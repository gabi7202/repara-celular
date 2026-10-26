/* Cliente Groq con RESILIENCIA — el corazón de Lupita.
   Diagnóstico del bug "el asistente no tiene la IA en este servicio" (que se
   disparaba aunque GROQ_API_KEY estuviera puesta en Vercel):

   1) Los modelos de Groq se RENOMBRAN y JUBILAN sin avisar
      (p. ej. llama-3.3-70b-versatile → variantes "versatile"/"compound", y
      whisper-large-v3-turbo ya no existe en cuentas nuevas). El proxy anterior
      reenviaba SIEMPRE el mismo nombre: en cuanto Groq lo retiraba, respondía
      4xx y el sitio entero decía "no tiene IA". → Aquí probamos una lista de
      modelos equivalentes hasta que uno exista (y recordamos cuál funcionó).

   2) Un 401/403 casi nunca significa "clave ausente": puede ser un reinicio
      momentáneo de la instancia o un glitch de Groq. Antes eso abortaba todo.
      → Ahora se reintenta una vez antes de rendirse.

   3) 502/503 sobrecarga de Groq → reintento breve. 429 límite → reintento con
      espera cortita. Todo con tiempos acotados para que la voz no se congele.

   La clave SOLO vive aquí (process.env), jamás llega al navegador. */

const GROQ = 'https://api.groq.com/openai/v1';

/* Cadidatos por rol, del preferido al respaldo. Si algún día Groq jubila uno,
   solo agrega/quíta nombres aquí — o cámbialos en datos/agente.json. */
const CANDIDATOS_CHAT = [
  'openai/gpt-oss-20b',
  'openai/gpt-oss-120b'
];
const CANDIDATOS_STT = [
  'whisper-large-v3-turbo',
  'whisper-large-v3'
];
/* cache en memoria de la instancia: modelo que ya respondió bien */
let chatOk = null, sttOk = null;
/* Enfriamiento por modelo: Groq limita TPM POR MODELO. Cuando uno se agota,
   lo saltamos unos segundos y probamos el siguiente en vez de insistir y
   dejar a Lupita muda. La memoria es por instancia (suficiente en caliente). */
const chatCool = new Map(), sttCool = new Map();
function enEspera(mapa, modelo){ return (mapa.get(modelo) || 0) > Date.now(); }
function enfriar(mapa, modelo, err){
  const seg = Math.max(3, Number(err && err.retryAfter) || 12);
  mapa.set(modelo, Date.now() + Math.min(60, seg) * 1000);
}

/* Clave genérica de arranque (placeholder): permite que el build/deploy de
   Vercel funcione "de fábrica" sin GROQ_API_KEY. Lupita arranca y responde con
   un aviso claro en vez de morir con 503. En cuanto definas tu clave real
   (gsk_...) en Vercel, esa tiene prioridad absoluta sobre el placeholder. */
const PLACEHOLDER_KEY = 'gsk_PLACEHOLDER_PEGA_AQUI_TU_CLAVE_GROQ';

function esPlaceholder(k){
  const s = String(k || '').trim();
  return !s || s === PLACEHOLDER_KEY || /^gsk_(PEGA|COLOCA|TU_|XXXX|REEMPLAZ)/i.test(s);
}

function groqKey(req){
  /* prioridad: env específica del agente → env estándar → placeholder */
  const k = process.env.GROQ_API_KEY_AGENTE || process.env.GROQ_API_KEY || PLACEHOLDER_KEY;
  if (esPlaceholder(k)){
    const e = new Error('GROQ_API_KEY no configurada (el sitio usa una clave genérica de arranque). Pega tu clave real gsk_... en Vercel → Settings → Environment Variables → GROQ_API_KEY (Scope Production) y haz Redeploy.');
    e.status = 503; e.code = 'sin_clave'; e.placeholder = true; throw e;
  }
  return String(k).trim().replace(/^Bearer\s+/i, '');
}

async function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }

/* POST crudo a Groq con timeout propio (no depende del límite de la función). */
async function post(path, headers, body, ms){
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), ms || 20000);
  try {
    const r = await fetch(GROQ + path, { method:'POST', headers, body, signal: ctrl.signal });
    const ct = r.headers.get('content-type') || '';
    let data = null, txt = '';
    if (ct.includes('json')) data = await r.json().catch(() => null);
    else { txt = await r.text().catch(() => ''); if (!txt) { const b = await r.arrayBuffer().catch(()=>null); if (b) data = Buffer.from(b); } }
    if (!r.ok){
      const msg = data && data.error && (data.error.message || data.error.code) ? String(data.error.message || data.error.code) : txt.slice(0, 200);
      const e = new Error('groq_' + r.status + ': ' + msg.slice(0, 200));
      e.groqStatus = r.status;
      /* Groq manda Retry-After en segundos cuando es 429. */
      const ra = parseInt(r.headers.get('retry-after') || '0', 10);
      if (Number.isFinite(ra) && ra > 0) e.retryAfter = ra;
      throw e;
    }
    return data;
  } finally { clearTimeout(to); }
}

function esReintentable(err){
  const s = err && err.groqStatus;
  if (s === 429 || s >= 500) return true;
  /* 401/403 transitorios (reinicio de instancia / glitch): un retry no cuesta nada */
  if (s === 401 || s === 403) return true;
  return false;
}

