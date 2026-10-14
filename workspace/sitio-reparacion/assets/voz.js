/*!
 * TapaTech · Agente de voz "Lupita"
 * Flujo: micrófono (con permiso) → STT → Groq (LLM + herramientas) → TTS neuronal con prosodia.
 * Sin dependencias. Se carga de forma perezosa solo cuando la persona abre el asistente.
 *
 * STT: Web Speech API del navegador (gratis, tiempo real). Si no existe, graba y transcribe
 *      con Groq Whisper (whisper-large-v3-turbo) vía /api/stt.
 * LLM: Groq (llama-3.3-70b-versatile) vía /api/chat. La clave vive en el servidor, nunca aquí.
 * TTS: 1) webhook gratuito (Edge neuronal es-MX-DaliaNeural, ver tools/tts-edge.py)
 *      2) PlayAI vía Groq (/api/tts)
 *      3) voz del navegador (speechSynthesis) — siempre disponible, cero costo.
 *
 * La prosodia es lo importante: el modelo contesta con marcas ([[p:500]], [[r:0.85]], [[t:+10]],
 * [[v:strong]], [[e:alegre]], [[n:digitos]], [[/]]) y este módulo las traduce a pausas reales,
 * cambios de ritmo y de tono según el motor que esté activo.
 */
(function (W) {
'use strict';

var API = W.TAPATECH_VOZ = { listo: false, version: '1.0', estado: 'inactivo' };
var D = document;
function $(s, r) { return (r || D).querySelector(s); }
function $$(s, r) { return Array.prototype.slice.call((r || D).querySelectorAll(s)); }
function track(ev, d) { try { W.dataLayer = W.dataLayer || []; W.dataLayer.push(Object.assign({ event: ev }, d || {})); } catch (e) {} }
function dormir(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
function log() { try { if (W.console && console.info) console.info.apply(console, ['[voz]'].concat([].slice.call(arguments))); } catch (e) {} }

var CFG = null, PROMPT = '', CTX = '';
var historial = [], turnosSinAccion = 0;
var muted = false, manosLibres = true, velUsuario = 1, iniciado = false, cicloActivo = false;
var recogn = null, detenerTodo = false;
var colaAudio = [], reproduciendo = false, audioCtx = null;
var ultimoFolio = null, pendienteEscucha = false;

/* ══════════════════════════════════════════════════════════════════
   1. PROSODIA — parser de marcas (puro, sin DOM: se puede unit-testear)
   ══════════════════════════════════════════════════════════════════ */
var RE_MARCA = /\[\[\s*(p:\d+|r:[0-9.]+|t:[+-]?[0-9.]+|v:[a-zñ]+|e:[a-zñ]+|n:[a-zñ]+|\/)\s*\]\]/gi;

var PROSA_DEFECTO = {
  pausaAutomatica: 140, rateMin: 0.6, rateMax: 1.6, pitchMin: 0.6, pitchMax: 1.6,
  presets: {
    alegre:   { rate: 1.06, pitch: 1.10, volume: 1.00 },
    serio:    { rate: 0.94, pitch: 0.94, volume: 0.95 },
    empatico: { rate: 0.88, pitch: 0.98, volume: 0.90 }
  }
};

/** Convierte texto marcado en segmentos hablables: {text, rate, pitch, volume, emphasis, emocion, digitos, pauseAfter} */
API.parsearProsodia = function (texto, opts) {
  var o = Object.assign({}, PROSA_DEFECTO, (opts && opts.prosodia) || opts || {});
  var txt = String(texto == null ? '' : texto);
  var base = { rate: 1, pitch: 1, volume: 1 };
  var st = Object.assign({}, base), emo = null, emph = null, digitos = false, pausa = 0;
  var segs = [], last = 0, m;

  function empujar(hasta) {
    var crudo = txt.slice(last, hasta);
    last = hasta;
    var t = crudo.replace(/\s+/g, ' ').trim();
    if (!t) return;
    var s = { text: t, rate: st.rate, pitch: st.pitch, volume: st.volume,
              emphasis: emph, emocion: emo, digitos: digitos, pauseAfter: 0 };
    if (pausa && segs.length) segs[segs.length - 1].pauseAfter = Math.max(segs[segs.length - 1].pauseAfter, pausa);
    else if (pausa && !segs.length) s.pauseAfter = 0;
    pausa = 0;
    if (/[.!?…]$/.test(t)) s.pauseAfter = Math.max(s.pauseAfter, o.pausaAutomatica);
    segs.push(s);
  }

  RE_MARCA.lastIndex = 0;
  while ((m = RE_MARCA.exec(txt)) !== null) {
    empujar(m.index);
    var tok = m[1].toLowerCase(), tipo = tok.charAt(0), val = tok.slice(2);
    if (tok === '/') { st = Object.assign({}, base); emo = null; emph = null; digitos = false; }
    else if (tipo === 'p') { pausa = Math.min(3000, parseInt(val, 10) || 0); }
    else if (tipo === 'r') { st.rate = Math.min(o.rateMax, Math.max(o.rateMin, parseFloat(val) || 1)); }
    else if (tipo === 't') { var v = parseFloat(val) || 0; st.pitch = Math.min(o.pitchMax, Math.max(o.pitchMin, st.pitch * (1 + v / 100))); }
    else if (tipo === 'v') { emph = val; }
    else if (tipo === 'e') { emo = val; var pr = o.presets[emo]; if (pr) { st.rate *= pr.rate; st.pitch *= pr.pitch; st.volume = pr.volume; } }
    else if (tipo === 'n') { digitos = (val === 'digitos'); if (digitos) st.rate = Math.min(st.rate, 0.92); }
    /* importante: saltar la marca recién consumida, si no, su texto se cuela
       en el segmento siguiente y el TTS la leería en voz alta ("corchete pe trescientos"). */
    last = m.index + m[0].length;
    RE_MARCA.lastIndex = last;
  }
  empujar(txt.length);
  if (pausa && segs.length) segs[segs.length - 1].pauseAfter = Math.max(segs[segs.length - 1].pauseAfter, pausa);
  /* límite defensivo: rate/pitch dentro de lo que aceptan los motores */
  segs.forEach(function (s) {
    s.rate = Math.min(o.rateMax, Math.max(o.rateMin, s.rate * (velUsuario || 1)));
    s.pitch = Math.min(o.pitchMax, Math.max(o.pitchMin, s.pitch));
  });
  return segs;
};

/** Texto limpio para subtítulos y para motores que no soportan prosodia. */
API.aTextoPlano = function (texto) {
  return String(texto == null ? '' : texto)
    .replace(/\[\[\s*p:(\d+)\s*\]\]/gi, function (_, ms) { return ms >= 700 ? '…' : ms >= 350 ? ', ' : ''; })
    .replace(/\[\[[^\]]*\]\]/gi, '')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/\s+/g, ' ').trim();
};

/** SSML para motores que lo aceptan (Edge/Azure, Amazon Polly, Google). */
API.aSSML = function (texto, opts) {
  var esc = function (s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); };
  var cuerpo = API.parsearProsodia(texto, opts).map(function (s) {
    var out = esc(s.text), attrs = [];
    if (Math.abs(s.rate - 1) > 0.02) attrs.push('rate="' + Math.round(s.rate * 100) + '%"');
    if (Math.abs(s.pitch - 1) > 0.02) attrs.push('pitch="' + (s.pitch > 1 ? '+' : '') + Math.round((s.pitch - 1) * 50) + 'Hz"');
    if (Math.abs(s.volume - 1) > 0.02) attrs.push('volume="' + Math.round(s.volume * 100) + '%"');
    if (attrs.length) out = '<prosody ' + attrs.join(' ') + '>' + out + '</prosody>';
    if (s.emphasis === 'strong') out = '<emphasis level="strong">' + out + '</emphasis>';
    if (s.digitos) out = '<say-as interpret-as="digits">' + out + '</say-as>';
    if (s.pauseAfter) out += '<break time="' + s.pauseAfter + 'ms"/>';
    return out;
  }).join(' ');
  return '<speak version="1.0" xml:lang="es-MX">' + cuerpo + '</speak>';
};

