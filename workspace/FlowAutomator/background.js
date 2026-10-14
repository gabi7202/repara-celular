/**
 * background.js (service worker)
 * ------------------------------------------------------------------
 * 1) Descarga imágenes que le pasa la página (blob: / data: / https:).
 * 2) "Captura" las descargas que dispara la propia web de Flow cuando
 *    usamos su botón nativo, y las MUEVE a la carpeta + nombre que
 *    elegiste (chrome.downloads.setPath). Sin esto, Flow guardaría
 *    todo suelto en la raíz de Descargas.
 * 3) Guarda el informe CSV y el registro de la corrida.
 */

const LIMITE_DATA_URL_BYTES = 24 * 1024 * 1024; // margen seguro para mensajería MV3
const colaReubicar = [];                        // FIFO de { filename, id, resultado }

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (!request || typeof request.action !== 'string') return false;

  switch (request.action) {
    case 'descargar':
      descargar(request.url, request.filename).then(sendResponse);
      return true;

    case 'guardarTexto':
      descargarTexto(request.texto, request.filename, request.mime).then(sendResponse);
      return true;

    case 'prepararReubicacion':
      // Se llama ANTES de pulsar el botón nativo de descarga de Flow.
      colaReubicar.push({ filename: request.filename, id: null, resultado: null, creado: Date.now() });
      if (colaReubicar.length > 20) colaReubicar.shift();
      sendResponse({ exito: true, enCola: colaReubicar.length });
      return false;

    case 'esperarReubicacion':
      esperarReubicacion(request.timeoutMs || 60000).then(sendResponse);
      return true;

    case 'ping':
      sendResponse({ exito: true, version: chrome.runtime.getManifest().version });
      return false;

    default:
      sendResponse({ exito: false, error: `Acción desconocida: ${request.action}` });
      return false;
  }
});

/* --------------------------- descarga directa --------------------------- */

async function descargar(url, filename) {
  try {
    if (!url) throw new Error('URL vacía.');
    if (url.startsWith('data:') && url.length > LIMITE_DATA_URL_BYTES) {
      throw new Error('Imagen demasiado grande para viajar como data URL (usa el botón nativo de Flow).');
    }
    const id = await iniciarDescarga(url, filename);
    const fin = await esperarFinDescarga(id);
    if (fin && fin.error) throw new Error(fin.error);
    return { exito: true, downloadId: id, filename };
  } catch (e) {
    return { exito: false, error: e.message };
  }
}

function iniciarDescarga(url, filename) {
  return new Promise((resolve, reject) => {
    chrome.downloads.download({ url, filename, saveAs: false, conflictAction: 'uniquify' }, (downloadId) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else if (typeof downloadId !== 'number') reject(new Error('chrome.downloads no devolvió un ID.'));
      else resolve(downloadId);
    });
  });
}

function esperarFinDescarga(id, timeoutMs = 180000) {
  return new Promise((resolve) => {
    let listo = false;
    const terminar = (r) => {
      if (listo) return;
      listo = true;
      chrome.downloads.onChanged.removeListener(onChanged);
      clearTimeout(timer);
      resolve(r);
    };
    const onChanged = (delta) => {
      if (delta.id !== id) return;
      if (delta.state && delta.state.current === 'complete') terminar({ ok: true });
      if (delta.error) terminar({ error: delta.error.current });
    };
    const timer = setTimeout(() => {
      chrome.downloads.search({ id }, (items) => {
        const item = items && items[0];
        if (!item) return terminar({ ok: true });
        if (item.state === 'complete') return terminar({ ok: true });
        if (item.error) return terminar({ error: item.error });
        terminar({ ok: true, incompleto: true });
      });
    }, timeoutMs);
    chrome.downloads.onChanged.addListener(onChanged);
  });
}

/* --------------------- reubicación de descargas nativas --------------------- */

chrome.downloads.onCreated.addListener((item) => {
  if (!item || typeof item.id !== 'number') return;
  if (item.byExtensionId) return;      // es nuestra: ya va a la carpeta correcta
  if (!colaReubicar.length) return;     // nadie la esperaba
  const entrada = colaReubicar.shift();
  entrada.id = item.id;
  colaReubicar.push(entrada);           // la dejamos visible para esperarReubicacion
  reubicarCuandoExista(item.id, entrada.filename)
    .then((r) => { entrada.resultado = r; })
    .catch((e) => { entrada.resultado = { exito: false, error: e.message }; });
});

/**
 * setPath exige que el archivo ya exista en disco, así que reintentamos
 * durante unos segundos hasta que la descarga nativa termina.
 */
async function reubicarCuandoExista(id, filename, intentos = 30) {
  for (let i = 0; i < intentos; i++) {
    await sleep(700);
    const items = await buscar([['id', id]]);
    const item = items && items[0];
    if (!item) return { exito: false, error: 'descarga no encontrada' };
    if (item.state === 'in_progress') continue;
    if (item.error) return { exito: false, error: item.error };

    // Flow puede entregar .jpg aunque pidiéramos .png: respetamos su extensión real
    const extReal = (/\.(png|jpe?g|webp|gif|avif)$/i.exec(item.filename || '') || [null, ''])[1];
    const destino = extReal ? filename.replace(/\.(png|jpe?g|webp|gif|avif)$/i, '.' + extReal) : filename;

    try {
      await new Promise((res, rej) => {
        chrome.downloads.setPath({ downloadId: id, path: destino }, () => {
          chrome.runtime.lastError ? rej(new Error(chrome.runtime.lastError.message)) : res();
        });
      });
      return { exito: true, filename: destino };
    } catch (e) {
      if (i >= intentos - 1) return { exito: false, error: e.message };
    }
  }
  return { exito: false, error: 'la descarga nativa no terminó a tiempo' };
}

function buscar(pares) {
  return new Promise((resolve) => {
    const query = {};
    pares.forEach(([k, v]) => { query[k] = v; });
    chrome.downloads.search(query, (items) => resolve(items || []));
  });
}

function esperarReubicacion(timeoutMs) {
  return new Promise((resolve) => {
    const fin = Date.now() + timeoutMs;
    const tick = async () => {
      const idx = colaReubicar.findIndex((e) => e.resultado);
      if (idx >= 0) {
        const r = colaReubicar[idx].resultado;
        colaReubicar.splice(idx, 1);
        return resolve(r);
      }
      if (Date.now() > fin) {
        colaReubicar.length = 0;
        return resolve({ exito: false, error: 'Flow no produjo ninguna descarga nativa a tiempo.' });
      }
      await sleep(500);
      tick();
    };
    tick();
  });
}

/* ------------------------------ utilidades ------------------------------ */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function descargarTexto(texto, filename, mime = 'text/plain;charset=utf-8') {
  const dataUrl = 'data:' + mime + ',' + encodeURIComponent(texto || '');
  return descargar(dataUrl, filename);
}