/** Chat completions con fallback de modelos + retries. `preferido` viene de datos/agente.json. */
async function chatConFallback(payloadBase, preferido, key){
  const lista = [];
  /* Si un modelo ya respondió bien (p. ej. el respaldo 120b tras un 429 del
     20b), va primero: así no volvemos a tropezar con el que está saturado. */
  if (chatOk) lista.push(chatOk);
  if (preferido && !lista.includes(String(preferido).slice(0, 60))) lista.push(String(preferido).slice(0, 60));
  CANDIDATOS_CHAT.forEach(m => { if (!lista.includes(m)) lista.push(m); });
  let ultimoErr = null, todosEnfriados = true;
  for (let i = 0; i < lista.length; i++){
    const model = lista[i];
    if (enEspera(chatCool, model)) continue;
    todosEnfriados = false;
    for (let intento = 0; intento < 2; intento++){
      try {
        const d = await post('/chat/completions',
          { 'Content-Type':'application/json', Authorization:'Bearer ' + key },
          JSON.stringify(Object.assign({}, payloadBase, { model })));
        chatOk = model;
        chatCool.delete(model);
        return Object.assign({ _modelo_usado: model }, d);
      } catch(e){
        ultimoErr = e;
        const s = e.groqStatus;
        if (s === 404 || s === 400 || s === 422) break;           /* ese modelo no sirve: prueba el siguiente */
        if (s === 429){
          /* TPM agotado en ESTE modelo: el siguiente tiene su propio cupo.
             No esperamos aquí; la espera mataría la conversación de voz. */
          enfriar(chatCool, model, e);
          break;
        }
        if ((s >= 500 || s === 401 || s === 403) && intento === 0){ await sleep(400); continue; }
        throw e;                                                  /* 401 definitivo tras retry, red, etc. */
      }
    }
  }
  if ((ultimoErr && ultimoErr.groqStatus === 429) || (!ultimoErr && todosEnfriados)){
    const e = new Error('groq_429: todos los modelos están en su límite de tokens por minuto; reintenta en unos segundos');
    e.groqStatus = 429; e.code = 'limite_groq'; e.retryAfter = 15;
    throw e;
  }
  throw ultimoErr || new Error('groq_sin_modelos_disponibles');
}

/** Transcripción Whisper con fallback de modelos + retries. */
async function sttConFallback(formFactory, preferido, key){
  const lista = [];
  if (sttOk) lista.push(sttOk);
  if (preferido && !lista.includes(String(preferido).slice(0, 60))) lista.push(String(preferido).slice(0, 60));
  CANDIDATOS_STT.forEach(m => { if (!lista.includes(m)) lista.push(m); });
  let ultimoErr = null, todosEnfriados = true;
  for (let i = 0; i < lista.length; i++){
    const model = lista[i];
    if (enEspera(sttCool, model)) continue;
    todosEnfriados = false;
    for (let intento = 0; intento < 2; intento++){
      try {
        const fd = formFactory(model);
        const d = await post('/audio/transcriptions', { Authorization:'Bearer ' + key }, fd);
        sttOk = model;
        sttCool.delete(model);
        return Object.assign({ _modelo_usado: model }, d);
      } catch(e){
        ultimoErr = e;
        const s = e.groqStatus;
        if (s === 404 || s === 400 || s === 422) break;
        if (s === 429){ enfriar(sttCool, model, e); break; }
        if ((s >= 500 || s === 401 || s === 403) && intento === 0){ await sleep(500); continue; }
        throw e;
      }
    }
  }
  if ((ultimoErr && ultimoErr.groqStatus === 429) || (!ultimoErr && todosEnfriados)){
    const e = new Error('groq_429: transcripción temporalmente limitada; reintenta en unos segundos');
    e.groqStatus = 429; e.code = 'limite_groq'; e.retryAfter = 15;
    throw e;
  }
  throw ultimoErr || new Error('groq_stt_sin_modelo');
}

/* ── LUPITA NO DEBE DECIR "TAPATECH" ───────────────────────────────────────
   El taller se llama TapaTech (Tapa + Tech). Whisper y WebSpeech lo transcriben
   a veces como "tapatech", "tapatex" o "tapa tach"; y si ese error entra al
   chat, el modelo lo repite en voz alta. Tres capas de defensa:
   1) initial_prompt en /api/stt: le "sopla" a Whisper el vocabulario correcto.
   2) corregirSTT(): normaliza la transcripción ANTES de enviarla al LLM
      ("tapatech" → "TapaTech"). La ciudad Tapachula NUNCA se toca.
   3) deslucharNombre(): limpia también las SALIDAS del modelo, por si el LLM
      escribe "tapatech" en su respuesta hablada. */
const VARIANTES_NOMBRE = /\b(?:tapa|ta\s?pa|tapat)[\s.,'-]*(?:tech|teck|tex|teks|tach|tetsh?|tetch)\b|\btapatech\b|\btapatex\b/gi;

/** Corrige malas lecturas del nombre en texto transcrito o generado. */
function corregirSTT(t){
  let s = String(t == null ? '' : t);
  if (!s) return s;
  /* no tocar "Tapachula ...": solo la palabra suelta que suena al taller */
  s = s.replace(VARIANTES_NOMBRE, function(m){
    return /chula/i.test(m) ? m : 'TapaTech';
  });
  /* mayúsculas normales "tapatech"/"TAPATECH" escritas de una sola vez */
  s = s.replace(/\btapatech\b/gi, function(m){ return /chula/i.test(m) ? m : 'TapaTech'; });
  return s;
}

/** Para salidas del LLM/TTS: mismo principio sobre la respuesta hablada. */
function deslucharNombre(t){ return corregirSTT(t); }

module.exports = { GROQ, groqKey, post, chatConFallback, sttConFallback, CANDIDATOS_CHAT, CANDIDATOS_STT, PLACEHOLDER_KEY, esPlaceholder, corregirSTT, deslucharNombre };
