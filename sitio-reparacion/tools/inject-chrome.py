#!/usr/bin/env python3
"""
Injecta el mismo encabezado y pie de página en todas las páginas internas,
para que la navegación sea idéntica y funcional desde cualquier punto del sitio.

Uso:  python3 tools/inject-chrome.py            (desde la carpeta del sitio)
      python3 tools/inject-chrome.py --check    (solo verifica, no escribe)

Cómo funciona: reemplaza <header class="hdr">…</header> y <footer class="ftr">…</footer>
en cada página, calculando el prefijo relativo correcto según su profundidad.
Si una página no tiene header/footer, los inserta junto a <main> / </main>.
"""
import os, re, sys

PAGINAS = {
    '404.html': '/',
    'privacidad.html': './',
    'terminos.html': './',
    'blog/index.html': '../',
    'blog/cuanto-cuesta-cambiar-la-pantalla-de-un-celular-en-tapachula/index.html': '../../',
}
MARCA   = 'TapaTech'
CIUDAD  = 'Tapachula · Chiapas'
WA_NUM  = '529622889585'          # ⚙️ solo dígitos, con código de país
TEL     = '+529622889585'         # ⚙️ con lada
TEL_TXT = '962 288 9585'
DIRECCION = 'Quinceava Avenida Sur esq. 18a Calle Oriente, Col. Los Naranjos'
CP_CIUDAD = '16 de Septiembre, C.P. 30705, Tapachula de Córdova y Ordóñez, Chis.'

LOGO = ('<span class="logo-mark" style="color:#60A5FA" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none">'
        '<path d="M13.5 2 5 13.2h5.2L9.6 22 19 10.4h-5.6L13.5 2Z" fill="currentColor"/></svg></span>')

def header(P, activo=''):
    items = [('servicios','Servicios'),('cotizador','Cotizador'),('precios','Precios'),
             ('domicilio','A domicilio'),('proceso','Proceso'),('resenas','Reseñas'),
             ('faq','FAQ'),('ubicacion','Ubicación')]
    def uno(i, t):
        cls = ' class="is-active"' if activo == i else ''
        return '<a href="%s#%s"%s>%s</a>' % (P, i, cls, t)
    links = '\n      '.join(uno(i, t) for i, t in items)
    cls_blog = ' class="is-active"' if activo == 'blog' else ''
    return f'''<header class="hdr">
  <div class="wrap">
    <a class="logo" href="{P}" aria-label="{MARCA} — inicio">{LOGO}<span>{MARCA}<small>{CIUDAD}</small></span></a>
    <button class="burger" type="button" id="burger" aria-label="Abrir menú" aria-expanded="false" aria-controls="menu">
      <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>
    </button>
    <nav id="menu" aria-label="Navegación principal">
      {links}
      <a href="{P}blog/"{cls_blog}>Blog</a>
      <a class="btn btn--wa" href="https://wa.me/{WA_NUM}?text=%C2%A1Hola%20{MARCA}!%20Quiero%20cotizar%20una%20reparaci%C3%B3n." rel="noopener">WhatsApp</a>
      <a class="btn btn--acc" href="{P}#diagnostico">Agendar</a>
    </nav>
  </div>
</header>
<script>
(function(){{
  var b=document.getElementById('burger'), n=document.getElementById('menu');
  if(!b||!n) return;
  b.addEventListener('click',function(){{
    var o=n.classList.toggle('is-open');
    b.setAttribute('aria-expanded',o?'true':'false');
    b.setAttribute('aria-label',o?'Cerrar menú':'Abrir menú');
  }});
  n.addEventListener('click',function(e){{ if(e.target.tagName==='A'){{ n.classList.remove('is-open'); b.setAttribute('aria-expanded','false'); }} }});
  document.addEventListener('keydown',function(e){{ if(e.key==='Escape'&&n.classList.contains('is-open')){{ n.classList.remove('is-open'); b.setAttribute('aria-expanded','false'); }} }});
}})();
</script>'''

def footer(P):
    return f'''<footer class="ftr">
  <div class="wrap">
    <div class="cta-mini">
      <div><b style="color:#fff;font-size:1.05rem">¿Listo para repararlo?</b>
        <p style="margin:4px 0 0">Diagnóstico gratis, precio cerrado por escrito y garantía de 30 días.</p></div>
      <div class="cta-btns">
        <a class="btn btn--wa" href="https://wa.me/{WA_NUM}?text=%C2%A1Hola%20{MARCA}!%20Quiero%20reparar%20mi%20equipo." rel="noopener">WhatsApp</a>
        <a class="btn btn--ghost" style="border-color:#2A3E66;color:#EAF0FB" href="tel:{TEL}">Llamar</a>
        <a class="btn btn--ghost" style="border-color:#2A3E66;color:#EAF0FB" href="{P}#diagnostico">Agendar cita</a>
      </div>
    </div>
    <div class="ftr-grid">
      <div><b>{MARCA}</b>{DIRECCION}<br>{CP_CIUDAD}<br><a href="tel:{TEL}">{TEL_TXT}</a><br>
        <span style="font-size:.82rem">Lun a Sáb 9:00–19:00 corrido · Dom: urgencias por WhatsApp</span></div>
      <div><b>Servicios</b>
        <a href="{P}#servicios">Cambio de pantalla</a><a href="{P}#servicios">Batería y puerto de carga</a>
        <a href="{P}#servicios">Equipos mojados</a><a href="{P}#servicios">Laptops: SSD, RAM, formateo</a>
        <a href="{P}#servicios">Xbox / PS / Switch</a><a href="{P}#domicilio">Recolección a domicilio</a></div>
      <div><b>Información</b>
        <a href="{P}#cotizador">Cotizador</a><a href="{P}#precios">Lista de precios</a>
        <a href="{P}#garantia">Garantía</a><a href="{P}#proceso">Cómo trabajamos</a>
        <a href="{P}#mitos">Mitos de reparación</a><a href="{P}#faq">Preguntas frecuentes</a>
        <a href="{P}#ubicacion">Ubicación y horario</a></div>
      <div><b>Sitio</b>
        <a href="{P}blog/">Blog y guías</a><a href="{P}privacidad.html">Aviso de privacidad</a>
        <a href="{P}terminos.html">Términos y garantía</a><a href="{P}admin.html">Panel del taller</a>
        <a href="https://maps.app.goo.gl/RMnSieAbZH7mSWLS7" target="_blank" rel="noopener">Google Maps</a></div>
    </div>
    <p class="ftr-legal">© <span id="year">2026</span> {MARCA} {CIUDAD}. Todos los derechos reservados.
      Precios en pesos mexicanos (MXN), sujetos a diagnóstico gratuito.</p>
  </div>
  <script>document.getElementById('year').textContent=new Date().getFullYear();</script>
</footer>'''

