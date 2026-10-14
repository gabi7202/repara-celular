/* POST /api/chat → Groq (LLM) con herramientas. La clave nunca llega al navegador. */
const { json, groq, groqKey } = require('./_lib');
module.exports = async function handler(req, res) {
  if (req.method !== 'POST'){ res.setHeader('Allow','POST'); return json(res, 405, { ok:false }); }
  try {
    const key = groqKey(req);
    const b = req.body || {};
    const mensajes = (Array.isArray(b.mensajes) ? b.mensajes : []).slice(-20).map(m => Object.assign(
      { role: ['system','user','assistant','tool'].includes(m.role) ? m.role : 'user',
        content: typeof m.content === 'string' ? m.content.slice(0, 8000) : (m.content || null) },
      m.tool_calls ? { tool_calls: m.tool_calls } : {},
      m.tool_call_id ? { tool_call_id: m.tool_call_id } : {},
      m.name ? { name: m.name } : {}
    ));
    if (!mensajes.length) return json(res, 400, { ok:false, error:'mensajes_vacios' });
    mensajes.unshift({ role:'system', content: String(b.sistema || '').slice(0, 24000) + (b.contexto ? '\n\n' + String(b.contexto).slice(0, 12000) : '') });
    const tools = (Array.isArray(b.herramientas) ? b.herramientas : []).filter(t => t && t.type === 'function' && t.function && t.function.name).slice(0, 12);
    const d = await groq('/chat/completions', JSON.stringify({
      model: String(b.modelo || 'llama-3.3-70b-versatile').slice(0, 60),
      messages: mensajes,
      temperature: Number.isFinite(b.temperature) ? Math.min(1.2, Math.max(0, b.temperature)) : 0.45,
      max_tokens: Math.min(700, parseInt(b.max_tokens || 260, 10) || 260),
      top_p: Number.isFinite(b.top_p) ? b.top_p : 0.9,
      stream: false,
      ...(tools.length ? { tools, tool_choice:'auto' } : {})
    }), key);
    const msg = (d.choices && d.choices[0] && d.choices[0].message) || {};
    return json(res, 200, { ok:true, content: msg.content || '', tool_calls: msg.tool_calls || null, uso: d.usage || null, modelo: d.model || '' });
  } catch(e){ return json(res, e.status || 500, { ok:false, error: e.code || 'error', detalle: e.message }); }
};
