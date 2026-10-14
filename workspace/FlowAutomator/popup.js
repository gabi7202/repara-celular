/**
 * popup.js — orquestador.
 *
 * Estrategia anti-fragilidad:
 *  - El "robot" vive en page-worker.js, inyectado UNA sola vez en la pestaña.
 *  - Cada llamada a la página es corta (dispara y devuelve) y el popup hace
 *    polling: así no dependemos de canales de mensajería largos que Chrome
 *    pueda cortar, y el estado se guarda en chrome.storage.local para poder
 *    reabrir el popup y ver cómo va la corrida.
 */

const $ = (id) => document.getElementById(id);
const CLAVE_ESTADO = 'flowAuto_estado';
const CLAVE_CFG = 'flowAuto_cfg';

let TAB_ID = null;
let corriendo = false;
let detener = false;
let corrida = null;   // { prompts, resultados, indice }
let ultimoLogIdx = 0;

/* ------------------------------ helpers ------------------------------ */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function tabActiva() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function enPagina(fn, ...args) {
  if (TAB_ID === null) throw new Error('Sin pestaña activa.');
  const res = await chrome.scripting.executeScript({
    target: { tabId: TAB_ID },
    world: 'ISOLATED',
    func: fn,
    args
  });
  if (chrome.runtime.lastError) throw new Error(chrome.runtime.lastError.message);
  return res && res[0] ? res[0].result : undefined;
}

/**
 * Dispara un método del robot en la página y hace polling hasta obtener el resultado.
 * Cada executeScript es corto (no depende de canales de mensajería largos).
 */
async function llamarMetodo(nombre, args = [], { timeoutMs = 30000, pollMs = 400, onTick = null } = {}) {
  await enPagina((n, a) => {
    const api = window.__flowAuto;
    if (!api || typeof api[n] !== 'function') throw new Error('Método no disponible en la página: ' + n);
    api.__pend = api.__pend || {};
    api.__res = api.__res || {};
    if (api.__pend[n]) return true; // ya en curso
    api.__pend[n] = true;
    api.__res[n] = undefined;
    Promise.resolve(api[n].apply(api, a))
      .then((r) => { api.__res[n] = r === undefined ? { exito: true } : r; })
      .catch((e) => { api.__res[n] = { exito: false, error: String((e && e.message) || e) }; })
      .finally(() => { api.__pend[n] = false; });
    return true;
  }, nombre, args);

  const fin = Date.now() + timeoutMs;
  while (Date.now() < fin) {
    await sleep(pollMs);
    if (onTick) { try { await onTick(); } catch {} }
    const r = await enPagina((n) => {
      const api = window.__flowAuto;
      if (!api) return { __fatal: true, error: 'El robot no está en la página (recarga Flow y reintenta).' };
      if (api.__pend && api.__pend[n]) return { __pendiente: true, estado: api.estado ? api.estado() : null };
      const out = api.__res ? api.__res[n] : undefined;
      if (api.__res) api.__res[n] = undefined;
      return out === undefined ? { __pendiente: true } : out;
    }, nombre);
    if (r && r.__fatal) throw new Error(r.error);
    if (r && !r.__pendiente) return r;
  }
  throw new Error('Tiempo de espera agotado en "' + nombre + '".');
}

async function leerEstadoPagina() {
  return enPagina(() => {
    const api = window.__flowAuto;
    if (!api) return null;
    return { estado: api.estado(), logs: api.logs ? api.logs(0) : { logs: [] } };
  });
}

async function inyectarWorker() {
  const src = await (await fetch(chrome.runtime.getURL('page-worker.js'))).text();
  const res = await enPagina((codigo) => {
    try {
      // eslint-disable-next-line no-eval
      (0, eval)(codigo);
      return { exito: !!window.__flowAuto, version: window.__flowAuto ? window.__flowAuto.version : null };
    } catch (e) {
      return { exito: false, error: String(e && e.message || e) };
    }
  }, src);
  if (!res || !res.exito) throw new Error('No se pudo instalar el robot en la página: ' + (res && res.error || 'desconocido'));
  return res;
}

function slug(texto, max = 48) {
  return String(texto || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max) || 'imagen';
}