/** Convierte rate/pitch a la notación de Edge TTS: "+2%" / "+4Hz" */
API.rateEdge = function (rate) { var p = Math.round(((rate || 1) - 1) * 100); return (p >= 0 ? '+' : '') + p + '%'; };
API.pitchEdge = function (pitch) { var hz = Math.round(((pitch || 1) - 1) * 50); return (hz >= 0 ? '+' : '') + hz + 'Hz'; };

/* ══════════════════════════════════════════════════════════════════
   2. CONTEXTO VIVO (catálogo + horario) → una sola fuente de verdad
   ══════════════════════════════════════════════════════════════════ */
function datos() { return W.TAPATECH_DATA || {}; }
function negocio() { return datos().negocio || (W.CONFIG) || {}; }

function catalogoCompacto() {
  var cat = datos().catalogo || {}, lineas = [];
  Object.keys(cat).forEach(function (dev) {
    var P = cat[dev].precios || {};
    (cat[dev].servicios || []).forEach(function (s) {
      var t = P[s.id]; if (!t) return;
      var marcas = Object.keys(t).map(function (mk) {
        var v = t[mk];
        if (v && v.incell) return mk + ' economica ' + v.incell[0] + '-' + v.incell[1] + ' premium ' + v.premium[0] + '-' + v.premium[1];
        if (Array.isArray(v)) return mk + ' ' + v[0] + '-' + v[1];
        return '';
      }).filter(Boolean);
      lineas.push(dev + '/' + s.id + ' (' + s.nombre + ', ' + s.tiempo + ', garantia ' + (s.garantia || 0) + ' dias): ' + marcas.join(' | '));
    });
    lineas.push(dev + ' marcas: ' + (cat[dev].marcas || []).map(function (m) { return m.nombre; }).join(', '));
  });
  var ex = negocio().extras || {};
  lineas.push('extras: domicilio ' + (ex.domicilio || 120) + ', express ' + (ex.express || 180) + ', respaldo ' + (ex.respaldo || 150));
  return lineas.join('\n');
}

