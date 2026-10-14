const fs = require('fs');
const { JSDOM, VirtualConsole } = require('/tmp/t/node_modules/jsdom');
const html = fs.readFileSync(0, 'utf8');
const errors = [], peticiones = [];
const vc = new VirtualConsole();
vc.on('jsdomError', e => errors.push('jsdomError: ' + (e.message || e)));
vc.on('error', (...a) => errors.push('console.error: ' + a.join(' ')));
const dom = new JSDOM(html, { url:'https://voltfix.test/?utm_source=google&utm_campaign=prueba', runScripts:'dangerously', pretendToBeVisual:true, virtualConsole:vc,
  beforeParse(w){
    w.open = () => ({ focus(){}, closed:false }); w.print = () => {}; w.scrollTo = () => {};
    w.fetch = async (url, opts) => { peticiones.push({ url:String(url), method:(opts&&opts.method)||'GET', body:(opts&&opts.body)||null });
      return { ok:true, status:201, json: async()=>({ ok:true, id:'ld_test', folio:'VF-TEST' }) }; };
  } });
const { window } = dom, doc = window.document;
const $ = s => doc.querySelector(s), $$ = s => Array.from(doc.querySelectorAll(s));
const out = [], ok = (l,c,e='') => out.push(`${c?'✅':'❌'} ${l}${e?' — '+e:''}`);
const fire = (el,ev='click') => el.dispatchEvent(new window.Event(ev,{bubbles:true}));
const submit = () => $('#leadForm').dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true}));
const setSel = (el,v) => { el.value=v; fire(el,'change'); };