function parsearPrompts(texto) {
  const lineas = String(texto || '').split(/\r?\n/);
  const out = [];
  for (const linea of lineas) {
    const cruda = linea.replace(/^\s*(\d{1,4})\s*[.)\-–:]\s+/, ''); // "1. ", "2) "…
    if (!cruda.trim()) continue;
    if (/^\s*(\/\/|#)\s/.test(linea)) continue;                     // comentarios
    if (/^\s{2,}\S/.test(linea) && out.length) {                    // continuación
      out[out.length - 1] += ' ' + cruda.trim();
      continue;
    }
    out.push(cruda.trim());
  }
  return out.map((p) => p.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

/* ------------------------------ UI ------------------------------ */

function estado(msg) { $('estado').textContent = msg; }

function loguear(texto) {
  const pre = $('log').textContent === '—' ? '' : $('log').textContent + '\n';
  $('log').textContent = (pre + texto).slice(-12000);
  $('log').scrollTop = $('log').scrollHeight;
}

function pintarLista() {
  if (!corrida) return;
  const cont = $('lista');
  cont.classList.remove('oculto');
  cont.innerHTML = corrida.resultados.map((r, i) => {
    const clase = r.estado === 'ok' ? 'ok' : r.estado === 'error' ? 'err' : r.estado === 'corriendo' ? 'run' : '';
    const icono = r.estado === 'ok' ? '✅' : r.estado === 'error' ? '❌' : r.estado === 'corriendo' ? '⏳' : '·';
    const detalle = r.estado === 'ok' ? (r.segundos ? r.segundos + 's' : 'ok') : r.estado === 'error' ? (r.error || '').slice(0, 34) : (r.fase || '');
    return `<div class="item"><span class="n">${String(i + 1).padStart(3, '0')}</span><span class="p" title="${(r.prompt || '').replace(/"/g, '&quot;')}">${(r.prompt || '').replace(/</g, '&lt;')}</span><span class="s ${clase}">${icono} ${detalle}</span></div>`;
  }).join('');
  const hechos = corrida.resultados.filter((r) => r.estado === 'ok').length;
  $('barra').style.width = Math.round((hechos / Math.max(1, corrida.prompts.length)) * 100) + '%';
}

function modoCorriendo(on) {
  corriendo = on;
  $('btnIniciar').disabled = on;
  $('btnIniciar').textContent = on ? '⏳ En curso…' : '🚀 Iniciar';
  $('btnParar').classList.toggle('oculto', !on);
  ['prompts', 'carpeta', 'pausa', 'timeout', 'nativo', 'informe', 'nombres'].forEach((id) => { $(id).disabled = on; });
}

async function guardarCfg() {
  await chrome.storage.local.set({
    [CLAVE_CFG]: {
      carpeta: $('carpeta').value, pausa: $('pausa').value, timeout: $('timeout').value,
      nativo: $('nativo').checked, informe: $('informe').checked, nombres: $('nombres').value,
      prompts: $('prompts').value
    }
  });
}

async function cargarCfg() {
  const { [CLAVE_CFG]: cfg } = await chrome.storage.local.get(CLAVE_CFG);
  if (!cfg) return;
  if (cfg.carpeta) $('carpeta').value = cfg.carpeta;
  if (cfg.pausa) $('pausa').value = cfg.pausa;
  if (cfg.timeout) $('timeout').value = cfg.timeout;
  if (typeof cfg.nativo === 'boolean') $('nativo').checked = cfg.nativo;
  if (typeof cfg.informe === 'boolean') $('informe').checked = cfg.informe;
  if (cfg.nombres) $('nombres').value = cfg.nombres;
  if (cfg.prompts) $('prompts').value = cfg.prompts;
}

/* --------------------------- flujo principal --------------------------- */

async function prepararTab() {
  const tab = await tabActiva();
  if (!tab) throw new Error('No hay pestaña activa.');
  if (!/^(https:\/\/)?(flow\.google\.com|labs\.google)/.test(tab.url || '')) {
    const a = $('alertaTab');
    a.classList.remove('oculto');
    a.textContent = '⚠️ La pestaña activa no es Google Flow (' + (tab.url || 'sin url').slice(0, 45) + '…). Abre flow.google.com y vuelve a intentarlo.';
    throw new Error('Pestaña incorrecta.');
  }
  $('alertaTab').classList.add('oculto');
  TAB_ID = tab.id;
  return tab;
}

async function asegurarWorker() {
  try {
    const hay = await enPagina(() => ({ ok: !!(window.__flowAuto && window.__flowAuto.version), v: window.__flowAuto && window.__flowAuto.version }));
    if (hay && hay.ok) return hay;
  } catch (e) { /* reintentamos inyectando */ }
  return inyectarWorker();
}

async function aplicarOpciones(timeoutSeg, usarNativo) {
  await enPagina((t, n) => {
    window.__flowAuto.setOptions({ generationTimeoutMs: t * 1000, useNativeDownload: n });
    return true;
  }, timeoutSeg, usarNativo);
}

async function correrPrompt(prompt, indice, carpeta, modoNombre, usarNativo, timeoutSeg) {
  // 1) Escribir el prompt en el compositor
  const escrito = await llamarMetodo('escribirPrompt', [prompt], { timeoutMs: 30000, pollMs: 300 });
  if (!escrito.exito) throw new Error(escrito.error || 'No se pudo escribir el prompt.');

  // 2) Pulsar generar y esperar a que aparezca la imagen (polling, no timeout fijo)
  const generado = await llamarMetodo('generarYEsperar', [{ timeoutMs: timeoutSeg * 1000 }], {
    timeoutMs: timeoutSeg * 1000 + 45000,
    pollMs: 900,
    onTick: async () => {
      if (detener) throw new Error('Detenido por el usuario.');
      const s = await enPagina(() => window.__flowAuto.estado());
      if (s && s.exito && s.estado) {
        estado(`⏳ ${indice + 1}: ${s.estado.detalle || s.estado.paso}`);
        if (corrida) { corrida.resultados[indice].fase = s.estado.detalle || s.estado.paso; }
      }
      actualizarLogDesdePagina();
    }
  });
  if (!generado.exito) throw new Error(generado.error || 'Fallo al generar la imagen.');

  // 3) Guardar el archivo
  const base = modoNombre === 'numero'
    ? String(indice + 1).padStart(3, '0')
    : String(indice + 1).padStart(3, '0') + '-' + slug(prompt);

  // 3a) Botón nativo de Flow + reubicación del archivo a tu carpeta (mejor calidad/formato original)
  if (usarNativo && !generado.esCanvas) {
    const nombreNativo = `${carpeta}/${base}.png`; // el background corrige la extensión real
    await chrome.runtime.sendMessage({ action: 'prepararReubicacion', filename: nombreNativo }).catch(() => {});
    const nativo = await llamarMetodo('descargarConBoton', [generado.url], { timeoutMs: 20000, pollMs: 500 })
      .catch((e) => ({ exito: false, error: e.message }));
    if (nativo && nativo.exito) {
      const reub = await chrome.runtime.sendMessage({ action: 'esperarReubicacion', timeoutMs: 45000 }).catch(() => null);
      if (reub && reub.exito) {
        return { exito: true, filename: reub.filename, metodo: 'nativo-flow', segundos: generado.segundos, url: generado.url };
      }
      loguear(`[${indice + 1}] Flow descargó el archivo pero no pude moverlo a "${carpeta}" (${(reub && reub.error) || 'sin respuesta'}). Quedó en la raíz de Descargas.`);
      return { exito: true, filename: '(raíz de Descargas)', metodo: 'nativo-flow-sin-mover', segundos: generado.segundos, url: generado.url };
    }
    loguear(`[${indice + 1}] Sin botón de descarga de Flow (${(nativo && nativo.error) || 'n/d'}) → captura directa.`);
  }

  // 3b) Captura directa: la página convierte la imagen a blob/data URL y el background la guarda
  let prep = await llamarMetodo('prepararDescarga', [generado.url], { timeoutMs: 60000, pollMs: 400 })
    .catch((e) => ({ exito: false, error: e.message }));
  if (!prep || !prep.exito) {
    loguear(`[${indice + 1}] Captura por URL falló (${prep && prep.error}) → intentando exportar <canvas>.`);
    prep = await llamarMetodo('capturarCanvas', [], { timeoutMs: 30000, pollMs: 400 }).catch((e) => ({ exito: false, error: e.message }));
  }
  if (!prep || !prep.exito) throw new Error((prep && prep.error) || 'No se pudo obtener la imagen.');

  const filename = `${carpeta}/${base}.${prep.ext || 'png'}`;
  const res = await chrome.runtime.sendMessage({ action: 'descargar', url: prep.url, filename });
  if (!res || !res.exito) throw new Error((res && res.error) || 'chrome.downloads rechazó la descarga.');
  return { exito: true, filename, metodo: 'captura/' + (prep.via || '?'), segundos: generado.segundos, url: generado.url };
}

async function actualizarLogDesdePagina() {
  try {
    const r = await enPagina(() => window.__flowAuto.logs(0));
    if (r && r.exito && r.logs && r.logs.length !== ultimoLogIdx) {
      ultimoLogIdx = r.logs.length;
      const nuevas = r.logs.slice(-14).map((l) => new Date(l.t).toLocaleTimeString() + '  ' + l.msg).join('\n');
      $('log').textContent = ($('log').textContent === '—' ? '' : $('log').textContent + '\n') + nuevas;
      $('log').textContent = $('log').textContent.slice(-12000);
      $('log').scrollTop = $('log').scrollHeight;
    }
  } catch {}
}

async function guardarInforme(carpeta, resultados, prompts) {
  if (!$('informe').checked) return;
  const esc = (v) => '"' + String(v === undefined || v === null ? '' : v).replace(/"/g, '""') + '"';
  const csv = ['indice;estado;archivo;segundos;metodo;prompt;error']
    .concat(resultados.map((r, i) => [i + 1, r.estado, r.filename || '', r.segundos || '', r.metodo || '', esc(prompts[i] || ''), esc(r.error || '')].join(';')))
    .join('\n');
  await chrome.runtime.sendMessage({ action: 'guardarTexto', texto: '\ufeff' + csv, filename: `${carpeta}/_informe.csv`, mime: 'text/csv;charset=utf-8' });
  const logTxt = await enPagina(() => {
    const r = window.__flowAuto.logs(0);
    return r.logs.map((l) => new Date(l.t).toISOString() + '  ' + l.msg).join('\n');
  }).catch(() => '');
  if (logTxt) await chrome.runtime.sendMessage({ action: 'guardarTexto', texto: logTxt, filename: `${carpeta}/_registro.txt`, mime: 'text/plain;charset=utf-8' });
}

async function iniciar() {
  detener = false;
  try {
    await prepararTab();
    await asegurarWorker();

    const prompts = parsearPrompts($('prompts').value);
    if (!prompts.length) { estado('⚠️ Escribe al menos un prompt (uno por línea).'); return; }

    const carpeta = ($('carpeta').value.trim() || 'imagenes_flow').replace(/[\\/:*?"<>|]+/g, '-').replace(/^\/+|\/+$/g, '');
    const modoNombre = $('nombres').value;
    const pausa = Math.max(0, parseInt($('pausa').value, 10) || 0) * 1000;
    const timeoutSeg = Math.max(20, parseInt($('timeout').value, 10) || 150);
    const usarNativo = $('nativo').checked;

    await aplicarOpciones(timeoutSeg, usarNativo);
    await guardarCfg();

    corrida = { prompts, resultados: prompts.map((p) => ({ prompt: p, estado: 'pendiente' })) };
    modoCorriendo(true);
    pintarLista();
    estado(`▶️ ${prompts.length} imágenes · carpeta "${carpeta}" · máx ${timeoutSeg}s c/u`);

    for (let i = 0; i < prompts.length; i++) {
      if (detener) { corrida.resultados[i].estado = 'cancelado'; break; }
      corrida.resultados[i].estado = 'corriendo';
      corrida.resultados[i].fase = 'escribiendo…';
      pintarLista();
      estado(`⏳ ${i + 1}/${prompts.length}: escribiendo prompt…`);
      const t0 = Date.now();
      try {
        const r = await correrPrompt(prompts[i], i, carpeta, modoNombre, usarNativo, timeoutSeg);
        corrida.resultados[i] = { prompt: prompts[i], estado: 'ok', filename: r.filename, metodo: r.metodo, segundos: r.segundos || Math.round((Date.now() - t0) / 1000) };
        estado(`✅ ${i + 1}/${prompts.length} guardada (${r.metodo})`);
      } catch (e) {
        corrida.resultados[i] = { prompt: prompts[i], estado: 'error', error: e.message };
        estado(`❌ ${i + 1}/${prompts.length}: ${e.message}`);
        loguear(`[${i + 1}] ERROR: ${e.message}`);
      }
      pintarLista();
      await chrome.storage.local.set({ [CLAVE_ESTADO]: { corrida: corrida.resultados, ts: Date.now() } });
      if (i < prompts.length - 1 && !detener) {
        for (let s = pausa; s > 0 && !detener; s -= 500) await sleep(Math.min(500, s));
      }
    }

    const ok = corrida.resultados.filter((r) => r.estado === 'ok').length;
    const mal = corrida.resultados.filter((r) => r.estado === 'error').length;
    await guardarInforme(carpeta, corrida.resultados, prompts).catch((e) => loguear('Informe no guardado: ' + e.message));
    estado(`🎉 Terminado: ${ok} correctas, ${mal} con error${detener ? ' (detenido por ti)' : ''}. Revisa Descargas/${carpeta}.`);
    pintarLista();
  } catch (e) {
    estado('❌ ' + e.message);
    loguear('ERROR GENERAL: ' + e.message);
  } finally {
    modoCorriendo(false);
  }
}

/* ------------------------------ eventos ------------------------------ */

$('btnIniciar').addEventListener('click', iniciar);

$('btnParar').addEventListener('click', async () => {
  detener = true;
  estado('⏹ Deteniendo tras la imagen actual…');
  await enPagina(() => window.__flowAuto.cancelar()).catch(() => {});
});

$('btnDiag').addEventListener('click', async () => {
  try {
    await prepararTab();
    await asegurarWorker();
    const d = await enPagina(() => window.__flowAuto.diagnosticar());
    $('log').textContent = JSON.stringify(d, null, 2);
    if (!d || !d.exito) { estado('❌ Diagnóstico fallido.'); return; }
    const campo = d.campoPrompt && d.campoPrompt.encontrado;
    estado(campo
      ? `✅ Campo de prompt OK (${d.campoPrompt.tag}, score ${d.campoPrompt.score}, ${d.campoPrompt.candidatos} candidatos). Botón generar: ${d.botonGenerar ? '"' + (d.botonGenerar.etiqueta || 'ícono') + '"' : 'no localizado'}.`
      : `⚠️ No encuentro el campo de prompt. Abre el panel de creación de Flow (modo Imagen) y repite el diagnóstico. Candidatos: ${d.campoPrompt ? d.campoPrompt.candidatos : 0}.`);
  } catch (e) {
    estado('❌ ' + e.message);
  }
});

$('btnArchivo').addEventListener('click', () => {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.txt,.csv,.md,text/plain';
  input.onchange = (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const texto = String(ev.target.result || '');
      $('prompts').value = $('prompts').value.trim() ? $('prompts').value.trimEnd() + '\n' + texto : texto;
      const n = parsearPrompts($('prompts').value).length;
      estado(`📂 "${file.name}" cargado · ${n} prompts detectados.`);
      guardarCfg();
    };
    reader.readAsText(file);
  };
  input.click();
});

$('btnLimpiar').addEventListener('click', () => {
  $('prompts').value = '';
  $('lista').classList.add('oculto');
  $('log').textContent = '—';
  $('barra').style.width = '0';
  estado('Limpiado.');
  guardarCfg();
});

['carpeta', 'pausa', 'timeout', 'nativo', 'informe', 'nombres', 'prompts'].forEach((id) => {
  $(id).addEventListener('change', guardarCfg);
});

/* ------------------------------ arranque ------------------------------ */

(async function init() {
  await cargarCfg();
  const { [CLAVE_ESTADO]: previo } = await chrome.storage.local.get(CLAVE_ESTADO);
  if (previo && previo.corrida && Date.now() - previo.ts < 10 * 60 * 1000) {
    corrida = { prompts: previo.corrida.map((r) => r.prompt), resultados: previo.corrida };
    pintarLista();
    const ok = previo.corrida.filter((r) => r.estado === 'ok').length;
    estado(`ℹ️ Corrida anterior recuperada: ${ok}/${previo.corrida.length} completadas. Pulsa 🚀 Iniciar para una nueva.`);
  }
  try {
    const tab = await tabActiva();
    if (tab && !/flow\.google\.com|labs\.google/.test(tab.url || '')) {
      const a = $('alertaTab');
      a.classList.remove('oculto');
      a.textContent = '⚠️ La pestaña activa no es Flow. Abre flow.google.com (y selecciona Nano Banana) antes de iniciar.';
    }
  } catch {}
})();
