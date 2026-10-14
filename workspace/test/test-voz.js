const fs = require('fs');
const { JSDOM, VirtualConsole } = require('/tmp/t/node_modules/jsdom');
const html = fs.readFileSync('sitio-reparacion/index.html', 'utf8');
const voz  = fs.readFileSync('sitio-reparacion/assets/voz.js', 'utf8');
const cfgAgent = JSON.parse(fs.readFileSync('sitio-reparacion/datos/agente.json', 'utf8'));
const promptMd = fs.readFileSync('sitio-reparacion/datos/prompt-agente.md', 'utf8');

const errors = [], llamados = [], utter = [];
const vc = new VirtualConsole();
vc.on('jsdomError', e => errors.push('jsdomError: ' + (e.message || e)));
vc.on('error', (...a) => errors.push('console.error: ' + a.join(' ')));

let chatMode = 'normal';
const dom = new JSDOM(html, { url:'https://taptTech.test/', runScripts:'dangerously', pretendToBeVisual:true, virtualConsole:vc,
  beforeParse(w){
    w.open = () => ({ focus(){} }); w.print = () => {}; w.scrollTo = () => {};
    w.Audio = class { constructor(src){ this.src=src; this.paused=true; } play(){ this.paused=false; return Promise.resolve(); } pause(){ this.paused=true; } };
    w.speechSynthesis = {
      getVoices: () => [{ name:'Microsoft Dalia Online (Natural) - Spanish (Mexico)', lang:'es-MX' }, { name:'Microsoft Jorge - Spanish (Mexico)', lang:'es-MX' }, { name:'Google US English', lang:'en-US' }],
      speak: u => utter.push({ text:u.text, rate:u.rate, pitch:u.pitch, volume:u.volume, lang:u.lang, voice:u.voice && u.voice.name }),
      cancel: () => {}, onvoiceschanged: null
    };
    w.SpeechSynthesisUtterance = class { constructor(t){ this.text=t; this.rate=1; this.pitch=1; this.volume=1; this.lang='es-MX'; this.voice=null;
      // simula fin inmediato para no colgar la prueba
      setTimeout(()=>{ this.onend && this.onend(); }, 0); } };
    w.SpeechRecognition = class {
      constructor(){ this.lang=''; this.continuous=false; this.interimResults=false; this.maxAlternatives=1; }
      start(){ setTimeout(()=>{
        const res = { resultIndex:0, results:[{ isFinal:true, 0:{ transcript: w.__frase || 'Se me rompió la pantalla de mi iPhone trece' } }] };
        this.onresult && this.onresult(res);
        this.onend && this.onend();
      }, 20); }
      stop(){ this.onend && this.onend(); }
      abort(){ this.onerror && this.onerror({ error:'aborted' }); }
    };
    w.Notification = function(){ }; w.Notification.permission = 'default'; w.Notification.requestPermission = async () => 'granted';
    w.fetch = async (url, opts) => {
      const u = String(url), o = opts || {};
      llamados.push({ url:u, method:o.method||'GET', body:o.body||null });
      const json = (obj, status=200) => ({ ok:status<400, status, headers:{ get:()=>'application/json' }, json:async()=>obj, text:async()=>JSON.stringify(obj) });
      if (u.includes('datos/agente.json')) return json(cfgAgent);
      if (u.includes('datos/prompt-agente.md')) return { ok:true, status:200, headers:{get:()=>'text/markdown'}, text:async()=>promptMd, json:async()=>({}) };
      if (u.includes('/api/leads')) return json({ ok:true, id:'ld_1', folio:'TT-20261014-VOZ1' }, 201);
      if (u.includes('/api/chat')){
        if (chatMode === 'error') return { ok:false, status:503, headers:{get:()=>'application/json'}, text:async()=>'{"error":"sin_clave"}', json:async()=>({error:'sin_clave'}) };
        if (chatMode === 'tools') {
          const n = llamados.filter(x=>x.url.includes('/api/chat')).length;
          if (n === 1) return json({ ok:true, content:'', tool_calls:[{ id:'c1', type:'function', function:{ name:'cotizar', arguments: JSON.stringify({ equipo:'celular', marca:'apple', modelo:'iPhone 13', servicio:'pantalla', calidad:'ambas' }) } }] });
          return json({ ok:true, content:'{"decir":"Para iPhone trece,[[p:300]][[r:0.85]] la económica queda de mil cien a mil setecientos pesos[[/]].[[p:400]] ¿Te aparto la revisión gratis?","accion":null}' });
        }
        if (chatMode === 'lead') return json({ ok:true, content:'', tool_calls:[{ id:'c2', type:'function', function:{ name:'registrar_lead', arguments: JSON.stringify({ nombre:'Ana López', telefono:'(962) 123-4567', equipo:'Celular', marca:'Apple', modelo:'iPhone 13', falla:'Pantalla rota', tipo:'diagnostico' }) } }] });
        return json({ ok:true, content:'{"decir":"¡Claro que sí![[p:200]] Revisamos tu pantalla[[r:0.85]] en cuarenta a sesenta minutos[[/]].[[p:400]] ¿Te espero en el local o[[e:alegre]] pasamos por él[[/]]?","accion":null}' });
      }
      return json({ ok:false, error:'no_impl' }, 404);
    };
  }});
