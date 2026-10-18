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

   4) FIX OCT-2026 (deploy preview de Vercel): el placeholder de arranque
      hacía groqKey()→503 "sin_clave" ANTES de intentar Groq, así que un deploy
      con env mal scoping (Preview sin GROQ_API_KEY) moría aunque la clave
      existiera en Production. Ahora: si hay una clave real en env se usa; si
      solo existe el placeholder, se INTENTA igual contra Groq con las claves
      candidatas y recién si todas fallan se devuelve el error claro de config.

   La clave SOLO vive aquí (process.env), jamás llega al navegador. */

const GROQ = 'https://api.groq.com/openai/v1';

/* Candidatos por rol, del preferido al respaldo. Si algún día Groq jubila uno,
   solo agrega/quíta nombres aquí — o cámbialos en datos/agente.json.
   ACTUALIZADO 18-OCT-2026 (5): verificado contra console.groq.com/docs/models.
   • openai/gpt-oss-20b PRIMERO: vigente y es el modelo que el dueño tiene en
     uso (así lo pidió explícitamente). Se usa con su nombre canónico con
     prefijo "openai/" para que Groq no devuelva 404 por alias sin prefijo.
   • llama-3.3-70b-versatile SEGUNDO: respaldo vigente, soporta tools +
     response_format json_object.
   • meta-llama/llama-4-maverick-17b-128e-instruct FUE RETIRADO para esta
     cuenta (devolvía 404 "does not exist or you do not have access") → fuera
     de los candidatos; sanearModelo aún reescribe sus alias por compatibilidad. */
/* Nombres canónicos con prefijo de proveedor: Groq responde 404
   "The model `meta-llama/llama-4-maverick...` does not exist or you do not
   have access to it" a los alias SIN prefijo (p. ej. "llama-4-maverick-17b-128e-instruct").
   Por eso aquí solo van nombres completos; sanearModelo reescribe los cortos. */
const CANDIDATOS_CHAT = [
  'openai/gpt-oss-20b',           /* PREFERIDO (verificado 18-oct-2026 en console.groq.com/docs/models; el dueño lo tiene en uso) */
  'llama-3.3-70b-versatile',      /* respaldo vigente: soporta tools + response_format json_object */
  'llama-3.1-8b-instant',         /* respaldo rápido */
  'openai/gpt-oss-120b'           /* vigente pero su 413 de cuota interrumpe tool-calls → solo último recurso */
];
/* meta-llama/llama-4-scout y meta-llama/llama-4-maverick SALIERON de la lista:
   Groq los retiró para esta cuenta (404 "does not exist or you do not have
   access"). sanearModelo sigue reescribiendo los alias sin prefijo por si un
   cliente viejo los pide, pero ya NUNCA se usan como candidatos. */
const CANDIDATOS_STT = [
  'whisper-large-v3-turbo',
  'whisper-large-v3'
];
/* Alias históricos que Groq ya NO acepta (estos sí fueron renombrados):
   si un cliente viejo los envía, se reescriben al nombre vigente ANTES de
   llamar a la API. OJO: los gpt-oss-* NO están aquí porque siguen vivos;
   su nombre canónico es "openai/gpt-oss-120b" / "openai/gpt-oss-20b", así
   que a las variantes sin prefijo solo se les agrega el prefijo. */
const ALIAS_RETIrados = {
  'llama-3.1-70b-versatile': 'llama-3.3-70b-versatile',
  'llama-3.3-70b-instruct': 'llama-3.3-70b-versatile',
  'whisper-large-v3-turbo-20241113': 'whisper-large-v3-turbo'
};
/** Alias SIN prefijo de proveedor que Groq rechaza con 404 "does not exist or
    you do not have access": el nombre canónico exige el prefijo (meta-llama/…,
    moonshotai/…). Cualquier variante con guiones/barras raras se normaliza aquí. */
