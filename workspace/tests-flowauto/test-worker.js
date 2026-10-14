/**
 * Prueba de integración del "robot" (page-worker.js) contra un clon de la UI
 * de Google Flow montado en jsdom. Verifica: detección del campo, escritura,
 * detección del botón de generar, espera por polling (no timeout fijo),
 * elección de la imagen nueva, botón nativo de descarga, captura por fetch,
 * exportación de canvas y diagnóstico.
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const RAIZ = path.join(__dirname, '..', 'FlowAutomator');
const WORKER = fs.readFileSync(path.join(RAIZ, 'page-worker.js'), 'utf8');
const FIXTURE = fs.readFileSync(path.join(__dirname, 'fixture-flow.html'), 'utf8');

let fallos = 0;
function chequeo(nombre, cond, extra = '') {
  const ok = !!cond;
  if (!ok) fallos++;
  console.log(`${ok ? '✅' : '❌'} ${nombre}${extra ? '  →  ' + extra : ''}`);
  return ok;
}

function rectDe(el) {
  // jsdom no hace layout: devolvemos rectángulos coherentes con width/height
  let w = el.width || parseFloat(el.style && el.style.width) || 0;
  let h = el.height || parseFloat(el.style && el.style.height) || 0;
  if (!w || !h) {
    const m = /(?:^|;)\s*width:\s*(\d+)px/.exec(el.getAttribute && el.getAttribute('style') || '');
    const m2 = /(?:^|;)\s*height:\s*(\d+)px/.exec(el.getAttribute && el.getAttribute('style') || '');
    w = w || (m ? +m[1] : 0);
    h = h || (m2 ? +m2[1] : 0);
  }
  const tag = el.tagName;
  const top = tag === 'TEXTAREA' || tag === 'BUTTON' && el.closest && el.closest('#compositor') ? 600
    : tag === 'HEADER' || tag === 'NAV' ? 0 : 200;
  return { width: w, height: h, top, left: 40, right: 40 + w, bottom: top + h, x: 40, y: top };
}

async function montar() {
  const dom = new JSDOM(FIXTURE, { runScripts: 'outside-only', url: 'https://flow.google.com/try-flow', pretendToBeVisual: true });
  const win = dom.window;

  win.Element.prototype.getBoundingClientRect = function () { return rectDe(this); };
  win.HTMLElement.prototype.scrollIntoView = function () {};
  win.Element.prototype.scrollIntoView = function () {};
  const gcs = win.getComputedStyle.bind(win);
  win.getComputedStyle = (el, pseudo) => {
    const base = gcs(el, pseudo);
    const inline = (el.style && el.style.cssText) || '';
    const w = /width:\s*([\d.]+)px/.exec(inline);
    const h = /height:\s*([\d.]+)px/.exec(inline);
    return new Proxy(base, {
      get(t, prop) {
        if (prop === 'width') return w ? w[1] + 'px' : (t.width || 'auto');
        if (prop === 'height') return h ? h[1] + 'px' : (t.height || 'auto');
        if (prop === 'visibility') return 'visible';
        if (prop === 'display') return 'block';
        if (prop === 'opacity') return '1';
        if (prop === 'pointerEvents') return 'auto';
        const v = t[prop];
        return typeof v === 'function' ? v.bind(t) : v;
      }
    });
  };

  // fetch que devuelve un PNG falso (simula la red de Google)
  win.fetch = async (url) => ({
    ok: true, status: 200,
    blob: async () => new win.Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3])], { type: 'image/png' })
  });
  win.URL.createObjectURL = () => 'blob:https://flow.google.com/fake-id';

  const logs = [];
  win.console.log = (...a) => logs.push(a.map(String).join(' '));

  win.eval(WORKER);
  return { dom, win, api: win.__flowAuto, logs };
}

(async () => {
  console.log('── Instalación ─────────────────────────────────────────────');
  const { win, api } = await montar();
  chequeo('window.__flowAuto instalado', !!api);
  chequeo('versión del robot', api && api.version === '2.0', api && api.version);

  console.log('\n── Diagnóstico de la página ────────────────────────────────');
  const d = api.diagnosticar();
  console.log(JSON.stringify({ campo: d.campoPrompt, generar: d.botonGenerar, imagenes: d.imagenes.length }, null, 1));
  chequeo('detecta el campo de prompt', d.campoPrompt.encontrado && d.campoPrompt.tag === 'TEXTAREA', 'score ' + d.campoPrompt.score);
  chequeo('detecta el botón Generar', d.botonGenerar && d.botonGenerar.criterio === 'etiqueta', d.botonGenerar && d.botonGenerar.etiqueta);
  chequeo('no confunde el avatar del header con un resultado', !d.imagenes.some((i) => /avatar/.test(i.url)));

  console.log('\n── Prompt 1: escribir + generar + descargar ────────────────');
  const prompt1 = 'Un retrato cinematográfico de una astronauta, luz de neón, 35mm';
  api.setOptions({ generationTimeoutMs: 30000, pollMs: 300, settleMs: 200, typeDelayMs: 0 });

  const esc1 = await api.escribirPrompt(prompt1);
  chequeo('escritura exitosa', esc1.exito, esc1.metodo || esc1.error);
  chequeo('el textarea contiene el prompt completo', win.document.getElementById('prompt').value === prompt1);
  chequeo('el botón Generar se habilitó (evento input disparado)', win.document.getElementById('btnGenerar').disabled === false);

  const gen1 = await api.generarYEsperar({ timeoutMs: 30000 });
  chequeo('generación completada', gen1.exito, gen1.error || `${gen1.tipo}, ${gen1.segundos}s`);
  chequeo('devuelve la URL de la imagen nueva', /imagen1/.test(gen1.url || ''), gen1.url);
  chequeo('elige la imagen grande y no el avatar', gen1.ancho >= 600, 'ancho ' + gen1.ancho);
  chequeo('la página registró el clic en Generar', win.__historial.some((h) => h.tipo === 'click-generar' && h.prompt === prompt1));

  const nat1 = await api.descargarConBoton(gen1.url);
  chequeo('encuentra y pulsa el botón nativo de descarga', nat1.exito && win.__descargaNativa === 1, nat1.boton || nat1.error);

  const prep1 = await api.prepararDescarga(gen1.url);
  chequeo('captura directa vía fetch → blob', prep1.exito && prep1.via === 'fetch' && prep1.url.startsWith('blob:'), prep1.via || prep1.error);
  chequeo('extensión correcta', prep1.ext === 'png', prep1.ext);

  console.log('\n── Prompt 2: segundo ciclo consecutivo ─────────────────────');
  const prompt2 = 'Paisaje nocturno con lluvia neón, estilo Blade Runner';
  const esc2 = await api.escribirPrompt(prompt2);
  const gen2 = await api.generarYEsperar({ timeoutMs: 30000 });
  chequeo('segundo prompt escrito', esc2.exito);
  chequeo('segunda imagen generada', gen2.exito && /imagen2/.test(gen2.url || ''), gen2.error || gen2.url);
  chequeo('no devuelve la imagen del prompt anterior', !/imagen1/.test(gen2.url || ''));

  console.log('\n── Ruta canvas (resultados sin <img>) ──────────────────────');
  win.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB';
  const c = win.document.createElement('canvas');
  c.width = 800; c.height = 600;
  c.setAttribute('style', 'width:800px;height:600px');
  win.document.getElementById('escenario').appendChild(c);
  const capCanvas = await api.capturarCanvas();
  chequeo('exporta el canvas a PNG', capCanvas.exito && capCanvas.url.startsWith('data:image/png'), capCanvas.error || capCanvas.via);

  console.log('\n── Manejo de errores ───────────────────────────────────────');
  const { win: w2, api: api2 } = await montar();
  api2.setOptions({ generationTimeoutMs: 1500, pollMs: 200, settleMs: 0 });
  w2.document.getElementById('btnGenerar').setAttribute('aria-label', 'Botón misterioso');
  w2.document.getElementById('btnGenerar').innerHTML = '';
  w2.document.getElementById('btnGenerar').removeAttribute('disabled');
  const genErr = await api2.escribirPrompt('algo').then(() => api2.generarYEsperar({ timeoutMs: 1500 }));
  chequeo('falla con un mensaje claro si no hay botón ni imagen', genErr.exito === false && /botón de generar|Timeout/.test(genErr.error), genErr.error);

  console.log('\n── parsearPrompts (popup.js) ───────────────────────────────');
  const src = fs.readFileSync(path.join(RAIZ, 'popup.js'), 'utf8');
  const fnSrc = src.slice(src.indexOf('function parsearPrompts'), src.indexOf('/* ------------------------------ UI'));
  const parsearPrompts = new Function(fnSrc + '; return parsearPrompts;')();
  const entrada = [
    '1. Primer prompt, con comas y todo',
    '// esto es un comentario',
    '2) Segundo prompt',
    '   continuación del segundo',
    '',
    'Tercer prompt sin número'
  ].join('\n');
  const prompts = parsearPrompts(entrada);
  console.log(JSON.stringify(prompts, null, 1));
  chequeo('respeta las comas dentro del prompt (no las parte)', prompts[0] === 'Primer prompt, con comas y todo', prompts[0]);
  chequeo('ignora comentarios y líneas vacías', prompts.length === 3, 'n=' + prompts.length);
  chequeo('une líneas sangradas como continuación', /continuación del segundo$/.test(prompts[1]), prompts[1]);
  chequeo('limpia la numeración "2)"', !/^\d/.test(prompts[1]), prompts[1]);

  console.log(`\n${fallos === 0 ? '🎉 TODO EN VERDE' : '⚠️ ' + fallos + ' fallo(s)'} · ${fallos === 0 ? '' : 'revisar arriba'}`);
  process.exit(fallos === 0 ? 0 : 1);
})().catch((e) => { console.error('💥 Excepción en la prueba:', e); process.exit(2); });