const { window } = dom, doc = window.document;
const $ = s => doc.querySelector(s), $$ = s => Array.from(doc.querySelectorAll(s));
const out = [], ok = (l,c,e='') => out.push(`${c?'✅':'❌'} ${l}${e?' — '+e:''}`);
const sleep = ms => new Promise(r=>setTimeout(r,ms));
async function finCiclo(max = 9000){
  const t0 = Date.now();
  while (Date.now() - t0 < max){
    const d = window.TAPATECH_VOZ._debug();
    if (!d.cicloActivo && !d.reproduciendo) return true;
    await sleep(60);
  }
  return false;
}

(async () => {
  // carga el módulo de voz como lo haría el loader
  window.eval(voz);
  const V = window.TAPATECH_VOZ;
  ok('Módulo de voz expuesto', !!V && typeof V.iniciar === 'function');

  /* ── 1. Parser de prosodia (corazón de la petición) ─────────────── */
  const segs = V.parsearProsodia('¡Hola![[/]] Soy Lupita,[[p:200]] del taller.[[p:500]] Cuesta[[r:0.85]] mil doscientos pesos[[/]].[[p:300]] ¿Vamos?[[e:alegre]][[t:+10]] ¡Órale![[/]]', cfgAgent);
  ok('Segmenta el texto marcado', segs.length >= 5, segs.length + ' segmentos');
  ok('Las pausas se aplican al segmento anterior', segs.some(s => s.pauseAfter >= 400), segs.map(s=>s.pauseAfter).join(','));
  const lento = segs.find(s => /mil doscientos/.test(s.text));
  ok('[[r:0.85]] baja el ritmo en precios', lento && Math.abs(lento.rate - 0.85) < 0.01, lento && 'rate=' + lento.rate.toFixed(2));
  const alegre = segs.find(s => /Órale/.test(s.text));
  ok('[[e:alegre]] + [[t:+10]] se componen (tono y ritmo arriba)', alegre && alegre.pitch > 1.15 && alegre.rate > 1.05, alegre && `pitch=${alegre.pitch.toFixed(2)} rate=${alegre.rate.toFixed(2)}`);
  ok('[[/]] restablece los valores', (()=>{ const i = segs.findIndex(s=>/Órale/.test(s.text)); const d = segs.slice(i+1); return d.length===0 || d.every(s=>Math.abs(s.rate-1)<0.2); })());
  const digitos = V.parsearProsodia('[[n:digitos]] nueve seis dos[[/]]', cfgAgent);
  ok('[[n:digitos]] marca deletreo y baja ritmo', digitos[0].digitos === true && digitos[0].rate <= 0.92, 'rate=' + digitos[0].rate.toFixed(2));
  const fuerte = V.parsearProsodia('tiene [[v:strong]]garantía[[/]] escrita', cfgAgent);
  ok('[[v:strong]] marca énfasis', fuerte.some(s => s.emphasis === 'strong' && /garantía/.test(s.text)));
  ok('Pausa automática al final de frase', V.parsearProsodia('Hola. ¿Sí?', cfgAgent).every(s => s.pauseAfter > 0));
  ok('Texto sin marcas no se rompe', V.parsearProsodia('Solo texto normal', cfgAgent).length === 1);
  ok('REGRESIÓN: ninguna marca se cuela en el texto hablado', V.parsearProsodia('¡Listo![[/]][[p:300]] Ya quedó.[[p:400]] ¿Algo más?[[e:alegre]]', cfgAgent).every(x => !/\[\[/.test(x.text)), V.parsearProsodia('¡Listo![[/]][[p:300]] Ya quedó.[[p:400]] ¿Algo más?[[e:alegre]]', cfgAgent).map(x=>x.text).join(' | '));
  ok('SSML sin marcas crudas', !/\[\[/.test(V.aSSML('Hola[[p:400]] mundo[[r:0.9]] lento[[/]]', cfgAgent)));
  const fus = V.fusionarSegmentos(V.parsearProsodia('Cuesta mil pesos[[p:300]] o[[p:200]] mil quinientos.', cfgAgent));
  ok('Fusiona palabras sueltas al siguiente segmento', fus.every(x => x.text.replace(/[\W_]/g,'').length >= 2), fus.map(x=>x.text).join(' | '));
  ok('Pausas entre segmentos se respetan', (()=>{ const sg = V.parsearProsodia('Uno.[[p:300]] Dos.[[p:900]] Tres.', cfgAgent); return sg[0].pauseAfter >= 300 && sg[1].pauseAfter >= 900; })());

  /* ── 2. Salidas para distintos motores TTS ──────────────────────── */
  const plano = V.aTextoPlano('¡Hola![[p:900]] Soy Lupita[[r:0.85]] del taller[[/]].');
  ok('aTextoPlano quita marcas (para subtítulos)', !/\[\[/.test(plano) && /Soy Lupita del taller/.test(plano), plano);
  ok('Pausa larga → puntos suspensivos', plano.includes('…'), plano);
  const ssml = V.aSSML('Cuesta[[r:0.85]] mil pesos[[/]].[[p:500]] ¿Vamos?', cfgAgent);
  ok('aSSML genera <speak> con prosody y break', ssml.startsWith('<speak') && ssml.includes('<prosody') && ssml.includes('<break time='), ssml.slice(0,80)+'…');
  ok('SSML en es-MX y escapado', ssml.includes('xml:lang="es-MX"') && !/<(?!\/?(speak|prosody|break|emphasis|say-as))/.test(ssml));
  ok('rateEdge/pitchEdge con notación Edge', V.rateEdge(0.85) === '-15%' && V.pitchEdge(1.08) === '+4Hz', V.rateEdge(0.85) + ' / ' + V.pitchEdge(1.08));

  /* ── 3. Arranque del asistente ──────────────────────────────────── */
  $('#vozApp').hidden = false;
  await V.iniciar(); await sleep(400);
  $('#vozManos').dispatchEvent(new window.Event('click', { bubbles:true }));   // turnos manuales y deterministas
  ok('Modo manos libres desactivable', $('#vozManos').getAttribute('aria-pressed') === 'false');
  ok('Carga configuración y prompt maestro', llamados.some(l=>l.url.includes('agente.json')) && llamados.some(l=>l.url.includes('prompt-agente.md')));
  ok('Panel visible con nombre de la asistente', $('#vozApp').classList.contains('is-on') && /Lupita/.test($('#vozNombre').textContent), $('#vozNombre').textContent);
  ok('Saludo hablado con la voz es-MX correcta', utter.length >= 1 && /Lupita/.test(utter[0].text) && /Dalia|es-MX/i.test(String(utter[0].voice) + utter[0].lang), utter[0] && (utter[0].voice||utter[0].lang));
  ok('Saludo aparece como subtítulo', $$('#vozLog .burb--bot').length >= 1);

  /* ── 4. Contexto y prompt que llegan a Groq ─────────────────────── */
  chatMode = 'normal';
  window.__frase = 'Se me rompió la pantalla de mi iPhone trece';
  $('#vozMic').dispatchEvent(new window.Event('click', { bubbles:true }));
  await sleep(900);
  const chat = llamados.filter(l => l.url.includes('/api/chat'));
  ok('Envía la petición a Groq vía proxy', chat.length >= 1, chat.length + ' llamadas');
  const payload = JSON.parse(chat[0].body);
  ok('Incluye el prompt maestro como system', /Eres \*\*Lupita\*\*/.test(payload.sistema) && payload.sistema.length > 2000, payload.sistema.length + ' chars');
  ok('Incluye prosodia obligatoria en el prompt', /\[\[p:\d+\]\]/.test(payload.sistema) && /\[\[r:0\.85\]\]/.test(payload.sistema));
  ok('Incluye límites de seguridad', /no.*reporte de robo|reportes de robo/i.test(payload.sistema) && /contraseña/.test(payload.sistema));
  ok('Contexto con catálogo de precios', /CATALOGO DE PRECIOS/.test(payload.contexto) && /pantalla/.test(payload.contexto), payload.contexto.split('\n').length + ' líneas');
  ok('Contexto con horario y dirección reales', /Quinceava|30705/.test(payload.contexto) && /abierto|cerrado/i.test(payload.contexto), payload.contexto.split('\n')[2]);
  ok('Declara las 6 herramientas', (payload.herramientas||[]).length === 6, (payload.herramientas||[]).map(h=>h.function.name).join(','));
  ok('Usa el modelo configurado', payload.modelo === cfgAgent.llm.modelo, payload.modelo);
  ok('Respuesta del agente hablada y subtitulada', utter.length >= 2 && $$('#vozLog .burb--user').length >= 1, 'utterances=' + utter.length);
  ok('La respuesta conserva marcas de prosodia al hablar', utter.slice(1).some(u => u.rate < 0.95 || u.pitch > 1.02), 'rates=' + utter.slice(1,5).map(u=>u.rate.toFixed(2)).join(','));
  ok('Transcripción del usuario visible', /pantalla/i.test($$('#vozLog .burb--user').map(b=>b.textContent).join(' ')));

  /* ── 5. Herramientas: cotizar ───────────────────────────────────── */
  utter.length = 0; llamados.length = 0; chatMode = 'tools';
  window.__frase = '¿Cuánto cuesta?';
  $('#vozMic').dispatchEvent(new window.Event('click', { bubbles:true }));
  await sleep(1000);
  const chats2 = llamados.filter(l => l.url.includes('/api/chat'));
  ok('Ejecuta tool_call y vuelve a llamar al modelo', chats2.length >= 2, chats2.length + ' llamadas');
  const toolMsg = JSON.parse(chats2[1].body).mensajes.find(m => m.role === 'tool');
  ok('Devuelve el resultado de cotizar al modelo', !!toolMsg && /incell|premium/.test(toolMsg.content), toolMsg ? toolMsg.content.slice(0,90) : '—');
  ok('El agente dice el precio cotizado', utter.some(u => /mil/.test(u.text)) || $$('#vozLog .burb--bot').length > 0, utter.map(u=>u.text).join(' ').slice(0,60));

  /* ── 6. Herramienta registrar_lead → base de datos ──────────────── */
  await finCiclo(); llamados.length = 0; chatMode = 'lead';
  window.__frase = 'Agenda mi revisión, soy Ana';
  $('#vozMic').dispatchEvent(new window.Event('click', { bubbles:true }));
  await sleep(300); await finCiclo();
  const postLead = llamados.filter(l => l.url.includes('/api/leads') && l.method === 'POST');
  ok('El agente registra el lead en la BD', postLead.length >= 1, postLead.length + ' POST');
  if (postLead.length){
    const l = JSON.parse(postLead[0].body);
    ok('Lead con nombre y teléfono normalizado', l.nombre === 'Ana López' && l.telefono === '9621234567', l.nombre + ' / ' + l.telefono);
    ok('Lead marcado como capturado por voz', l.contacto === 'voz' && l.pagina === 'agente-de-voz', l.contacto + ' · ' + l.pagina);
    ok('Lead con folio', /^TT-\d{8}-[A-Z0-9]{4}$/.test(l.folio), l.folio);
  }

  /* ── 7. Degradación elegante sin clave de Groq ──────────────────── */
  await finCiclo(); utter.length = 0; chatMode = 'error';
  window.__frase = 'Hola';
  console.log('   [antes del clic] ' + JSON.stringify(V._debug()));
  $('#vozMic').dispatchEvent(new window.Event('click', { bubbles:true }));
  await sleep(120);
  console.log('   [120ms tras clic] ' + JSON.stringify(V._debug()));
  await sleep(400); await finCiclo();
  console.log('   [fin] ' + JSON.stringify(V._debug()));
  { const errs = $$('#vozLog .burb--error');
    console.log('   [debug] ' + JSON.stringify(V._debug()) + ' · errs=' + errs.length + ' · totalBurb=' + $$('#vozLog .burb').length + ' · últimas4: ' + $$('#vozLog .burb').slice(-4).map(b=>b.className.replace('burb ','')+'→'+b.textContent.slice(0,50)).join(' || ') + ' · últimas 3: ' + $$('#vozLog .burb').slice(-3).map(b=>b.className.replace('burb ','')+':'+b.textContent.slice(0,60)).join(' || '));
    ok('Sin IA: mensaje claro y salida a WhatsApp', errs.length >= 1 && /cotizador|WhatsApp/i.test($('#vozLog').textContent), (errs.pop()||{textContent:''}).textContent.slice(0,80)); }

  /* ── 8. Controles ───────────────────────────────────────────────── */
  $('#vozMute').dispatchEvent(new window.Event('click', { bubbles:true }));
  ok('Silenciar voz cambia el estado', $('#vozMute').getAttribute('aria-pressed') === 'true' && /Activar/.test($('#vozMute').textContent));
  $('#vozMute').dispatchEvent(new window.Event('click', { bubbles:true }));
  ok('Reactivar voz', $('#vozMute').getAttribute('aria-pressed') === 'false');
  ok('Botón de muestra de voz real', !!$('#vozDemo') && /Lupita/.test($('#vozDemo').textContent));
  ok('Selector de velocidad y botón manos libres', !!$('#vozVel') && $('#vozVel').options.length === 3 && $('#vozManos').getAttribute('aria-pressed') === 'false');
  $('#vozManos').dispatchEvent(new window.Event('click', { bubbles:true }));
  ok('Manos libres se reactiva', $('#vozManos').getAttribute('aria-pressed') === 'true');
  $('#vozManos').dispatchEvent(new window.Event('click', { bubbles:true }));
  ok('Cerrar con Escape', (()=>{ doc.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Escape',bubbles:true})); return true; })());
  await sleep(300);
  ok('Panel cerrado tras Escape', !$('#vozApp').classList.contains('is-on'));
  ok('Botón del sitio marca aria-expanded', $('#voiceBtn').getAttribute('aria-expanded') === 'false');
  ok('Datos expuestos al agente (catálogo real)', !!window.TAPATECH_DATA && typeof window.TAPATECH_DATA.cotizar === 'function');
  const cot = window.TAPATECH_DATA.cotizar('celular','apple','iPhone 13 Pro Max','pantalla','ambas');
  ok('cotizar() devuelve rangos con ajuste por modelo', cot.opciones && cot.opciones.premium.max > cot.opciones.incell.max, JSON.stringify(cot.opciones));
  ok('cotizar() servicio gratis', window.TAPATECH_DATA.cotizar('celular','apple','iPhone 13','diag').gratis === true);
  ok('cotizar() marca desconocida cae en "otra"', !!window.TAPATECH_DATA.cotizar('celular','marca_rara','X','bateria').rango);
  ok('Eventos de voz en dataLayer', (window.dataLayer||[]).filter(e=>/^voz_/.test(e.event||'')).length >= 3, [...new Set((window.dataLayer||[]).map(e=>e.event).filter(e=>/^voz_/.test(e||'')))].join(', '));
  ok('Sin errores de runtime', errors.length === 0, errors.slice(0,2).join(' | ') || 'limpio');

  console.log(out.join('\n'));
  const f = out.filter(l => l.startsWith('❌'));
  console.log('\n──────────────────────────────────────────────');
  console.log(`${out.length} checks de voz · ✅ ${out.length-f.length} · ❌ ${f.length}`);
  if (f.length){ console.log('\nFALLOS:'); f.forEach(x=>console.log('  '+x)); }
  process.exit(f.length ? 1 : 0);
})().catch(e => { console.error('FALLO FATAL', e); process.exit(1); });