const PREFIJOS_MODELO = {
  'llama-4-scout-17b-16e-instruct': 'meta-llama/llama-4-scout-17b-16e-instruct',
  'llama-4-maverick-17b-128e-instruct': 'meta-llama/llama-4-maverick-17b-128e-instruct',
  'kimi-k2-instruct-0905': 'moonshotai/kimi-k2-instruct-0905',
  'kimi-k2-0905-preview': 'moonshotai/kimi-k2-instruct-0905'
};
/** Normaliza nombres jubilados/alias al modelo vigente equivalente. */
function sanearModelo(m){
  const s = String(m || '').trim();
  if (!s) return '';
  if (ALIAS_RETIrados[s]) return ALIAS_RETIrados[s];
  /* gpt-oss-120b → openai/gpt-oss-120b (nombre canónico con prefijo) */
  const oss = s.match(/^(?:openai\/)?(gpt-oss-(?:120b|20b))$/i);
  if (oss) return 'openai/' + oss[1].toLowerCase();
  /* sin prefijo y coincide un alias conocido (p. ej. "llama-4-maverick-17b-128e-instruct"
     o "Llama-4-Maverick…"): se agrega el prefijo del proveedor para evitar el 404 */
  const clave = s.toLowerCase().replace(/\s+/g, '-');
  if (!s.includes('/') && PREFIJOS_MODELO[clave]) return PREFIJOS_MODELO[clave];
  return ALIAS_RETIrados[s.toLowerCase()] || s;
}
/* cache en memoria de la instancia: modelo que ya respondió bien */
let chatOk = null, sttOk = null;

/* Clave genérica de arranque (placeholder): permite que el build/deploy de
   Vercel funcione "de fábrica" sin GROQ_API_KEY. Lupita arranca y responde con
   un aviso claro en vez de morir con 503. En cuanto definas tu clave real
   (gsk_...) en Vercel, esa tiene prioridad absoluta sobre el placeholder. */
const PLACEHOLDER_KEY = 'gsk_PLACEHOLDER_PEGA_AQUI_TU_CLAVE_GROQ';

function esPlaceholder(k){
  const s = String(k || '').trim();
  return !s || s === PLACEHOLDER_KEY || /^gsk_(PEGA|COLOCA|TU_|XXXX|REEMPLAZ)/i.test(s);
}

/** Candidatos de clave para este request: env específica → env estándar →
    variables extra del propio request (p. ej. x-groq-key-forwarded de un
    proxy intermedio). Se filtran duplicados, vacíos y placeholders. */
function clavesGroq(req){
  const cand = [
    process.env.GROQ_API_KEY_AGENTE,
    process.env.GROQ_API_KEY,
    req && req.headers && req.headers['x-groq-key-forwarded']
  ].map(k => String(k || '').trim().replace(/^Bearer\s+/i, ''))
   .filter(k => k && !esPlaceholder(k));
  return [...new Set(cand)];
}

function groqKey(req){
  /* prioridad: env específica del agente → env estándar → placeholder.
     FIX OCT-2026: si NO hay clave real definida, ya NO se aborta con 503 aquí
     (eso rompía deploys preview donde la env existe pero no está scopingada al
     entorno, o donde otra variable sí la trae): se devuelve igualmente el
     placeholder para que chatConFallback/tts INTENTEN contra Groq; si todos los
     intentos fallan por autenticación, el error final sigue siendo el aviso
     claro de configuración (sin_clave) — pero ahora después de probar de verdad. */
  const reales = clavesGroq(req);
  if (reales.length) return reales[0];
  return PLACEHOLDER_KEY;
}

/** true si el error de Groq es de autenticación/autorización (401/403) o si
    simplemente no había ninguna clave real que intentar. */
function esFalloDeClave(err, teniaClaveReal){
  if (!teniaClaveReal) return true;
  return err && (err.groqStatus === 401 || err.groqStatus === 403);
}

/** Error canónico "falta la clave", con instrucciones accionables. */
function errorSinClave(){
  const e = new Error('GROQ_API_KEY no configurada (el sitio usa una clave genérica de arranque). Pega tu clave real gsk_... en Vercel → Settings → Environment Variables → GROQ_API_KEY con Scope PRODUCTION *y* PREVIEW, guarda y haz Redeploy (las env nuevas no aplican a deploys ya creados).');
  e.status = 503; e.code = 'sin_clave'; e.placeholder = true;
  return e;
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
      throw e;
    }
    return data;
  } finally { clearTimeout(to); }
}

function esReintentable(err){
  const s = err && err.groqStatus;
  if (s === 429 || s >= 500) return true;
  /* 413 "Request too large for model X": Groq lo devuelve cuando el modelo fue
     RETIRADO o cambió de ventana — no por tamaño real del request. Reintentar
     el mismo modelo no sirve; mejor probar el siguiente candidato ya que
     sanearModelo no siempre conoce el nombre jubilado. */
  if (s === 413) return false;
  /* 401/403 transitorios (reinicio de instancia / glitch): un retry no cuesta nada */
  if (s === 401 || s === 403) return true;
  return false;
}

