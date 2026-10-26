/*!
 * TapaTech · Agente de voz "Lupita"
 * Flujo: micrófono (con permiso) → STT → Groq (LLM + herramientas) → Edge TTS con puntuación natural.
 * Sin dependencias. Se carga de forma perezosa solo cuando la persona abre el asistente.
 *
 * STT: Web Speech API del navegador (gratis, tiempo real). Si no existe, graba y transcribe
 *      con Groq Whisper (whisper-large-v3-turbo) vía /api/stt.
 * LLM: Groq (openai/gpt-oss-20b) vía /api/chat. La clave vive en el servidor, nunca aquí.
 * TTS: 1) webhook gratuito (Edge neuronal es-MX-DaliaNeural, ver tools/tts-edge.py)
 *      2) voz del navegador (speechSynthesis) como respaldo.
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

var CFG = null, CTX = '';
var historial = [], turnosSinAccion = 0, propuestasConvertidas = 0, autorizacionLeadEnTurno = false, leadGuardadoEnTurno = false;
var manosLibres = true, velUsuario = 0.9, iniciado = false, cicloActivo = false;
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

/** Conserva la puntuación que Edge usa para pausas y entonación. */
API.textoParaVoz = function (texto) {
  var s = API.aTextoPlano(texto)
    .replace(/([.!?…])\s*,/g, '$1')
    .replace(/,\s*,+/g, ',')
    .replace(/([.!?…])(?=\S)/g, '$1 ');
  function agregarSignoApertura(cierre, apertura) {
    var fin = s.indexOf(cierre);
    if (fin < 0) return;
    var inicio = Math.max(
      s.lastIndexOf('.', fin - 1),
      s.lastIndexOf('?', fin - 1),
      s.lastIndexOf('!', fin - 1),
      s.lastIndexOf(',', fin - 1)
    ) + 1;
    if (s.slice(inicio, fin).indexOf(apertura) >= 0) return;
    while (inicio < fin && /\s/.test(s.charAt(inicio))) inicio++;
    s = s.slice(0, inicio) + apertura + s.slice(inicio);
  }
  agregarSignoApertura('?', '¿');
  agregarSignoApertura('!', '¡');
  s = s.replace(/[,;:]\s*$/, '');
  if (s && !/[.!?…]$/.test(s)) s += '.';
  return s;
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
        if (v && v.incell) return mk + ' economica desde ' + v.incell[0] + ' premium desde ' + v.premium[0];
        if (Array.isArray(v)) return v[0] === 0 ? '' : mk + ' desde ' + v[0];
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
  partes.push('- CATALOGO DE PRECIOS (MXN, aproximados "desde", pieza + mano de obra incluidos; es la MISMA tabla que muestra el cotizador del sitio, unica fuente de precios). REGLA: al dar cualquier precio di SIEMPRE "aproximadamente desde X pesos, depende de tu modelo exacto" y agrega "siempre te damos la mejor calidad y el mejor precio". Nunca des un rango alto ni una cifra unica como precio final, e invita a usar el cotizador o pasar por el taller para el precio cerrado tras diagnostico gratis. En iPhone ofrece la opcion de pantalla SIN mensaje de pieza cambiada. Las tapas traseras solo existen para iPhone; si el cliente tiene Android no las ofrezcas.');
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
  { type: 'function', function: { name: 'registrar_lead', description: 'Guarda la solicitud solo después de que el cliente autorizó guardar sus datos en el turno anterior. Requiere nombre, teléfono de 10 dígitos y consentimiento true.',
    parameters: { type: 'object', properties: {
      nombre: { type: 'string' }, telefono: { type: 'string' }, equipo: { type: 'string' }, marca: { type: 'string' },
      modelo: { type: 'string' }, falla: { type: 'string' }, domicilio: { type: 'boolean' }, colonia: { type: 'string' },
      tipo: { type: 'string', enum: ['diagnostico', 'cita', 'callback', 'oferta'] }, cita_fecha: { type: 'string' }, cita_hora: { type: 'string' },
      consentimiento: { type: 'boolean', enum: [true] }
    }, required: ['nombre', 'telefono', 'consentimiento'] } } },
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
  if (a.consentimiento !== true || !autorizacionLeadEnTurno) return { error: 'consentimiento_requerido', guardado: false };
  autorizacionLeadEnTurno = false;
  var telefono = normalizarTel(a.telefono);
  if (!/^\d{10}$/.test(telefono)) return { error: 'telefono_invalido', guardado: false };
  var folio = (negocio().folioPrefix || 'TT') + '-' + new Date().toISOString().slice(0, 10).replace(/-/g, '') + '-' + Math.random().toString(36).slice(2, 6).toUpperCase();
  var lead = {
    folio: folio, tipo: a.tipo || 'diagnostico', nombre: a.nombre, telefono: telefono,
    telefono_texto: a.telefono, equipo: a.equipo || '', marca: a.marca || '', modelo: a.modelo || '',
    falla: a.falla || '', domicilio: !!a.domicilio, colonia: a.colonia || '',
    cita_fecha: a.cita_fecha || '', cita_hora: a.cita_hora || '', contacto: 'voz',
    consentimiento: true, origen: location.href, pagina: 'agente-de-voz', notas: 'lead capturado por Lupita (voz)'
  };
  try {
    var r = await fetch(endpoint('leads'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(lead) });
    if (!r.ok) return { error: 'lead_no_guardado', guardado: false, estado: r.status };
  } catch (e) { return { error: 'lead_no_guardado', guardado: false }; }
  ultimoFolio = folio;
  turnosSinAccion = 0;
  propuestasConvertidas = 0;
  leadGuardadoEnTurno = true;
  track('voz_lead', { folio: folio, tipo: lead.tipo, via: 'api' });
  return { folio: folio, guardado: true, telefono_confirmado: lead.telefono };
}
function abrirWhatsApp(motivo) {
  var num = (negocio().whatsapp || '529622889585');
  var txt = '¡Hola ' + (negocio().nombre || 'TapaTech') + '! Vengo del asistente de voz Lupita. Motivo: ' + (motivo || 'quiero cotizar una reparación') +
    (ultimoFolio ? '. Mi folio es ' + ultimoFolio : '') + '.';
  var a = $('#vozWa');
  if (a) {
    a.href = 'https://wa.me/' + num + '?text=' + encodeURIComponent(txt);
    a.hidden = false;
    a.textContent = 'Continuar por WhatsApp';
  }
  if (!a) return { error: 'enlace_whatsapp_no_disponible', preparado: false };
  track('voz_whatsapp', { motivo: motivo || '' });
  return { preparado: true, requiereToque: true };
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
  /* El prompt maestro lo pone el SERVIDOR (datos/prompt-agente.md). No lo
     mandamos desde aquí: antes viajaba duplicado y agotaba el TPM de Groq. */
  var cuerpo = {
    modelo: CFG.llm.modelo, temperature: CFG.llm.temperature, max_tokens: CFG.llm.maxTokens,
    contexto: CTX, mensajes: mensajes, herramientas: HERRAMIENTAS
  };
  /* timeout propio: si Vercel tarda o el teléfono cambia de red, NO dejamos a
     Lupita congelada en "Pensando…" — abortamos y caemos al manejo de error. */
  var ctrl = new AbortController();
  var to = setTimeout(function () { try { ctrl.abort(); } catch (e) {} }, (CFG.llm && CFG.llm.timeoutMs) || 20000);
  var r;
  try {
    r = await fetch(endpoint('chat'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo), signal: ctrl.signal });
  } catch (e) {
    if (String(e && e.name) === 'AbortError') throw new Error('llm_timeout');
    throw new Error('llm_red: ' + String(e && e.message || e).slice(0, 60));
  } finally { clearTimeout(to); }
  if (!r.ok) {
    var t = '', code = '';
    try { var j = await r.json(); code = j && j.error ? j.error : ''; t = (j && j.detalle) ? String(j.detalle).slice(0, 140) : ''; }
    catch (e) { try { t = (await r.text()).slice(0, 140); } catch (e2) {} }
    var err = new Error('llm_' + r.status + (code ? '_' + code : '') + (t ? ':' + t : ''));
    err.code = code; err.status = r.status;
    throw err;
  }
  return await r.json();
}