function estadoAbiertoTexto() {
  if (typeof W.estadoAbierto === 'function') { try { return W.estadoAbierto().txt; } catch (e) {} }
  var hz = negocio().zonaHoraria || 'America/Mexico_City', hor = negocio().horarios || {};
  var p = new Intl.DateTimeFormat('en-US', { timeZone: hz, hour12: false, weekday: 'short', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date());
  var g = function (t) { return (p.filter(function (x) { return x.type === t; })[0] || {}).value; };
  var mapa = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  var dia = mapa[g('weekday')], hh = parseInt(g('hour'), 10) % 24, mm = parseInt(g('minute'), 10);
  var r = hor[dia];
  if (r && hh * 60 + mm >= r[0] * 60 && hh * 60 + mm < r[1] * 60) return 'ABIERTO, cierra a las ' + r[1] + ':00';
  return 'CERRADO en este momento (horario lunes a sabado 9:00-19:00)';
}

function construirContexto() {
  var d = new Date();
  var fecha = d.toLocaleString('es-MX', { timeZone: negocio().zonaHoraria || 'America/Mexico_City', dateStyle: 'full', timeStyle: 'short' });
  var partes = [
    'CONTEXTO EN VIVO (no lo leas en voz alta, úsalo para responder):',
    '- Ahora es: ' + fecha + '.',
    '- Estado del local: ' + estadoAbiertoTexto() + '.',
    '- Página del usuario: ' + location.pathname + (location.hash || '') + (location.search || ''),
    '- Nombre del taller: ' + (negocio().nombre || 'TapaTech') + '. Teléfono/WhatsApp: ' + (negocio().telefonoTxt || '') + '.',
    '- Dirección: ' + (negocio().direccion || '') + '.'
  ];
  if (ultimoFolio) partes.push('- Folio de la cotización que el usuario tiene en pantalla: ' + ultimoFolio);
  var dom = $('#vozLog');
  if (dom && dom.dataset.turnos) partes.push('- Turnos de esta conversación: ' + dom.dataset.turnos);
  partes.push('- CATALOGO DE PRECIOS (MXN, pieza + mano de obra incluidos):');
  partes.push(catalogoCompacto());
  return partes.join('\n');
}

/* ══════════════════════════════════════════════════════════════════
   3. HERRAMIENTAS que el agente puede ejecutar (del lado del cliente)
   ══════════════════════════════════════════════════════════════════ */
var HERRAMIENTAS = [
  { type: 'function', function: { name: 'cotizar', description: 'Devuelve el rango de precio, tiempo y garantía de un servicio para un equipo. Úsala SIEMPRE antes de decir un precio.',
    parameters: { type: 'object', properties: {
      equipo: { type: 'string', enum: ['celular', 'laptop', 'consola'] },
      marca: { type: 'string', description: 'id de marca: apple, samsung, xiaomi, motorola, honor, huawei, hp, lenovo, dell, asus, xbox, ps, switch, otra' },
      modelo: { type: 'string', description: 'modelo tal cual lo dijo el usuario' },
      servicio: { type: 'string', description: 'id de servicio: pantalla, bateria, puerto, camara, mojado, software, placa, formateo, ssd, ram, limpieza, pantallaL, datos, placaL, hdmi, enciende, lector, joystick, termica, pantallaC, diag' },
      calidad: { type: 'string', enum: ['incell', 'premium', 'ambas'] }
    }, required: ['equipo', 'servicio'] } } },
  { type: 'function', function: { name: 'estado_abierto', description: 'Dice si el local está abierto ahora y a qué hora cierra o abre.', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'registrar_lead', description: 'Guarda la solicitud del cliente en el sistema del taller y devuelve un folio. Requiere nombre y teléfono de 10 dígitos.',
    parameters: { type: 'object', properties: {
      nombre: { type: 'string' }, telefono: { type: 'string' }, equipo: { type: 'string' }, marca: { type: 'string' },
      modelo: { type: 'string' }, falla: { type: 'string' }, domicilio: { type: 'boolean' }, colonia: { type: 'string' },
      tipo: { type: 'string', enum: ['diagnostico', 'cita', 'callback', 'oferta'] }, cita_fecha: { type: 'string' }, cita_hora: { type: 'string' }
    }, required: ['nombre', 'telefono'] } } },
  { type: 'function', function: { name: 'agendar_cita', description: 'Valida si un día y hora están disponibles según el horario del local.',
    parameters: { type: 'object', properties: { fecha: { type: 'string', description: 'AAAA-MM-DD' }, hora: { type: 'string', description: 'HH:MM' } }, required: ['fecha', 'hora'] } } },
  { type: 'function', function: { name: 'verificar_folio', description: 'Consulta el estado de un folio existente.', parameters: { type: 'object', properties: { folio: { type: 'string' } }, required: ['folio'] } } },
  { type: 'function', function: { name: 'enviar_whatsapp', description: 'Abre WhatsApp con un mensaje preparado para que el cliente continúe con una persona.',
    parameters: { type: 'object', properties: { motivo: { type: 'string' } }, required: ['motivo'] } } }
];

function normalizarTel(v) { var d = String(v || '').replace(/\D/g, ''); if (d.length === 12 && d.indexOf('52') === 0) d = d.slice(2); return d; }

function cotizarLocal(a) {
  var f = datos().cotizar;
  if (typeof f === 'function') { try { return f(a.equipo, a.marca, a.modelo, a.servicio, a.calidad); } catch (e) { return { error: String(e.message || e) }; } }
  return { error: 'cotizador_no_disponible' };
}
function agendarLocal(a) {
  var hor = negocio().horarios || {};
  var partes = String(a.fecha || '').split('-');
  if (partes.length !== 3) return { disponible: false, motivo: 'fecha con formato invalido, usa AAAA-MM-DD' };
  var dia = new Date(Number(partes[0]), Number(partes[1]) - 1, Number(partes[2])).getDay();
  var r = hor[dia];
  if (!r) return { disponible: false, motivo: 'ese dia el local esta cerrado (domingo solo urgencias por WhatsApp)' };
  var hm = String(a.hora || '').split(':'), mins = (parseInt(hm[0], 10) || 0) * 60 + (parseInt(hm[1], 10) || 0);
  if (mins < r[0] * 60 || mins > (r[1] * 60 - 45)) return { disponible: false, motivo: 'fuera de horario, atendemos de ' + r[0] + ':00 a ' + r[1] + ':00' };
  var hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  if (new Date(Number(partes[0]), Number(partes[1]) - 1, Number(partes[2])) < hoy) return { disponible: false, motivo: 'esa fecha ya paso' };
  return { disponible: true, fecha: a.fecha, hora: a.hora, nota: 'sujeto a confirmacion del taller' };
}
async function registrarLead(a) {
  var folio = (negocio().folioPrefix || 'TT') + '-' + new Date().toISOString().slice(0, 10).replace(/-/g, '') + '-' + Math.random().toString(36).slice(2, 6).toUpperCase();
  var lead = {
    folio: folio, tipo: a.tipo || 'diagnostico', nombre: a.nombre, telefono: normalizarTel(a.telefono),
    telefono_texto: a.telefono, equipo: a.equipo || '', marca: a.marca || '', modelo: a.modelo || '',
    falla: a.falla || '', domicilio: !!a.domicilio, colonia: a.colonia || '',
    cita_fecha: a.cita_fecha || '', cita_hora: a.cita_hora || '', contacto: 'voz',
    consentimiento: true, origen: location.href, pagina: 'agente-de-voz', notes: 'lead capturado por Lupita (voz)'
  };
  var via = 'no_guardado';
  try {
    var r = await fetch(endpoint('leads'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(lead) });
    via = r.ok ? 'api' : 'http_' + r.status;
  } catch (e) { via = 'sin_servidor'; }
  try { var arr = JSON.parse(localStorage.getItem('tt-leads-voz') || '[]'); arr.unshift(lead); localStorage.setItem('tt-leads-voz', JSON.stringify(arr.slice(0, 60))); } catch (e) {}
  ultimoFolio = folio;
  track('voz_lead', { folio: folio, tipo: lead.tipo, via: via });
  return { folio: folio, guardado: via === 'api', via: via, telefono_confirmado: lead.telefono };
}
function abrirWhatsApp(motivo) {
  var num = (negocio().whatsapp || '529622889585');
  var txt = '¡Hola ' + (negocio().nombre || 'TapaTech') + '! Vengo del asistente de voz Lupita. Motivo: ' + (motivo || 'quiero cotizar una reparación') +
    (ultimoFolio ? '. Mi folio es ' + ultimoFolio : '') + '.';
  try { W.open('https://wa.me/' + num + '?text=' + encodeURIComponent(txt), '_blank', 'noopener'); } catch (e) {}
  var a = $('#vozWa'); if (a) a.href = 'https://wa.me/' + num + '?text=' + encodeURIComponent(txt);
  track('voz_whatsapp', { motivo: motivo || '' });
  return { abierto: true };
}
async function ejecutarHerramienta(nombre, args) {
  switch (nombre) {
    case 'cotizar': return cotizarLocal(args);
    case 'estado_abierto': return { estado: estadoAbiertoTexto() };
    case 'registrar_lead': return await registrarLead(args);
    case 'agendar_cita': return agendarLocal(args);
    case 'verificar_folio': return { folio: args.folio, estado: 'por confirmar', nota: 'El estado detallado lo confirma el taller por WhatsApp o en el local.' };
    case 'enviar_whatsapp': return abrirWhatsApp(args.motivo);
    default: return { error: 'herramienta_desconocida: ' + nombre };
  }
}

/* ══════════════════════════════════════════════════════════════════
   4. LLM (Groq) a través del proxy del servidor
   ══════════════════════════════════════════════════════════════════ */
function endpoint(clave) {
  var e = ((W.CONFIG || {}).agenteVoz || {}).endpoints || {};
  var mapa = { chat: '/api/chat', stt: '/api/stt', tts: '/api/tts', leads: '/api/leads' };
  return e[clave] || mapa[clave];
}
function recortar() {
  var max = (CFG.llm && CFG.llm.historialMaximo) || 12;
  if (historial.length > max) historial = historial.slice(historial.length - max);
}
function intentarJSON(s) {
  var t = String(s || '').trim();
  if (t.charAt(0) !== '{') { var i = t.indexOf('{'); if (i < 0) return null; t = t.slice(i); }
  try { return JSON.parse(t); } catch (e) { return null; }
}

async function llamarLLM(mensajes) {
  var cuerpo = {
    modelo: CFG.llm.modelo, temperature: CFG.llm.temperature, max_tokens: CFG.llm.maxTokens,
    sistema: PROMPT, contexto: CTX, mensajes: mensajes, herramientas: HERRAMIENTAS
  };
  var r = await fetch(endpoint('chat'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) });
  if (!r.ok) { var t = ''; try { t = (await r.text()).slice(0, 160); } catch (e) {} throw new Error('llm_' + r.status + (t ? ':' + t : '')); }
  return await r.json();
}

