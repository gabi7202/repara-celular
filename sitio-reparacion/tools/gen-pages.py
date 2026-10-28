#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Genera las 7 páginas de conversión/SEO del sitio TapaTech Tapachula.
Una intención = una URL. Las variantes de keyword van en la MISMA página.
Uso: python3 tools/gen-pages.py   (desde la raíz del proyecto)
Idempotente: regenera los archivos desde cero.
"""
import json, os, textwrap

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITE = "https://reparaciondecelulares.vercel.app"
WA = "529622889585"
AUTHOR = "Rafael Ortiz"
BIZ_ID = SITE + "/#negocio"

def wa_link(texto):
    from urllib.parse import quote
    return f"https://wa.me/{WA}?text=" + quote("¡Hola TapaTech! " + texto)

def ld(*objs):
    graph = {"@context": "https://schema.org", "@graph": list(objs)}
    return json.dumps(graph, ensure_ascii=False, indent=2)

def breadcrumb(name, url):
    return {
        "@type": "BreadcrumbList",
        "itemListElement": [
            {"@type": "ListItem", "position": 1, "name": "Inicio", "item": SITE + "/"},
            {"@type": "ListItem", "position": 2, "name": name, "item": url},
        ],
    }

def service_node(sid, name, desc, extra=None):
    n = {
        "@type": "Service",
        "@id": sid,
        "name": name,
        "serviceType": "Reparación de celulares",
        "description": desc,
        "provider": {"@id": BIZ_ID},
        "areaServed": [
            {"@type": "City", "name": "Tapachula"},
            {"@type": "AdministrativeArea", "name": "Costa de Chiapas"},
        ],
    }
    if extra:
        n.update(extra)
    return n

def faq_node(faq_id, items):
    return {
        "@type": "FAQPage",
        "@id": faq_id,
        "mainEntity": [
            {"@type": "Question", "name": q, "acceptedAnswer": {"@type": "Answer", "text": a}}
            for q, a in items
        ],
    }

NAV = """      <a href="/servicio#servicios">Servicios</a>
      <a href="/servicio#cotizador">Cotizador</a>
      <a href="/servicio#precios">Precios</a>
      <a href="/blog/">Blog</a>
      <a href="../../nosotros.html">Nosotros</a>
      <a class="btn btn--wa" href="{wa_nav}" rel="noopener">WhatsApp</a>
      <a class="btn btn--acc" href="/servicio#diagnostico">Agendar</a>"""

STYLE = """<style>
.cta :not(.btn),.cta :not(.btn) a{color:#fff!important}
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
  .hdr nav a.btn,.hdr nav a.btn:hover{color:#FFFFFF!important}
  .hdr nav a.btn{display:inline-flex;justify-content:center;align-items:center;margin-top:8px;
    padding:12px 24px;font-size:1rem;font-weight:800;line-height:1.1;
    white-space:nowrap!important;flex:0 0 auto;width:auto;max-width:100%}
}
@media(min-width:901px){.burger{display:none!important}}
</style>"""

BURGER_JS = """<script>
(function(){
  var b=document.getElementById('burger'), n=document.getElementById('menu');
  if(!b||!n) return;
  b.addEventListener('click',function(){
    var o=n.classList.toggle('is-open');
    b.setAttribute('aria-expanded',o?'true':'false');
    b.setAttribute('aria-label',o?'Cerrar menú':'Abrir menú');
  });
  n.addEventListener('click',function(e){ if(e.target.tagName==='A'){ n.classList.remove('is-open'); b.setAttribute('aria-expanded','false'); } });
  document.addEventListener('keydown',function(e){ if(e.key==='Escape'&&n.classList.contains('is-open')){ n.classList.remove('is-open'); b.setAttribute('aria-expanded','false'); } });
})();
</script>"""

WA_FLOAT = ('<a class="wa-float" href="' + wa_link("Tengo una duda sobre una reparación.") +
            '" aria-label="Escribir por WhatsApp" rel="noopener"><svg viewBox="0 0 24 24" aria-hidden="true">'
            '<path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5.1-1.3A10 10 0 1 0 12 2Zm5.4 14.1c-.2.6-1.2 1.2-1.7 1.2-.4.1-1 .1-1.6-.1-.4-.1-.9-.3-1.5-.6-2.6-1.1-4.3-3.8-4.4-4-.1-.2-1-1.4-1-2.7s.7-1.9.9-2.2c.2-.2.5-.3.7-.3h.5c.2 0 .4 0 .6.5l.9 2.1c.1.2.1.4 0 .6l-.4.6-.5.5c-.1.2-.3.3-.1.6.2.3.8 1.3 1.7 2.1 1.2 1.1 2.2 1.4 2.5 1.5.3.1.5.1.7-.1l1-1.2c.2-.3.4-.2.7-.1l2 .9c.3.2.5.3.6.4 0 .2 0 .8-.2 1.4Z"/></svg></a>')

def page(slug, title, desc, kw, og_title, url, schema_json, crumbs_last, body_html, wa_cta_text):
    html = f"""<!DOCTYPE html>
<html lang="es-MX">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title}</title>
<meta name="description" content="{desc}">
<meta name="keywords" content="{kw}">
<link rel="canonical" href="{url}">
<meta name="robots" content="index,follow,max-image-preview:large">
<meta name="author" content="{AUTHOR} — TapaTech Tapachula">
<meta property="og:type" content="website">
<meta property="og:site_name" content="TapaTech Tapachula">
<meta property="og:locale" content="es_MX">
<meta property="og:url" content="{url}">
<meta property="og:title" content="{og_title}">
<meta property="og:description" content="{desc}">
<meta property="og:image" content="{SITE}/assets/og-cover.jpg">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="../../favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="../../assets/apple-touch-icon.png">
<link rel="stylesheet" href="../../assets/doc-v2.css">
<script type="application/ld+json">
{schema_json}
</script>
{STYLE}
</head>
<body>
<a class="skip" href="#main">Saltar al contenido</a>

<header class="hdr">
  <div class="wrap">
    <a class="logo" href="../../" aria-label="TapaTech — inicio"><span class="logo-mark" style="color:#FA8072" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="M13.5 2 5 13.2h5.2L9.6 22 19 10.4h-5.6L13.5 2Z" fill="currentColor"/></svg></span><span>TapaTech<small>Tapachula · Chiapas</small></span></a>
    <button class="burger" type="button" id="burger" aria-label="Abrir menú" aria-expanded="false" aria-controls="menu">
      <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>
    </button>
    <nav id="menu" aria-label="Navegación principal">
{NAV.format(wa_nav=wa_link("Quiero cotizar una reparación."))}
    </nav>
  </div>
</header>
{BURGER_JS}<main id="main" class="wrap narrow">
  <nav class="crumbs" aria-label="Miga de pan"><a href="../../">Inicio</a><span>›</span>{crumbs_last}</nav>

{body_html}
</main>