/* La cuenta dura solo lo que dure esta conversación: no se persigue al visitante
   entre sesiones y Lupita deja de insistir después de dos propuestas. */
function accionEsConversion(a) { return !!a && ['whatsapp', 'cotizador', 'cita'].includes(a.tipo); }

function registrarConversion(decir, acc, textoUsuario) {
  var maxProp = (CFG.conversacion && CFG.conversacion.maxPropuestasConversion) || 2;
  if (leadGuardadoEnTurno) { propuestasConvertidas = 0; return false; }
  var propuso = !!accionEsConversion(acc) ||
    /\b(?:whatsapp|cotizador|cotizaci[oó]n|folio|cita|agend(?:a|ar|amos)|apart(?:a|ar)|recolecci[oó]n)\b/i.test(String(decir || ''));
  var acepto = propuestasConvertidas > 0 &&
    /^\s*(?:sí|si|claro|va|dale|ok|okay|me parece|está bien|anótame|aparta|agenda|quiero|mándalo|envíalo)\b/i.test(String(textoUsuario || ''));
  if (acepto || (acc && accionEsConversion(acc))) propuestasConvertidas = 0;
  else if (propuso) propuestasConvertidas++;
  return propuestasConvertidas >= maxProp;
}

async function pensar(textoUsuario) {
  leadGuardadoEnTurno = false;
  var ultimoAsistente = '';
  for (var ai = historial.length - 1; ai >= 0; ai--) {
    if (historial[ai].role === 'assistant' && !historial[ai].tool_calls && historial[ai].content) {
      ultimoAsistente = String(historial[ai].content);
      break;
    }
  }
  autorizacionLeadEnTurno =
    /\b(?:autoriz|permiso|guardar|registrar)\b/i.test(ultimoAsistente) &&
    /^\s*(?:sí|si)(?:\s*,?\s*(?:autorizo|está bien|claro|puedes|de acuerdo|por favor))?\s*[.!]?\s*$/i.test(String(textoUsuario || ''));
  historial.push({ role: 'user', content: textoUsuario });
  /* CIERRE DIRECTO tras 2 propuestas de conversión sin aceptación:
     se inyecta una orden de sistema al final del historial (no se guarda
     permanente; solo vive en esta llamada). Así Lupita deja de insistir,
     ahorra llamadas a la API y suelta al "comparador de precios" con elegancia. */
  var maxProp = (CFG.conversacion && CFG.conversacion.maxPropuestasConversion) || 2;
  var rechazo = propuestasConvertidas > 0 && /^\s*(?:no gracias|ahora no|no por ahora|luego|después|solo estoy viendo|solo comparo)\b/i.test(String(textoUsuario || ''));
  var cierreObligatorio = propuestasConvertidas >= maxProp || rechazo;
  if (cierreObligatorio) {
    historial.push({ role: 'system', content: 'CIERRE OBLIGATORIO: ya ofreciste ayuda ' + propuestasConvertidas + ' veces y el cliente no toma ninguna acción (solo compara precios o evade). NO vuelvas a proponer WhatsApp, cotización ni cita. Responde ÚNICAMENTE un cierre corto, amable y directo, más o menos así: "Si en algún momento decides repararlo, escríbenos por WhatsApp y te atendemos de inmediato. Que estés bien." Y termina la conversación con calma.' });
  }
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
  var decir = API.corregirNombre(respuesta.content || '');
  var accion = null, parsed = intentarJSON(decir);
  if (parsed && typeof parsed.decir === 'string') { decir = parsed.decir; accion = parsed.accion || null; }
  /* Si el modelo usó herramientas y se quedó callado, cerramos con una frase útil */
  if (!API.aTextoPlano(decir).trim()) decir = '[[e:alegre]]¡Listo![[/]][[p:300]] Ya quedó anotado.[[p:400]] ¿Te ayudo con algo más?';
  historial.push({ role: 'assistant', content: decir });
  recortar();
  if (/whatsapp|folio|cita/i.test(decir)) turnosSinAccion = 0; else turnosSinAccion++;
  registrarConversion(decir, accion, textoUsuario);
  return { decir: decir, accion: accion, cierre: cierreObligatorio };
}