async function pensar(textoUsuario) {
  historial.push({ role: 'user', content: textoUsuario });
  recortar();
  var respuesta = await llamarLLM(historial);
  var guarda = 0;
  while (respuesta.tool_calls && respuesta.tool_calls.length && guarda < 3) {
    guarda++;
    historial.push({ role: 'assistant', content: respuesta.content || '', tool_calls: respuesta.tool_calls });
    for (var i = 0; i < respuesta.tool_calls.length; i++) {
      var tc = respuesta.tool_calls[i], args = {};
      try { args = JSON.parse(tc.function.arguments || '{}'); } catch (e) { args = {}; }
      var res;
      try { res = await ejecutarHerramienta(tc.function.name, args); } catch (e) { res = { error: String(e.message || e) }; }
      log('herramienta', tc.function.name, args, '→', res);
      historial.push({ role: 'tool', tool_call_id: tc.id, name: tc.function.name, content: JSON.stringify(res) });
    }
    recortar();
    respuesta = await llamarLLM(historial);
  }
  var decir = respuesta.content || '';
  var accion = null, parsed = intentarJSON(decir);
  if (parsed && typeof parsed.decir === 'string') { decir = parsed.decir; accion = parsed.accion || null; }
  /* Si el modelo usó herramientas y se quedó callado, cerramos con una frase útil */
  if (!API.aTextoPlano(decir).trim()) decir = '[[e:alegre]]¡Listo![[/]][[p:300]] Ya quedó anotado.[[p:400]] ¿Te ayudo con algo más?';
  historial.push({ role: 'assistant', content: decir });
  recortar();
  if (/whatsapp|folio|cita/i.test(decir)) turnosSinAccion = 0; else turnosSinAccion++;
  return { decir: decir, accion: accion };
}

/* ══════════════════════════════════════════════════════════════════
   5. STT — reconocimiento de voz
   ══════════════════════════════════════════════════════════════════ */
function sttNativo() { return W.SpeechRecognition || W.webkitSpeechRecognition || null; }
async function pedirMicrofono() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('sin_mic');
  return await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
}

function escucharNavegador() {
  var SR = sttNativo();
  return new Promise(function (resolve, reject) {
    var r = new SR(), final = '', inter = '', listo = false;
    r.lang = (CFG.stt && CFG.stt.idioma) || 'es-MX';
    r.continuous = false; r.interimResults = true; r.maxAlternatives = 1;
    var tope = setTimeout(function () { try { r.stop(); } catch (e) {} }, ((CFG.stt && CFG.stt.grabacionMaximaSeg) || 25) * 1000);
    r.onresult = function (e) {
      inter = '';
      for (var i = e.resultIndex; i < e.results.length; i++) {
        var t = e.results[i][0].transcript;
        if (e.results[i].isFinal) final += t; else inter += t;
      }
      pintarInterim((final + ' ' + inter).trim());
      /* barge-in: si Lupita está hablando y la persona ya dijo algo, la callamos */
      if ((final + inter).trim().length > 3 && reproduciendo) cancelarVoz();
    };
    r.onerror = function (e) { listo = true; clearTimeout(tope); reject(new Error('stt_' + (e.error || 'desconocido'))); };
    r.onend = function () {
      if (listo) return; listo = true; clearTimeout(tope); pintarInterim('');
      var t = final.trim();
      t ? resolve(t) : reject(new Error('stt_sin_audio'));
    };
    recogn = r;
    try { r.start(); } catch (e) { reject(new Error('stt_no_inicio')); }
  });
}

async function escucharWhisper() {
  var stream = await pedirMicrofono();
  var tipos = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
  var mime = tipos.filter(function (t) { return W.MediaRecorder && MediaRecorder.isTypeSupported(t); })[0] || '';
  var rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  var chunks = [];
  rec.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
  var fin = new Promise(function (res) { rec.onstop = function () { res(new Blob(chunks, { type: rec.mimeType || 'audio/webm' })); }; });

  var ctx = new (W.AudioContext || W.webkitAudioContext)();
  var src = ctx.createMediaStreamSource(stream), an = ctx.createAnalyser();
  an.fftSize = 1024; src.connect(an);
  var buf = new Float32Array(an.fftSize), hablando = false, silencio = 0, t0 = Date.now();
  var umbral = (CFG.stt && CFG.stt.umbralVolumen) || 0.012;
  var silencioMax = (CFG.stt && CFG.stt.silencioMs) || 900;
  var maxMs = ((CFG.stt && CFG.stt.grabacionMaximaSeg) || 25) * 1000;
  var tick = setInterval(function () {
    an.getFloatTimeDomainData(buf);
    var rms = 0; for (var i = 0; i < buf.length; i++) rms += buf[i] * buf[i];
    rms = Math.sqrt(rms / buf.length);
    pintarViz(rms);
    if (rms > umbral) { hablando = true; silencio = 0; } else if (hablando) { silencio += 120; }
    if ((hablando && silencio >= silencioMax) || Date.now() - t0 > maxMs) { clearInterval(tick); if (rec.state !== 'inactive') rec.stop(); }
  }, 120);
  rec.start();
  var blob = await fin;
  clearInterval(tick); pintarViz(0);
  stream.getTracks().forEach(function (t) { t.stop(); });
  try { ctx.close(); } catch (e) {}
  if (blob.size < 1200) throw new Error('stt_sin_audio');

  /* Enviamos base64 en JSON: funciona igual en Vercel, en Node puro y en cualquier
     proxy, sin necesidad de parsear multipart en el servidor. */
  var b64 = await blobABase64(blob);
  var r = await fetch(endpoint('stt'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
    audio_base64: b64, mime: blob.type || 'audio/webm',
    modelo: (CFG.stt && CFG.stt.modeloWhisper) || 'whisper-large-v3-turbo', idioma: 'es'
  })});
  if (!r.ok) throw new Error('stt_http_' + r.status);
  var j = await r.json();
  if (!j.text || !j.text.trim()) throw new Error('stt_vacio');
  return j.text.trim();
}

