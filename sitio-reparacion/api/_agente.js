/* Herramientas del lado del servidor para Lupita (se fusionan con las del cliente).
   ── POR QUÉ EXISTE ESTE ARCHIVO ─────────────────────────────────────────────
   1) `cotizar` vivía solo en el navegador (window.TAPATECH_DATA.cotizar). Si el
      usuario llegaba por la "tarjeta sorpresa", o el script del cotizador aún no
      estaba listo, la herramienta devolvía {error:'cotizador_no_disponible'} →
      Groq veía un error y Lupita respondía cualquier cosa. Ahora el servidor
      SIEMPRE puede cotizar: catálogo embebido + mismo ajuste por modelo.

   2) El LLM a veces NO devuelve el JSON estricto que pide el prompt maestro
      (texto suelto, comillas chinas, bloques ```json). parseSalida() resuelve
      todos esos casos y garantiza `{decir, accion}` — sin esto el subtítulo y
      el TTS se quedaban vacíos ("no tiene IA" aparente). */

const PRECIOS = {
  celular: {
    pantalla: { apple:{incell:[1100,1700],premium:[2000,4600]}, samsung:{incell:[700,1500],premium:[1600,5200]}, xiaomi:{incell:[500,900],premium:[1100,2200]}, motorola:{incell:[500,900],premium:[1100,2200]}, honor:{incell:[500,900],premium:[1100,2200]}, huawei:{incell:[500,900],premium:[1100,2200]}, otra:{incell:[500,900],premium:[1100,2800]} },
    bateria:  { apple:[800,1100], samsung:[450,950], xiaomi:[400,800], motorola:[400,800], honor:[400,800], huawei:[400,800], otra:[400,900] },
    puerto:   { apple:[450,900], samsung:[400,800], xiaomi:[350,700], motorola:[350,700], honor:[350,700], huawei:[350,700], otra:[350,800] },
    camara:   { apple:[450,950], samsung:[400,900], xiaomi:[350,800], motorola:[350,800], honor:[350,800], huawei:[350,800], otra:[350,850] },
    mojado:   [500,1500], software:[350,800], placa:[800,2200], tapa:[1000,1800], diag:[0,0]
  },
  laptop: {
    formateo:[450,1100], ssd:[900,3200], ram:[600,1800], limpieza:[400,800],
    pantalla:[1200,3500], teclado:[700,1800], datos:[800,2500], placa:[1000,3000]
  },
  consola: { hdmi:[800,1800], enciende:[700,2000], lector:[600,1500], joystick:[450,950], termica:[400,800], pantalla:[1200,2800], diag:[0,0] }
};
const TIEMPOS = {
  pantalla:'40-60 min', bateria:'30-50 min', puerto:'40-70 min', camara:'40-80 min',
  mojado:'24-48 h', software:'1-3 h', placa:'24-72 h', tapa:'40-60 min', diag:'15-30 min',
  formateo:'2-4 h', ssd:'1-2 h', ram:'30-60 min', limpieza:'1-2 h', pantallaL:'1-2 dias',
  teclado:'1-2 h', datos:'24-72 h', placaL:'24-72 h', hdmi:'24-48 h', enciende:'24-72 h',
  lector:'24-48 h', joystick:'24-48 h', termica:'24-48 h', pantallaC:'2-5 dias'
};
const GARANTIA_MOJADO = 15, GARANTIA_SSD = 90;

function redondear(n){ return Math.round(n / 10) * 10; }
function ajustar(rango, modeloTexto){
  const m = String(modeloTexto || '').toLowerCase();
  if (!rango) return [0, 0];
  if (!m) return [rango[0], rango[1]];
  const top  = /(pro max|ultra|plus|fold|flip|elite|oled|macbook pro|series x|s2[3-9]|iphone 1[4-9]|note 2|zenbook|xps|legion|omen|rog|switch oled)/;
  const eco  = /(iphone 7|iphone 8|iphone se|galaxy j|galaxy a0|galaxy a1|moto e|redmi 9|redmi 10|3ds|lite\b|one s|vita|a05|a14|e22)/;
  const f = top.test(m) ? 1.18 : eco.test(m) ? 0.85 : 1;
  return [redondear(rango[0] * f), redondear(Math.max(rango[1] * f, rango[0] * f + 50))];
}