/* ══════════════════════════════════════════════════════════════════
   5. STT — reconocimiento de voz con blindaje anti-ruido
   ──────────────────────────────────────────────────────────────────
   El taller, la calle o un TV cercano pueden llenar el ambiente de ruido.
   Para que la respuesta no sea un desastre, aplicamos varias capas:
   a) Filtro hardware del micrófono: echoCancellation + noiseSuppression + AGC.
   b) Calibración: medimos el ruido ambiente los primeros ~700 ms y fijamos
      un umbral adaptativo por encima de él.
   c) Puerta de ruido (noise gate): solo mandamos al motor de STT el audio
      donde realmente hay voz (RMS por encima del umbral), recortando
      silencios y rachas de ruido puro.
   d) VAD con histéresis para detectar cuándo terminaste de hablar.
   e) En Web Speech API: confianza mínima + rechazo de frases fantasma
      ("ok google", dictados en inglés, palabras sueltas sin contexto).
   f) Si el navegador falla o sospecha de ruido, fallback automático a
      Whisper (mucho más robusto con ruido de fondo).
   g) Reintento inteligente: si la captura fue pobre, Lupita lo dice y da
      consejos concretos en vez de responder cualquier cosa.
   ══════════════════════════════════════════════════════════════════ */
/* ── LUPITA NUNCA DICE "TAPATECH" (espejo cliente de api/_groq.js) ─────────
   El STT del navegador (Web Speech API) transcribe "TapaTech" como "tapatech".
   Se corrige la transcripción ANTES de pintar el "Entendí: ..." y antes de
   enviarla al LLM; y se limpia también toda salida hablada, por si acaso. */