/** Chat completions con fallback de modelos + retries. `preferido` viene de datos/agente.json. */
async function chatConFallback(payloadBase, preferido, key, req){
  const lista = [];
  /* sanearModelo: si el navegador/admin todavía pide un modelo jubilado por
     Groq (p. ej. openai/gpt-oss-20b → 413/400), lo reescribimos al vigente */
  const p = sanearModelo(preferido);
  if (p) lista.push(p.slice(0, 60));
  if (chatOk && !lista.includes(chatOk)) lista.push(chatOk);
  CANDIDATOS_CHAT.forEach(m => { if (!lista.includes(m)) lista.push(m); });
  /* FIX OCT-2026: si solo hay placeholder en env, igual intentamos contra Groq
     (quizá otra variable/header trae la clave real); si todos los modelos
     responden 401/403 → error claro sin_clave en vez del confuso groq_401. */
  const claves = clavesGroq(req).length ? clavesGroq(req) : [key || PLACEHOLDER_KEY];
  let ultimoErr = null, falloClave = false;
  for (const k of claves){
    const claveReal = !esPlaceholder(k);
    let rompioPorClave = false;
    for (let i = 0; i < lista.length; i++){
      const model = lista[i];
      for (let intento = 0; intento < 2; intento++){
        try {
          const d = await post('/chat/completions',
            { 'Content-Type':'application/json', Authorization:'Bearer ' + k },
            JSON.stringify(Object.assign({}, payloadBase, { model })));
          chatOk = model;
          return Object.assign({ _modelo_usado: model }, d);
        } catch(e){
          ultimoErr = e;
          const s = e.groqStatus;
          if (esFalloDeClave(e, claveReal)){
            /* clave inválida/ausente: ningún modelo se evaluará con esta clave;
               pasar a la siguiente clave candidata (o rendirse al final) */
            rompioPorClave = true; break;
          }
          /* 404/400/422/413: ese modelo no existe, cambió de ventana o fue
             RETIRADO por Groq (el 413 "Request too large for model X" es la
             señal típica) → NO reintentar: saltar al siguiente candidato. */
          if (s === 404 || s === 400 || s === 422 || s === 413) break;
          if (esReintentable(e) && intento === 0){ await sleep(s === 429 ? 700 : 400); continue; } /* reintenta el mismo */
          throw e;                                                  /* red u otro error real */
        }
      }
      if (rompioPorClave) break;
    }
    if (rompioPorClave) falloClave = true;
  }
  if (falloClave) throw errorSinClave();
  throw ultimoErr || new Error('groq_sin_modelos_disponibles');
}

/** Transcripción Whisper con fallback de modelos + retries. */
async function sttConFallback(formFactory, preferido, key, req){
  const lista = [];
  const p = sanearModelo(preferido);
  if (p) lista.push(p.slice(0, 60));
  if (sttOk && !lista.includes(sttOk)) lista.push(sttOk);
  CANDIDATOS_STT.forEach(m => { if (!lista.includes(m)) lista.push(m); });
  const claves = clavesGroq(req).length ? clavesGroq(req) : [key || PLACEHOLDER_KEY];
  let ultimoErr = null, falloClave = false;
  for (const k of claves){
    const claveReal = !esPlaceholder(k);
    let rompioPorClave = false;
    for (let i = 0; i < lista.length; i++){
      const model = lista[i];
      for (let intento = 0; intento < 2; intento++){
        try {
          const fd = formFactory(model);
          const d = await post('/audio/transcriptions', { Authorization:'Bearer ' + k }, fd);
          sttOk = model;
          return Object.assign({ _modelo_usado: model }, d);
        } catch(e){
          ultimoErr = e;
          const s = e.groqStatus;
          if (esFalloDeClave(e, claveReal)){ rompioPorClave = true; break; }
          if (s === 404 || s === 400 || s === 422 || s === 413) break;   /* modelo retirado: siguiente */
          if (esReintentable(e) && intento === 0){ await sleep(s === 429 ? 900 : 500); continue; }
          throw e;
        }
      }
      if (rompioPorClave) break;
    }
    if (rompioPorClave) falloClave = true;
  }
  if (falloClave) throw errorSinClave();
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

module.exports = { GROQ, groqKey, clavesGroq, esPlaceholder, errorSinClave, post, chatConFallback, sttConFallback, CANDIDATOS_CHAT, CANDIDATOS_STT, ALIAS_RETIrados, sanearModelo, PLACEHOLDER_KEY, corregirSTT, deslucharNombre };