function escuchar() {
  var pref = (CFG.stt && CFG.stt.motorPreferido) || 'auto';
  if (pref === 'whisper') return escucharWhisper();
  if (pref === 'navegador' || (pref === 'auto' && sttNativo())) {
    if (sttNativo()) return escucharNavegador();
  }
  return escucharWhisper();
}

/* ══════════════════════════════════════════════════════════════════
   6. TTS — tres motores con la misma prosodia
   ══════════════════════════════════════════════════════════════════ */
function vozNavegador() {
  if (!W.speechSynthesis) return null;
  var voces = speechSynthesis.getVoices() || [];
  var pref = (CFG.tts && CFG.tts.navegador && CFG.tts.navegador.preferirVoces) || ['es-MX', 'es_MX', 'Dalia', 'Paulina', 'Sabina'];
  var evit = (CFG.tts && CFG.tts.navegador && CFG.tts.navegador.evitarVoces) || [];
  var es = voces.filter(function (v) { return /^es[-_](MX|US|419)/i.test(v.lang || ''); });
  var pool = es.length ? es : voces.filter(function (v) { return /^es/i.test(v.lang || ''); });
  var ok = pool.filter(function (v) { return !evit.some(function (e) { return v.name.indexOf(e) >= 0; }); });
  for (var i = 0; i < pref.length; i++) {
    var hit = (ok.length ? ok : pool).filter(function (v) { return v.name.indexOf(pref[i]) >= 0 || (v.lang || '').indexOf(pref[i]) >= 0; })[0];
    if (hit) return hit;
  }
  return (ok.length ? ok : pool)[0] || voces[0] || null;
}

function hablarNavegador(segs) {
  return new Promise(function (resolve) {
    if (!W.speechSynthesis) return resolve(false);
    var nav = CFG.tts && CFG.tts.navegador || {};
    var voz = vozNavegador();
    var i = 0;
    reproduciendo = true; avatar('hablando');
    function siguiente() {
      if (detenerTodo || i >= segs.length) { reproduciendo = false; avatar(''); return resolve(true); }
      var s = segs[i++];
      var u = new SpeechSynthesisUtterance(s.text);
      if (voz) u.voice = voz;
      u.lang = (voz && voz.lang) || 'es-MX';
      u.rate = Math.min(2, Math.max(0.5, s.rate * (nav.velocidad || 1)));
      u.pitch = Math.min(2, Math.max(0, s.pitch * (nav.tono || 1)));
      u.volume = Math.max(0, Math.min(1, s.volume));
      u.onend = function () { setTimeout(siguiente, s.pauseAfter || 0); };
      u.onerror = function () { setTimeout(siguiente, 40); };
      try { speechSynthesis.speak(u); } catch (e) { siguiente(); }
    }
    try { speechSynthesis.cancel(); } catch (e) {}
    siguiente();
  });
}

async function sintetizarRemoto(seg, motor) {
  if (motor === 'webhook') {
    var url = CFG.tts && CFG.tts.webhook && CFG.tts.webhook.url;
    if (!url) throw new Error('sin_webhook');
    var cuerpo = {
      text: seg.text, voice: (CFG.tts && CFG.tts.vozEdge) || 'es-MX-DaliaNeural',
      rate: API.rateEdge(seg.rate), pitch: API.pitchEdge(seg.pitch),
      volume: (CFG.tts && CFG.tts.volumePorDefecto) || '100', format: (CFG.tts && CFG.tts.webhook.formato) || 'mp3',
      ssml: API.aSSML(seg.text, CFG)
    };
    var ctrl = new AbortController();
    var to = setTimeout(function () { ctrl.abort(); }, (CFG.tts.webhook.timeoutMs) || 9000);
    var r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo), signal: ctrl.signal });
    clearTimeout(to);
    if (r.status === 204) throw new Error('webhook_vacio');   /* segmento sin palabras hablables */
    if (!r.ok) throw new Error('webhook_' + r.status);
    var ct = r.headers.get('content-type') || '';
    if (ct.indexOf('json') >= 0) {
      var j = await r.json();
      if (j.audio) return base64ABlob(j.audio, j.format === 'wav' ? 'audio/wav' : 'audio/mpeg');
      if (j.url) return await (await fetch(j.url)).blob();
      throw new Error('webhook_sin_audio');
    }
    return await r.blob();
  }
  /* Groq / PlayAI */
  var g = (CFG.tts && CFG.tts.groq) || {};
  var rr = await fetch(endpoint('tts'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
    text: seg.text, voice: g.voz || 'Jennifer', style: g.estilo || 'Cheerful', speed: Math.min(1.6, Math.max(0.6, seg.rate)),
    modelo: g.modelo || 'playai-tts', formato: 'mp3'
  })});
  if (!rr.ok) throw new Error('tts_' + rr.status);
  var ct2 = rr.headers.get('content-type') || '';
  if (ct2.indexOf('json') >= 0) { var j2 = await rr.json(); if (j2.audio) return base64ABlob(j2.audio, 'audio/mpeg'); throw new Error('tts_sin_audio'); }
  return await rr.blob();
}

function blobABase64(blob) {
  return new Promise(function (resolve, reject) {
    var fr = new FileReader();
    fr.onload = function () { resolve(String(fr.result).split(',')[1] || ''); };
    fr.onerror = function () { reject(new Error('audio_no_leible')); };
    fr.readAsDataURL(blob);
  });
}
function base64ABlob(b64, tipo) {
  var bin = atob(String(b64).replace(/^data:[^,]+,/, '')), len = bin.length, u8 = new Uint8Array(len);
  for (var i = 0; i < len; i++) u8[i] = bin.charCodeAt(i);
  return new Blob([u8], { type: tipo || 'audio/mpeg' });
}