{WA_FLOAT}
</body>
</html>
"""
    # páginas en RAÍZ: el borrador usa rutas de blog (../../assets, ../slug/).
    # Reescritura sistemática a rutas de página raíz:
    import re as _re
    html = _re.sub(r'(?:src|href)="\.\./\.\./assets/', 'src="/assets/', html) if False else html
    html = html.replace('href="../../assets/', 'href="/assets/').replace('src="../../assets/', 'src="/assets/')
    html = html.replace('href="../../favicon.svg"', 'href="/favicon.svg"')
    html = html.replace('href="../../nosotros.html"', 'href="/nosotros.html"')
    html = html.replace('href="../../"', 'href="/"')
    # enlaces a posts del blog: ../../blog/slug/ o ../blog/slug/ -> /blog/slug/
    html = _re.sub(r'(?:src|href)="(?:\.\./)+(blog/)', lambda m: ('href="/' if 'href=' in m.group(0) or True else '') + m.group(1), html)
    # enlaces entre páginas nuevas que quedaron relativos ../slug/ -> /slug/
    html = _re.sub(r'href="\.\./([a-z0-9-]+)/"', lambda m: 'href="/%s/"' % m.group(1), html)
    # alternate x-default apuntando a la home (misma lengua/mercado)
    html = html.replace('<link rel="canonical" href="%s">' % url,
        '<link rel="canonical" href="{0}">\n<link rel="alternate" hreflang="es-mx" href="{0}">\n<link rel="alternate" hreflang="x-default" href="{1}/">'.format(url, SITE))
    path = os.path.join(ROOT, slug, "index.html")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(html)
    print("OK →", os.path.relpath(path, ROOT))
    return url

RELATED = """    <nav class="related" aria-label="Artículos relacionados">
      <h2>Sigue leyendo</h2>
      <ul class="rel-grid">
        <li><a href="/blog/cuanto-cuesta-cambiar-la-pantalla-de-un-celular-en-tapachula/" data-cat="Precios" rel="nofollow"><b>¿Cuánto cuesta cambiar la pantalla en Tapachula?</b><span>Tablas por marca y calidad de pieza (Incell vs OLED).</span></a></li>
        <li><a href="/blog/celular-no-enciende-causas-y-soluciones/" data-cat="Diagnóstico" rel="nofollow"><b>Mi celular no enciende: las 8 causas reales</b><span>Pruebas caseras de 5 minutos antes de pagar.</span></a></li>
        <li><a href="/blog/no-carga-puerto-o-bateria/" data-cat="Energía" rel="nofollow"><b>No carga: ¿puerto, cable, batería o placa?</b><span>Cómo distinguir la falla antes de cotizar.</span></a></li>
      </ul>
    </nav>"""

# =====================================================================
# 1. /reparacion-celulares-tapachula — MÁXIMA (transaccional local)
# =====================================================================
u1 = SITE + "/reparacion-celulares-tapachula/"
sch1 = ld(
    service_node(BIZ_ID.replace("#negocio", "#servicio-celulares"),
                 "Reparación de celulares en Tapachula",
                 "Taller de reparación de celulares en Tapachula: cambio de pantalla, batería, puerto de carga, equipos mojados, software y microsoldadura. Diagnóstico gratis, entrega en 40–60 min y garantía escrita de 30 días.",
                 {"url": u1,
                  "hasOfferCatalog": {"@type": "OfferCatalog", "name": "Servicios de reparación de celulares", "itemListElement": [
                      {"@type": "Offer", "itemOffered": {"@type": "Service", "name": "Cambio de pantalla de celular"}},
                      {"@type": "Offer", "itemOffered": {"@type": "Service", "name": "Cambio de batería de celular"}},
                      {"@type": "Offer", "itemOffered": {"@type": "Service", "name": "Reparación de puerto de carga"}},
                      {"@type": "Offer", "itemOffered": {"@type": "Service", "name": "Reparación de equipos mojados (lavado ultrasónico)"}},
                      {"@type": "Offer", "itemOffered": {"@type": "Service", "name": "Microsoldadura y reparación de placa"}},
                      {"@type": "Offer", "itemOffered": {"@type": "Service", "name": "Recolección y entrega a domicilio en Tapachula"}}
                  ]}}),
    breadcrumb("Reparación de celulares en Tapachula", u1),
    faq_node(u1 + "#faq", [
        ("¿Dónde están para reparar mi celular en Tapachula?", "Estamos en Quinceava Avenida Sur esq. 18a Calle Oriente, Col. Los Naranjos, CP 30705, Tapachula. Abrimos de lunes a sábado de 9:00 a 19:00. Si buscas 'reparación de celulares cerca de mí', también recolectamos tu equipo a domicilio dentro de Tapachula."),
        ("¿Cuánto tarda una reparación de celular?", "La mayoría de cambios de pantalla y batería se entregan en 40–60 minutos, frente a ti. Fallas de placa o equipos mojados pueden tardar de 24 a 48 horas; siempre te avisamos el tiempo exacto antes de dejar el equipo."),
        ("¿Hacen diagnóstico gratuito?", "Sí. Revisamos tu equipo contigo presente y te damos causa y precio por escrito antes de tocar nada. El diagnóstico no tiene costo y no estás obligado a reparar."),
        ("¿Qué marcas reparan?", "Reparamos todas las marcas de celulares: iPhone, Samsung, Xiaomi, Motorola, Realme, OPPO, vivo, Huawei, ZTE y más, incluyendo pantallas curvas y modelos recientes."),
        ("¿Dan garantía?", "30 días por escrito sobre la pieza y la mano de obra de la reparación realizada. Si el mismo punto falla dentro del plazo, reabrimos sin cargo."),
    ]),
)
body1 = """  <article>
    <header class="hero-doc">
      <span class="eyebrow">Taller local · Tapachula, Chiapas</span>
      <h1>Reparación de celulares en Tapachula: diagnóstico gratis y entrega en 40 minutos</h1>
      <p class="lead" style="margin-top:14px">Buscas <b>reparación de celulares cerca de mí</b> y quieres un taller de verdad: con técnico visible, precio por escrito antes de reparar y garantía real. En TapaTech llevamos 15 años reparando teléfonos en Tapachula — pantalla, batería, puerto de carga, daños por agua y microsoldadura de placa — en nuestro local de Los Naranjos y con recolección a domicilio.</p>
      <div class="meta">
        <span>Por <b>Rafael Ortiz (&quot;Cubatel&quot;)</b> · Técnico principal</span>
        <span>·</span>
        <span>Actualizado <b>28 oct 2026</b></span>
        <span>·</span>
        <span>Lectura <b>5 min</b></span>
      </div>
    </header>

    <figure>
      <img src="../../assets/taller.webp" width="1200" height="800" loading="eager" decoding="async" alt="Técnico de TapaTech reparando un celular en el taller de reparación de celulares en Tapachula, Chiapas">
      <figcaption>Reparación frente al cliente: así trabajamos — puedes ver cada paso del proceso desde tu lugar.</figcaption>
    </figure>

    <h2 id="servicios">Qué reparamos (y qué no te vamos a inventar)</h2>
    <table>
      <caption>Servicios de reparación de celulares en TapaTech Tapachula</caption>
      <thead><tr><th scope="col">Servicio</th><th scope="col">Señal típica</th><th scope="col">Tiempo estimado</th></tr></thead>
      <tbody>
        <tr><td><b>Cambio de pantalla</b></td><td>Cristal estrellado, manchas, sin táctil o sin imagen</td><td>40–60 min</td></tr>
        <tr><td><b>Cambio de batería</b></td><td>Dura poco, se apaga al 20%, está inflada</td><td>30–45 min</td></tr>
        <tr><td><b>Puerto de carga</b></td><td>No carga, el cable hace falso contacto</td><td>45–90 min</td></tr>
        <tr><td><b>Equipo mojado</b></td><td>Dejó de funcionar tras contacto con líquido</td><td>24–48 h</td></tr>
        <tr><td><b>Software / FRP legal</b></td><td>Bootloop, olvido de cuentas propias</td><td>1–24 h</td></tr>
        <tr><td><b>Microsoldadura de placa</b></td><td>No enciende, no da señal, muere de repente</td><td>24–72 h</td></tr>
      </tbody>
    </table>
    <p class="callout"><b>Si no lo reparamos, te lo decimos.</b> No vendemos &quot;magia&quot;: si el costo supera el valor real de tu equipo o la falla no conviene, te lo explicamos con números y te vas con la verdad. También rechazamos equipos reportados o con cuentas ajenas: solo trabajamos con comprobación de propiedad.</p>

    <h2 id="porque">Por qué elegir este taller de celulares en Tapachula</h2>
    <ul>
      <li><b>Diagnóstico gratis y presencial.</b> El técnico revisa tu equipo contigo; nada de &quot;déjalo y mañana llamamos&quot;.</li>
      <li><b>Precio cerrado por escrito antes de reparar.</b> Lo que cotizamos es lo que pagas — pieza y mano de obra incluidas.</li>
      <li><b>Garantía escrita de 30 días</b> sobre la pieza y el trabajo realizado.</li>
      <li><b>Reparación express:</b> la mayoría de pantallas y baterías, en menos de una hora, en el mostrador.</li>
      <li><b>A domicilio en Tapachula:</b> recolectamos y entregamos tu equipo por $120 si no puedes venir.</li>
      <li><b>Pago con tarjeta, efectivo o transferencia.</b></li>
    </ul>

    <h2 id="proceso">Cómo es el proceso, paso a paso</h2>
    <ol>
      <li><b>Nos escribes por WhatsApp</b> con modelo y falla (una foto ayuda muchísimo). Te damos un rango de precio al instante con el cotizador.</li>
      <li><b>Traes el equipo (o lo recolectamos).</b> Diagnóstico gratuito en 30–60 minutos, contigo presente.</li>
      <li><b>Apruebas el precio cerrado.</b> Si no conviene, te lo decimos y no pagas nada.</li>
      <li><b>Reparamos y probamos</b> función por función (táctil, cámara, huella, señal, carga).</li>
      <li><b>Te lo entregamos con garantía escrita</b> y la pieza dañada, si la quieres conservar.</li>
    </ol>

    <h2 id="ubicacion">Estamos cerca de ti en Tapachula</h2>
    <p><b>Quinceava Avenida Sur esq. 18a Calle Oriente, Col. Los Naranjos, CP 30705, Tapachula, Chiapas.</b> Lunes a sábado, 9:00–19:00. Si buscabas un <b>técnico de celulares cerca de mí</b> o un <b>taller de electrónica cerca de mí</b>, estamos a minutos de Centro y de la México; y si te queda caro el mandado, pasamos por tu equipo.</p>

    <h2 id="faq">Preguntas frecuentes</h2>
    <h3>¿Arreglan celulares de cualquier marca?</h3>
    <p>Sí: iPhone, Samsung, Xiaomi, Motorola, Realme, OPPO, vivo, Huawei y más, incluidos modelos con pantalla curva. Si no tenemos la pieza, la conseguimos en 24–72 h y te lo decimos desde el principio.</p>
    <h3>¿Cuánto cuesta reparar un celular aquí?</h3>
    <p>Depende del modelo y la falla. Usa el <a href="/servicio#cotizador">cotizador del sitio</a> para ver el aproximado de tu equipo en 60 segundos, o mándanos el modelo por WhatsApp. El precio final se cierra tras el diagnóstico gratuito y siempre por escrito.</p>
    <h3>¿Debo llevar la caja o factura?</h3>
    <p>Para reparaciones normales basta con que acredites que el equipo es tuyo (contraseña, INE con datos del número, o ticket). Para desbloqueos y temas de cuenta exigimos comprobación formal por tu seguridad y la nuestra.</p>
    <h3>¿Pueden recoger mi celular a domicilio?</h3>
    <p>Sí, en toda Tapachula: $120 por trayecto, incluye la devolución. Es la opción favorita de quien busca &quot;servicios móviles cerca de mí&quot;.</p>

    <section class="cta">
      <h2>Tu reparación empieza con un mensaje</h2>
      <p>Mándanos modelo y falla por WhatsApp y te respondemos con precio aproximado y tiempo de entrega. O abre el cotizador y calcula en 60 segundos. Diagnóstico gratis al llegar al taller.</p>
      <div class="btn-row">
        <a class="btn btn--wa" href="__WA_CTA__" rel="noopener">Cotizar mi reparación</a>
        <a class="btn btn--acc" href="/servicio#cotizador">Abrir el cotizador</a>
      </div>
    </section>

