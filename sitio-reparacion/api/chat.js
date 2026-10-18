/* POST /api/chat → Groq (LLM) con herramientas. La clave nunca llega al navegador.
   ── Cambios clave (bug "el asistente no tiene la IA en este servicio") ──
   • response_format json_object: fuerza salida JSON válida ({decir, accion}).
     Si el modelo elegido no soporta esa opción, se reintenta SIN ella (fallback).
   • Fallback de modelos + retries contra 401/403/429/5xx transitorios (api/_groq.js).
   • parseSalida() garantiza {decir, accion} aunque el modelo escriba texto suelto.
   • El prompt maestro ahora viaja DESDE EL SERVIDOR (datos/prompt-agente.md),
     ya no depende de que el navegador logre descargarlo; si el cliente también
     manda `sistema`, se usa el del servidor como base y el extra del cliente después. */
const { json } = require('./_lib');
const { groqKey, chatConFallback, corregirSTT } = require('./_groq');
const { parseSalida } = require('./_agente');
const fs = require('fs');
const path = require('path');

let promptCache = null, promptTs = 0;
function promptMaestro(){
  /* cache 5 min: en serverless esto evita releer disco en cada turno */
  if (promptCache && Date.now() - promptTs < 300000) return promptCache;
  try {
    const crudo = fs.readFileSync(path.join(__dirname, '..', 'datos', 'prompt-agente.md'), 'utf8');
    const i = crudo.lastIndexOf('===PROMPT==='), j = i >= 0 ? crudo.indexOf('===FIN===', i) : -1;
    promptCache = (i >= 0 && j > i) ? crudo.slice(i + 12, j).trim() : crudo.trim();
  } catch(e){ promptCache = ''; }
  promptTs = Date.now();
  return promptCache;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST'){ res.setHeader('Allow','POST'); return json(res, 405, { ok:false }); }
  try {
    const key = groqKey(req);
    const b = req.body || {};
    const mensajes = (Array.isArray(b.mensajes) ? b.mensajes : []).slice(-20).map(m => Object.assign(
      { role: ['system','user','assistant','tool'].includes(m.role) ? m.role : 'user',
        /* "tapatech" nunca entra al contexto: se normaliza a "TapaTech" en la
           entrada (transcripciones del usuario incluidos) */
        content: typeof m.content === 'string' ? corregirSTT(m.content.slice(0, 8000)) : (m.content || null) },
      m.tool_calls ? { tool_calls: m.tool_calls } : {},
      m.tool_call_id ? { tool_call_id: m.tool_call_id } : {},
      m.name ? { name: m.name } : {}
    ));
    if (!mensajes.length) return json(res, 400, { ok:false, error:'mensajes_vacios' });
    /* Sistema: prompt maestro del servidor + extras del cliente + contexto vivo */
    const maestro = promptMaestro();
    const sistema = [maestro, String(b.sistema || '').slice(0, 12000)].filter(Boolean).join('\n\n')
                  + (b.contexto ? '\n\n' + String(b.contexto).slice(0, 12000) : '');
    mensajes.unshift({ role:'system', content: sistema });
    const tools = (Array.isArray(b.herramientas) ? b.herramientas : []).filter(t => t && t.type === 'function' && t.function && t.function.name).slice(0, 12);
    const payloadBase = {
      messages: mensajes,
      temperature: Number.isFinite(b.temperature) ? Math.min(1.2, Math.max(0, b.temperature)) : 0.45,
      max_tokens: Math.min(900, parseInt(b.max_tokens || 400, 10) || 400),
      top_p: Number.isFinite(b.top_p) ? b.top_p : 0.9,
      stream: false,
      ...(tools.length ? { tools, tool_choice:'auto' } : {})
    };
    let d = null, usatoJsonFormat = true;
    try {
      d = await chatConFallback(Object.assign({ response_format:{ type:'json_object' } }, payloadBase), b.modelo, key);
    } catch(e){
      /* si el fallo fue por response_format (400) u otro del primer intento,
         reintentamos sin formato JSON — la normalización local cubre el resto */
      usatoJsonFormat = false;
      d = await chatConFallback(payloadBase, b.modelo, key);
    }
    const msg = (d.choices && d.choices[0] && d.choices[0].message) || {};
    const sal = parseSalida(msg.content || '');
    return json(res, 200, {
      ok:true,
      content: corregirSTT(sal.decir),   /* normalizado + "tapatech"→"TapaTech" en la salida hablada */
      accion: sal.accion,           /* acción opcional resuelta en el servidor */
      tool_calls: msg.tool_calls || null,
      uso: d.usage || null,
      modelo: d._modelo_usado || d.model || '',
      json_format: usatoJsonFormat
    });
  } catch(e){
    const status = e.status || e.groqStatus || 500;
    /* Traducimos los códigos feos a un código estable que voz.js sabe explicar */
    let code = e.code || 'error';
    if (e.groqStatus === 401 || e.groqStatus === 403) code = 'clave_invalida';
    else if (e.groqStatus === 429) code = 'limite_groq';
    else if (e.groqStatus === 404 && /does not exist|do not have access|model_not_found/i.test(e.message || '')) code = 'modelo_no_disponible';
    else if (/groq_/.test(e.message || '')) code = 'groq_fallo';
    return json(res, status >= 400 && status < 600 ? status : 500, { ok:false, error: code, detalle: (e.message || '').slice(0, 240) });
  }
};