async function reproducirBlob(blob) {
  return new Promise(function (resolve, reject) {
    var url = URL.createObjectURL(blob), a = new Audio(url);
    colaAudio.push(a);
    a.onended = function () { URL.revokeObjectURL(url); colaAudio = colaAudio.filter(function (x) { return x !== a; }); resolve(true); };
    a.onerror = function () { URL.revokeObjectURL(url); reject(new Error('audio_error')); };
    a.play().catch(function (e) { reject(e); });
  });
}

async function hablarRemoto(segs, motor) {
  reproduciendo = true; avatar('hablando');
  for (var i = 0; i < segs.length; i++) {
    if (detenerTodo) break;
    var s = segs[i];
    if (s.text.replace(/\W/g, '').length < 2) { if (s.pauseAfter) await dormir(s.pauseAfter); continue; }
    try {
      var blob = await sintetizarRemoto(s, motor);
      if (blob && blob.size > 200) await reproducirBlob(blob);
    } catch (e) {
      /* Un segmento sin audio no debe tumbar toda la frase: seguimos con el siguiente.
         Solo si falla el motor completo, hablamos() reintenta con la voz del navegador. */
      if (/webhook_vacio/.test(String(e.message))) continue;
      throw e;
    }
    if (s.pauseAfter && !detenerTodo) await dormir(s.pauseAfter);
  }
  reproduciendo = false; avatar('');
  return true;
}

function elegirMotor() {
  var orden = (CFG.tts && CFG.tts.ordenMotores) || ['webhook', 'groq', 'navegador'];
  for (var i = 0; i < orden.length; i++) {
    var m = orden[i];
    if (m === 'webhook' && CFG.tts && CFG.tts.webhook && CFG.tts.webhook.url) return 'webhook';
    if (m === 'groq') return 'groq';           /* el proxy decide si hay clave; si falla, caemos al navegador */
    if (m === 'navegador' && W.speechSynthesis) return 'navegador';
  }
  return W.speechSynthesis ? 'navegador' : null;
}

/** Une segmentos demasiado cortos ("o", "y", "…") al siguiente: suenan naturales
    y evitan una petición de audio por cada palabra suelta. */
API.fusionarSegmentos = function (segs) {
  var out = [], corto = function (t) { return String(t || '').replace(/[\W_]/g, '').length < 2; };
  for (var i = 0; i < segs.length; i++) {
    var s = Object.assign({}, segs[i]);
    if (corto(s.text) && i < segs.length - 1) {
      var sig = Object.assign({}, segs[i + 1]);
      sig.text = (s.text + ' ' + sig.text).replace(/\s+/g, ' ').trim();
      sig.pauseAfter = Math.max(s.pauseAfter || 0, sig.pauseAfter || 0);
      segs[i + 1] = sig;               /* se procesa fusionado en la siguiente vuelta */
      continue;
    }
    if (corto(s.text) && out.length) { /* último segmento corto: se pega al anterior */
      out[out.length - 1].text = (out[out.length - 1].text + ' ' + s.text).replace(/\s+/g, ' ').trim();
      out[out.length - 1].pauseAfter = Math.max(out[out.length - 1].pauseAfter || 0, s.pauseAfter || 0);
      continue;
    }
    out.push(s);
  }
  return out;
};

async function hablar(texto) {
  var plano = API.aTextoPlano(texto);
  if (!plano) return;
  pintarBurbuja('bot', plano);
  if (muted) { notificar('Lupita respondió', plano); return; }
  var segs = API.fusionarSegmentos(API.parsearProsodia(texto, CFG));
  detenerTodo = false;
  var motor = elegirMotor();
  setEstado(motor === 'navegador' ? 'Hablando…' : 'Hablando con voz neuronal…');
  try {
    if (motor === 'navegador') await hablarNavegador(segs);
    else await hablarRemoto(segs, motor);
  } catch (e) {
    log('TTS ' + motor + ' falló, uso el navegador:', e.message);
    track('voz_tts_fallo', { motor: motor || 'ninguno', error: String(e.message || e).slice(0, 60) });
    try { await hablarNavegador(segs); } catch (e2) { /* el subtítulo ya está en pantalla */ }
  }
  setEstado(idleTxt());
  notificar('Lupita respondió', plano);
}

function cancelarVoz() {
  detenerTodo = true;
  try { if (W.speechSynthesis) speechSynthesis.cancel(); } catch (e) {}
  colaAudio.forEach(function (a) { try { a.pause(); a.currentTime = 0; } catch (e) {} });
  colaAudio = [];
  reproduciendo = false; avatar('');
  track('voz_interrumpida');
}

/* ══════════════════════════════════════════════════════════════════
   7. Interfaz
   ══════════════════════════════════════════════════════════════════ */
function avatar(clase) { var a = $('#vozAv'); if (a) a.className = 'voz-av' + (clase ? ' ' + clase : ''); }
function idleTxt() { return manosLibres ? 'Toca el micrófono o habla cuando quieras' : 'Toca el micrófono para hablar'; }
function setEstado(t) {
  API.estado = t;
  var e = $('#vozEstado'), h = $('#vozEstadoHd');
  if (e) e.textContent = t; if (h) h.textContent = t;
}
function pintarBurbuja(tipo, texto) {
  var log2 = $('#vozLog'); if (!log2 || !texto) return;
  var d = D.createElement('div');
  d.className = 'burb burb--' + tipo;
  d.textContent = texto;
  if (tipo === 'bot') d.setAttribute('aria-label', 'Lupita dice: ' + texto);
  log2.appendChild(d);
  log2.scrollTop = log2.scrollHeight;
  log2.dataset.turnos = String(Number(log2.dataset.turnos || 0) + 1);
  return d;
}
var burbInterim = null;
function pintarInterim(texto) {
  var log2 = $('#vozLog'); if (!log2) return;
  if (!texto) { if (burbInterim) { burbInterim.remove(); burbInterim = null; } return; }
  if (!burbInterim) { burbInterim = D.createElement('div'); burbInterim.className = 'burb burb--interim'; log2.appendChild(burbInterim); }
  burbInterim.textContent = texto + '…';
  log2.scrollTop = log2.scrollHeight;
}
function pintarViz(rms) {
  var bars = $$('#vozViz i'); if (!bars.length) return;
  for (var i = 0; i < bars.length; i++) {
    var f = Math.max(0, Math.min(1, (rms || 0) * (6 + Math.random() * 5)));
    bars[i].style.height = (4 + f * 30).toFixed(1) + 'px';
    bars[i].style.opacity = f > 0.05 ? '1' : '.55';
  }
}
function notificar(titulo, cuerpo) {
  if (!(CFG.conversacion && CFG.conversacion.notificarSiPestanaOculta)) return;
  if (!D.hidden || !W.Notification || Notification.permission !== 'granted') return;
  try { new Notification(titulo, { body: String(cuerpo).slice(0, 180), tag: 'lupita', silent: true }); } catch (e) {}
}
function micActivo(on) {
  var m = $('#vozMic'); if (!m) return;
  m.classList.toggle('grabando', !!on);
  m.setAttribute('aria-label', on ? 'Detener micrófono' : 'Activar micrófono y hablar con la asistente');
  avatar(on ? 'escuchando' : '');
}

