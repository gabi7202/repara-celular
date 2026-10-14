/* ══════════════════════════════════════════════════════════════════════
   POST /api/visitas → registro de visitantes para Lupita (remarketing)
   ──────────────────────────────────────────────────────────────────────
   Acciones:
     { accion:'visita', hash, datos }        → registra/humaniza la visita.
                                               Devuelve {ok, notificar:true} si
                                               el visitante volvió sin convertir
                                               y NO se le ha avisado hoy.
     { accion:'avisado', hash }              → marca que ya recibió su aviso
                                               (1 por día; con LUPITA_FREQ=3dias,
                                               1 cada 3 días).
     { accion:'clic_notif', id }             → contó el retorno desde la notificación.
     { accion:'suscribir'|'unsubscribe', endpoint } → push VAPID (opcional, futuro).
   GET  /api/visitas?pin=ADMIN_PIN           → lista de visitas/anónimos (admin).

   Privacidad: no guardamos el IP en claro — solo un hash SHA-256(IP+UA+sal)
   que sirve como "huella" para asociar al visitante consigo mismo.
   Frecuencia: LUPITA_FREQ = 'dia' (default, máx 1 aviso/día) o '3dias'.
   ══════════════════════════════════════════════════════════════════════ */
const crypto = require('crypto');
const { json, pinOk, ip, huella, VISITAS_F, LEADS_F, leerJsonl, escribirJsonl } = require('./_lib');

const SAL = process.env.LUPITA_SAL || 'tapatech-lupita-v1';
const FREQ = (process.env.LUPITA_FREQ || 'dia').toLowerCase(); // 'dia' | '3dias'
const MS_PERIOD = FREQ === '3dias' ? 3 * 864e5 : 864e5;

module.exports = async function handler(req, res){
  try {
    if (req.method === 'GET'){
      if (!pinOk(req)) return json(res, 401, { ok:false, error:'pin' });
      const rows = leerJsonl(VISITAS_F());
      res.setHeader('Cache-Control','no-store');
      return res.status(200).json({ ok:true, total:rows.length, visitas:rows.slice(-400).reverse() });
    }
    if (req.method !== 'POST'){ res.setHeader('Allow','POST, GET'); return json(res, 405, { ok:false }); }

    const b = req.body || {};
    const accion = String(b.accion || 'visita');
    const rows = leerJsonl(VISITAS_F());
    const now = Date.now();
    const h = String(b.hash || '') === '' ? huella(ip(req), req.headers['user-agent']) : String(b.hash).slice(0,64);

    /* suscripciones push (preparado para VAPID cuando lo actives) */
    if (accion === 'suscribir' || accion === 'unsubscribe'){
      let v = rows.find(r => r.h === h) || (rows.push({ h, created_at:new Date().toISOString() }) && rows[rows.length-1]);
      v.push = accion === 'suscribir' ? { endpoint: String(b.endpoint||'').slice(0,400), keys: b.keys || null } : null;
      v.actualizado = new Date().toISOString();
      escribirJsonl(VISITAS_F(), rows);
      return json(res, 201, { ok:true });
    }

    if (accion === 'avisado'){
      const v = rows.find(r => r.h === h);
      if (v){ v.ultimo_aviso = now; v.avisos = (v.avisos||0)+1; v.contexto_aviso = String(b.contexto||'').slice(0,200); }
      escribirJsonl(VISITAS_F(), rows);
      return json(res, 201, { ok:true });
    }

    if (accion === 'clic_notif'){
      const v = rows.find(r => r.h === h);
      if (v){ v.retornos = (v.retornos||0)+1; v.ultimo_retorno = new Date().toISOString(); }
      escribirJsonl(VISITAS_F(), rows);
      return json(res, 201, { ok:true });
    }

    /* ── 'visita': registrar y decidir si toca un aviso discreto ── */
    let v = rows.find(r => r.h === h);
    const esNueva = !v;
    if (esNueva){ v = { h, vistas: 0, created_at: new Date().toISOString() }; rows.push(v); }
    v.vistas = (v.vistas||0) + 1;
    v.ultima = new Date().toISOString();
    if (b.datos && typeof b.datos === 'object'){
      v.ctx = { pagina:String(b.datos.pagina||'').slice(0,120), equipo:String(b.datos.equipo||'').slice(0,60),
                falla:String(b.datos.falla||'').slice(0,90), origen:String(b.datos.origen||'').slice(0,60) };
    }

    /* ¿convirtió? si dejó lead/cotización (misma huella), NO se le molesta */
    let convirtio = false;
    try {
      const leads = leerJsonl(LEADS_F());
      convirtio = leads.some(l => l.ip_hash === h);
    } catch(e){}
    if (convirtio) v.convirtio = true;

    /* elegibilidad: segunda visita (se fue sin convertir) + pasó el periodo sin avisar */
    const sinAvisoReciente = !v.ultimo_aviso || (now - v.ultimo_aviso) >= MS_PERIOD;
    const notificar = !convirtio && !esNueva && v.vistas >= 2 && sinAvisoReciente && (v.avisos||0) < 5;

    /* saneo: solo últimas 2000 huellas */
    const recortadas = rows.length > 2000 ? rows.slice(-2000) : rows;
    escribirJsonl(VISITAS_F(), recortadas);
    return json(res, 201, { ok:true, nueva: esNueva, notificar, freq: FREQ });
  } catch(e){ return json(res, e.status || 500, { ok:false, error:e.message }); }
};