var VARIANTES_NOMBRE = /\b(?:tapa|ta\s?pa|tapat)[\s.,'-]*(?:tech|teck|tex|teks|tach|tetsh?|tetch)\b|\btapatech\b|\btapatex\b/gi;
API.corregirNombre = function (t) {
  var s = String(t == null ? '' : t);
  if (!s) return s;
  s = s.replace(VARIANTES_NOMBRE, function (m) { return /chula/i.test(m) ? m : 'TapaTech'; });
  s = s.replace(/\btapatech\b/gi, function (m) { return /chula/i.test(m) ? m : 'TapaTech'; });
  return s;
};

function sttNativo() { return W.SpeechRecognition || W.webkitSpeechRecognition || null; }
async function pedirMicrofono() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('sin_mic');
  var s = (CFG.stt) || {};
  return await navigator.mediaDevices.getUserMedia({ audio: {
    echoCancellation: s.echoCancellation !== false,
    noiseSuppression: s.noiseSuppression !== false,
    autoGainControl: s.autoGainControl !== false
  }});
}

/* Medidor de RMS reutilizable sobre un MediaStream */
function crearMedidor(stream) {
  var ctx = new (W.AudioContext || W.webkitAudioContext)();
  var src = ctx.createMediaStreamSource(stream);
  var an = ctx.createAnalyser();
  an.fftSize = 1024; an.smoothingTimeConstant = 0.6;
  src.connect(an);
  var buf = new Float32Array(an.fftSize);
  return {
    ctx: ctx,
    rms: function () {
      an.getFloatTimeDomainData(buf);
      var s = 0; for (var i = 0; i < buf.length; i++) s += buf[i] * buf[i];
      return Math.sqrt(s / buf.length);
    },
    cerrar: function () { try { ctx.close(); } catch (e) {} }
  };
}

/* Calibración de ruido ambiente: mide durante `ms` y devuelve estadísticas.
   Devuelve { base, p90, max } — "base" es el ruido de fondo típico. */
function calibrarRuido(medidor, ms) {
  return new Promise(function (resolve) {
    var muestras = [], t0 = Date.now();
    var iv = setInterval(function () {
      muestras.push(medidor.rms());
      if (Date.now() - t0 >= (ms || 700)) {
        clearInterval(iv);
        muestras.sort(function (a, b) { return a - b; });
        var n = muestras.length;
        resolve({
          base: muestras[Math.floor(n * 0.5)] || 0,       /* mediana */
          p90:  muestras[Math.floor(n * 0.9)] || 0,       /* picos frecuentes */
          max:  muestras[n - 1] || 0
        });
      }
    }, 60);
  });
}

/* Construye un stream filtrado por puerta de ruido: pasa solo cuando hay voz.
   Con ruido alto sube el corte; con silencio lo baja (adaptativo). */
function aplicarPuerta(stream, umbralFn) {
  var ctx = new (W.AudioContext || W.webkitAudioContext)();
  var src = ctx.createMediaStreamSource(stream);
  var proc = ctx.createScriptProcessor(2048, 1, 1);
  var gateAbierto = false, holdFrames = 0;
  var SILENCIO_BLANCO = new Float32Array(2048);
  proc.onaudioprocess = function (e) {
    var inp = e.inputBuffer.getChannelData(0), out = e.outputBuffer.getChannelData(0);
    var rms = 0; for (var i = 0; i < inp.length; i++) rms += inp[i] * inp[i];
    rms = Math.sqrt(rms / inp.length);
    var u = umbralFn();
    if (rms > u) { gateAbierto = true; holdFrames = 12; } /* ~250 ms de cola para no cortar finales */
    else if (holdFrames > 0) holdFrames--; else gateAbierto = false;
    if (gateAbierto) out.set(inp); else out.set(SILENCIO_BLANCO);
  };
  src.connect(proc); proc.connect(ctx.destination);
  return {
    stream: new MediaStream(ctx.destination.stream.getAudioTracks()),
    cerrar: function () { try { proc.disconnect(); src.disconnect(); ctx.close(); } catch (e) {} }
  };
}