/* ══════════════════════════════════════════════════════════════════
   8. Ciclo de conversación
   ══════════════════════════════════════════════════════════════════ */
async function ciclo() {
  if (cicloActivo) return;
  cicloActivo = true;
  try {
    setEstado('Escuchando… habla ahora');
    micActivo(true);
    var texto = await escuchar();
    micActivo(false); pintarViz(0);
    if (!texto) { cicloActivo = false; return reintentar('No escuché nada. ¿Me lo repites?'); }
    pintarBurbuja('user', texto);
    track('voz_usuario', { palabras: texto.split(/\s+/).length });
    setEstado('Pensando…');
    var r = await pensar(texto);
    await hablar(r.decir);
    if (r.accion) await manejarAccion(r.accion);
    if (turnosSinAccion >= ((CFG.conversacion && CFG.conversacion.maxTurnosSinAccion) || 8)) {
      await hablar('[[e:empatico]]Para atenderte mejor,[[p:300]] te propongo seguir por WhatsApp con el técnico.[[/]][[p:400]] ¿Te lo abro?');
      abrirWhatsApp('continuar conversación desde el asistente de voz');
      turnosSinAccion = 0;
    }
    if ((manosLibres || pendienteEscucha) && API.estado !== 'fin') {
      pendienteEscucha = false;
      cicloActivo = false;
      await dormir((CFG.conversacion && CFG.conversacion.autoEscucharTrasMs) || 450);
      return ciclo();
    }
  } catch (e) {
    micActivo(false); pintarViz(0);
    await manejarError(e);
  }
  cicloActivo = false;
}

async function reintentar(mensaje) {
  pintarBurbuja('sys', mensaje);
  if (manosLibres) { await dormir(500); ciclo(); }
}

async function manejarError(e) {
  var m = String(e && e.message || e);
  log('error', m);
  track('voz_error', { error: m.slice(0, 80) });
  var msg = 'No pudimos completar la conversación.';
  if (/stt_(not-allowed|service-not-allowed|permission)/.test(m)) msg = 'Sin permiso de micrófono no puedo escucharte. Actívalo en el candado de la barra de direcciones, o escríbenos por WhatsApp.';
  else if (/stt_(no-speech|sin_audio|audio-capture)/.test(m)) msg = 'No capté audio. Acerca el teléfono, revisa que no esté en silencio y vuelve a tocar el micrófono.';
  else if (/stt_(network|language-not-supported)/.test(m)) msg = 'El reconocimiento de voz del navegador falló. Puedes escribirnos por WhatsApp.';
  else if (/sin_mic/.test(m)) msg = 'Este navegador no da acceso al micrófono. Usa Chrome o Safari, o escríbenos por WhatsApp.';
  else if (/llm_(401|403|503)|sin_clave/.test(m)) msg = 'El asistente aún no tiene conectada la IA en este servidor. Mientras tanto, cotiza en el sitio o escríbenos por WhatsApp.';
  else if (/llm_429/.test(m)) msg = 'Estamos atendiendo a varias personas a la vez. Intenta en unos segundos o escríbenos por WhatsApp.';
  else if (/llm_|Failed to fetch|NetworkError/.test(m)) msg = 'Se perdió la conexión con el asistente. Revisa tu internet o sigue por WhatsApp.';
  else if (/tts_|webhook_/.test(m)) msg = 'Tuve un problema con el audio, pero aquí está la respuesta escrita.';
  pintarBurbuja('error', msg);
  setEstado(idleTxt());
  notificar('Lupita', msg);
}

async function manejarAccion(acc) {
  if (!acc || !acc.tipo) return;
  if (acc.tipo === 'whatsapp') abrirWhatsApp(acc.motivo || 'consulta desde el asistente');
  else if (acc.tipo === 'cotizador') { cerrar(); var c = $('#cotizador'); if (c) c.scrollIntoView({ behavior: 'smooth' }); }
  else if (acc.tipo === 'mapa') { cerrar(); var m = $('#ubicacion'); if (m) m.scrollIntoView({ behavior: 'smooth' }); }
  else if (acc.tipo === 'fin') { API.estado = 'fin'; setEstado('Conversación terminada'); await dormir(900); cerrar(); }
  track('voz_accion', { accion: acc.tipo });
}

/* ══════════════════════════════════════════════════════════════════
   9. Arranque
   ══════════════════════════════════════════════════════════════════ */
async function cargarConfig() {
  var url = ((W.CONFIG || {}).agenteVoz || {}).configUrl || 'datos/agente.json';
  var r = await fetch(url, { cache: 'no-cache' });
  if (!r.ok) throw new Error('cfg_' + r.status);
  CFG = await r.json();
  var purl = (CFG.llm && CFG.llm.promptUrl) || 'datos/prompt-agente.md';
  var pr = await fetch(purl, { cache: 'no-cache' });
  var crudo = pr.ok ? await pr.text() : '';
  /* El archivo trae una cabecera de documentación que menciona los marcadores, así que
     tomamos la ÚLTIMA apertura y el primer cierre posterior. */
  var i = crudo.lastIndexOf('===PROMPT==='), j = i >= 0 ? crudo.indexOf('===FIN===', i) : -1;
  PROMPT = (i >= 0 && j > i) ? crudo.slice(i + 12, j).trim() : crudo.trim();
  if (!PROMPT) throw new Error('prompt_vacio');
  manosLibres = !(CFG.conversacion && CFG.conversacion.manosLibres === false);
  var mb = $('#vozManos'); if (mb) mb.setAttribute('aria-pressed', String(manosLibres));
}

async function saludar() {
  var saludo = (CFG.asistente && CFG.asistente.saludo) || '¡Hola! Soy Lupita, del taller TapaTech. ¿Qué le pasó a tu equipo?';
  historial = [{ role: 'assistant', content: saludo }];
  turnosSinAccion = 0;
  await hablar(saludo);
}

async function pedirPermisoNotificaciones() {
  try { if (W.Notification && Notification.permission === 'default') await Notification.requestPermission(); } catch (e) {}
}