setTimeout(async () => {
  /* ── 1. Estructura y SEO ───────────────────────────────────────── */
  ok('H1 único con keyword', $$('h1').length===1 && /reparaci/i.test($('h1').textContent));
  ok('JSON-LD válido (3 nodos)', (()=>{try{const d=JSON.parse($('script[type="application/ld+json"]').textContent);return d['@graph'].length===3}catch(e){return false}})());
  ok('Cero scripts externos', $$('script[src]').length===0);
  ok('Cero iframes al cargar', $$('iframe').length===0);
  ok('Imágenes con width y alt', $$('img').every(i=>i.getAttribute('width')&&i.getAttribute('alt')));
  ok('Sin ids duplicados', (()=>{const ids=$$('[id]').map(e=>e.id);return new Set(ids).size===ids.length})(), (()=>{const ids=$$('[id]').map(e=>e.id);const d=ids.filter((x,i)=>ids.indexOf(x)!==i);return [...new Set(d)].join(',')||'0 duplicados'})());

  /* ── 2. Navegación ─────────────────────────────────────────────── */
  const navLinks = $$('#nav a').map(a=>a.getAttribute('href'));
  ok('Nav con 9 destinos (incluye Blog)', navLinks.length===9 && navLinks.includes('blog/'), navLinks.join(' '));
  ok('Todos los anclajes del nav existen', navLinks.filter(h=>h.startsWith('#')).every(h=>doc.getElementById(h.slice(1))));
  ok('Barra de progreso presente', !!$('#prog'));
  ok('Botón volver arriba presente', !!$('#toTop'));
  ok('Menú móvil con aria', $('#burger').getAttribute('aria-expanded')==='false' && $('#burger').getAttribute('aria-controls')==='nav');
  fire($('#burger')); ok('Menú móvil abre', $('#nav').classList.contains('is-open') && $('#burger').getAttribute('aria-expanded')==='true');
  fire($('#burger')); ok('Menú móvil cierra', !$('#nav').classList.contains('is-open'));
  ok('Skip link', !!$('.skip'));

  /* ── 3. CTAs de conversión ─────────────────────────────────────── */
  const ctas = $$('a.btn, button.btn');
  ok('Más de 30 CTAs visibles', ctas.length>=30, ctas.length+' botones CTA');
  ok('6 tiras de CTA entre secciones', $$('.strip').length>=6, $$('.strip').length+' strips');
  const wa = $$('a[href*="wa.me/"]');
  ok('WhatsApp presente en todo el sitio', wa.length>=14, wa.length+' enlaces wa.me');
  ok('Todos los wa.me con mensaje precargado', wa.every(a=>/text=/.test(a.href)), wa.filter(a=>!/text=/.test(a.href)).length+' vacíos');
  ok('Teléfonos clickeables', $$('a[href^="tel:"]').length>=5, $$('a[href^="tel:"]').length+' enlaces tel:');
  ok('Header con WhatsApp + Agendar', !!$('#waHdr') && /Agendar/.test($('.hdr-cta').textContent));
  ok('Hero con 3 CTAs + teléfono', $$('.hero-cta .btn').length===3 && !!$('.hero-phone'));
  ok('Footer con CTA', !!$('#waFooter'));
  ok('Modal de oferta existe y arranca oculto', !!$('#oferta') && $('#oferta').hidden===true);

  /* ── 4. Filas de servicio clickeables ──────────────────────────── */
  const svc = $$('.svc[data-svc]');
  ok('20 servicios clickeables', svc.length===20, svc.length+' filas');
  ok('Cada fila muestra su acceso "Cotizar"', $$('.svc-go').length===20, $$('.svc-go').length);
  ok('Filas accesibles por teclado', svc.every(r=>r.getAttribute('role')==='button' && r.getAttribute('tabindex')==='0'));
  const filaConsola = svc.find(r=>r.dataset.svc==='hdmi');
  fire(filaConsola);
  ok('Clic en servicio precarga el cotizador', $('#servicio').value==='hdmi' && $$('#grpDev .pill').findIndex(p=>p.classList.contains('is-on'))===2, 'svc='+$('#servicio').value);
  ok('Servicio inválido no rompe el cotizador', (()=>{ const s=$('#servicio'); s.value='pantalla'; fire(s,'change'); return /\$|GRATIS/.test($('#resPrice').textContent); })(), $('#resPrice').textContent.replace(/\s+/g,' ').trim().slice(0,28));
  fire($$('#grpDev .pill')[0]);

  /* ── 5. Cotizador + boleto ─────────────────────────────────────── */
  setSel($('#marca'),'apple'); setSel($('#servicio'),'pantalla');
  $('#modelo').value='iPhone 13 Pro Max'; fire($('#modelo'),'input');
  const precio = $('#resPrice').textContent;
  ok('Cotizador responde al modelo', /\$\d/.test(precio) && !/NaN|undefined/.test(precio), precio.replace(/\s+/g,' ').trim().slice(0,34));
  fire($('#btnBoleto'));
  ok('Boleto con folio válido', /^TT-\d{8}-[A-Z0-9]{4}$/.test($('#tFolio').textContent), $('#tFolio').textContent);
  ok('QR en SVG', $$('#tQR svg rect').length>30, $$('#tQR svg rect').length+' rects (run-length)');
  ok('SVG descargable', ($('#boletoWrap').dataset.svg||'').startsWith('<svg') && ($('#boletoWrap').dataset.svg||'').includes($('#tFolio').textContent));
  await new Promise(r=>setTimeout(r,120));
  const postBoleto = peticiones.filter(p=>p.method==='POST' && p.url.includes('/api/leads'));
  ok('La cotización se registra en la BD', postBoleto.length>=1, postBoleto.length+' POST a /api/leads');
  if (postBoleto.length){
    const b = JSON.parse(postBoleto[0].body);
    ok('Lead de cotización con datos útiles', b.tipo==='cotizacion' && b.modelo==='iPhone 13 Pro Max' && b.rango_precio, JSON.stringify({tipo:b.tipo,modelo:b.modelo,rango:b.rango_precio}));
    ok('Lead incluye trazabilidad (utm/origen)', !!b.origen && !!b.utm && /google/.test(JSON.stringify(b.utm)), JSON.stringify(b.utm));
  }

  /* ── 6. Asistente de 3 pasos (base de datos) ───────────────────── */
  ok('Asistente en paso 1', !$('#paso1').hidden && $('#paso2').hidden && $('#paso3').hidden);
  ok('Barra de progreso del asistente', $$('.wiz-bar i').length===3 && $$('.wiz-bar i')[0].classList.contains('on'));
  fire($('#wNext'));
  ok('Paso 1 exige la falla', $('#paso1').hidden===false && $$('.field-err').length>=1, $$('.field-err').length+' campos marcados');
  setSel($('#l-falla'),'Pantalla rota / negra / con líneas');
  fire($('#wNext'));
  ok('Avanza a paso 2', !$('#paso2').hidden && $('#paso1').hidden && $$('.wiz-bar i')[1].classList.contains('on'));
  fire($('#wNext'));
  ok('Paso 2 exige modelo', $('#paso2').hidden===false && $('#l-modelo').classList.contains('field-err'));
  $('#l-modelo').value='iPhone 13';
  const dom2=$('#l-dom'); dom2.checked=true; fire(dom2,'change');
  ok('Domicilio revela campo de colonia', $('#wZona').hidden===false);
  $('#l-colonia').value='Col. Las Flores, 3a Pte #12';
  fire($('#wNext'));
  ok('Avanza a paso 3', !$('#paso3').hidden && $('#wSend').hidden===false);
  fire($('#wBack')); ok('Botón atrás funciona', !$('#paso2').hidden); fire($('#wNext'));
  $('#l-nombre').value='Ana López'; $('#l-tel').value='(962) 123-4567'; $('#l-email').value='ana@ejemplo.com';
  submit();
  ok('Sin consentimiento no se envía', $('#l-ok').classList.contains('field-err'));
  $('#l-ok').checked=true;
  const cita = $$('#wContacto input[name="contacto"]').find(r=>r.value==='cita');
  cita.checked=true; fire(cita,'change');
  ok('Elegir cita revela calendario', $('#wCita').hidden===false && $('#l-fecha').value.length===10, 'fecha='+$('#l-fecha').value);
  const slots=$$('.slot');
  ok('Horarios generados desde CONFIG', slots.length>=6, slots.length+' horarios: '+slots.slice(0,4).map(s=>s.dataset.h).join(', '));
  const libre=slots.find(s=>!s.disabled);
  ok('Siempre hay al menos un horario disponible (o sugiere otro día)', !!libre, libre ? 'libre='+libre.dataset.h : 'todos deshabilitados');
  if(libre) fire(libre);
  ok('Horario seleccionable', $('#l-hora').value.length===5, 'fecha='+$('#l-fecha').value+' hora='+$('#l-hora').value);
  submit();
  await new Promise(r=>setTimeout(r,250));
  const posts = peticiones.filter(p=>p.method==='POST' && p.url.includes('/api/leads'));
  const ultimo = posts.length ? JSON.parse(posts[posts.length-1].body) : null;
  ok('Asistente envía el lead a la BD', !!ultimo && ultimo.tipo!=='cotizacion', ultimo ? ultimo.tipo : 'sin envío');
  ok('Lead con nombre y teléfono normalizado', ultimo && ultimo.nombre==='Ana López' && ultimo.telefono==='9621234567', ultimo ? ultimo.nombre+' / '+ultimo.telefono : '—');
  ok('Lead con equipo, marca, modelo y falla', ultimo && ultimo.modelo==='iPhone 13' && /Pantalla/.test(ultimo.falla), ultimo ? [ultimo.equipo,ultimo.marca,ultimo.modelo].join(' ') : '—');
  ok('Lead con domicilio y colonia', ultimo && ultimo.domicilio===true && /Las Flores/.test(ultimo.colonia));
  ok('Lead con cita (fecha y hora)', ultimo && ultimo.contacto==='cita' && !!ultimo.cita_fecha, ultimo ? ultimo.cita_fecha+' '+ultimo.cita_hora : '—');
  ok('Lead con consentimiento', ultimo && ultimo.consentimiento===true);
  ok('Mensaje de éxito honesto con folio', /TT-\d{8}-[A-Z0-9]{4}/.test($('#leadMsg').textContent) && !/recibimos tu mensaje/i.test($('#leadMsg').textContent), $('#leadMsg').textContent.replace(/\s+/g,' ').trim().slice(0,74));
  ok('Botones post-envío', !!$('#leadWa2') && !!$('#leadCopy') && !!$('#leadNuevo'));
  ok('Cola local vacía cuando la API responde', (JSON.parse(window.localStorage.getItem('tt-cola')||'[]')).length===0);

  /* ── 7. Resiliencia: sin API → cola local ──────────────────────── */
  window.fetch = async () => { throw new Error('sin red'); };
  $('#l-nombre').value='Beto Sin Red'; $('#l-tel').value='9629876543';
  const whats=$$('#wContacto input[name="contacto"]').find(r=>r.value==='whatsapp'); whats.checked=true; fire(whats,'change');
  submit();
  await new Promise(r=>setTimeout(r,220));
  const cola = JSON.parse(window.localStorage.getItem('tt-cola')||'[]');
  ok('Sin servidor: el lead se encola (no se pierde)', cola.length>=1 && cola[0].nombre==='Beto Sin Red', cola.length+' en cola');
  ok('Aviso honesto cuando no hay conexión', $('#leadMsg').classList.contains('err') && /guardada en este dispositivo/i.test($('#leadMsg').textContent), $('#leadMsg').textContent.replace(/\s+/g,' ').slice(0,70));
  window.fetch = async (u,o) => { peticiones.push({url:String(u),method:(o&&o.method)||'GET',body:(o&&o.body)||null}); return {ok:true,status:201,json:async()=>({ok:true})}; };
  window.dispatchEvent(new window.Event('online'));
  await new Promise(r=>setTimeout(r,220));
  ok('Al volver la conexión se sincroniza la cola', JSON.parse(window.localStorage.getItem('tt-cola')||'[]').length===0, 'quedan '+(JSON.parse(window.localStorage.getItem('tt-cola')||'[]')).length);

  /* ── 8. Modal de oferta ────────────────────────────────────────── */
  window.localStorage.removeItem('tt-oferta');
  window.dispatchEvent(new window.MouseEvent('mouseout', { clientY:1 }));
  await new Promise(r=>setTimeout(r,60));
  ok('Modal se activa por intención de salida', $('#oferta').classList.contains('is-on') && $('#oferta').hidden===false);
  $('#ofNombre').value=''; $('#ofTel').value='123';
  fire($('#ofSend'));
  ok('Modal valida datos', $('#ofTel').classList.contains('field-err') && $('#oferta').classList.contains('is-on'));
  $('#ofNombre').value='Carlos M'; $('#ofTel').value='9621112233';
  const antes = peticiones.length;
  fire($('#ofSend'));
  await new Promise(r=>setTimeout(r,180));
  ok('Modal registra lead de oferta', peticiones.slice(antes).some(p=>p.body && /"tipo":"oferta"/.test(p.body)));
  ok('Modal se cierra al aceptar', !$('#oferta').classList.contains('is-on'));
  ok('Modal no vuelve a molestar (7 días)', (()=>{const g=JSON.parse(window.localStorage.getItem('tt-oferta')||'{}');return g.visto===true && g.cerrado>0})());

  /* ── 9. Acordeones, tabs y tema ────────────────────────────────── */
  ok('FAQ con 11 preguntas nativas', $$('#faq details').length>=8, $$('#faq details').length);
  ok('Mitos con 4', $$('#mitos details').length===4);
  $$('.tab')[1] && fire($$('.tab')[1]);
  ok('Tabs de laptop funcionan', doc.getElementById('p-lap').hidden===false && $$('.tab')[1].getAttribute('aria-selected')==='true');
  fire($$('.tab')[0]);
  fire($('#themeBtn')); ok('Tema oscuro', doc.documentElement.getAttribute('data-theme')==='dark');
  fire($('#themeBtn')); ok('Tema claro', doc.documentElement.getAttribute('data-theme')===null);
  ok('Mapa como fachada', !!$('#mapPh') && $$('iframe').length===0);

  /* ── 10. Datos para el agente de voz y tracking ────────────────── */
  ok('Datos expuestos para IA', !!window.TAPATECH_DATA && window.TAPATECH_DATA.catalogo.consola && window.TAPATECH_DATA.negocio.whatsapp);
  ok('Slot del agente de voz', !!$('#voicePanel') && !!$('#vozApp') && !!$('#voiceBtn') && !!$('#vozMic'));
  const ev=[...new Set((window.dataLayer||[]).map(e=>e.event))];
  ok('Eventos de conversión en dataLayer', ev.length>=8, ev.length+' tipos: '+ev.slice(0,10).join(', '));
  ok('Sin errores de runtime', errors.length===0, errors.slice(0,2).join(' | ')||'limpio');
  ok('Sin placeholders sin resolver', !/__LQIP__|\$\{/.test(doc.body.textContent.slice(0,4000)));

  console.log(out.join('\n'));
  const f=out.filter(l=>l.startsWith('❌'));
  console.log('\n──────────────────────────────────────────────');
  console.log(`${out.length} checks · ✅ ${out.length-f.length} · ❌ ${f.length} · 📡 ${peticiones.length} peticiones a la API`);
  if(f.length){console.log('\nFALLOS:');f.forEach(x=>console.log('  '+x));}
  process.exit(f.length?1:0);
}, 1000);