""" + RELATED + """
  </article>"""
page("reparacion-celulares-tapachula",
     "Reparación de Celulares en Tapachula | Taller con Diagnóstico Gratis · TapaTech",
     "¿Reparación de celulares cerca de mí en Tapachula? Taller con técnico visible, precio cerrado por escrito, entrega en 40–60 min, garantía de 30 días y servicio a domicilio. Todas las marcas.",
     "reparacion de celulares, reparación de celulares cerca de mi, taller de celulares Tapachula, reparar celulares, reparador de celulares, técnico de celulares cerca de mi, reparación de teléfonos",
     "Reparación de celulares en Tapachula — TapaTech",
     u1, sch1, '<span aria-current="page">Reparación de celulares en Tapachula</span>', body1.replace("__WA_CTA__", wa_link("Mi celular (modelo ________) tiene esta falla: ________ ¿me pueden ayudar?")), "")

# =====================================================================
# 2. /cambio-pantalla-celular-tapachula — ALTA (comercial/precio)
# =====================================================================
u2 = SITE + "/cambio-pantalla-celular-tapachula/"
sch2 = ld(
    service_node(SITE + "/#servicio-pantalla",
                 "Cambio de pantalla de celular en Tapachula",
                 "Cambio de pantalla para iPhone, Samsung, Xiaomi y demás marcas en Tapachula: piezas Incell económicas y OLED/AMOLED premium, incluidas curvas. Entrega en 40–60 minutos con garantía escrita.",
                 {"url": u2,
                  "serviceAudience": {"@type": "Audience", "audienceType": "Usuarios de celulares en Tapachula y la Costa de Chiapas"},
                  "offers": {"@type": "Offer", "priceCurrency": "MXN", "priceSpecification": {"@type": "PriceSpecification", "priceCurrency": "MXN", "eligibleQuantityDescription": "El precio depende del modelo y la calidad de pieza (Incell o OLED). Rango orientativo 2026: desde $600 hasta $5,200. Usa el cotizador del sitio para el aproximado exacto de tu modelo."}, "availability": "https://schema.org/InStock"}}),
    breadcrumb("Cambio de pantalla de celular en Tapachula", u2),
    faq_node(u2 + "#faq", [
        ("¿Cuánto cuesta un cambio de pantalla de celular en Tapachula?", "Depende del modelo y la calidad de la pieza. En 2026 los rangos reales van de aprox. $600–$1,700 en pantallas Incell para gama media Android, hasta $5,200 en OLED/AMOLED premium para gamas altas y iPhones recientes. En el cotizador de TapaTech ves el aproximado de tu modelo exacto en 60 segundos; el precio cerrado se confirma tras revisión gratuita."),
        ("¿Cuánto tarda cambiar una pantalla de celular?", "Entre 40 y 60 minutos para la mayoría de modelos, hecho frente a ti en el taller. Algunos equipos con marco sellado o pantallas curvas requieren 1–2 horas para el prensado correcto."),
        ("¿Qué diferencia hay entre pantalla Incell, OLED y original?", "Incell: tecnología LCD económica, buena imagen, menor costo; ideal para uso diario. OLED/AMOLED: negros puros, más brillo y ahorro de batería; es la calidad con la que salió tu equipo. Original de servicio: la misma del fabricante, la más cara. Te recomendamos según el uso y valor de tu teléfono, sin venderte la más cara por default."),
        ("¿La pantalla nueva pierde Touch ID, Face ID o huella bajo pantalla?", "No, si se hace bien. Conservamos tus componentes originales (sensor, auricular, cámaras) y los reubicamos en la pantalla nueva. En iPhone el Face ID va ligado a la pantalla original: lo manejamos con cuidado extremo. Todo queda probado frente a ti y con garantía escrita."),
        ("¿Ponen mensaje de 'pieza desconocida' en iPhone?", "En iPhone aparece aviso de pantalla no original salvo transferencia de IC (microsoldadura), que ofrecemos como opción en modelos recientes. Te explicamos pros y contras antes de decidir; nunca decidimos por ti."),
    ]),
)
body2 = """  <article>
    <header class="hero-doc">
      <span class="eyebrow">Precios reales 2026 · Tapachula</span>
      <h1>Cambio de pantalla de celular en Tapachula: ¿cuánto cuesta y cuánto tarda?</h1>
      <p class="lead" style="margin-top:14px">La pregunta #1 que nos hacen: <b>¿cuánto cuesta un cambio de pantalla de celular?</b> La respuesta honesta depende de tu modelo y de la calidad de pieza que elijas. Aquí tienes los rangos reales que manejamos en 2026 en Tapachula, la diferencia entre Incell y OLED, y las formas en que otros te cobran de más.</p>
      <div class="meta">
        <span>Por <b>Rafael Ortiz (&quot;Cubatel&quot;)</b> · 15 años reparando equipos</span>
        <span>·</span>
        <span>Actualizado <b>28 oct 2026</b></span>
        <span>·</span>
        <span>Lectura <b>6 min</b></span>
      </div>
    </header>

    <figure>
      <img src="../../assets/antes-despues.webp" width="1200" height="800" loading="eager" decoding="async" alt="Celular con pantalla rota junto al mismo equipo con pantalla nueva instalada en TapaTech Tapachula">
      <figcaption>Antes y después real de un cambio de pantalla en nuestro taller: táctil, colores y huella probados frente al cliente.</figcaption>
    </figure>

    <h2 id="cuanto">¿Cuánto cuesta cambiar la pantalla de un celular? Rangos 2026</h2>
    <table>
      <caption>Rangos orientativos con pieza y mano de obra incluidas (Tapachula, octubre 2026)</caption>
      <thead><tr><th scope="col">Tipo de equipo</th><th scope="col">Pieza Incell / económica</th><th scope="col">Pieza OLED / premium</th></tr></thead>
      <tbody>
        <tr><td>Android gama de entrada (A0x, Redmi, Galaxy J)</td><td>$600 – $1,100</td><td>—</td></tr>
        <tr><td>Android gama media (Galaxy A, Redmi Note, Motorola G)</td><td>$800 – $1,700</td><td>$1,600 – $2,800</td></tr>
        <tr><td>iPhone estándar (XS–15)</td><td>$1,200 – $2,200</td><td>$2,400 – $4,200</td></tr>
        <tr><td>iPhone Pro Max / modelos recientes</td><td>$1,800 – $2,600</td><td>$3,500 – $5,200</td></tr>
        <tr><td>Samsung con pantalla curva (S/Note/Ultra)</td><td>no aplica</td><td>$2,800 – $5,200</td></tr>
      </tbody>
    </table>
    <p><b>¿Cuánto sale un cambio de pantalla de celular exactamente para TU modelo?</b> Escríbelo en el <a href="/servicio#cotizador">cotizador</a> y te da el aproximado al instante. Estos rangos son los mismos precios que publicamos en mostrador; los ajustamos cuando cambia el costo de importación.</p>

    <h2 id="calidades">Incell vs OLED vs original: cuál te conviene de verdad</h2>
    <ul>
      <li><b>Incell (económica):</b> buen brillo y color, táctil correcto, el menor precio. Recomendada si tu equipo es de trabajo, para redes o si piensas venderlo pronto.</li>
      <li><b>OLED/AMOLED (premium):</b> negros reales, más brillo bajo sol, menor consumo. Es la que debes elegir si tu teléfono ya traía OLED, si usas huella bajo pantalla o si planeas conservarlo 2+ años.</li>
      <li><b>Original de servicio:</b> idéntica a la de fábrica, máxima duración y reventa; su precio puede duplicar el Incell. Solo la sugerimos en equipos recientes de alto valor.</li>
    </ul>
    <p class="callout"><b>Regla honesta</b> Nunca te vendemos la pieza más cara por default. Te decimos qué gana y qué pierde tu modelo con cada opción, y el precio se cierra por escrito antes de abrir el equipo.</p>

    <h2 id="tiempo">¿Cuánto tarda el cambio de pantalla?</h2>
    <p>Entre <b>40 y 60 minutos</b> en la mayoría de modelos, hecho en el mostrador y frente a ti. Curvas y equipos con marco sellado toman hasta 2 horas por el prensado. Si la pieza no está en existencia, llega en 24–72 h y te avisamos antes.</p>

    <h2 id="trampas">5 formas en que te cobran de más (y cómo evitarlas)</h2>
    <ol>
      <li><b>&quot;Mano de obra aparte&quot;:</b> cotizan la pantalla barata y suman $300–$500 al final. Aquí el precio incluye pieza + instalación + pruebas.</li>
      <li><b>Pantalla Incell cobrada como OLED:</b> pide que te muestren la caja de la pieza. Nosotros la abrimos contigo.</li>
      <li><b>&quot;Se me dañó otra cosa&quot; sorpresa:</b> aparece un daño nuevo después de cobrar. Por eso cerramos precio por escrito ANTES de abrir el equipo.</li>
      <li><b>Sin prueba de huella/Face ID/cámara:</b> instalan y entregan sin probar todo. Aquí verificamos función por función frente a ti.</li>
      <li><b>Garantía verbal:</b> &quot;si falla me lo traes&quot;. Aquí va por escrito, 30 días, pieza y trabajo.</li>
    </ol>

    <h2 id="faq-resumen">Lo que más nos preguntan</h2>
    <p>Si tu pantalla <b>se ve pero no responde al tacto</b>, o <b>responde pero no muestra imagen</b>, la reparación suele ser la misma (módulo de pantalla) — pero hay excepciones: te ayudamos a distinguirlas en la guía <a href="/blog/celular-no-enciende-causas-y-soluciones/">mi celular no enciende</a>. Y si además dejó de cargar, revisa <a href="/blog/no-carga-puerto-o-bateria/">puerto o batería</a> antes de pagar dos reparaciones cuando solo era una.</p>

    <section class="cta">
      <h2>Pide el precio de tu modelo en 60 segundos</h2>
      <p>Escribe tu modelo en el cotizador o mándalo por WhatsApp con una foto del daño. Te decimos costo aproximado, calidad recomendada y tiempo de entrega antes de que salgas de casa.</p>
      <div class="btn-row">
        <a class="btn btn--wa" href="__WA_CTA__" rel="noopener">Cotizar mi pantalla</a>
        <a class="btn btn--acc" href="/servicio#cotizador">Abrir el cotizador</a>
      </div>
    </section>