EXTRA_CSS = '''
/* Navegación unificada (inyectada por tools/inject-chrome.py) */
.burger{display:none;margin-left:auto;width:40px;height:40px;border-radius:50%;border:1px solid var(--line);background:transparent;cursor:pointer;place-items:center;color:var(--txt)}
.burger:hover{border-color:var(--acc)}
.hdr nav a.is-active{background:var(--acc-soft);color:var(--acc-ink)}
@media(max-width:900px){
  .burger{display:grid}
  .hdr nav{position:absolute;top:62px;left:0;right:0;z-index:60;flex-direction:column;align-items:stretch;
    background:var(--paper);border-bottom:1px solid var(--line);padding:10px 18px 18px;gap:4px;
    box-shadow:0 18px 34px rgba(11,15,18,.14);transform:translateY(-140%);
    transition:transform .26s cubic-bezier(.2,.8,.2,1);max-height:calc(100dvh - 62px);overflow:auto}
  .hdr nav.is-open{transform:none}
  .hdr nav a{padding:13px 12px;font-size:.98rem;border-radius:10px;display:block}
    /* FIX botones del encabezado (web y móvil): texto BLANCO y tamaño completo. */
  .hdr nav a.btn,.hdr nav a.btn:hover{color:#FFFFFF!important}
  .hdr nav a.btn{display:inline-flex;justify-content:center;align-items:center;margin-top:8px;
    padding:12px 24px;font-size:1rem;font-weight:800;line-height:1.1;
    white-space:nowrap!important;flex:0 0 auto;width:auto;max-width:100%}
}
@media(min-width:901px){.burger{display:none!important}}
.ftr-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:26px;margin-top:26px}
.ftr-grid b{color:#fff;font-size:.74rem;letter-spacing:.14em;text-transform:uppercase;margin-bottom:10px}
.ftr-grid a{display:block;font-size:.88rem;margin-bottom:7px}
.ftr-grid div:first-child{font-size:.88rem;line-height:1.6}
.cta-mini{display:flex;gap:16px;align-items:center;justify-content:space-between;flex-wrap:wrap;
  background:linear-gradient(120deg,rgba(59,130,246,.14),rgba(255,255,255,.03));
  border:1px solid rgba(59,130,246,.30);border-radius:20px;padding:18px 22px}
.cta-btns{display:flex;gap:8px;flex-wrap:wrap}
.ftr-legal{margin-top:26px;padding-top:18px;border-top:1px solid #22304E;font-size:.78rem;color:#8190A8}
@media(max-width:640px){.cta-mini{flex-direction:column;align-items:stretch}}
'''

def inyectar(ruta, prefijo, check=False):
    s = open(ruta, encoding='utf-8').read()
    orig = s
    activo = 'blog' if '/blog' in ruta else ''
    H, F = header(prefijo, activo), footer(prefijo)
    # header
    if re.search(r'<header class="hdr">.*?</header>', s, re.S):
        s = re.sub(r'<header class="hdr">.*?</header>\s*(<script>.*?</script>)?', H, s, count=1, flags=re.S)
    elif '<main' in s:
        s = s.replace('<main', H + '\n<main', 1)
    # footer
    if re.search(r'<footer class="ftr">.*?</footer>', s, re.S):
        s = re.sub(r'<footer class="ftr">.*?</footer>', F, s, count=1, flags=re.S)
    elif '</main>' in s:
        s = s.replace('</main>', '</main>\n' + F, 1)
    else:
        s = s.replace('</body>', F + '\n</body>', 1)
    # CSS extra una sola vez
    if 'Navegación unificada' not in s:
        s = s.replace('</head>', '<style>' + EXTRA_CSS + '</style>\n</head>', 1)
    cambiado = s != orig
    if cambiado and not check:
        open(ruta, 'w', encoding='utf-8').write(s)
    return cambiado

if __name__ == '__main__':
    root = '.'   # ejecutar desde la carpeta del sitio
    check = '--check' in sys.argv
    for rel, pref in PAGINAS.items():
        ruta = os.path.join(root, rel)
        if not os.path.exists(ruta):
            print('  ⚠ no existe:', rel); continue
        c = inyectar(ruta, pref, check)
        print(('  ✓ actualizada ' if c else '  = sin cambios ') + rel + ('' if not check else (' [cambiaría]' if c else '')))
    print('Listo.' if not check else 'Revisión terminada.')