/* ¿Sospechamos que el texto recibido es basura por ruido? */
API.textoSospechoso = function (t) {
  var s = String(t || '').trim();
  if (!s) return true;
  var pal = s.toLowerCase().split(/\s+/);
  /* frases fantasma típicas del motor cuando come ruido ambiente */
  if (/^(ok\s?google|hey\s?google|hola\??$|gracias\.?|hello\.?|hi\.?|hey\.?)$/i.test(s)) return true;
  if (/noisy conditions|please|\[.*?\]|silence|thank you/i.test(s)) return true;
  /* una sola palabra suelta sin contexto suele ser residuo de ruido */
  if (pal.length === 1 && /^(ok|okay|go|the|and|a|i|you|yeah|yes|no|hmm|hum|uh|eh)$/i.test(pal[0])) return true;
  /* repetición de la misma palabra ("the the the") = dictado fantasma */
  var unicos = {}; pal.forEach(function (w) { unicos[w] = 1; });
  if (pal.length >= 2 && Object.keys(unicos).length === 1) return true;
  /* dictado en inglés = casi siempre ruido (el usuario habla español) */
  if (/^(hello|hi|hey|thank you|thanks|good morning|what'?s up|can you|the)\b/i.test(s) && !/[áéíóúñ¿¡]/i.test(s)) return true;
  return false;
};

function escucharNavegador() {
  var SR = sttNativo();
  var cfg = CFG.stt || {};
  var minConfianza = cfg.confianzaMinima || 0.5;
  return new Promise(function (resolve, reject) {
    var r = new SR(), final = '', mejorConf = 0, listo = false;
    r.lang = cfg.idioma || 'es-MX';
    r.continuous = false; r.interimResults = true;
    r.maxAlternatives = Math.max(3, cfg.alternativas || 3); /* elegimos la alternativa más creíble */
    var tope = setTimeout(function () { try { r.stop(); } catch (e) {} }, ((cfg.grabacionMaximaSeg) || 25) * 1000);
    r.onresult = function (e) {
      var inter = '';
      for (var i = e.resultIndex; i < e.results.length; i++) {
        var res = e.results[i], alt = res[0];
        if (res.isFinal) {
          mejorConf = Math.max(mejorConf, alt.confidence || 0);
          final += ' ' + alt.transcript;
        } else inter += alt.transcript;
      }
      pintarInterim((final + ' ' + inter).trim());
      /* barge-in: si Lupita está hablando y la persona ya dijo algo, la callamos */
      if ((final + inter).trim().length > 3 && reproduciendo) cancelarVoz();
    };
    r.onerror = function (e) { listo = true; clearTimeout(tope); reject(new Error('stt_' + (e.error || 'desconocido'))); };
    r.onend = function () {
      if (listo) return; listo = true; clearTimeout(tope); pintarInterim('');
      var t = final.trim();
      if (!t) return reject(new Error('stt_sin_audio'));
      /* Confianza muy baja = probablemente nos comió el ruido → usar Whisper */
      if (mejorConf && mejorConf < minConfianza) return reject(new Error('stt_ruido_baja_confianza'));
      if (API.textoSospechoso(t)) return reject(new Error('stt_ruido_sospechoso'));
      resolve(API.corregirNombre(t));
    };
    recogn = r;
    try { r.start(); } catch (e) { reject(new Error('stt_no_inicio')); }
  });
}

async function escucharWhisper() {
  var stream = await pedirMicrofono();
  var cfg = CFG.stt || {};

  /* ── Calibración de ruido ambiente (~700 ms) ─────────────────── */
  var medidor = crearMedidor(stream);
  var ruido = await calibrarRuido(medidor, cfg.calibracionMs || 700);
  medidor.cerrar();
  var baseUmbral = cfg.umbralVolumen || 0.012;
  /* Umbral adaptativo: por encima del ruido de fondo detectado (con piso y techo) */
  var umbralCal = Math.min(0.08, Math.max(baseUmbral, ruido.p90 * 2.2));
  log('ruido ambiente', ruido, 'umbral→', umbralCal.toFixed(4));
  track('voz_calibracion', { base: +ruido.base.toFixed(4), p90: +ruido.p90.toFixed(4), umbral: +umbralCal.toFixed(4) });
  if (ruido.p90 > (cfg.ruidoAlerta || 0.05)) setEstado('Ambiente ruidoso · acércate y habla fuerte y claro');

  /* ── Puerta de ruido: solo pasa audio con voz ─────────────────── */
  var puerta = null, grabStream = stream;
  if (cfg.puertaRuido !== false && W.AudioContext && typeof AudioContext.prototype.createScriptProcessor === 'function') {
    try {
      var umbralDin = umbralCal;
      puerta = aplicarPuerta(stream, function () { return umbralDin; });
      grabStream = puerta.stream;
    } catch (e) { log('puerta indisponible', e.message); }
  }

  var tipos = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
  var mime = tipos.filter(function (t) { return W.MediaRecorder && MediaRecorder.isTypeSupported(t); })[0] || '';
  var rec = new MediaRecorder(grabStream, mime ? { mimeType: mime } : undefined);
  var chunks = [];
  rec.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
  var fin = new Promise(function (res) { rec.onstop = function () { res(new Blob(chunks, { type: rec.mimeType || 'audio/webm' })); }; });

  var ctx = new (W.AudioContext || W.webkitAudioContext)();
  var src = ctx.createMediaStreamSource(grabStream), an = ctx.createAnalyser();
  an.fftSize = 1024; src.connect(an);
  var buf = new Float32Array(an.fftSize), hablando = false, silencio = 0, t0 = Date.now();
  var umbral = umbralCal;
  var silencioMax = (cfg.silencioMs) || 900;
  var maxMs = ((cfg.grabacionMaximaSeg) || 25) * 1000;
  /* histéresis: abrir es más difícil que mantenerse abierto */
  var tick = setInterval(function () {
    an.getFloatTimeDomainData(buf);
    var rms = 0; for (var i = 0; i < buf.length; i++) rms += buf[i] * buf[i];
    rms = Math.sqrt(rms / buf.length);
    pintarViz(rms);
    if (rms > (hablando ? umbral * 0.6 : umbral)) { hablando = true; silencio = 0; } else if (hablando) { silencio += 120; }
    if ((hablando && silencio >= silencioMax) || Date.now() - t0 > maxMs) { clearInterval(tick); if (rec.state !== 'inactive') rec.stop(); }
  }, 120);
  rec.start();
  var blob = await fin;
  clearInterval(tick); pintarViz(0);
  if (puerta) puerta.cerrar();
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
  var txt = j.text.trim();
  /* Whisper alucina con ruido ("¡Gracias!", subtítulos) — lo filtramos aquí también */
  if (API.textoSospechoso(txt)) throw new Error('stt_ruido_sospechoso');
  /* el servidor ya corrige, pero aplicamos de nuevo por si vino de caché u otro backend */
  return API.corregirNombre(txt);
}

function escuchar() {
  var pref = (CFG.stt && CFG.stt.motorPreferido) || 'auto';
  if (pref === 'whisper') return escucharWhisper();
  if (pref === 'navegador' || (pref === 'auto' && sttNativo())) {
    if (sttNativo()) {
      return escucharNavegador().catch(function (e) {
        var m = String(e && e.message || '');
        /* Si el motor del navegador se confundió por ruido o no hay red para su
           servicio, caemos a Whisper que maneja mejor esos casos. */
        if (/stt_(network|no-speech|sin_audio|ruido_baja_confianza|ruido_sospechoso|aborted)/.test(m)) {
          log('fallback a Whisper por', m);
          track('voz_fallback_whisper', { motivo: m.slice(0, 60) });
          return escucharWhisper();
        }
        throw e;
      });
    }
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
        rate: API.rateEdge(velUsuario),
      pitch: (CFG.tts && CFG.tts.pitchPorDefecto) || '+6Hz',
      volume: (CFG.tts && CFG.tts.volumePorDefecto) || '100', format: (CFG.tts && CFG.tts.webhook.formato) || 'mp3',
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
  /* Proxy al webhook gratuito Edge TTS configurado solo en el servidor. */
  var rr = await fetch(endpoint('tts'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
    text: seg.text, voice: (CFG.tts && CFG.tts.vozEdge) || 'es-MX-DaliaNeural',
    rate: API.rateEdge(velUsuario),
    pitch: (CFG.tts && CFG.tts.pitchPorDefecto) || '+6Hz',
    volume: (CFG.tts && CFG.tts.volumePorDefecto) || '100',
    formato: 'mp3'
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
  var orden = (CFG.tts && CFG.tts.ordenMotores) || ['proxy', 'navegador'];
  for (var i = 0; i < orden.length; i++) {
    var m = orden[i];
    if (m === 'webhook' && CFG.tts && CFG.tts.webhook && CFG.tts.webhook.url) return 'webhook';
    /* Si /api/health dice que no hay TTS_WEBHOOK, no perdemos una petición
       fallida por respuesta: pasamos directo a la voz del navegador. */
    if (m === 'proxy' && !(CFG.tts && CFG.tts.proxyOk === false)) return 'proxy';
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
  var plano = API.textoParaVoz(texto);
  if (!plano) return;
  var burbBot = pintarBurbuja('bot', plano);
  /* Lupita "escribe" su respuesta: punteado vivo hasta que empieza a sonar */
  if (burbBot) { burbBot.classList.add('typing'); setTimeout(function(){ burbBot.classList.remove('typing'); }, Math.min(2600, plano.length * 24)); }
  var motor = elegirMotor();
  var segs = motor && motor !== 'navegador'
    ? [{ text: plano, rate: 1, pitch: 1, volume: 1, pauseAfter: 0 }]
    : API.fusionarSegmentos(API.parsearProsodia(texto, CFG));
  detenerTodo = false;
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
  var e = $('#vozEstado');
  if (e) e.textContent = t;
  /* Lupita (mascota salmón): el botón "Hablar con Lupita" refleja si escucha o habla */
  var vb = $('#voiceBtn'), vl = $('#voiceBtnLbl');
  if (vb) vb.classList.toggle('voice-live', !!(t && /escuchando|hablando/i.test(t)));
  if (vl) vl.textContent = !t ? '🎙️ Hablar con Lupita (asistente de voz)'
    : /escuchando/i.test(t) ? '🎙️ Lupita te está escuchando…'
    : /hablando/i.test(t) ? '🗣️ Lupita está hablando…'
    : '🎙️ Hablar con Lupita (asistente de voz)';
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
  try { new Notification(titulo, { body: String(cuerpo).slice(0, 180), tag: 'lupita', icon: '/assets/lupita-mascota.svg', badge: '/assets/icon-192.png', silent: true }); } catch (e) {}
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
    /* Confirmación visual inmediata: la persona ve que Lupita entendió bien */
    setEstado('Entendí: «' + String(texto).slice(0, 60) + '»');
    pintarBurbuja('user', texto);
    track('voz_usuario', { palabras: texto.split(/\s+/).length });
    setEstado('Pensando…');
    var r = await pensar(texto);
    await hablar(r.decir);
    if (r.accion) await manejarAccion(r.accion);
    if (r.cierre) {
      turnosSinAccion = 0;
      propuestasConvertidas = 0;
      API.estado = 'fin';
      setEstado('Conversación terminada');
      cicloActivo = false;
      return;
    }
    if (turnosSinAccion >= ((CFG.conversacion && CFG.conversacion.maxTurnosSinAccion) || 8)) {
      await hablar('[[e:empatico]]Para atenderte mejor,[[p:300]] si quieres continuar, toca el botón de WhatsApp que aparece aquí abajo.[[/]]');
      abrirWhatsApp('continuar conversación desde el asistente de voz');
      API.estado = 'fin'; setEstado('Conversación terminada');
      cicloActivo = false;
      return;
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

var reintentosRuido = 0;
async function reintentar(mensaje) {
  pintarBurbuja('sys', mensaje);
  if (manosLibres) { await dormir(500); ciclo(); }
}

/* Mensajes anti-ruido: si falló la captura, Lupita da consejos concretos
   y ofrece cambiar de canal en vez de responder basura. */
function consejoRuido() {
  var tips = [
    'Hay ruido alrededor y no te escuché bien. [[e:empatico]]Acércate al micrófono[[/]][[p:200]] y repíteme, por favor.',
    'El ambiente está ruidoso. Habla un poco más fuerte y cerca del teléfono, o escríbelo aquí abajo en el chat.',
    'No logré captarte bien con tanto ruido. ¿Me lo repices? Si prefieres, te abro WhatsApp y seguimos por texto.'
  ];
  return tips[Math.min(reintentosRuido, tips.length - 1)];
}

async function manejarError(e) {
  var m = String(e && e.message || e);
  log('error', m);
  track('voz_error', { error: m.slice(0, 80) });
  var msg = 'No pudimos completar la conversación.';
  if (/stt_(not-allowed|service-not-allowed|permission)/.test(m)) msg = 'Sin permiso de micrófono no puedo escucharte. Actívalo en el candado de la barra de direcciones, o escríbenos por WhatsApp.';
  else if (/stt_ruido/.test(m)) {
    reintentosRuido++;
    msg = consejoRuido();
    if (reintentosRuido >= 3) {
      msg = 'Con tanto ruido me es difícil ayudarte por voz. [[e:alegre]]Te propongo continuar por WhatsApp[[/]][[p:300]] y te atiendo de inmediato.';
      abrirWhatsApp('conversación por voz interrumpida por ruido');
      reintentosRuido = 0;
    } else if (manosLibres) {
      setTimeout(function () { if (API.estado !== 'fin') ciclo(); }, 400);
    }
  }
  else if (/stt_(no-speech|sin_audio|audio-capture|vacio)/.test(m)) { reintentosRuido++; msg = consejoRuido(); if (manosLibres) setTimeout(function () { if (API.estado !== 'fin') ciclo(); }, 400); }
  else if (/stt_(network|language-not-supported)/.test(m)) msg = 'El reconocimiento de voz del navegador falló. Puedes escribirnos por WhatsApp.';
  else if (/sin_mic/.test(m)) msg = 'Este navegador no da acceso al micrófono. Usa Chrome o Safari, o escríbenos por WhatsApp.';
  /* Clave placeholder sin reemplazar (sitio recién desplegado): Lupita sigue viva,
     ofrece el modo texto y avisa al dueño cómo activar la IA real. */
  else if (/llm_503_sin_clave|sin_clave|clave_invalida/.test(m)){
    try { fetch('/api/health', { method:'GET' }).then(function(h){ return h.ok ? h.json() : null; }).then(function(j){ window.__lupitaHealth = j; }).catch(function(){}); } catch(e){}
    msg = 'Hola, soy Lupita.[[p:300]] Por ahora estoy en modo texto porque el dueño aún no conecta la llave de inteligencia artificial del taller.[[p:300]] Pueden escribirme por WhatsApp o usar el cotizador de la página, y quedo lista muy pronto. ¡Gracias!';
    setEstado('IA pendiente de activar · usa el cotizador o WhatsApp');
    track('voz_sin_clave', {});
    /* aviso técnico SOLO para el dueño (admin autenticado), nunca para clientes */
    try {
      var pinGuardado = W.localStorage && localStorage.getItem('tt_admin_pin');
      if (location.pathname.indexOf('admin') >= 0 && pinGuardado){
        pintarBurbuja('sys', '⚙️ GROQ_API_KEY sigue con el placeholder genérico: Vercel → Settings → Environment Variables → reemplaza el valor por tu clave gsk_... de console.groq.com/keys (Scope Production) y haz Redeploy. /api/health lo confirma.');
      }
    } catch(e){}
    abrirWhatsApp('asistente de voz sin IA conectada');
    return;
  }
  else if (/llm_(401|403|503)/.test(m)) msg = 'El asistente aún no tiene conectada la IA en este servidor. Mientras tanto, cotiza en el sitio o escríbenos por WhatsApp.';
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
  /* El prompt maestro ya no se descarga en el navegador: /api/chat lo lee de
     datos/prompt-agente.md en el servidor. Así una sola copia define a Lupita
     y no se duplican tokens en cada turno. */
  /* Saber si el servidor tiene TTS remoto evita un 503 por cada frase. */
  try {
    var hr = await fetch('/api/health', { cache: 'no-cache' });
    if (hr.ok) {
      var hj = await hr.json();
      if (hj && hj.tts && hj.tts.estado === 'respaldo_navegador') {
        CFG.tts = CFG.tts || {};
        CFG.tts.proxyOk = false;
      }
    }
  } catch (e) { log('health no disponible', e && e.message); }
  manosLibres = !(CFG.conversacion && CFG.conversacion.manosLibres === false);
  var mb = $('#vozManos'); if (mb) mb.setAttribute('aria-pressed', String(manosLibres));
}

async function saludar() {
  var saludo = (CFG.asistente && CFG.asistente.saludo) || '¡Hola! Soy Lupita, del taller TapaTech. ¿Qué le pasó a tu equipo?';
  historial = [{ role: 'assistant', content: saludo }];
  turnosSinAccion = 0; propuestasConvertidas = 0; autorizacionLeadEnTurno = false; leadGuardadoEnTurno = false;
  await hablar(saludo);
}

/* ── Saludo PREVIO desde la tarjeta de sorpresa (voz-sorp en index.html).
   Pide SOLO permiso de micrófono después del gesto explícito del visitante.
   No solicita notificaciones ni inicia seguimiento comercial. ── */
API.saludoPrevio = async function (texto) {
  abrir();
  setEstado('Lupita te está hablando…');
  try {
    if (!iniciado) { await cargarConfig(); enlazarControles(); iniciado = true; API.listo = true; }
    var t = texto || ((CFG.asistente && CFG.asistente.saludoSorpresa) ||
      '¡Hola! Bienvenido a TapaTech, la mejor opción para reparar tu celular en Tapachula. Dime, ¿en qué te puedo ayudar?');
    historial = [{ role: 'assistant', content: t }];
    pintarBurbuja('sys', 'Saludo de bienvenida 🐾 — cuando quieras, activa el micrófono para platicar conmigo.');
    track('voz_sorp_iniciar');
    await hablar(t);
    var micOk = false;
    try { await pedirMicrofono(); micOk = true; } catch (e) { log('mic no concedido', e && e.message); }
    setEstado(micOk ? 'Micrófono listo · toca el botón y cuéntame tu falla' : 'Toca el micrófono para hablar (permiso pendiente)');
    track('voz_sorp_mic', { concedido: micOk });
    return micOk;
  } catch (e) {
    log('fallo en saludo previo', e);
    setEstado('Toca el micrófono para hablar');
    return false;
  }
};

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
/* El saludo de la sorpresa ya cargó controles: solo abre/oculta la consola. */
if (iniciado) API.iniciar = function () { abrir(); };
API.cancelarVoz = cancelarVoz;
/* introspección para pruebas y depuración en consola */
API._debug = function () { return { cicloActivo: cicloActivo, reproduciendo: reproduciendo, pendienteEscucha: pendienteEscucha, detenerTodo: detenerTodo,
  manosLibres: manosLibres, velocidad: velUsuario, estado: API.estado, historial: historial.length, turnosSinAccion: turnosSinAccion }; };
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
  var ml = $('#vozManos');
  if (ml) ml.addEventListener('click', function () {
    manosLibres = !manosLibres; ml.setAttribute('aria-pressed', String(manosLibres));
    ml.textContent = manosLibres ? '🔁 Manos libres' : '👆 Un turno a la vez';
    if (manosLibres && !cicloActivo) ciclo();
  });
  var wa = $('#vozWa'); if (wa && !wa.getAttribute('href').match(/wa\.me/)) wa.href = 'https://wa.me/' + (negocio().whatsapp || '');
  var cot = $('#vozCot'); if (cot) cot.addEventListener('click', function () { cerrar(); var c = $('#cotizador'); if (c) c.scrollIntoView({ behavior: 'smooth' }); });
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
