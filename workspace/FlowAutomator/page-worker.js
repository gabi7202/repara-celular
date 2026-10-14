/**
 * page-worker.js
 * ------------------------------------------------------------------
 * Se INYECTA en la pestaña de Google Flow (mundo aislado de la extensión).
 * No depende de mensajes: expone `window.__flowAuto` con funciones async
 * cortas que el popup llama mediante chrome.scripting.executeScript.
 *
 * Filosofía: nunca confiar en un único selector. Todo se resuelve por
 * candidatos + puntuación + polling, para sobrevivir a cambios de UI.
 * ------------------------------------------------------------------
 */
(() => {
  if (window.__flowAuto) {
    // Ya instalado: solo refrescamos opciones si llegan nuevas.
    if (window.__flowAuto.__opts) window.__flowAuto.setOptions(window.__flowAuto.__opts);
    return;
  }

  /* ============================ UTILIDADES ============================ */

  const sleep = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms | 0)));

  const OPT = {
    minImageArea: 20000,        // px² mínimos para considerar una <img> como resultado
    typeDelayMs: 12,             // pausa entre "teclas" al escribir
    typeChunk: 3,                // caracteres por insertText
    fieldTimeoutMs: 8000,
    buttonTimeoutMs: 8000,
    generationTimeoutMs: 150000, // máx. espera por imagen (polling, no fijo)
    pollMs: 700,
    settleMs: 1800,              // espera extra tras detectar la imagen
    useNativeDownload: true,     // intenta el botón de descarga de Flow primero
    preferHighRes: true          // usa srcset/currentSrc si es mayor
  };

  const LOGS = [];
  const log = (...args) => {
    const line = args
      .map((a) => (typeof a === 'string' ? a : (() => { try { return JSON.stringify(a); } catch { return String(a); } })()))
      .join(' ');
    LOGS.push({ t: Date.now(), msg: line });
    if (LOGS.length > 400) LOGS.shift();
    console.log('%c[FlowAuto]', 'color:#f4b400;font-weight:bold', ...args);
  };

  const textoDe = (el) => {
    if (!el) return '';
    return ((el.getAttribute && (el.getAttribute('aria-label') || el.getAttribute('title'))) ||
            el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ');
  };

  const esVisible = (el) => {
    if (!el || !el.getBoundingClientRect) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const st = window.getComputedStyle(el);
    return st.visibility !== 'hidden' && st.display !== 'none' && parseFloat(st.opacity) > 0.01;
  };

  const dentroDeContenedorNoDeseado = (el) => {
    let p = el;
    for (let i = 0; i < 8 && p && p !== document.body; i++, p = p.parentElement) {
      const cls = String(p.className && p.className.baseVal !== undefined ? p.className.baseVal : p.className || '');
      if (/\b(avatar|profile|thumbnail|logo|sidebar-nav)\b/i.test(cls)) return true;
      const tag = p.tagName;
      if (tag === 'HEADER' || tag === 'NAV' || tag === 'FOOTER') return true;
    }
    return false;
  };

  const normalizar = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  const puntuaTexto = (txt, grupos) => {
    const t = normalizar(txt);
    if (!t) return 0;
    let score = 0;
    grupos.forEach((grupo, i) => {
      if (grupo.some((w) => t.includes(w))) score += (grupos.length - i) * 10;
    });
    if (t.length < 40) score += 4; // etiquetas cortas suelen ser botones reales
    return score;
  };

  /* ======================= DETECCIÓN DE CAMPOS ======================= */

  const GRUPOS_PROMPT = [
    ['describe', 'prompt', 'escribe', 'write your', 'cuentame', 'que quieres', 'ask gemini', 'imagen'],
    ['idea', 'scene', 'escena']
  ];

  function candidatosPromptField() {
    const set = new Set();
    document.querySelectorAll('textarea').forEach((e) => set.add(e));
    document.querySelectorAll('[contenteditable="true"],[contenteditable=""]').forEach((e) => set.add(e));
    document.querySelectorAll('[role="textbox"]').forEach((e) => set.add(e));
    document.querySelectorAll('div[aria-multiline="true"]').forEach((e) => set.add(e));
    document.querySelectorAll('input[type="text"]').forEach((e) => {
      // Evitar campos de búsqueda/filtro
      const t = normalizar(e.getAttribute('aria-label') + ' ' + e.placeholder);
      if (!/search|buscar|filter|filtrar/.test(t)) set.add(e);
    });
    return [...set].filter(esVisible).filter((e) => !e.closest('[hidden]'));
  }

  function elegirPromptField() {
    const cands = candidatosPromptField();
    if (!cands.length) return null;
    let mejor = null, mejorScore = -1;
    for (const el of cands) {
      let score = 0;
      const etiquetas = [
        el.getAttribute('aria-label'), el.getAttribute('placeholder'), el.getAttribute('data-placeholder'),
        el.getAttribute('title'), textoDe(el)
      ].filter(Boolean).join(' ');
      score += puntuaTexto(etiquetas, GRUPOS_PROMPT);
      if (el.tagName === 'TEXTAREA') score += 12;
      if (el.getAttribute('role') === 'textbox') score += 10;
      if (el.isContentEditable) score += 8;
      const r = el.getBoundingClientRect();
      if (r.top > window.innerHeight * 0.45) score += 10; // los compositores suelen vivir abajo
      if (r.width > 260) score += 6;
      if (el.disabled || el.readOnly) score -= 100;
      if (score > mejorScore) { mejorScore = score; mejor = el; }
    }
    return { el: mejor, score: mejorScore, total: cands.length };
  }

  async function esperarPromptField(timeoutMs = OPT.fieldTimeoutMs) {
    const fin = Date.now() + timeoutMs;
    let ultimo = null;
    while (Date.now() < fin) {
      ultimo = elegirPromptField();
      if (ultimo && ultimo.el && ultimo.score > 0) return ultimo;
      await sleep(250);
    }
    return (ultimo && ultimo.el) ? ultimo : null;
  }

  async function rellenarPrompt(el, texto) {
    el.focus();
    await sleep(120);

    const esCampoNativo = el.tagName === 'TEXTAREA' || el.tagName === 'INPUT';

    // 1) Seleccionar todo / limpiar
    try {
      if (esCampoNativo) {
        el.select && el.select();
      } else if (document.activeElement === el) {
        document.execCommand('selectAll', false, null);
      }
      await sleep(60);
      document.execCommand('delete', false, null);
    } catch (e) { /* algunos editores no soportan execCommand */ }

    // 2) Escritura "humana" vía execCommand (lo que mejor entiende ProseMirror/Lexical/React)
    let insertado = false;
    for (let i = 0; i < texto.length; i += OPT.typeChunk) {
      const trozo = texto.slice(i, i + OPT.typeChunk);
      try {
        if (document.execCommand('insertText', false, trozo)) { insertado = true; }
      } catch (e) { break; }
      await sleep(OPT.typeDelayMs);
    }

    const actual = leerValor(el);
    if (normalizar(actual).includes(normalizar(texto).slice(0, 40)) || actual.trim().length >= texto.trim().length * 0.9) {
      return { metodo: 'execCommand', ok: true };
    }

    // 3) Fallback A: setter nativo + eventos (React controlado)
    if (esCampoNativo) {
      const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value') && Object.getOwnPropertyDescriptor(proto, 'value').set;
      if (setter) setter.call(el, texto); else el.value = texto;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
      await sleep(250);
      if (leerValor(el).trim()) return { metodo: 'setter-nativo', ok: true, insertado };
    } else {
      // Fallback B: beforeinput + DOM directo (editores ricos)
      try {
        el.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertText', data: texto }));
      } catch (e) {}
      el.innerText = texto;
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: texto }));
      // Colocar el caret al final para que el editor no se confunda
      try {
        const rango = document.createRange();
        rango.selectNodeContents(el);
        rango.collapse(false);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(rango);
      } catch (e) {}
      await sleep(250);
      if (leerValor(el).trim()) return { metodo: 'dom-directo', ok: true, insertado };
    }

    return { metodo: insertado ? 'execCommand-parcial' : 'desconocido', ok: leerValor(el).trim().length > 0 };
  }

  function leerValor(el) {
    if (!el) return '';
    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') return el.value || '';
    return (el.innerText || el.textContent || '').trim();
  }

  /* ======================= DETECCIÓN DE BOTONES ======================= */

  const GRUPOS_GENERAR = [
    ['generar', 'generate', 'crear', 'create', 'enviar', 'send', 'run', 'make', 'ejecutar'],
    ['imagen', 'image', 'video', 'escena', 'scene', 'foto']
  ];
  const GRUPOS_DESCARGAR = [
    ['descargar', 'download', 'bajar imagen', 'guardar imagen', 'save image', 'exportar', 'export image'],
    []
  ];
  const PALABRAS_MALAS_BOTON = ['borrar', 'delete', 'cancelar', 'cancel', 'cerrar', 'close', 'eliminar', 'remove', 'share', 'compartir', 'copiar', 'copy', 'feedback', 'ayuda', 'help', 'menu', 'more options', 'mas opciones', 'like', 'dislike', 'thumbs', 'nueva conversacion', 'new chat', 'configuracion', 'settings', 'iniciar sesion', 'sign in'];

  function botonesCandidatos() {
    const set = new Set();
    document.querySelectorAll('button, [role="button"], [data-testid*="button" i]').forEach((b) => set.add(b));
    // Algunos compositores usan el botón de "enviar" como svg/div
    document.querySelectorAll('[aria-label]').forEach((b) => {
      if (b.tagName === 'DIV' || b.tagName === 'SPAN') set.add(b);
    });
    return [...set].filter(esVisible);
  }

  function estaHabilitado(b) {
    if (b.disabled) return false;
    if (b.getAttribute('aria-disabled') === 'true') return false;
    const st = window.getComputedStyle(b);
    if (parseFloat(st.opacity) < 0.35 || st.pointerEvents === 'none') return false;
    return true;
  }

  function scoreBoton(b, grupos, cercaDe, exigirHabilitado) {
    const etiqueta = textoDe(b);
    if (!etiqueta && !b.querySelector('svg')) return -Infinity;
    let score = puntuaTexto(etiqueta, grupos);
    if (PALABRAS_MALAS_BOTON.some((w) => normalizar(etiqueta).includes(w))) score -= 60;
    if (!etiqueta && b.querySelector('svg')) score += 2; // botón solo-ícono: candidato débil
    if (!estaHabilitado(b)) score -= (exigirHabilitado ? 500 : 20);
    if (cercaDe) {
      const d = distancia(b, cercaDe);
      if (d !== null) score += Math.max(0, 22 - Math.round(d / 26));
    }
    return score;
  }

  function buscarBoton(grupos, { cercaDe = null, exigirHabilitado = true, umbral = 10 } = {}) {
    let mejor = null, mejorScore = umbral - 1;
    for (const b of botonesCandidatos()) {
      const score = scoreBoton(b, grupos, cercaDe, exigirHabilitado);
      if (score > mejorScore) { mejorScore = score; mejor = b; }
    }
    return mejor ? { el: mejor, score: mejorScore } : null;
  }

  async function esperarBoton(grupos, opts = {}) {
    const timeoutMs = opts.timeoutMs || OPT.buttonTimeoutMs;
    const fin = Date.now() + timeoutMs;
    while (Date.now() < fin) {
      const r = buscarBoton(grupos, opts);
      if (r) return r;
      await sleep(300);
    }
    return buscarBoton(grupos, opts);
  }

  /** Botón "Generar": etiqueta > cercanía al campo > ícono habilitado junto al campo. */
  function buscarBotonGenerar(campo) {
    const porEtiqueta = buscarBoton(GRUPOS_GENERAR, { exigirHabilitado: true, umbral: 30 });
    if (porEtiqueta) return Object.assign({ por: 'etiqueta' }, porEtiqueta);
    const porCercania = buscarBoton(GRUPOS_GENERAR, { cercaDe: campo || null, exigirHabilitado: true, umbral: 10 });
    if (porCercania) return Object.assign({ por: 'cercanía' }, porCercania);
    if (campo) {
      let mejor = null, mejorScore = 0;
      for (const b of botonesCandidatos()) {
        if (!estaHabilitado(b)) continue;
        const etiqueta = normalizar(textoDe(b));
        if (etiqueta && PALABRAS_MALAS_BOTON.some((w) => etiqueta.includes(w))) continue;
        const d = distancia(b, campo);
        if (d === null || d > 340) continue;
        const score = (b.querySelector('svg') ? 20 : 8) + Math.max(0, 26 - Math.round(d / 14));
        if (score > mejorScore) { mejorScore = score; mejor = b; }
      }
      if (mejor) return { el: mejor, score: mejorScore, por: 'ícono-junto-al-campo' };
    }
    return null;
  }

  /** Botón de descarga: solo si hay etiqueta explícita (nada de adivinar por íconos). */
  function buscarBotonDescarga(cercaDe) {
    const r = buscarBoton(GRUPOS_DESCARGAR, { cercaDe: cercaDe || null, exigirHabilitado: true, umbral: 30 });
    return r ? Object.assign({ por: 'etiqueta' }, r) : null;
  }

  function distancia(a, b) {
    try {
      const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
      return Math.hypot(ra.left - rb.left, ra.top - rb.top);
    } catch { return null; }
  }

  function clickSeguro(el) {
    if (!el) return false;
    try {
      el.scrollIntoView({ block: 'center', inline: 'center' });
    } catch {}
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    const objetivo = document.elementFromPoint(x, y) || el;
    const destino = objetivo === el || el.contains(objetivo) ? objetivo : el;
    ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach((tipo) => {
      const Ev = tipo.startsWith('pointer') ? PointerEvent : MouseEvent;
      destino.dispatchEvent(new Ev(tipo, { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, button: 0 }));
    });
    return true;
  }

  /* ============================ IMÁGENES ============================ */

  function areaImg(img) {
    const r = img.getBoundingClientRect();
    return (r.width || img.naturalWidth || 0) * (r.height || img.naturalHeight || 0);
  }

  function inventarioImagenes() {
    const mapa = new Map();
    document.querySelectorAll('img').forEach((img, i) => {
      const clave = img.currentSrc || img.src || `sin-src-${i}`;
      const r = img.getBoundingClientRect();
      const info = mapa.get(clave) || { clave, imgs: [], areaMax: 0, el: img };
      info.imgs.push(img);
      const a = areaImg(img);
      if (a > info.areaMax) { info.areaMax = a; info.el = img; }
      mapa.set(clave, info);
    });
    // Resultados pintados en <canvas> (algunos visores de Flow no usan <img>)
    const canvases = [...document.querySelectorAll('canvas')].filter(esVisible);
    canvases.forEach((c, i) => {
      const r = c.getBoundingClientRect();
      const a = r.width * r.height;
      if (a < OPT.minImageArea) return;
      if (dentroDeContenedorNoDeseado(c)) return;
      mapa.set('canvas#' + i, { clave: 'canvas#' + i, imgs: [], areaMax: a, el: c, esCanvas: true });
    });
    // CSS backgrounds con url()
    document.querySelectorAll('*').forEach((el) => {
      if (mapa.size > 400) return;
      const bg = window.getComputedStyle(el).backgroundImage;
      const m = /url\(["']?(.*?)["']?\)/.exec(bg || '');
      if (!m || m[1].startsWith('data:image/svg')) return;
      const r = el.getBoundingClientRect();
      const a = r.width * r.height;
      if (a < OPT.minImageArea) return;
      const clave = m[1];
      if (mapa.has(clave)) return;
      mapa.set(clave, { clave, imgs: [], areaMax: a, el, esBackground: true });
    });
    return mapa;
  }

  function urlAltaResolucion(info) {
    if (info.esCanvas) {
      const r = info.el.getBoundingClientRect();
      return { url: '', ancho: Math.max(r.width, info.el.width || 0), esCanvas: true };
    }
    let mejor = info.clave;
    let mejorW = 0;
    const candidatos = new Set([info.clave]);
    info.imgs.forEach((img) => {
      if (img.currentSrc) candidatos.add(img.currentSrc);
      if (img.src) candidatos.add(img.src);
      if (img.getAttribute && img.getAttribute('srcset')) {
        img.getAttribute('srcset').split(',').forEach((parte) => {
          const [u, w] = parte.trim().split(/\s+/);
          if (u) candidatos.add(u);
        });
      }
      const r = img.getBoundingClientRect();
      mejorW = Math.max(mejorW, r.width, img.naturalWidth || 0);
    });
    // Si hay variantes con tamaño explícito en la URL (lh3.googleusercontent.com), pedir la grande
    let elegida = mejor;
    for (const u of candidatos) {
      if (/googleusercontent\.com/.test(u) && /[=-]w\d{2,5}/.test(u)) {
        const grande = u.replace(/([=-])w\d{2,5}(-h\d{2,5})?/, '$1w2048');
        candidatos.add(grande);
      }
    }
    for (const u of candidatos) {
      if (/googleusercontent/.test(u) && /w2048/.test(u)) { elegida = u; break; }
      if (!elegida || (u.length > elegida.length && /^https?:/.test(u))) elegida = u;
    }
    if (!OPT.preferHighRes) elegida = info.clave;
    return { url: elegida, ancho: mejorW };
  }

  function hayActividadGeneracion() {
    const spinners = [...document.querySelectorAll('[class*="loading" i],[class*="spinner" i],[class*="progress" i],[aria-busy="true"],[role="progressbar"]')]
      .filter(esVisible)
      .filter((e) => {
        const r = e.getBoundingClientRect();
        return r.width > 12 && r.height > 12;
      });
    const campo = elegirPromptField();
    const boton = buscarBoton(GRUPOS_GENERAR, { exigirHabilitado: false });
    const botonDesactivado = boton && boton.el ? !estaHabilitado(boton.el) : false;
    return { spinners: spinners.length, botonDesactivado, campoConTexto: campo && campo.el ? leerValor(campo.el).trim().length > 0 : false };
  }

  function elegirResultado(base, actual) {
    const nuevas = [];
    for (const [clave, info] of actual.entries()) {
      if (base.has(clave)) continue;
      if (info.areaMax < OPT.minImageArea) continue;
      if (dentroDeContenedorNoDeseado(info.el)) continue;
      if (/^data:image\/svg/.test(clave)) continue;
      nuevas.push(info);
    }
    if (nuevas.length) {
      nuevas.sort((a, b) => b.areaMax - a.areaMax);
      return { info: nuevas[0], tipo: 'nueva', candidatas: nuevas.length };
    }
    // Sin imágenes "nuevas": la de mayor área fuera de chrome/nav
    let mejor = null;
    for (const info of actual.values()) {
      if (info.areaMax < OPT.minImageArea) continue;
      if (dentroDeContenedorNoDeseado(info.el)) continue;
      if (/^data:image\/svg/.test(info.clave)) continue;
      if (!mejor || info.areaMax > mejor.areaMax) mejor = info;
    }
    return mejor ? { info: mejor, tipo: 'mayor', candidatas: 1 } : null;
  }

  async function urlADescargable(url) {
    if (!url) throw new Error('Sin URL de imagen.');
    if (url.startsWith('blob:') || url.startsWith('data:')) return { url, mime: url.startsWith('data:') ? (url.slice(5).split(';')[0] || 'image/png') : 'image/png' };
    // 1) fetch (mismo origen o CORS permisivo)
    try {
      const res = await fetch(url, { credentials: 'include', mode: 'cors' });
      if (res.ok) {
        const blob = await res.blob();
        if (blob.size > 0) return { url: URL.createObjectURL(blob), mime: blob.type || 'image/png', bytes: blob.size, via: 'fetch' };
      } else {
        log('fetch respondió', res.status, '→ probando no-cors/canvas');
      }
    } catch (e) {
      log('fetch falló:', e.message);
    }
    // 2) canvas (si la imagen no "mancha" el lienzo)
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        try {
          const c = document.createElement('canvas');
          c.width = img.naturalWidth; c.height = img.naturalHeight;
          c.getContext('2d').drawImage(img, 0, 0);
          const data = c.toDataURL('image/png');
          if (data && data.length > 1000) resolve({ url: data, mime: 'image/png', via: 'canvas' });
          else reject(new Error('Canvas vacío.'));
        } catch (e) {
          reject(new Error('Canvas bloqueado (CORS): ' + e.message));
        }
      };
      img.onerror = () => reject(new Error('No se pudo cargar la imagen para convertirla.'));
      img.src = url;
    });
  }

  function extensionDe(mime, url) {
    const m = String(mime || '').toLowerCase();
    if (m.includes('jpeg') || m.includes('jpg')) return 'jpg';
    if (m.includes('webp')) return 'webp';
    if (m.includes('gif')) return 'gif';
    if (m.includes('avif')) return 'avif';
    const mm = /\.(jpe?g|png|webp|gif|avif)(\?|$)/i.exec(String(url || ''));
    return mm ? mm[1].replace('jpeg', 'jpg') : 'png';
  }

  function nombreSeguro(s) {
    return String(s || '').replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 90);
  }

  /* ============================== API ============================== */

  let cancelado = false;
  let estado = { corriendo: false, paso: 'idle', detalle: '' };

  const api = {
    __opts: null,
    version: '2.0',

    setOptions(o) {
      Object.assign(OPT, o || {});
      api.__opts = Object.assign({}, OPT);
      return { exito: true, opciones: OPT };
    },

    estado() {
      return { exito: true, estado, cancelado, opciones: OPT };
    },

    logs(desde = 0) {
      return { exito: true, logs: LOGS.slice(desde), total: LOGS.length };
    },

    cancelar() {
      cancelado = true;
      log('Cancelación solicitada por el usuario.');
      return { exito: true };
    },

    /** Diagnóstico: ¿qué ve la extensión en la página? */
    diagnosticar() {
      const campo = elegirPromptField();
      const btnGen = buscarBotonGenerar(campo && campo.el);
      const btnDown = buscarBotonDescarga(null);
      const inv = inventarioImagenes();
      const imagenes = [...inv.values()]
        .filter((i) => i.areaMax >= OPT.minImageArea)
        .sort((a, b) => b.areaMax - a.areaMax)
        .slice(0, 8)
        .map((i) => ({ area: Math.round(i.areaMax), url: String(i.clave).slice(0, 140), bg: !!i.esBackground }));
      return {
        exito: true,
        url: location.href,
        titulo: document.title,
        campoPrompt: campo && campo.el
          ? { encontrado: true, tag: campo.el.tagName, score: campo.score, candidatos: campo.total, ariaLabel: campo.el.getAttribute('aria-label'), placeholder: campo.el.getAttribute('placeholder'), editable: campo.el.isContentEditable }
          : { encontrado: false, candidatos: campo ? campo.total : 0 },
        botonGenerar: btnGen ? { etiqueta: textoDe(btnGen.el) || '(solo ícono)', score: btnGen.score, criterio: btnGen.por, habilitado: estaHabilitado(btnGen.el) } : null,
        botonDescargar: btnDown ? { etiqueta: textoDe(btnDown.el), score: btnDown.score } : null,
        imagenes,
        canvas: [...document.querySelectorAll('canvas')].filter(esVisible).length,
        actividad: hayActividadGeneracion()
      };
    },

    /** Paso 1: escribir el prompt en el compositor. */
    async escribirPrompt(prompt) {
      estado = { corriendo: true, paso: 'escribiendo', detalle: '' };
      cancelado = false;
      try {
        const campo = await esperarPromptField();
        if (!campo || !campo.el) throw new Error('No encuentro el campo de prompt. ¿Estás en Flow y con el panel de creación abierto?');
        log('Campo detectado:', campo.el.tagName, 'score', campo.score, 'de', campo.total, 'candidatos.');
        const r = await rellenarPrompt(campo.el, prompt);
        const valor = leerValor(campo.el);
        if (!valor.trim()) throw new Error('El campo quedó vacío tras escribir (método: ' + r.metodo + ').');
        if (valor.trim().length < prompt.trim().length * 0.8) {
          log('AVISO: el texto escrito (' + valor.length + ') es más corto que el prompt (' + prompt.length + ').');
        }
        estado = { corriendo: true, paso: 'prompt-listo', detalle: r.metodo };
        await sleep(500); // dar tiempo al debounce de Flow para habilitar el botón
        return { exito: true, metodo: r.metodo, caracteres: valor.length };
      } catch (e) {
        estado = { corriendo: false, paso: 'error', detalle: e.message };
        return { exito: false, error: e.message };
      }
    },

    /** Paso 2: pulsar generar y esperar a que aparezca la imagen. */
    async generarYEsperar(opts = {}) {
      const timeoutMs = opts.timeoutMs || OPT.generationTimeoutMs;
      estado = { corriendo: true, paso: 'generando', detalle: '' };
      try {
        const base = inventarioImagenes();
        let btn = null;
        const finBoton = Date.now() + OPT.buttonTimeoutMs;
        while (Date.now() < finBoton && !btn) {
          btn = buscarBotonGenerar(elegirPromptField() && elegirPromptField().el);
          if (!btn) await sleep(300);
        }
        if (!btn || !btn.el) throw new Error('No encuentro el botón de generar (¿está deshabilitado porque el campo quedó vacío?).');
        log('Botón generar:', textoDe(btn.el) || '(solo ícono)', '| criterio:', btn.por, '| score', btn.score);
        clickSeguro(btn.el);

        const inicio = Date.now();
        let ultimoInventario = base;
        let resultado = null;
        let areaAnterior = -1;
        let estables = 0;
        let cargando = true;

        while (Date.now() - inicio < timeoutMs) {
          if (cancelado) throw new Error('Cancelado por el usuario.');
          await sleep(OPT.pollMs);
          const inv = inventarioImagenes();
          ultimoInventario = inv;
          const act = hayActividadGeneracion();
          cargando = act.spinners > 0 || act.botonDesactivado;
          const r = elegirResultado(base, inv);

          if (r) {
            if (cargando) {
              estado = { corriendo: true, paso: 'generando', detalle: 'imagen parcial detectada, sigue procesando…' };
              areaAnterior = -1; estables = 0;
              continue;
            }
            // La imagen debe dejar de cambiar de tamaño (fin del lazy-load / upscale)
            if (Math.abs(r.info.areaMax - areaAnterior) <= 4 && r.info.areaMax >= OPT.minImageArea) estables++;
            else estables = 0;
            areaAnterior = r.info.areaMax;
            estado = { corriendo: true, paso: 'generando', detalle: `imagen detectada, estabilizando (${estables}/2)…` };
            if (estables >= 2) { resultado = r; break; }
            continue;
          }
          estado = { corriendo: true, paso: 'generando', detalle: cargando ? 'procesando…' : 'esperando resultado…' };
        }

        if (!resultado) {
          const r = elegirResultado(base, ultimoInventario);
          if (!r) throw new Error('Timeout: no apareció ninguna imagen nueva en ' + Math.round(timeoutMs / 1000) + 's. Mira el diagnóstico (🔍) y el registro.');
          log('Sin estabilidad confirmada: usando la mejor imagen disponible (' + r.tipo + ').');
          resultado = r;
        }

        await sleep(OPT.settleMs);
        const { url, ancho, esCanvas } = urlAltaResolucion(resultado.info);
        api.__ultimaImagen = url || null;
        api.__ultimoCanvas = resultado.info.esCanvas ? resultado.info.el : null;
        estado = { corriendo: true, paso: 'imagen-lista', detalle: resultado.tipo };
        log('Imagen lista (' + resultado.tipo + (esCanvas ? ', canvas' : '') + '), ancho aprox ' + Math.round(ancho) + 'px.');
        return { exito: true, url: url || '', esCanvas: !!esCanvas, tipo: resultado.tipo, ancho, segundos: Math.round((Date.now() - inicio) / 1000) };
      } catch (e) {
        estado = { corriendo: false, paso: 'error', detalle: e.message };
        return { exito: false, error: e.message };
      }
    },

    /** Paso 3a: descargar usando el botón nativo de Flow (respeta su formato/calidad). */
    async descargarConBoton(urlImagen) {
      if (!OPT.useNativeDownload) return { exito: false, error: 'deshabilitado por configuración' };
      try {
        const info = { clave: urlImagen, imgs: [...document.querySelectorAll('img')].filter((i) => (i.currentSrc || i.src) === urlImagen), areaMax: 0, el: null };
        info.imgs.forEach((i) => { const a = areaImg(i); if (a > info.areaMax) { info.areaMax = a; info.el = i; } });
        const ref = info.el;
        // Pasar el ratón por encima para que aparezcan los controles flotantes
        if (ref) {
          const r = ref.getBoundingClientRect();
          ['pointerover', 'mouseover', 'pointerenter', 'mouseenter', 'pointermove', 'mousemove'].forEach((tipo) => {
            const Ev = tipo.startsWith('pointer') ? PointerEvent : MouseEvent;
            ref.dispatchEvent(new Ev(tipo, { bubbles: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }));
          });
          await sleep(600);
        }
        let btn = null;
        const finEspera = Date.now() + 4000;
        while (Date.now() < finEspera && !btn) { btn = buscarBotonDescarga(ref); if (!btn) await sleep(300); }
        if (!btn || !btn.el) return { exito: false, error: 'sin botón de descarga visible' };
        clickSeguro(btn.el);
        log('Click en botón de descarga nativo:', textoDe(btn.el));
        await sleep(1500);
        return { exito: true, boton: textoDe(btn.el) };
      } catch (e) {
        return { exito: false, error: e.message };
      }
    },

    /** Paso 3b: obtener la imagen y entregarla al background para descargarla. */
    async prepararDescarga(urlImagen) {
      estado = { corriendo: true, paso: 'descargando', detalle: '' };
      try {
        const objetivo = urlImagen || api.__ultimaImagen;
        let url, mime, via;
        if (!objetivo && api.__ultimoCanvas) {
          const data = api.__ultimoCanvas.toDataURL('image/png');
          url = data; mime = 'image/png'; via = 'canvas-dom';
        } else if (!objetivo) {
          throw new Error('No hay URL de imagen que descargar.');
        } else {
          const r = await urlADescargable(objetivo);
          url = r.url; mime = r.mime; via = r.via;
        }
        const ext = extensionDe(mime, objetivo);
        estado = { corriendo: false, paso: 'listo-para-guardar', detalle: via };
        return { exito: true, url, mime, ext, via };
      } catch (e) {
        estado = { corriendo: false, paso: 'error', detalle: e.message };
        return { exito: false, error: e.message };
      }
    },

    /** Último recurso: exporta a PNG el <canvas> más grande de la página. */
    async capturarCanvas() {
      try {
        const cs = [...document.querySelectorAll('canvas')].filter(esVisible).sort((a, b) => {
          const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
          return (rb.width * rb.height) - (ra.width * ra.height);
        });
        for (const c of cs) {
          const r = c.getBoundingClientRect();
          if (r.width * r.height < OPT.minImageArea) continue;
          try {
            const data = c.toDataURL('image/png');
            if (data && data.length > 2000) {
              log('Canvas exportado (' + Math.round(r.width) + '×' + Math.round(r.height) + ').');
              return { exito: true, url: data, mime: 'image/png', ext: 'png', via: 'canvas-manual' };
            }
          } catch (e) { log('Canvas no exportable:', e.message); }
        }
        return { exito: false, error: 'No hay ningún canvas exportable en la página.' };
      } catch (e) {
        return { exito: false, error: e.message };
      }
    },

    nombreSeguro
  };

  window.__flowAuto = api;
  log('Flow Automator instalado en', location.href);
})();