API.iniciar = async function () {
  if (iniciado) { abrir(); return; }
  abrir();
  setEstado('Cargando asistente…');
  try {
    await cargarConfig();
    CTX = construirContexto();
    enlazarControles();
    API.listo = true; iniciado = true;
    track('voz_iniciado', { motor_tts: elegirMotor() || 'ninguno', stt: sttNativo() ? 'navegador' : 'whisper' });
    var nombre = (CFG.asistente && CFG.asistente.nombre) || 'Lupita';
    var nn = $('#vozNombre'); if (nn) nn.textContent = nombre + ' · ' + (negocio().nombre || 'TapaTech');
    pintarBurbuja('sys', 'Asistente de voz con IA. ' + ((CFG.permisos && CFG.permisos.explicacionAntesDePedir) || ''));
    await pedirPermisoNotificaciones();
    /* Refresca el contexto cada 60 s para que el horario no se quede viejo */
    setInterval(function () { CTX = construirContexto(); }, 60000);
    await saludar();
    if (manosLibres) ciclo();
  } catch (e) {
    log('fallo al iniciar', e);
    pintarBurbuja('error', 'No pudimos arrancar el asistente (' + String(e.message || e).slice(0, 60) + '). Puedes usar el cotizador o escribirnos por WhatsApp.');
    setEstado('Asistente no disponible');
    track('voz_error_inicio', { error: String(e.message || e).slice(0, 60) });
  }
};

function abrir() {
  var app = $('#vozApp'); if (!app) return;
  app.hidden = false;
  requestAnimationFrame(function () { app.classList.add('is-on'); });
  var b = $('#voiceBtn'); if (b) b.setAttribute('aria-expanded', 'true');
  var log2 = $('#vozLog'); if (log2) log2.scrollTop = log2.scrollHeight;
}
function cerrar() {
  var app = $('#vozApp'); if (!app) return;
  cancelarVoz();
  if (recogn) { try { recogn.abort(); } catch (e) {} recogn = null; }
  app.classList.remove('is-on');
  setTimeout(function () { app.hidden = true; }, 220);
  var b = $('#voiceBtn'); if (b) b.setAttribute('aria-expanded', 'false');
  setEstado('Cerrado');
  track('voz_cerrado');
}
API.alternar = function () { var app = $('#vozApp'); if (!app) return API.iniciar(); app.classList.contains('is-on') ? cerrar() : abrir(); };
API.abrir = abrir; API.cerrar = cerrar;
API.cancelarVoz = cancelarVoz;
/* introspección para pruebas y depuración en consola */
API._debug = function () { return { cicloActivo: cicloActivo, reproduciendo: reproduciendo, pendienteEscucha: pendienteEscucha, detenerTodo: detenerTodo,
  muted: muted, manosLibres: manosLibres, estado: API.estado, historial: historial.length, turnosSinAccion: turnosSinAccion }; };
API.hablarTexto = hablar;               /* útil para probar la prosodia desde consola */
API.parsear = API.parsearProsodia;

function enlazarControles() {
  var mic = $('#vozMic');
  if (mic) mic.addEventListener('click', function () {
    if (reproduciendo) cancelarVoz();          /* barge-in: la callamos */
    if (!cicloActivo) { setEstado('Te escucho…'); ciclo(); }
    else {
      /* Ya hay un turno activo: pedimos que en cuanto termine vuelva a escuchar
         (así interrumpir con el micrófono siempre funciona, haya o no manos libres). */
      pendienteEscucha = true;
      if (recogn) { try { recogn.stop(); } catch (e) {} }
      setEstado('Te escucho…');
    }
  });
  var x = $('#vozX'); if (x) x.addEventListener('click', cerrar);
  var mu = $('#vozMute');
  if (mu) mu.addEventListener('click', function () {
    muted = !muted; mu.setAttribute('aria-pressed', String(muted));
    mu.textContent = muted ? '🔊 Activar voz' : '🔇 Silenciar voz';
    if (muted) cancelarVoz();
    track('voz_mute', { silenciado: muted });
  });
  var vel = $('#vozVel');
  if (vel) vel.addEventListener('change', function () { velUsuario = parseFloat(vel.value) || 1; track('voz_velocidad', { velocidad: velUsuario }); });
  var ml = $('#vozManos');
  if (ml) ml.addEventListener('click', function () {
    manosLibres = !manosLibres; ml.setAttribute('aria-pressed', String(manosLibres));
    ml.textContent = manosLibres ? '🔁 Manos libres' : '👆 Un turno a la vez';
    if (manosLibres && !cicloActivo) ciclo();
  });
  var wa = $('#vozWa'); if (wa && !wa.getAttribute('href').match(/wa\.me/)) wa.href = 'https://wa.me/' + (negocio().whatsapp || '');
  var cot = $('#vozCot'); if (cot) cot.addEventListener('click', function () { cerrar(); var c = $('#cotizador'); if (c) c.scrollIntoView({ behavior: 'smooth' }); });
  /* Muestra de voz real (generada con es-MX-DaliaNeural) para que el cliente la escuche antes de hablar */
  var demo = $('#vozDemo');
  if (demo) demo.addEventListener('click', function () {
    try {
      var a = demo._audio || (demo._audio = new Audio('assets/demo-lupita.mp3'));
      if (a.paused) { cancelarVoz(); a.play(); demo.textContent = '⏸ Detener muestra'; }
      else { a.pause(); demo.textContent = '▶️ Escuchar a Lupita'; }
      a.onended = function () { demo.textContent = '▶️ Escuchar a Lupita'; };
      track('voz_demo', { reproduciendo: a.paused ? false : true });
    } catch (e) { log('demo no disponible', e.message); }
  });
  D.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && $('#vozApp') && $('#vozApp').classList.contains('is-on')) cerrar();
    /* barra espaciadora = push-to-talk cuando el panel está abierto y no hay un campo enfocado */
    if (e.code === 'Space' && $('#vozApp') && $('#vozApp').classList.contains('is-on')) {
      var t = e.target.tagName;
      if (t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT' || t === 'BUTTON') return;
      e.preventDefault();
      if (reproduciendo) cancelarVoz();
      if (!cicloActivo) ciclo();
    }
  });
  /* voces del navegador: en algunos motores llegan de forma asíncrona */
  if (W.speechSynthesis && speechSynthesis.onvoiceschanged !== undefined) speechSynthesis.onvoiceschanged = function () { log('voces listas:', (speechSynthesis.getVoices() || []).length); };
  D.addEventListener('visibilitychange', function () { if (D.hidden) cancelarVoz(); });
}

/* Pre-carga de voces (Chrome las entrega tarde) */
try { if (W.speechSynthesis) { speechSynthesis.getVoices(); setTimeout(function () { speechSynthesis.getVoices(); }, 300); } } catch (e) {}

})(window);