""" + RELATED + """
  </article>"""
page("cambio-pantalla-celular-tapachula",
     "¿Cuánto Cuesta un Cambio de Pantalla de Celular en Tapachula? Precios 2026 | TapaTech",
     "Cuánto cuesta un cambio de pantalla de celular en 2026: rangos reales Incell $600–$1,700 y OLED hasta $5,200 por modelo, cuánto tarda (40–60 min) y las trampas de precio a evitar. Cotiza tu modelo en Tapachula.",
     "cuanto cuesta un cambio de pantalla de celular, precio de cambio de pantalla de celular, costo de cambio de pantalla de celular, cuanto sale un cambio de pantalla, cambio de pantalla Tapachula",
     "Cambio de pantalla de celular en Tapachula — precios 2026",
     u2, sch2, '<span aria-current="page">Cambio de pantalla de celular</span>', body2.replace("__WA_CTA__", wa_link("Quiero cotizar el cambio de pantalla de mi celular. Modelo: ________")), "")

# =====================================================================
# 3. /reparacion-iphone-tapachula — ALTA
# =====================================================================
u3 = SITE + "/reparacion-iphone-tapachula/"
sch3 = ld(
    service_node(SITE + "/#servicio-iphone",
                 "Reparación de iPhone en Tapachula",
                 "Reparación de iPhone en Tapachula: cambio de pantalla con Face ID intacto, batería, conectores, cámaras y microsoldadura de placa. Todos los modelos, diagnóstico gratis y garantía escrita de 30 días.",
                 {"url": u3}),
    breadcrumb("Reparación de iPhone en Tapachula", u3),
    faq_node(u3 + "#faq", [
        ("¿Reparan todos los modelos de iPhone en Tapachula?", "Sí, desde iPhone 6 hasta la serie 16/Pro Max, incluidas pantallas OLED y equipos con Face ID. Manejamos transferencia de componentes originales (auricular, sensores, cámaras) para no perder funciones."),
        ("¿Dónde puedo llevar mi iPhone a reparar con confianza?", "En TapaTech: Quinceava Av. Sur esq. 18a Calle Oriente, Col. Los Naranjos, Tapachula. Verifica tres cosas en cualquier taller antes de dejar tu iPhone: que te cierren el precio POR ESCRITO antes de abrir, que te dejen ver la reparación, y que den garantía escrita. Nosotros cumplimos las tres."),
        ("¿Se puede reparar la pantalla de un iPhone sin perder Face ID?", "Sí. El Face ID está vinculado al módulo de pantalla original; un cambio normal conserva Face ID porque reubicamos los sensores originales en la pantalla nueva. Solo el daño al flex del iluminador flood sería irreparable — por eso lo probamos antes de entregar."),
        ("¿Mi iPhone se prende y se apaga solo, qué es?", "Las causas típicas son batería degradada (la más común y barata), fallo de la línea de alimentación tras golpes o humedad, o software corrupto. Se diagnostica en 30–60 min con medición de consumo en fuente de poder. No esperes a que deje de prender: trae tu iPhone a revisión gratuita."),
        ("¿Aparece el mensaje de 'no se pudo verificar' o 'pieza desconocida'?", "En iOS reciente, las pantallas y baterías no originales muestran avisos en Ajustes. Son cosméticos (no afectan funcionamiento), pero si te molestan existen soluciones de microsoldadura (transferencia de IC/battery board original). Te explicamos opciones y costos antes de decidir."),
    ]),
)
body3 = """  <article>
    <header class="hero-doc">
      <span class="eyebrow">Servicio especializado · iPhone</span>
      <h1>Reparación de iPhone en Tapachula: pantalla, batería y placa sin perder funciones</h1>
      <p class="lead" style="margin-top:14px">Tu iPhone vale demasiado para dejarlo en manos improvisadas. <b>Reparar un iPhone</b> bien significa conservar Face ID, True Tone, la hermeticidad y tus componentes originales. Así trabajamos: diagnóstico gratis frente a ti, precio cerrado por escrito y garantía de 30 días — de un iPhone 8 a la serie 16 Pro Max.</p>
      <div class="meta">
        <span>Por <b>Rafael Ortiz (&quot;Cubatel&quot;)</b> · 15 años reparando equipos</span>
        <span>·</span>
        <span>Actualizado <b>28 oct 2026</b></span>
        <span>·</span>
        <span>Lectura <b>5 min</b></span>
      </div>
    </header>

    <figure>
      <img src="../../assets/taller.webp" width="1200" height="800" loading="eager" decoding="async" alt="Técnico de TapaTech reparando la pantalla de un iPhone en Tapachula conservando Face ID y True Tone">
      <figcaption>Estación de trabajo con tapete antiestático y luz regulada: el estándar mínimo para abrir un iPhone con seguridad.</figcaption>
    </figure>

    <h2 id="fallas">Las fallas de iPhone que más atendemos</h2>
    <table>
      <caption>Frecuencia de reparaciones de iPhone en TapaTech (2026)</caption>
      <thead><tr><th scope="col">Falla</th><th scope="col">Solución típica</th><th scope="col">Tiempo</th></tr></thead>
      <tbody>
        <tr><td><b>Pantalla estrellada o sin táctil</b></td><td>Cambio de módulo OLED conservando sensores originales</td><td>60–90 min</td></tr>
        <tr><td><b>Batería agotada / se apaga solo</b></td><td>Cambio de batería con calibración</td><td>40 min</td></tr>
        <tr><td><b>Se prende y se apaga solo (bootloop térmico)</b></td><td>Diagnóstico de consumo; batería, línea power o software</td><td>1–24 h</td></tr>
        <tr><td><b>No carga / conector flojo</b></td><td>Limpieza o cambio de puerto/dock flex</td><td>60–90 min</td></tr>
        <tr><td><b>Cámara borrosa o negra</b></td><td>Cambio de módulo de cámara</td><td>45 min</td></tr>
        <tr><td><b>Daño por líquido</b></td><td>Lavado ultrasónico + reparación de placa</td><td>24–48 h</td></tr>
        <tr><td><b>No da imagen pero vibra</b></td><td>Pantalla/backlight (el iPhone SÍ enciende)</td><td>60–90 min</td></tr>
      </tbody>
    </table>

    <h2 id="faceid">Face ID, True Tone y el aviso de &quot;pieza desconocida&quot;</h2>
    <p>Es lo que más preocupa y con razón: en iPhone estos componentes van <b>emparejados de fábrica</b>. Nuestro procedimiento:</p>
    <ul>
      <li><b>Reubicamos tus sensores originales</b> (auricular, proximidad, iluminador) en la pantalla nueva → Face ID y True Tone siguen funcionando.</li>
      <li><b>Te mostramos las opciones ante el aviso de iOS:</b> aceptar el aviso cosmético en Ajustes, o transferencia de IC (microsoldadura del circuito original de tu pantalla) para eliminarlo. Diferencia de costo clara, decisión tuya.</li>
      <li><b>Baterías:</b> igual — opción estándar con aviso, o transferencia del BMS original sin aviso. Probamos ciclos y salud real antes de entregar.</li>
    </ul>
    <p class="callout"><b>Nunca hacemos &quot;jumpers&quot; ni trucos</b> que dejan tu iPhone dependiente de un cable. Si algo no se puede hacer bien, te decimos qué riesgo tiene cada camino.</p>

    <h2 id="llevar">¿Dónde puedo llevar mi iPhone a reparar en Tapachula?</h2>
    <p>En <b>Quinceava Av. Sur esq. 18a Calle Oriente, Col. Los Naranjos</b> (CP 30705), de lunes a sábado 9:00–19:00. Antes de dejar tu iPhone en cualquier taller —incluso si al final decides otro— exige: precio por escrito antes de abrir, posibilidad de ver la reparación y garantía escrita. Sin esas tres cosas, no es un taller de iPhone.</p>

    <h2 id="prende">«Mi iPhone se prende y se apaga solo»: qué puede ser</h2>
    <p>Es una de las búsquedas más comunes y agrupa tres casos distintos: <b>(1) batería degradada</b> — el clásico apagado con 20–30% de carga; se resuelve en 40 minutos. <b>(2) reinicio térmico/protección</b> — tras golpe o humedad, una línea de alimentación se protege; requiere medición y microsoldadura. <b>(3) software corrupto</b> — tras una actualización; se recupera con reinstalado preservando datos cuando es posible. La diferencia entre una reparación de $700 y una de $2,500 está en saber cuál es; por eso el diagnóstico se hace con fuente de poder, no adivinando.</p>

    <section class="cta">
      <h2>Tu iPhone, con técnico que te explica</h2>
      <p>Mándanos modelo, iOS y qué le pasa por WhatsApp. Te damos causa probable, rango de precio y tiempo antes de que vengas. Diagnóstico gratis en el local.</p>
      <div class="btn-row">
        <a class="btn btn--wa" href="__WA_CTA__" rel="noopener">Enviar mi iPhone por WhatsApp</a>
        <a class="btn btn--acc" href="/servicio#cotizador">Ver precios en el cotizador</a>
      </div>
    </section>

    <nav class="related" aria-label="Artículos relacionados">
      <h2>Sigue leyendo</h2>
      <ul class="rel-grid">
        <li><a href="/cambio-pantalla-celular-tapachula/" data-cat="Precios" rel="nofollow"><b>¿Cuánto cuesta un cambio de pantalla?</b><span>Rangos 2026 por modelo y calidad de pieza.</span></a></li>
        <li><a href="/reparacion-bateria-celular-tapachula/" data-cat="Energía" rel="nofollow"><b>Batería de iPhone: cuándo cambiarla</b><span>Síntomas, salud de batería y riesgo de inflamación.</span></a></li>
        <li><a href="/blog/celular-no-enciende-causas-y-soluciones/" data-cat="Diagnóstico" rel="nofollow"><b>iPhone que no enciende: 8 causas</b><span>Pruebas caseras antes de pagar.</span></a></li>
      </ul>
    </nav>
  </article>"""
page("reparacion-iphone-tapachula",
     "Reparación de iPhone en Tapachula | Pantalla, Batería y Placa sin perder Face ID · TapaTech",
     "Repara tu iPhone en Tapachula conservando Face ID y True Tone: pantalla, batería, puertos, cámaras y microsoldadura. Diagnóstico gratis, precio por escrito y garantía de 30 días. Todos los modelos.",
     "reparar iphone, reparación de iphone cerca de mi, reparacion de pantalla iphone, donde puedo llevar mi iphone a reparar, iphone se prende y se apaga solo, iphone tapachula",
     "Reparación de iPhone en Tapachula — TapaTech",
     u3, sch3, '<span aria-current="page">Reparación de iPhone</span>', body3.replace("__WA_CTA__", wa_link("Tengo un iPhone (modelo ________, iOS ________) con esta falla: ________ ¿me pueden ayudar?")), "")

# =====================================================================
# 4. /reparacion-samsung-tapachula — MEDIA-ALTA
# =====================================================================
u4 = SITE + "/reparacion-samsung-tapachula/"
sch4 = ld(
    service_node(SITE + "/#servicio-samsung",
                 "Reparación de Samsung en Tapachula",
                 "Reparación de celulares Samsung en Tapachula: cambio de pantalla AMOLED (planas y curvas), batería, puerto de carga, placas base y software. Líneas Galaxy A, M, S, Note, Z Fold/Flip. Garantía escrita.",
                 {"url": u4}),
    breadcrumb("Reparación de Samsung en Tapachula", u4),
    faq_node(u4 + "#faq", [
        ("¿Reparan pantallas curvas de Samsung Galaxy S y Note?", "Sí. Las curvas requieren prensado en molde y adhesivo oficial; tomamos 1–2 horas para hacerlo bien. Usamos AMOLED de servicio o compatible premium según tu presupuesto, ambas con huella ultrasonido probada."),
        ("¿Cuánto cuesta la reparación de pantalla de Samsung?", "Gama A/M plana: desde ~$800–$1,700. AMOLED de gama S y curvas: $2,800–$5,200 según modelo. El aproximado exacto de tu Galaxy está en el cotizador; el precio cerrado va por escrito tras diagnóstico gratuito."),
        ("¿Perderé el Samsung Pay o Knox al reparar?", "No. Ninguna reparación legítima toca la efímera Knox: huella, Samsung Wallet/Pay y Secure Folder siguen funcionando igual. Si alguien te ofrece 'bypassear' Knox para abaratar, sal de ese taller: compromete la seguridad de tus cuentas."),
        ("¿Qué hago si mi Samsung quedó bloqueado por la empresa o por falta de pago (Payjoy/Macropay)?", "Si el equipo tiene bloqueo corporativo MDM/Knox o de financiera, primero verifica qué tipo de bloqueo es; algunos requieren regularizar con la empresa/financiera y otros sí son resolubles legalmente siendo el dueño. Guía completa: samsung-a17-bloqueado-por-empresa-frp-knox-pago."),
        ("¿Reparan Galaxy plegables (Z Fold/Flip)?", "Atendemos diagnosis y cotizaciones de plegables; las cubiertas internas Flex Glass se gestionan con pedido especial (7–15 días). Te decimos con honestidad cuándo conviene y cuándo no."),
    ]),
)
body4 = """  <article>
    <header class="hero-doc">
      <span class="eyebrow">Especialistas Galaxy · Tapachula</span>
      <h1>Reparación de Samsung en Tapachula: pantallas AMOLED, curvas y placas Galaxy</h1>
      <p class="lead" style="margin-top:14px">Los Galaxy tienen particularidades que un taller genérico no maneja bien: <b>pantallas AMOLED curvas, huella ultrasónica bajo el cristal y Knox</b>. Si buscas <b>reparación de celulares Samsung</b> en Tapachula, aquí te explicamos cómo tratamos cada línea (A, M, S, Note, Z) y qué esperar del costo y el tiempo.</p>
      <div class="meta">
        <span>Por <b>Rafael Ortiz (&quot;Cubatel&quot;)</b> · 15 años reparando equipos</span>
        <span>·</span>
        <span>Actualizado <b>28 oct 2026</b></span>
        <span>·</span>
        <span>Lectura <b>5 min</b></span>
      </div>
    </header>

    <figure>
      <img src="../../assets/taller.webp" width="1200" height="800" loading="eager" decoding="async" alt="Reparación de pantalla AMOLED curva de Samsung Galaxy en el taller TapaTech Tapachula">
      <figcaption>Prensado en molde para pantallas curvas: el paso que separa una reparación duradera de una que se levanta a las semanas.</figcaption>
    </figure>

    <h2 id="servicios">Qué reparamos en Samsung</h2>
    <ul>
      <li><b>Cambio de pantalla Samsung (AMOLED):</b> planas y curvas, con huella bajo pantalla probada y calibración de color.</li>
      <li><b>Batería:</b> desde Galaxy A hasta S Ultra; incluimos prueba de consumo e inspección de inflamación.</li>
      <li><b>Puerto de carga USB-C:</b> limpieza, cambio de sub-board o rework del conector en placa.</li>
      <li><b>Placa base:</b> no enciende, no da señal, muerte súbita tras actualización — microsoldadura con diagrama.</li>
      <li><b>Software:</b> bootloop, recuperación de cuentas propias, FRP con acreditación de propiedad.</li>
      <li><b>Equipos mojados:</b> lavado ultrasónico anti-corrosión (los Exynos perdonan poco la humedad).</li>
    </ul>

    <h2 id="curvas">Pantallas curvas: por qué no es 'pegar y listo'</h2>
    <p>Un Galaxy S curvo mal reparado se deslaminará o levantará esquinas en semanas. Nuestro proceso usa <b>molde de prensado, adhesivo oficial y secado controlado</b>; por eso toma 1–2 horas y no 20 minutos. La huella ultrasónica se recalibra con cada instalación. Si un taller te ofrece una curva &quot;en 15 minutos&quot;, pregúntale con qué molde trabaja.</p>

    <h2 id="precios">Precios orientativos de reparación Samsung (2026)</h2>
    <table>
      <caption>Gamas representativas con pieza y mano de obra incluidas</caption>
      <thead><tr><th scope="col">Línea</th><th scope="col">Pantalla</th><th scope="col">Batería</th></tr></thead>
      <tbody>
        <tr><td>Galaxy A / M (plana)</td><td>$800 – $1,700</td><td>$500 – $800</td></tr>
        <tr><td>Galaxy S plano (S21–S24)</td><td>$2,400 – $4,200</td><td>$700 – $1,100</td></tr>
        <tr><td>Galaxy S Ultra / curvos</td><td>$2,800 – $5,200</td><td>$800 – $1,200</td></tr>
        <tr><td>Z Flip / Z Fold</td><td>cotización especial</td><td>$900 – $1,400</td></tr>
      </tbody>
    </table>
    <p>Para el dato exacto de tu modelo: <a href="/servicio#cotizador">cotizador</a> o WhatsApp con una foto. Ejemplo detallado de caso real: <a href="/blog/samsung-galaxy-a17-pantalla-rota-precio/">Samsung A17 con pantalla rota</a>.</p>

    <h2 id="knox">Knox, Samsung Pay y bloqueos: lo que debes saber</h2>
    <p>Reparar tu Galaxy <b>no afecta Knox ni Samsung Wallet</b>: son independientes del hardware que cambiamos. Donde sí debemos ir con cuidado es en bloqueos: si tu equipo salió de una empresa (MDM) o de una financiera con falta de pago, el camino correcto depende del tipo de bloqueo — te lo desglosamos en la guía <a href="/blog/samsung-a17-bloqueado-por-empresa-frp-knox-pago/">Samsung bloqueado por empresa o falta de pago</a> y en <a href="/bloqueo-payjoy-macropay/">bloqueo Payjoy/Macropay</a>. Solo trabajamos bloqueos con acreditación de propiedad.</p>

    <section class="cta">
      <h2>¿Tu Galaxy pide taller? Empecemos por el diagnóstico</h2>
      <p>Mándanos modelo exacto (A15, S23 Ultra…) y qué le pasa. Te damos rango de precio y tiempo por WhatsApp antes de que vengas. Diagnóstico gratis en el local, de 9:00 a 19:00.</p>
      <div class="btn-row">
        <a class="btn btn--wa" href="__WA_CTA__" rel="noopener">Cotizar mi Samsung</a>
        <a class="btn btn--acc" href="/servicio#cotizador">Abrir el cotizador</a>
      </div>
    </section>

    <nav class="related" aria-label="Artículos relacionados">
      <h2>Sigue leyendo</h2>
      <ul class="rel-grid">
        <li><a href="/blog/samsung-galaxy-a17-pantalla-rota-precio/" data-cat="Precios" rel="nofollow"><b>Samsung A17 pantalla rota: precio real</b><span>Caso detallado por calidad de pieza.</span></a></li>
        <li><a href="/cambio-pantalla-celular-tapachula/" data-cat="Pantallas" rel="nofollow"><b>Guía general de cambio de pantalla</b><span>Incell vs OLED, tiempos y trampas.</span></a></li>
        <li><a href="/reparacion-celulares-tapachula/" data-cat="Taller" rel="nofollow"><b>Reparación de celulares en Tapachula</b><span>Todos nuestros servicios y garantías.</span></a></li>
      </ul>
    </nav>
  </article>"""
page("reparacion-samsung-tapachula",
     "Reparación de Samsung en Tapachula | Pantallas AMOLED y Curvas Galaxy · TapaTech",
     "Reparación de celulares Samsung en Tapachula: pantalla AMOLED plana y curva, batería, puerto USB-C, placa y software. Galaxy A, M, S, Note y Z. Precio por escrito y garantía de 30 días.",
     "reparacion samsung, reparacion de celulares samsung, reparacion de pantalla samsung, galaxy tapachula, pantalla curva samsung",
     "Reparación de Samsung en Tapachula — TapaTech",
     u4, sch4, '<span aria-current="page">Reparación de Samsung</span>', body4.replace("__WA_CTA__", wa_link("Tengo un Samsung Galaxy (modelo ________) con esta falla: ________ ¿qué puede ser?")), "")

# =====================================================================
# 5. /reparacion-bateria-celular-tapachula — MEDIA
# =====================================================================
u5 = SITE + "/reparacion-bateria-celular-tapachula/"
sch5 = ld(
    service_node(SITE + "/#servicio-bateria",
                 "Cambio de batería de celular en Tapachula",
                 "Cambio de batería de celular en Tapachula para iPhone, Samsung, Xiaomi y más: 30–45 minutos, prueba de salud y consumo, garantía escrita de 30 días. Atención urgente para baterías infladas.",
                 {"url": u5}),
    breadcrumb("Cambio de batería de celular en Tapachula", u5),
    faq_node(u5 + "#faq", [
        ("¿Cómo sé que mi celular necesita batería nueva?", "Cuatro señales: dura menos de medio día con uso normal, se apaga con 20–30% de carga, se calienta al cargar o la tapa/pantalla empieza a levantarse (inflamación). En iPhone, Salud de Batería bajo 80% es criterio directo. Si tu equipo además se prende y se apaga solo, la batería es sospechosa #1."),
        ("¿Qué hago si mi batería está inflada? ¿Explota?", "Déjala de usar y NO la cargues: una batería hinchada es un riesgo real de incendio, no una exageración. No la perfores ni la aplastes (el mito de 'revivirla presionándola' quema personas). Tráela apagada en una bolsa rígida o escríbenos para pasar por ella: la retiramos y disponemos responsablemente el mismo día."),
        ("¿Cuánto cuesta cambiar la batería de un celular?", "Según modelo: la mayoría de Android gama media $500–$800; iPhone $700–$1,100; gamas altas y curvos $800–$1,400. Incluye pieza, instalación, prueba de ciclos y garantía escrita. Tu aproximado exacto está en el cotizador."),
        ("¿Cuánto tarda el cambio de batería?", "30–45 minutos en la mayoría de equipos, frente a ti. Salvo baterías pegadas con exceso de adhesivo o equipos recién mojados, no dejamos tu teléfono esperando días."),
        ("¿Las baterías genéricas sirven? ¿Afectan al phone?", "Todas las baterías que instalamos son de grado A con protección electrónica y ciclos certificados; evitamos las 'genéricas' sin marca justamente porque degradan rápido y engañan con capacidad falsa. Instalamos, probamos consumo real y te mostramos la salud antes de entregar."),
    ]),
)
body5 = """  <article>
    <header class="hero-doc">
      <span class="eyebrow">Fallas de energía · Urgencia por batería hinchada</span>
      <h1>Batería de celular: inflada, no enciende o se apaga sola — cambio en 45 minutos</h1>
      <p class="lead" style="margin-top:14px">La <b>batería inflada</b> es la emergencia silenciosa: tapa que se levanta, pantalla que flota, calor raro. Y aunque no esté hinchada, una batería muerta es la causa #1 de &quot;<b>mi celular no enciende</b>&quot; y de &quot;<b>enciende y se apaga solo</b>&quot;. Te explicamos cómo identificar cada caso y qué hacemos en el taller — de 30 a 45 minutos, con garantía escrita.</p>
      <div class="meta">
        <span>Por <b>Rafael Ortiz (&quot;Cubatel&quot;)</b> · 15 años reparando equipos</span>
        <span>·</span>
        <span>Actualizado <b>28 oct 2026</b></span>
        <span>·</span>
        <span>Lectura <b>5 min</b></span>
      </div>
    </header>

    <figure>
      <img src="../../assets/taller.webp" width="1200" height="800" loading="eager" decoding="async" alt="Técnico de TapaTech extrayendo una batería de celular inflamada en Tapachula con pinzas y tapete antiestático">
      <figcaption>Retiro seguro de batería hinchada: sin perforar, sin aplicar fuerza, en contención ignífuga. La disposición final es responsabilidad del taller.</figcaption>
    </figure>

    <h2 id="senales">4 señales de que la batería ya terminó su vida</h2>
    <ol>
      <li><b>Duración colapsada:</b> medio día con uso ligero, o se apaga marcando 20–30%.</li>
      <li><b>Apagados y reinicios solos:</b> el sistema cae porque la batería no sostiene el pico de consumo (típico en frío o con cámara).</li>
      <li><b>Hinchazón:</b> tapa trasera o pantalla levantada, burbuja visible, el equipo rueda sobre la mesa. <b>= prioridad, deja de usarlo.</b></li>
      <li><b>No enciende en absoluto:</b> si tras 45 min de carga y reinicio forzado sigue muerto, la batería puede estar en protección profunda o muerta — se comprueba con fuente de poder en minutos.</li>
    </ol>

    <h2 id="inflada">Batería inflada: qué hacer HOY y qué jamás intentar</h2>
    <p class="callout"><b>Peligro real</b> Una celda hinchada contiene gas de electrolito inflamable. NO la cargues, NO la perfores, NO la aplastes para &quot;regresarla&quot;, NO la tires al basura común. Apaga el equipo, déjalo en superficie no inflamable y tráelo (o pídenos recolección a domicilio). Retiro e instalación de la nueva: mismo día.</p>
    <p>¿Por qué se hinchan? Ciclo de vida agotado, cargadores sin certificación, o calor extremo — en Tapachula el sol dentro del coche es un acelerante real. Si tu funda atrapa calor o cargas junto a la ventana, cambia el hábito además de la batería.</p>

    <h2 id="noenciende">Cuando &quot;no enciende&quot; o &quot;enciende y se apaga&quot; resulta ser la batería</h2>
    <p>Conectamos el equipo a fuente de poder regulada: si pide corriente pero no arranca, o arranca y corta, medimos si la caída es de la celda, del circuito de carga o de placa. Muchas veces el cliente llega convencido de que &quot;se mechó&quot; su phone y eran 45 minutos de batería nueva. Antes de pagar reparaciones mayores, haz las <b>3 pruebas caseras</b> de nuestra guía <a href="/blog/celular-no-enciende-causas-y-soluciones/">celular que no enciende</a> — y si tampoco carga, revisa primero <a href="/blog/no-carga-puerto-o-bateria/">puerto o batería</a>.</p>

    <h2 id="precio">Precio y tiempo del cambio de batería (2026)</h2>
    <table>
      <caption>Pieza de grado A + instalación + garantía escrita de 30 días</caption>
      <thead><tr><th scope="col">Tipo</th><th scope="col">Rango</th><th scope="col">Tiempo</th></tr></thead>
      <tbody>
        <tr><td>Android gama media (A, M, Redmi, Moto G)</td><td>$500 – $800</td><td>30–45 min</td></tr>
        <tr><td>iPhone (8 a 15)</td><td>$700 – $1,100</td><td>40 min</td></tr>
        <tr><td>Gamas altas / curvos / plegables</td><td>$800 – $1,400</td><td>45–90 min</td></tr>
      </tbody>
    </table>
    <p>Descarta el humo: exigimos celdas con protección electrónica y certificamos ciclos reales. El aproximado de tu modelo está en el <a href="/servicio#cotizador">cotizador</a>.</p>

    <section class="cta">
      <h2>¿Batería hinchada o teléfono que vive conectado?</h2>
      <p>Escríbenos hoy con modelo y síntomas. Si es batería, sales con tu equipo funcionando en menos de una hora. Si es otra cosa, te lo decimos con el diagnóstico gratis antes de cobrarte nada.</p>
      <div class="btn-row">
        <a class="btn btn--wa" href="__WA_CTA__" rel="noopener">Cotizar cambio de batería</a>
        <a class="btn btn--acc" href="/servicio#cotizador">Abrir el cotizador</a>
      </div>
    </section>

