/* ══════════════════════════════════════════════════════════════════════
   POST /api/push → consola de envío de notificaciones push (solo ADMIN_PIN)
   ──────────────────────────────────────────────────────────────────────
   Acciones (body JSON):
     { pin, accion:'estado' }
        → resumen: suscritos, elegibles hoy, VAPID listo/no.
     { pin, accion:'avisar', hash }
        → envía 1 push a UN visitante concreto (elige mensaje según su
          contexto y aplica los candados de frecuencia de Lupita).
     { pin, accion:'difundir', titulo?, cuerpo?, solo_elegibles? }
        → campaña manual a todos los suscritos elegibles (máx 50 por
          petición; máx 1 por visitante/periodo — Lupita nunca hace spam).
   GET  /api/push?pin=   → equivalente a accion:'estado'.

   Privacidad: el push SOLO llega a quien otorgó permiso de notificaciones
   y se suscribió voluntariamente vía el service worker. Frecuencia limitada
   por LUPITA_FREQ (dia | 3dias) y tope de 5 avisos push por visitante.
   ══════════════════════════════════════════════════════════════════════ */
const { json, pinOk, VISITAS_F, leerJsonl, escribirJsonl } = require('./_lib');
const { vapidListo, pushAvisarLupita } = require('./_push');

module.exports = async function handler(req, res){
  try {
    if (!pinOk(req)) return json(res, 401, { ok:false, error:'pin' });
    const b = Object.assign({}, req.query || {}, req.body || {});
    const accion = String(b.accion || (req.method === 'GET' ? 'estado' : 'estado'));
    const rows = leerJsonl(VISITAS_F());
    const now = Date.now();
    const MS_PERIOD = (process.env.LUPITA_FREQ || 'dia').toLowerCase() === '3dias' ? 3 * 864e5 : 864e5;

    const suscritos = rows.filter(r => r.push && r.push.endpoint);
    const elegibles = suscritos.filter(r => !r.convirtio && !r.push_sin_huella && (now - Number(r.ultimo_aviso || 0)) >= MS_PERIOD && (r.avisos_push || 0) < 5);

    if (accion === 'estado'){
      return json(res, 200, { ok:true, vapid: vapidListo(), suscritos: suscritos.length, elegibles_hoy: elegibles.length,
        freq: (process.env.LUPITA_FREQ || 'dia'), total_visitas: rows.length });
    }

    if (accion === 'avisar'){
      const h = String(b.hash || '').slice(0, 64);
      const v = rows.find(r => r.h === h);
      if (!v) return json(res, 404, { ok:false, error:'no_encontrado' });
      const r = await pushAvisarLupita(v, 'manual');
      escribirJsonl(VISITAS_F(), rows.length > 2000 ? rows.slice(-2000) : rows);
      return json(res, r.enviado ? 200 : 422, { ok: r.enviado, motivo: r.motivo || null, msg: r.msg || null });
    }

    if (accion === 'difundir'){
      /* título/cuerpo personalizados opcionales; si no, mensajes de Lupita */
      const lista = b.solo_elegibles === false ? suscritos : elegibles;
      const objetivos = lista.slice(0, 50);
      let enviados = 0, fallidos = [];
      for (const v of objetivos){
        const custom = (b.titulo || b.cuerpo)
          ? await (async () => { /* push directo con texto del admin respeta candados */
              try {
                const { pushEnviar } = require('./_push');
                await pushEnviar(v.push, b.titulo || 'TapaTech · Lupita', b.cuerpo || 'Pasa por el taller: diagnóstico gratis hoy.', b.url || '/');
                v.ultimo_aviso = now; v.avisos = (v.avisos||0)+1; v.avisos_push = (v.avisos_push||0)+1;
                return true;
              } catch(e){ if (e.expired) v.push = null; return false; }
            })()
          : (await pushAvisarLupita(v, 'campana')).enviado;
        if (custom) enviados++; else fallidos.push(v.h.slice(0, 8));
      }
      escribirJsonl(VISITAS_F(), rows.length > 2000 ? rows.slice(-2000) : rows);
      return json(res, 200, { ok:true, intentados: objetivos.length, enviados, fallidos: fallidos.slice(0, 20) });
    }

    return json(res, 400, { ok:false, error:'accion_desconocida' });
  } catch(e){ return json(res, e.status || 500, { ok:false, error:e.message }); }
};