/** Implementación de servidor de la herramienta `cotizar` (misma semántica que el cotizador del sitio). */
function cotizarServer(a){
  let dev = String(a.equipo || 'celular').toLowerCase();
  if (dev === 'phone' || dev === 'movil') dev = 'celular';
  if (dev === 'playstation' || dev === 'xbox' || dev === 'nintendo') dev = 'consola';
  let marca = String(a.marca || 'otra').toLowerCase();
  if (marca.includes('iphone')) marca = 'apple';
  if (!/^(apple|samsung|xiaomi|motorola|honor|huawei|hp|lenovo|dell|asus|otra)$/.test(marca)) marca = 'otra';
  const tabla = PRECIOS[dev];
  if (!tabla) return { error:'dispositivo_desconocido', validos:['celular','laptop','consola'] };
  let svc = String(a.servicio || '');
  if (dev === 'laptop' && svc === 'pantalla') svc = 'pantallaL';
  if (dev === 'consola' && svc === 'pantalla') svc = 'pantallaC';
  if (dev === 'consola' && svc === 'diag') svc = 'diag';
  const fila = tabla[svc];
  if (!fila) return { error:'servicio_desconocido', validos:Object.keys(tabla) };
  if (svc === 'tapa' && marca !== 'apple') return { error:'servicio_no_aplica', nota:'las tapas traseras solo aplican para iPhone; para Android ofrece pantalla, batería u otro servicio' };
  const gratis = svc === 'diag';
  const calidadTabla = (marca === 'apple' || marca === 'samsung') ? 'premium' : 'incell';
  let base;
  if (Array.isArray(fila)) base = fila;
  else if (Array.isArray(fila.otra || fila[Object.keys(fila)[0]])) base = fila[marca] || fila.otra;
  else base = fila[marca] || fila.otra;
  /* servicios de doble calidad (pantalla de celular) */
  if (base && base.incell){
    const q = (a.calidad === 'incell' || a.calidad === 'premium') ? a.calidad : calidadTabla;
    const r = ajustar(base[q] || base.incell, a.modelo);
    return { servicio: svc, equipo: dev, calidad: q, moneda:'MXN', aproximado:true,
      rango:{ min:r[0], max:r[1] }, tiempo: TIEMPOS[svc] || '24-48 h', garantia:30,
      nota_pronunciacion:'Di solo el mínimo como "aproximadamente desde X pesos, depende de tu modelo exacto" y agrega "siempre te damos la mejor calidad y el mejor precio". Nunca lo presenten como precio final.' };
  }
  const r = ajustar(base, a.modelo);
  if (gratis) return { servicio: svc, equipo: dev, gratis:true, rango:[0,0], tiempo: TIEMPOS[svc] || '15-30 min', garantia:0,
    nota_pronunciacion:'El diagnóstico es gratis y sin compromiso; se descuenta si autoriza la reparación.' };
  const g = svc === 'ssd' ? GARANTIA_SSD : (svc === 'mojado' ? GARANTIA_MOJADO : 30);
  return { servicio: svc, equipo: dev, calidad: (marca === 'apple' || marca === 'samsung') ? 'premium' : 'economica',
    moneda:'MXN', aproximado:true, rango:{ min:r[0], max:r[1] }, tiempo: TIEMPOS[svc] || '24-48 h', garantia:g,
    nota_pronunciacion:'Di solo el mínimo como "aproximadamente desde X pesos, depende de tu modelo exacto" + "siempre te damos la mejor calidad y el mejor precio". El precio cerrado sale del diagnóstico gratis.' };
}

/** ¿El texto `extra` es una copia del prompt maestro?
 *  El cliente antiguo enviaba el prompt completo en `sistema`; el servidor lo
 *  añadía OTRA VEZ al maestro. Con gpt-oss-20b (8 000 TPM) eso hacía que UNA
 *  sola petición superara el límite y Groq devolviera 429 en cada turno.
 *  Detectamos la copia para no duplicar ni gastar tokens. */
function esCopiaDelMaestro(extra, maestro){
  const norm = s => String(s || '').replace(/\s+/g, ' ').trim();
  const e = norm(extra), m = norm(maestro);
  if (!e || !m) return false;
  if (e === m) return true;
  /* marcas inequívocas del prompt de Lupita */
  if (/Eres\s+\*{0,2}Lupita/i.test(e) && /Formato exacto de tu salida/i.test(e)) return true;
  /* mismo arranque y una extensión considerable: es el mismo documento */
  if (e.length > 2000 && (e.includes(m.slice(0, 300)) || m.includes(e.slice(0, 300)))) return true;
  return false;
}

/** Compone el mensaje de sistema SIN duplicar el prompt maestro.
 *  Orden pensado para el caché de Groq: primero lo estático (maestro), al final
 *  lo variable (contexto en vivo). Los tokens cacheados no consumen TPM. */
function componerSistema(maestro, extra, contexto){
  const m = String(maestro || '').trim();
  let e = String(extra || '').trim().slice(0, 4000);
  const ctx = String(contexto || '').trim().slice(0, 8000);
  if (e && esCopiaDelMaestro(e, m)) e = '';
  return [m, e, ctx].filter(Boolean).join('\n\n');
}

/** Normaliza la salida del modelo a {decir, accion}. Tolera texto plano, ```json, comillas raras. */
function parseSalida(content){
  let t = String(content == null ? '' : content).trim();
  if (!t) return { decir:'', accion:null };
  t = t.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/,'').trim();
  /* intentos de JSON: completo, desde la primera llave, o el último objeto grande */
  const candidatos = [t];
  const i = t.indexOf('{'); if (i > 0) candidatos.push(t.slice(i));
  const j = t.lastIndexOf('}'); if (j > 0 && j < t.length - 1) candidatos.push(t.slice(t.indexOf('{'), j + 1));
  for (const c of candidatos){
    try {
      const o = JSON.parse(c.replace(/[“”]/g,'"').replace(/[‘’]/g,"'"));
      if (o && typeof o.decir === 'string') return { decir:o.decir, accion:(o.accion && typeof o.accion === 'object') ? o.accion : null };
      if (o && typeof o.texto === 'string') return { decir:o.texto, accion:null };
    } catch(e){}
  }
  /* No era JSON: ¿empezó a escribir el objeto y se cortó? rescatamos "decir":"..." */
  const m = t.match(/"decir"\s*:\s*"([\s\S]*)/);
  if (m){
    let s = m[1].replace(/["\s]*}$/,'');
    return { decir:s, accion:null };
  }
  /* Texto plano: limpiamos restos de claves JSON y dejamos la frase hablada */
  const limpio = t.replace(/^\{?\s*"?decir"?\s*:\s*"?/i,'').replace(/"?\s*,?\s*"?accion"?\s*:?.*$/i,'').trim();
  return { decir: limpio || t, accion:null };
}

module.exports = { cotizarServer, parseSalida, componerSistema, esCopiaDelMaestro, PRECIOS };