""" + RELATED + """
  </article>"""
page("reparacion-bateria-celular-tapachula",
     "Batería Inflada o Celular que No Enciende | Cambio de Batería en Tapachula · TapaTech",
     "Batería de celular inflada, que no enciende o se apaga sola: señales reales, qué hacer (y qué no), cambio en 30–45 min con garantía escrita. Precios 2026 en Tapachula. Atención urgente el mismo día.",
     "bateria inflada, celular no enciende bateria, enciende y se apaga solo, cambio de bateria celular, bateria de phone, salud de bateria",
     "Cambio de batería de celular en Tapachula — TapaTech",
     u5, sch5, '<span aria-current="page">Cambio de batería</span>', body5.replace("__WA_CTA__", wa_link("Creo que la batería de mi celular (modelo ________) está inflada o agotada. Síntomas: ________")), "")

# =====================================================================
# 6. /desbloqueo-legal-celulares-tapachula — MEDIA
# =====================================================================
u6 = SITE + "/desbloqueo-legal-celulares-tapachula/"
sch6 = ld(
    service_node(SITE + "/#servicio-desbloqueo",
                 "Desbloqueo legal de celulares en Tapachula",
                 "Desbloqueo y liberación legal de celulares en Tapachula: FRP con acreditación de propiedad, liberación por compañía telefónica y retiro de cuentas Google/iCloud propias. Verificación de reporte antes de comprar.",
                 {"url": u6}),
    breadcrumb("Desbloqueo legal de celulares en Tapachula", u6),
    faq_node(u6 + "#faq", [
        ("¿Qué necesitan para desbloquear mi celular legalmente?", "Comprobación de propiedad: caja/factura/ticket a tu nombre, o presencia del titular de la cuenta vinculada con identificación. Con eso hacemos constancia por escrito. Sin acreditación, ningún taller serio debe tocarte el equipo — y si te ofrece hacerlo sin ella, es señal de robo."),
        ("¿Pueden quitar el bloqueo de cuenta de Google (FRP) de un teléfono que es mío?", "Sí, cuando acreditas propiedad (factura, caja con IMEI coincidente o presencia del titular). El método y costo varían por marca y nivel de seguridad (Samsung Knox es el más estricto). Te cotizamos solo después de verificar documentos."),
        ("¿Qué es la liberación por compañía y cómo la obtengo gratis?", "Es el desbloqueo de red (para usar cualquier chip). Desde 2021 en México la liberación por operadora es gratuita al terminar contrato o periodo de permanencia: solicítala directamente con tu operador con tu INE y número de serie. Suele tardar de minutos a pocos días. Si tu equipo fue comprado de contado, casi siempre ya viene libre."),
        ("¿Me pueden recuperar un iPhone con iCloud activado?", "Solo si eres el titular: con tus credenciales de Apple ID o con documentación de propiedad válida, el desbloqueo se hace vía restauración legítima. Quien te prometa 'saltar iCloud' sin ser el dueño te vende un delito (y un ladrillo: Apple lo revierte con cada servidor)."),
        ("Compré un celular usado y trae bloqueo: ¿qué hago?", "Primero verifica el IMEI en la lista negra de IFT (granconsulta.ift.gob.mx) para descartar reporte de robo. Si no está reportado, contacta al vendedor para que retire su cuenta o entregue factura. Si nadie responde, ven con lo que tengas: evaluamos qué es acreditable."),
    ]),
)
body6 = """  <article>
    <header class="hero-doc">
      <span class="eyebrow">Solo con acreditación de propiedad</span>
      <h1>Desbloqueo legal de celulares en Tapachula: FRP, iCloud y liberación de línea</h1>
      <p class="lead" style="margin-top:14px">Existen tres tipos de &quot;bloqueo&quot; muy distintos —cuenta de Google (FRP), iCloud, y bloqueo de red/compañía— y uno de ellos ni siquiera necesita taller: la <b>liberación por operadora es gratis</b> desde hace años. Aquí te digo cuál es tu caso, qué documentos pedirte y por qué ningún taller serio trabaja sin comprobar que el teléfono es tuyo.</p>
      <div class="meta">
        <span>Por <b>Rafael Ortiz (&quot;Cubatel&quot;)</b> · 15 años reparando equipos</span>
        <span>·</span>
        <span>Actualizado <b>28 oct 2026</b></span>
        <span>·</span>
        <span>Lectura <b>6 min</b></span>
      </div>
    </header>

    <figure>
      <img src="../../assets/taller.webp" width="1200" height="800" loading="eager" decoding="async" alt="Técnico de TapaTech verificando IMEI y documentos de propiedad para un desbloqueo legal de celular en Tapachula">
      <figcaption>Antes de cualquier desbloqueo: IMEI, consulta de reporte y documentos. La constancia se levanta por escrito.</figcaption>
    </figure>

    <h2 id="tipos">Identifica tu bloqueo: 3 tipos, 3 caminos</h2>
    <table>
      <caption>Cómo reconocer cada bloqueo antes de gastar dinero</caption>
      <thead><tr><th scope="col">Bloqueo</th><th scope="col">Se ve así</th><th scope="col">Camino correcto</th></tr></thead>
      <tbody>
        <tr><td><b>FRP / Cuenta Google</b></td><td>Pide correo antiguo tras formatear</td><td>Titular retira la cuenta, o desbloqueo con acreditación en taller</td></tr>
        <tr><td><b>iCloud (iPhone)</b></td><td>&quot;Este iPhone está vinculado a un ID de Apple&quot;</td><td>Solo con credenciales del titular o documentación válida; no existen atajos permanentes</td></tr>
        <tr><td><b>Red / compañía</b></td><td>&quot;SIM no válida / código de desbloqueo&quot;</td><td><b>Gratis</b> con tu operadora (IFE/IFT: terminaste contrato → liberación sin costo)</td></tr>
      </tbody>
    </table>
    <p class="callout"><b>Antes de pagar</b> Consulta tu IMEI en la lista negra del IFT (gratis en línea). Si el equipo está reportado por robo, ningún trámite legal existe — y quien te diga lo contrario te está metiendo en un problema penal.</p>

    <h2 id="frp">FRP (bloqueo de cuenta de Google): qué pedimos y por qué</h2>
    <p>Es el caso más común: compras usado, el vendedor desapareció, y tras actualizar el teléfono pide un correo que no conoces. Requisitos para ayudarte: <b>caja o factura con IMEI coincidente, o presencia del titular con identificación</b>. Con eso, el procedimiento varía por marca y parche de seguridad; Samsung con Knox es el más estricto y a veces la única ruta limpia es el titular iniciando sesión remota. Te decimos el costo exacto solo después de ver tus documentos — nunca antes, porque depende del escenario.</p>

    <h2 id="icloud">iCloud: la verdad incómoda</h2>
    <p>Si alguien te promete &quot;bypassear iCloud&quot; sin ser el dueño, te vende dos cosas: un delito receptivo potencial y un teléfono que Apple vuelve a bloquear. Lo que SÍ hacemos: restauración legítima cuando eres el titular (con tus credenciales) o cuando acreditas propiedad documental. Guía relacionada sobre bloqueos empresariales y de financieras: <a href="/blog/samsung-a17-bloqueado-por-empresa-frp-knox-pago/">Samsung bloqueado por empresa</a> y <a href="/bloqueo-payjoy-macropay/">Payjoy/Macropay</a>.</p>

    <h2 id="liberacion">Liberación de línea (chip): hazlo gratis con tu compañía</h2>
    <ol>
      <li>Termina tu contrato o periodo de permanencia (o compra de contado: ya debió salir libre).</li>
      <li>Contacta a tu operador (app, tienda o líneas oficiales) con INE y el número de serie.</li>
      <li>Solicita <b>liberación de equipo</b>: es gratuita por regulación. Minutos a pocos días.</li>
      <li>Si la compañía se niega sin causa, tienes derecho a levantar queja ante PROFETICO/IFT.</li>
    </ol>
    <p>Cuando el trámite se complica (equipos de segunda mano de planes ajenos), ven con tus documentos y te orientamos — sin costo la orientación.</p>

    <h2 id="no-hacemos">Lo que NO hacemos (y deberías huir de quien lo ofrezca)</h2>
    <ul>
      <li>Desbloqueos sin acreditar propiedad — punto.</li>
      <li>Bypass de iCloud &quot;permanentes&quot; (no existen; es mentira con sobrecosto).</li>
      <li>Eliminar bloqueos MDM corporativos de equipos que no son tuyos.</li>
      <li>Trabajar equipos con reporte de robo vigente.</li>
    </ul>

    <section class="cta">
      <h2>¿No sabes qué tipo de bloqueo trae tu equipo?</h2>
      <p>Mándanos una foto de la pantalla donde aparece el bloqueo + el modelo. Te decimos qué tipo es, qué documentos necesitas y si vale la pena resolverlo — todo por WhatsApp, sin costo.</p>
      <div class="btn-row">
        <a class="btn btn--wa" href="__WA_CTA__" rel="noopener">Consultar mi bloqueo</a>
        <a class="btn btn--ghost" style="border-color:#2A3E66;color:#EAF0FB" href="/reparacion-celulares-tapachula/">Ver todos los servicios del taller</a>
      </div>
    </section>

    <nav class="related" aria-label="Artículos relacionados">
      <h2>Sigue leyendo</h2>
      <ul class="rel-grid">
        <li><a href="/blog/samsung-a17-bloqueado-por-empresa-frp-knox-pago/" data-cat="Bloqueos" rel="nofollow"><b>Samsung bloqueado por empresa o falta de pago</b><span>Knox/MDM explicado con casos reales.</span></a></li>
        <li><a href="/bloqueo-payjoy-macropay/" data-cat="Financieras" rel="nofollow"><b>Bloqueo Payjoy/Macropay por falta de pago</b><span>Qué es, a qué hora bloquea y cómo regularizar.</span></a></li>
        <li><a href="/reparacion-celulares-tapachula/" data-cat="Taller" rel="nofollow"><b>Reparación de celulares en Tapachula</b><span>Pantallas, baterías, puertos y placa.</span></a></li>
      </ul>
    </nav>
  </article>"""
page("desbloqueo-legal-celulares-tapachula",
     "Desbloqueo Legal de Celulares en Tapachula | FRP, iCloud y Liberación · TapaTech",
     "Desbloqueo legal de celulares en Tapachula con acreditación de propiedad: FRP de Google, iCloud en iPhone y liberación de línea gratis con tu compañía. Verificación de IMEI y orientación sin costo.",
     "desbloqueo de celulares, desbloqueo de telefonos, desbloqueo de iphone, liberacion de celulares, desbloqueo frp, liberar celular compania",
     "Desbloqueo legal de celulares en Tapachula — TapaTech",
     u6, sch6, '<span aria-current="page">Desbloqueo legal de celulares</span>', body6.replace("__WA_CTA__", wa_link("Mi celular (modelo ________) tiene un bloqueo: ________ (adjunto foto). ¿Qué necesito para resolverlo legalmente?")), "")

# =====================================================================
# 7. /bloqueo-payjoy-macropay — MEDIA-ALTA (informacional→conversión)
# =====================================================================
u7 = SITE + "/bloqueo-payjoy-macropay/"
sch7 = ld(
    service_node(SITE + "/#servicio-bloqueo-financiera",
                 "Revisión de celulares bloqueados por financiera (Payjoy/Macropay)",
                 "Revisión técnica de celulares bloqueados por falta de pago (Payjoy, Macropay y similares) en Tapachula: identificamos qué tipo de bloqueo tiene tu equipo, qué puedes hacer legalmente y cómo prepararlo para entregarlo al regularizar tu adeudo.",
                 {"url": u7}),
    breadcrumb("Bloqueo Payjoy/Macropay", u7),
    faq_node(u7 + "#faq", [
        ("¿Qué es el bloqueo Payjoy o Macropay?", "Es un bloqueo remoto por MDM (gestión de dispositivos) que la financiera activa cuando dejas de pagar las mensualidades de un equipo comprado a crédito. El teléfono queda inutilizable hasta que regularices el adeudo con la empresa; no es una falla técnica, es una medida contractual legítima."),
        ("¿A qué hora se bloquea Macropay o Payjoy por falta de pago?", "No hay hora fija pública: el corte se dispara automáticamente al vencer la fecha límite sin pago (o pocos días después, según el sistema de la financiera). Suele ocurrir de madrugada o a primera hora, cuando se corre el lote de conciliación. Si ya venció tu fecha, espera el bloqueo en cualquier momento."),
        ("¿Si debo en Payjoy puedo sacar equipo en Macropay (o al revés)?", "Son empresas distintas con sistemas de cobranza propios; un adeudo con una no te impide automáticamente gestionar con la otra, pero ambas consultan burós de crédito y listas internas. Lo importante: el bloqueo MDM solo se levanta regularizando con LA financiera dueña del equipo, no con otra."),
        ("¿Qué pasa si no pago el celular bloqueado?", "El equipo queda inservible (bloqueo MDM persistente, incluso tras formatear) y el adeudo sigue generando intereses y reporta negativo. En montos sostenidos, la financiera puede ejercer acciones civiles. Recuperar el uso del teléfono pasa por negociar con ella: el taller no puede — ni debe — retirar un bloqueo contractual ajeno."),
        ("¿Cómo sé si mi bloqueo es de financiera y no de otra cosa?", "Señal típica: mensaje permanente de &quot;dispositivo administrado/gestionado&quot; o pantalla de la financiera al encender, que sobrevive al restablecimiento de fábrica. En la revisión gratuita te confirmamos si es MDM de financiera, FRP de cuenta, bloqueo corporativo o una falla técnica disfrazada — cada una tiene camino distinto."),
        ("¿Pueden revisar mi equipo bloqueado antes de que pague?", "Sí, y es útil: verificamos que el bloqueo sea realmente contractual (hay fallas de software que parecen bloqueo y SÍ tienen arreglo técnico), dejamos el equipo listo para entrega segura cuando regularices, y te emitimos constancia del estado del dispositivo. Nunca retiramos bloqueos de financiera: eso solo lo hace la empresa acreedora."),
    ]),
)
body7 = """  <article>
    <header class="hero-doc">
      <span class="eyebrow">Guía honesta · Qué es y qué NO se puede hacer</span>
      <h1>Bloqueo por falta de pago: Payjoy, Macropay y otras financieras — qué hacer si te bloquearon el celular</h1>
      <p class="lead" style="margin-top:14px">Si <b>te bloquearon el celular</b> de la nada y aparece &quot;dispositivo gestionado&quot;, probablemente compraste a crédito y la financiera (<b>Payjoy</b>, <b>Macropay</b> o similar) activó el <b>bloqueo por falta de pago</b>. Aquí te explico qué es exactamente, <b>a qué hora bloquea Macropay</b>, qué relación tiene con Buró, qué NO funciona (ni intenten, por favor) y el único camino real para volver a usar tu equipo.</p>
      <div class="meta">
        <span>Por <b>Rafael Ortiz (&quot;Cubatel&quot;)</b> · 15 años reparando equipos</span>
        <span>·</span>
        <span>Actualizado <b>28 oct 2026</b></span>
        <span>·</span>
        <span>Lectura <b>7 min</b></span>
      </div>
    </header>

    <figure>
      <img src="../../assets/taller.webp" width="1200" height="800" loading="eager" decoding="async" alt="Técnico de TapaTech revisando un celular bloqueado por financiera Payjoy o Macropay en Tapachula">
      <figcaption>Revisión técnica: confirmar que el bloqueo es MDM contractual y no una falla de software que sí tiene arreglo.</figcaption>
    </figure>

    <h2 id="que-es">¿Qué es el bloqueo Payjoy/Macropay? (y cómo se llama realmente)</h2>
    <p>El nombre técnico es <b>bloqueo MDM</b> (Mobile Device Management): la financiera instala un perfil de gestión que le permite <b>inutilizar el equipo remotamente</b> cuando faltas al pago. Es la garantía digital del crédito: firmas que el teléfono es de la financiera hasta que lo liquidas. Por eso:</p>
    <ul>
      <li>Sobrevive al <b>restablecimiento de fábrica</b> — el perfil se reinstala solo al conectar a internet.</li>
      <li>No es una falla: <b>ningún &quot;software milagroso&quot; externo lo quita</b> de forma permanente.</li>
      <li>Solo lo levanta <b>la empresa acreedora</b> al regularizarse el adeudo.</li>
    </ul>

    <h2 id="hora">¿A qué hora se bloquea Macropay o Payjoy?</h2>
    <p>No hay horario público oficial. En la práctica, los cortes se disparan en <b>lotes automáticos de conciliación</b> al vencer tu fecha límite (o unos días después): muchas personas lo descubren de madrugada o temprano en la mañana, al desbloquear la pantalla y encontrar el aviso. Si tu fecha ya venció, asume que puede ocurrir en cualquier momento — y si pagas para librarlo, la liberación también tarda horas en replicarse al equipo (apágalo y enciéndelo con datos/wifi después de pagar).</p>

    <h2 id="adeudo">Si debo en Payjoy, ¿puedo sacar equipo en Macropay? ¿Y viceversa?</h2>
    <p>Son empresas distintas: un adeudo con una no te bloquea automáticamente con la otra. PERO ambas consultan <b>burós de crédito</b> (Circulo de Crédito/Buró) y listas internas, así que un impago fuerte reduce tus posibilidades con cualquiera de las dos, sube tasas o exige garantís. Y ojo: si algún día regularizas y recuperas el equipo, el historial negativo persiste meses. La pregunta correcta no es &quot;¿dónde más me prestan?&quot; sino negociar con quien ya te financió.</p>

    <h2 id="pasa">¿Qué pasa si no pago el celular bloqueado?</h2>
    <ol>
      <li><b>El equipo queda inservible</b> de forma permanente: no es &quot;unos días&quot;; el MDM espera conexión y se reactiva.</li>
      <li><b>La deuda no desaparece:</b> genera intereses moratorios y se reporta negativo.</li>
      <li><b>La financiera puede ejercer acciones legales civiles</b> por el monto; con contratos digitales modernos, es más fácil de lo que la gente cree.</li>
      <li><b>Venderlo no resuelve nada:</b> un equipo MDM bloqueado vale centavos de mercado y quien lo compre tendrá el mismo problema — además del problema legal tuyo.</li>
    </ol>
    <p class="callout"><b>Lo que NO funciona</b> Formatear, apps &quot;quitar bloqueos&quot;, cables chinos de TikTok, &quot;talleres&quot; que cobran $2,000 por &quot;liberarlo&quot;: todo eso o es fraude o es temporal, y varios te dejan el equipo peor. Un bloqueo contractual legítimo solo lo levanta el acreedor. Punto.</p>

    <h2 id="camino">El camino real: regularizar (y cómo te ayudamos en eso)</h2>
    <ol>
      <li><b>Localiza tu contrato</b> (app/correo de la financiera) y el monto exacto con intereses.</li>
      <li><b>Negocia:</b> las financieras suelen tener convenios de pago parcial o reestructura — pide por escrito el acuerdo.</li>
      <li><b>Paga según el acuerdo</b> y solicita la <b>liberación remota del MDM</b> (dales tiempo de replicación).</li>
      <li><b>Si el bloqueo persiste tras liquidar</b> — o si sospechas que tu &quot;bloqueo&quot; es en realidad una falla de software — tráelo: <b>revisión técnica gratuita</b>, constancia del estado del equipo y preparación segura para entregarlo al área técnica de la financiera sin que te muevan nada interno.</li>
    </ol>
    <p>También distinguimos casos confundidos: <a href="/blog/samsung-a17-bloqueado-por-empresa-frp-knox-pago/">bloqueo corporativo Knox/MDM de empresa</a> y <a href="/desbloqueo-legal-celulares-tapachula/">FRP/iCloud con acreditación de propiedad</a> tienen procedimientos distintos al de una financiera.</p>

    <section class="cta">
      <h2>¿No estás seguro de qué tipo de bloqueo trae tu equipo?</h2>
      <p>Mándanos por WhatsApp una foto/video de la pantalla del bloqueo + modelo del equipo. Te confirmamos si es MDM de financiera, bloqueo corporativo o una falla técnica con arreglo real. La orientación es gratis; y si es técnica, lo reparamos aquí mismo.</p>
      <div class="btn-row">
        <a class="btn btn--wa" href="__WA_CTA__" rel="noopener">Revisar mi caso por WhatsApp</a>
        <a class="btn btn--acc" href="/servicio#diagnostico">Agendar revisión en taller</a>
      </div>
    </section>

    <nav class="related" aria-label="Artículos relacionados">
      <h2>Sigue leyendo</h2>
      <ul class="rel-grid">
        <li><a href="/blog/samsung-a17-bloqueado-por-empresa-frp-knox-pago/" data-cat="Bloqueos" rel="nofollow"><b>Samsung bloqueado por empresa (FRP/Knox)</b><span>El otro gran tipo de bloqueo MDM.</span></a></li>
        <li><a href="/desbloqueo-legal-celulares-tapachula/" data-cat="Desbloqueo" rel="nofollow"><b>Desbloqueo legal de celulares</b><span>FRP, iCloud y liberación de línea gratis.</span></a></li>
        <li><a href="/blog/celular-no-enciende-causas-y-soluciones/" data-cat="Diagnóstico" rel="nofollow"><b>No enciende: 8 causas reales</b><span>Descarta una falla técnica disfrazada.</span></a></li>
      </ul>
    </nav>
  </article>"""
page("bloqueo-payjoy-macropay",
     "Bloqueo Payjoy y Macropay por Falta de Pago: Qué Es, A Qué Hora Bloquea y Cómo Resolverlo | TapaTech",
     "Teléfono bloqueado por falta de pago (Payjoy, Macropay): qué es el bloqueo MDM, a qué hora se activa, si debes en una puedes sacar en otra, qué pasa si no pagas y el único camino legal para recuperarlo. Revisión gratis en Tapachula.",
     "bloqueo payjoy, payjoy macropay, bloqueo por falta de pago, telefono bloqueado por falta de pago, me bloquearon el celular, a que hora se bloquea macropay",
     "Bloqueo Payjoy/Macropay: guía honesta — TapaTech",
     u7, sch7, '<span aria-current="page">Bloqueo Payjoy/Macropay</span>', body7.replace("__WA_CTA__", wa_link("Mi celular (modelo ________) apareció bloqueado (creo que Payjoy/Macropay). Adjunto foto del bloqueo. ¿Pueden revisarlo?")), "")

print("\n=== 7 páginas generadas ===")
