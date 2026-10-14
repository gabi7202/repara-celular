# Auditoría: gemeloscell.com vs reparaciondecelulares.vercel.app (TapaTech)

Análisis técnico realizado el 14 de octubre de 2026 descargando el HTML real de ambos sitios,
midiendo respuestas, pesos, terceros, schema, enlaces y rutas internas. Todo lo afirmado aquí se
puede reproducir con `curl`/DevTools.

---

## 1. Fotografía rápida (mediciones reales)

| | **Gemelos Cell** | **TapaTech** | **Este sitio (TapaTech)** |
|---|---|---|---|
| Dominio | Propio (`gemeloscell.com`) | Gratis (`*.vercel.app`) | Propio (configurable) |
| TTFB medido (3 corridas) | **67–73 ms** | 510–540 ms | ~70 ms (mismo hosting) |
| HTML | 111 KB (sin comprimir en respuesta) | 86 KB | 181 KB → **51 KB gzip** |
| CSS | 46 KB inline (0 peticiones) | 71 KB externo (bloqueante) | inline (0 peticiones) |
| JS de terceros | 0 (solo Vercel Analytics 17 KB) | **gtag 533 KB + AdSense 205 KB + push-ads 5 KB** | **0** |
| Fuentes web | 2 familias de Google (bloqueante) | 2 familias (con `media=print`, bien) | **0 (system stack)** |
| Imágenes | 3 PNG: 91 KB + 181 KB + 606 KB | **0 imágenes** | 4 WebP de 26–62 KB + LQIP |
| Mapa | iframe lazy | iframe lazy | **fachada** (0 KB hasta clic) |
| robots.txt / sitemap | **404 / 404** | sí / sí | sí / sí |
| canonical | sí | **no** | sí |
| Open Graph / Twitter | **completo** (ogcard 1200×630) | **ninguno** | completo (og-cover 78 KB) |
| JSON-LD | `LocalBusiness` válido | `@graph` válido pero `image` hotlinked a `z-cdn-media.chatglm.cn` | `LocalBusiness` + `MobilePhoneRepairService` + `WebSite` + `FAQPage` (8 Q) |
| Analítica | Vercel Analytics (sin embudo) | GA4 + AdSense + Search Console | dataLayer listo, GA4 opcional |
| Blog | **no** | sí (3 guías, ~2,700 palabras c/u) | sí (1 guía completa + índice + plan de 8 temas) |
| Reseñas | **3 reales de Google** (nombre, Local Guide, antigüedad) + enlace | 1 sin atribución verificable + "+250 clientes" sin fuente | espacio para reseñas reales enlazadas |
| Aviso de privacidad / términos | **sí / sí** | no / no | sí / sí |
| Cookies / consentimiento | no necesita | aviso + AdSense + prompt de push | no necesita |
| Enlaces rotos | 0 detectados | **`/desbloqueos/` → 404** (en footer y nav) | 0 (verificado por test) |
|keyword stuffing | no | **sí** (meta keywords con 16 variantes, 5× "cerca de mí", emojis en H2/H3) | no |

---

## 2. Gemelos Cell — lo mejor

1. **Marca y diseño premium coherentes** (negro + oro, serif de display, tipografía cuidada). Se ve
   como negocio establecido, no como landing genérica. Eso permite cobrar más.
2. **Autoridad real**: "Desde 2009 / 15 años en Tapachula" y **reseñas verificables de Google** con
   nombre, badge de Local Guide, cantidad de reseñas y antigüedad, enlazadas al perfil de Maps.
   Es el activo de confianza más fuerte de los dos sitios.
3. **SEO técnico de base correcto**: dominio propio, canonical, Open Graph completo con imagen 1200×630,
   `LocalBusiness` con `geo`, `openingHoursSpecification`, `hasOfferCatalog` y `sameAs`. HSTS activo.
4. **Precios publicados con honestidad**: rangos por servicio + descargo explícito ("algunos trabajos
   son más baratos, otros más caros… el diagnóstico gratuito te da el precio exacto"). Baja la
   fricción y filtra al cliente.
5. **Proceso de 4 pasos** que ataca el miedo real (precio sorpresa, tecnicismos, tiempo).
6. **FAQ que responde objeciones de compra**, no dudas de relleno: garantía, piezas originales vs
   genéricas, tiempos, cita, y "¿qué pasa si no pueden repararlo?" (respuesta: no cobramos nada).
7. **Portafolio amplio** (celulares, laptops, consolas y drones) → capta más mercado por visita.
8. **Peso y limpieza**: 111 KB de HTML, CSS inline, cero publicidad, cero cookies, cero popups.
   TTFB de 70 ms: la respuesta más rápida de los dos.
9. Cumple con **aviso de privacidad y términos**.

## 3. Gemelos Cell — lo peor

1. **Sin robots.txt ni sitemap.xml** (404 ambos). Sin blog ni páginas de servicio/zona: solo puede
   rankear por marca y por "reparación de celulares Tapachula" genérico. Pierde todo el tráfico
   informacional ("cuánto cuesta cambiar pantalla iPhone 13", "mi celular se mojó").
2. **Formulario que miente**: al enviar muestra "Recibimos tu mensaje. Te contactamos en menos de
   2 horas por WhatsApp", pero no hay backend: solo construye un enlace de WhatsApp. Si el usuario no
   presiona enviar en WhatsApp, **el lead se pierde y nadie se entera**. Además de ser deshonesto,
   no deja registro medible.
3. **Sin medición de negocio**: solo Vercel Analytics. No hay GA4, ni eventos de conversión, ni
   llamadas, ni clics de WhatsApp. No se puede optimizar lo que no se mide.
4. **Imágenes mal optimizadas y escasas**: logo PNG de 91.5 KB usado además como favicon (debería ser
   SVG de ~1 KB), ilustración PNG de 181 KB, ogcard de 606 KB. Nada en WebP/AVIF. Y **no hay fotos
   reales**: ni del local, ni del técnico, ni de un antes/después. Un taller vive de prueba visual.
5. **Google Fonts bloqueante** (Cormorant + Montserrat) sin `font-display` ni truco de carga diferida.
6. **No tiene cotizador**: el cliente debe escribir para saber un precio. Fricción alta en móvil,
   que es el 90% del tráfico local.
7. **No ofrece servicio a domicilio**, que hoy es un diferenciador real en la zona.
8. Contadores animados que muestran "0+" / "$0" sin JavaScript (el valor real está en `data-target`):
   detalle menor, pero degrada la lectura sin JS y la de algunos crawlers.
9. Una sola URL: sin `/reparacion-de-pantallas-tapachula`, sin `/reparacion-de-xbox-tapachula`,
   sin páginas de colonia. Techo de SEO muy bajo.
10. Sin favicon propio (404 en `/favicon.ico` y `/favicon.svg`), sin manifest, sin modo oscuro,
    sin PWA.

## 4. TapaTech — lo mejor

1. **Cotizador interactivo** (marca → modelo → servicio → calidad de pantalla → extras) con rango de
   precio en segundos. Es la mejor idea de los dos sitios: convierte curiosos en conversaciones.
2. **Boleto con folio y QR descargable** que confirma la cotización. Piensa en la operación real del
   taller (mostrador, mensajero, seguimiento) y no solo en la web.
3. **Pre-diagnóstico de software** que genera el mensaje de WhatsApp ya estructurado (marca, modelo,
   tipo de bloqueo, detalles). Baja el trabajo de atención y sube la calidad del lead.
4. **Servicio de recolección a domicilio por $100** y un ángulo de copy brillante: *"¿atrapado en el
   trabajo bajo la mirada de tu jefe?"*. Diferenciador concreto y bien vendido.
5. **Tabla Premium (OLED) vs económica (Incell)** con color, consumo, brillo y relación calidad-precio:
   educa, justifica precio y evita reclamos.
6. **Sección de mitos** (contraseñas, "se dañó la lógica", pantallas baratas, arroz) → construye
   autoridad y desarma a la competencia informal.
7. **Blog real con 3 guías largas** y enlaces internos: la única apuesta de contenido de los dos.
8. **SEO operativo**: robots.txt, sitemap.xml, `google-site-verification`, GA4, `@graph` con
   `MobilePhoneRepairService` + `FAQPage`, fuentes con `media="print" onload` + `noscript`,
   HSTS con `preload`, `X-Frame-Options`.
9. **Accesibilidad superior en marcado**: 45 atributos `aria-*` y 38 `<button>` semánticos (Astro +
   Tailwind bien usados), más consentimiento de cookies.
10. Copy con ángulos de venta específicos: 40–60 minutos, servicio express, "abierto hoy", cobertura
    en la costa de Chiapas, ética explícita (no quitan reportes de robo).

## 5. TapaTech — lo peor (varios puntos son graves)

1. **Monetización de push/ads de terceros inyectada en el sitio**: `<meta name="pushsdk">`, script
   `//zjkdy.com/0d2/9e2b1/mw.min.js` con *service worker* de permisos y **redirección a `rm358.com`**
   cuando el usuario acepta. Esto es el patrón clásico de *rogue push / malvertising*: llena al
   visitante de notificaciones basura y puede redirigirlo a páginas de fraude. Riesgo real de que
   **Chrome Safe Browsing marque el dominio**, de que Google Ads lo suspenda y de que el cliente
   final pierda el teléfono "por culpa del taller". Es lo más dañino de los dos sitios.
2. **AdSense (`ca-pub-…`, 205 KB)** en el sitio de un negocio local: añade peso, compite visualmente
   con el servicio y hace que la página parezca granja de contenido, no taller.
3. **Dominio gratuito `*.vercel.app`**: sin marca, sin confianza, y los subdominios de plataforma
   compiten mal en búsquedas locales. Además el nombre (`reparaciondecelulares`) es keyword exacta,
   lo que hoy ya no ayuda y se ve spammy.
4. **Cero Open Graph y cero Twitter Cards, y sin canonical**. Para un negocio que cierra por WhatsApp
   es un error caro: cada enlace compartido sale sin imagen, sin título y sin descripción.
5. **Cero imágenes en toda la home** (0 etiquetas `<img>`): ni local, ni técnico, ni antes/después.
   Y la única imagen declarada en el JSON-LD está **hotlinkeada a `z-cdn-media.chatglm.cn`** (CDN de
   un modelo de IA chino): no es suya, puede desaparecer y rompe el rich result.
6. **Keyword stuffing**: meta `keywords` con 16 variantes de "reparación de celulares cerca de mi",
   5 repeticiones de "cerca de mí" en el cuerpo, H2/H3 con emojis (📍🕒📱) y frases forzadas. El meta
   keywords no sirve para nada y el resto es señal de spam para Google y de baja calidad para el
   usuario.
7. **Enlace roto**: `/desbloqueos/` aparece en el nav y en el footer y devuelve **404**.
8. **Peso y peticiones reales**: HTML 86 KB + CSS externo 71 KB + islas JS (LandingPage, client,
   GlobalPromoPopup, CookieConsent) + gtag 533 KB + AdSense 205 KB + push 5 KB + 2 familias de
   fuentes + iframe de Maps ≈ **>1 MB y 15+ peticiones**, con TTFB de medio segundo.
9. **Prueba social floja**: un solo testimonio sin enlace verificable a Google, firmado
   "Carlos Ruiz, Fracc. Las Flores", y "+250 Tapachultecos satisfechos" sin fuente. Al lado de las
   reseñas reales de Gemelos, pierde la comparación.
10. **Popups apilados** (promo global + consentimiento de cookies + prompt de push) sobre una
    experiencia móvil que debería ser de un solo toque.
11. **Sin aviso de privacidad ni términos**, aunque pide nombre, teléfono, modelo y falla del equipo.
12. Blog sin `canonical` ni schema `Article` → se desperdician rich results y se arriesga duplicidad.
13. Detalle que revela cómo se construyó: el primer script del `<head>` es un "parche de robustez"
    que redefine `window.fetch` "para el sandbox del iframe". Código defensivo de preview, no de
    producto.
14. Errores de redacción y tono ("concéntrense en sus labors!", "Exelente") que restan profesionalismo.

---

## 6. Cómo el sitio nuevo toma lo mejor de cada uno y corrige lo peor

| Área | Lo mejor rescatado | Cómo se mejora |
|---|---|---|
| **Precio** | Cotizador interactivo + tabla Incell/OLED (TapaTech) y rangos honestos publicados (Gemelos) | Cotizador con 3 dispositivos (celular/laptop/consola), 20+ servicios, ajuste por gama del modelo, extras sumables, **boleto con folio + QR generado localmente** (SVG de 65 KB en vez de 220 KB) y descarga/impresión |
| **Confianza** | Reseñas reales de Google (Gemelos) + mitos y ética (TapaTech) | Sección de **6 promesas verificables** (nunca pedimos contraseña, pieza vieja devuelta, fotos antes/después, precio cerrado, garantía escrita, si no se repara no pagas) + espacio para reseñas **enlazables** y `aggregateRating` desactivado hasta tener datos reales |
| **Diferenciador** | Recolección a domicilio (TapaTech) | Sección propia con **proceso de 4 pasos, zonas de cobertura, pago contra entrega y boleto del mensajero**, más CTA dedicados y evento de tracking |
| **Alcance** | Multidispositivo (Gemelos: drones/consolas) | Tabs de **celulares, laptops y consolas (Xbox/PS/Switch)** con 21 servicios y precios; drones quedan fuera a propósito (mejor foco que diluir) |
| **SEO** | Blog + robots/sitemap + GA4 (TapaTech) y dominio/canonical/OG/schema (Gemelos) | Todo junto: canonical, OG/Twitter con `og-cover.jpg` propio, `LocalBusiness+MobilePhoneRepairService+WebSite+FAQPage`, sitemap con imágenes, robots, blog con `Article`+`BreadcrumbList`+`FAQPage`, URL semántica, geo/ICBM, **sin stuffing** y sin meta keywords |
| **Velocidad** | CSS inline (Gemelos) + fuentes diferidas (TapaTech) | **0 terceros, 0 fuentes web, 2 peticiones críticas**, WebP con `width/height` + LQIP, mapa como fachada, favicon SVG de 226 B, HTML de 181 KB → **51 KB gzip** |
| **Captura de leads** | Mensaje de WhatsApp estructurado (TapaTech) | Formulario con validación visible, **mensaje de éxito que no miente**, respaldo en `localStorage`, `leadEndpoint` opcional (Vercel Function / Apps Script / Formspree) y **folio compartido** entre boleto, WhatsApp y lead para medir cierre |
| **Medición** | GA4 (TapaTech) | `dataLayer` con **18+ eventos de conversión** ya cableados; GA4 se activa pegando un snippet. Sin AdSense ni push-ads, así que no hace falta banner de cookies |
| **Accesibilidad** | `aria-*` y botones semánticos (TapaTech) | Skip link, foco visible, `aria-expanded`/`aria-selected` en menú y tabs, `details/summary` nativos, `role="status"` en mensajes, `prefers-reduced-motion`, contraste AA, dock inferior con `safe-area-inset` |
| **Legal** | Privacidad y términos (Gemelos) | `privacidad.html` con sección específica sobre **acceso al dispositivo y contraseñas** (riesgo real del gremio) y `terminos.html` con garantía, exclusiones, abandono de equipo y ética de software |
| **Futuro** | — | **Agente de voz IA preparado**: slot `#voicePanel/#voiceMount`, `CONFIG.agenteVoz`, `window.TAPATECH_DATA` y `datos/servicios.json` como fuente de verdad compartida entre cotizador, web, teléfono y WhatsApp |
| **Riesgos** | — | Sin scripts de terceros: **se eliminan el push-ads y el AdSense** (el mayor riesgo de TapaTech) y el hotlink a CDN ajeno |

---

## 7. Plan de ejecución sugerido (para presentar al cliente)

**Semana 1 — Base**
1. Comprar dominio propio y desplegar (Vercel/Cloudflare Pages) con HTTPS + HSTS.
2. Sustituir los 12 datos del `CONFIG`, redes y Google Maps.
3. Sesión de fotos real: fachada, mostrador, técnico trabajando, 6 antes/después, piezas.
   Exportar a WebP y reemplazar las imágenes de ejemplo.
4. Pedir 10 reseñas a clientes de los últimos 30 días y publicar 3 en el sitio (con enlace).
5. Activar GA4 y marcar `lead_enviado`, `boleto_generado` y `wa_click_*` como conversiones.

**Semana 2 — SEO local**
6. Google Business Profile completo con fotos, horarios y enlace; responder reseñas antiguas.
7. Search Console + sitemap; validar FAQ y LocalBusiness en Rich Results Test.
8. Citaciones: Facebook, Instagram, TikTok, directorios locales (NAP idéntica).
9. Redirect 301 desde cualquier sitio anterior.

**Mes 2 — Contenido y captación**
10. Publicar 2 guías del plan de 8 temas, cada una enlazando al cotizador.
11. Crear páginas de servicio+zona (`/reparacion-de-pantallas-tapachula-centro/`, `/reparacion-de-xbox-tapachula/`).
12. Activar `leadEndpoint` (Vercel Function + Google Sheets) y un reporte semanal de leads.
13. Campaña local: Google Ads a "reparación de pantallas tapachula" + publicación semanal de
    antes/después en redes con enlace al cotizador.

**Mes 3 — Agente de voz IA (segunda fase del contrato)**
14. Elegir proveedor (Vapi/Retell para rapidez; LiveKit/Pipecat para control).
15. Generar la base de conocimiento desde `datos/servicios.json`.
16. Widget web (`activo:true` + `widgetSrc`) y número telefónico con el mismo asistente.
17. Habilidades: cotizar, agendar recolección, estado de folio, escalar a humano.
18. Permitir micrófono en `Permissions-Policy` y medir `voice_click` / `voice_agendado`.

---

## 8. Verificación de lo afirmado

```bash
# robots/sitemap de la competencia
curl -I https://gemeloscell.com/robots.txt      # 404
curl -I https://gemeloscell.com/sitemap.xml     # 404
curl -s https://reparaciondecelulares.vercel.app/robots.txt   # 200
curl -I https://reparaciondecelulares.vercel.app/desbloqueos/ # 404 (enlace en el footer)

# terceros y monetización en TapaTech
curl -s https://reparaciondecelulares.vercel.app | grep -o "pushsdk[^>]*"
curl -s https://reparaciondecelulares.vercel.app | grep -o "zjkdy.com[^']*"
curl -s https://reparaciondecelulares.vercel.app | grep -o "ca-pub-[0-9]*"

# ausencia de Open Graph en TapaTech / presencia en Gemelos
curl -s https://reparaciondecelulares.vercel.app | grep -c 'property="og:'   # 0
curl -s https://gemeloscell.com | grep -c 'property="og:'                   # 8

# imágenes
curl -s https://reparaciondecelulares.vercel.app | grep -c '<img'           # 0
curl -sI https://gemeloscell.com/logo.png | grep -i content-length          # 93,743 B
curl -sI https://gemeloscell.com/ogcard.png | grep -i content-length        # 620,782 B

# suite de 61 verificaciones del sitio nuevo
node test/test-sitio.js < sitio-reparacion/index.html
```

---

## 9. Versión 2 del sitio propio (lo que se añadió sobre la v1)

Sobre la base ya descrita, se agregaron cuatro bloques que atacan directamente los puntos débiles
de los dos competidores:

**Navegación unificada y verificada**
- Encabezado y pie idénticos en las 7 páginas (home, blog, artículo, privacidad, términos, 404, panel),
  con prefijos relativos correctos por profundidad → cualquier enlace abre desde cualquier página.
- Menú móvil con hamburguesa + `aria-expanded`, cierre con Escape o toque fuera.
- Scrollspy (resalta la sección activa), anclas suaves con compensación del header fijo,
  scroll automático al entrar con `#seccion` desde el blog, prefetch de páginas internas al hover,
  botón "volver arriba" y barra de progreso de lectura.
- `tools/check.py` revisa 198 referencias internas: **0 enlaces rotos** (contra el `/desbloqueos/` 404
  de TapaTech) y `tools/inject-chrome.py` resincroniza encabezado/pie si cambia la marca.

**Fluidez y animación**
- Solo se animan `transform`/`opacity`; las sombras de tarjetas son pseudo-elementos con transición
  de opacidad (evita repintar en cada hover).
- Un único listener de scroll con `requestAnimationFrame` y `passive:true` alimenta progreso +
  botón arriba + parallax del hero.
- `content-visibility:auto` en secciones bajo el pliegue → menos trabajo de render en móvil.
- Acordeones de FAQ y mitos con animación real de apertura y cierre (Web Animations API).
- **Modo ahorro automático**: con `prefers-reduced-motion`, `Save-Data`, ≤2 GB de RAM o ≤2 núcleos
  se desactivan animaciones y parallax (`html[data-lite="1"]`).
- Cero fuentes web y cero terceros: sin parpadeo de texto ni bloqueo de render.
- Red de seguridad: si `IntersectionObserver` falla, todo el contenido se muestra a los 2.6 s.

**Conversión (17 puntos de contacto medibles)**
- Header sticky con WhatsApp + Agendar; hero con 3 CTAs y teléfono clickeable; barra fija móvil
  (Llamar/Cotizar/WhatsApp); WhatsApp flotante; 6 tarjetas de síntoma que precargan el cotizador;
  **las 20 filas de servicios son clickeables** y llevan al cotizador con ese servicio; 6 tiras de CTA
  al final de cada sección con mensaje contextual; boleto con folio + QR + "enviar por WhatsApp";
  mapa con "cómo llegar" y "copiar dirección"; CTA en pie; CTA en blog y en 404.
- **Modal de oferta** por intención de salida (desktop) o 60 % de scroll (móvil): una vez por sesión,
  7 días de silencio si lo cierran, validación propia y lead registrado.

**Base de datos y panel del taller**
- Asistente de 3 pasos (falla → modelo y domicilio → contacto) que captura nombre, celular, correo,
  equipo, marca, modelo, falla, detalles, colonia, forma de contacto, **cita con día y hora**,
  consentimiento, UTM/referer/página y folio.
- Normalización de teléfono mexicano, validación por paso, horarios generados desde `CONFIG.horarios`
  (deshabilita horas pasadas y días cerrados).
- Tres modos de guardado: `server.js` (Node sin dependencias + JSONL + respaldo diario),
  Vercel + Supabase (Postgres con RLS, `supabase/schema.sql`), o cola en `localStorage` con reenvío
  automático cuando no hay servidor: **no se pierde ningún lead**.
- API completa (`POST/GET/PATCH/DELETE /api/leads`, `/api/leads.csv`, `/api/stats`, `/api/eventos`,
  `/api/health`) con PIN, validación anti-spam y límite de 25 envíos por IP y minuto.
- `/admin.html`: KPIs, filtros, búsqueda, cambio de estado, notas, WhatsApp/llamada por cliente,
  exportar CSV, refresco cada 30 s y `noindex` en robots, cabeceras y servidor.
- Cada cotización generada en el boleto también se registra (`tipo: cotizacion`), así el taller ve la
  demanda aunque el cliente no deje sus datos.

**Verificación**: 75 pruebas de comportamiento en jsdom en verde, 0 errores de enlaces, integración
real de API probada (crear, listar, filtrar, buscar, actualizar, borrar, CSV, stats, 401/400/429),
gzip de 226 KB → **61 KB** y `304 Not Modified` en visitas repetidas.

---

## 10. Versión 3 — datos reales del cliente y agente de voz con IA

**Datos aplicados en todo el sitio** (index, blog, legales, panel, manifest, sitemap, schema, JSON):
marca **TapaTech**, teléfono/WhatsApp **+52 962 288 9585**, dirección **Quinceava Avenida Sur esq.
18a Calle Oriente, Col. Los Naranjos, 16 de Septiembre, C.P. 30705, Tapachula de Córdova y Ordóñez,
Chiapas**, coordenadas 14.889124/-92.258130, horario **lunes a sábado 9:00–19:00 corrido** (domingo
solo urgencias por WhatsApp), folios con prefijo `TT-`, imagen OG regenerada con la marca.

**Agente de voz "Lupita" (implementado, no maquetado)**
- Perfil solicitado: mujer mexicana de 45–55 años, tono medio-agudo (nunca grave), simpática y alegre.
  Verificado con el motor: Edge TTS solo ofrece dos voces es-MX y `es-MX-DaliaNeural` es la que cumple.
  Muestras reales generadas: `assets/demo-lupita.mp3`, `assets/demo-lupita-prosodia.mp3`,
  `assets/voz-dalia.mp3` y `assets/voz-jorge.mp3` (comparativa).
- Flujo: micrófono con permiso explícito y aviso visible → STT (Web Speech API `es-MX`, o Groq
  Whisper cuando el navegador no la trae) → Groq `llama-3.3-70b-versatile` con el prompt maestro →
  parser de prosodia → TTS neuronal por segmentos → reproducción en cola con pausas reales.
- **Prosodia**: el prompt obliga a marcar la respuesta (`[[p:500]]`, `[[r:0.85]]`, `[[t:+10]]`,
  `[[v:strong]]`, `[[e:alegre]]`, `[[n:digitos]]`, `[[/]]`) y `assets/voz.js` las convierte en pausas,
  ritmo y tono según el motor (utterances encadenadas, peticiones por segmento con `rate`/`pitch`, o
  SSML `<prosody>`/`<break>`/`<emphasis>`). Los números se escriben como se pronuncian.
- **Herramientas reales**: `cotizar` (mismo motor de precios que el cotizador), `estado_abierto`,
  `registrar_lead` (guarda en la BD con folio), `agendar_cita` (valida horario real),
  `verificar_folio` y `enviar_whatsapp`.
- **Seguridad**: la clave de Groq vive solo en el servidor (`/api/chat`, `/api/stt`, `/api/tts`);
  el agente no promete precio cerrado, no acepta quitar reportes de robo, nunca pide contraseñas
  ni datos de tarjeta, admite ser una IA si le preguntan y no revela su prompt.
- **UX**: subtítulos en vivo, barge-in (se calla si la interrumpes), manos libres o turno a turno,
  silencio/mute, velocidad, notificaciones cuando la pestaña está oculta, botón "Escuchar a Lupita",
  espacio para cerrar con Escape y degradación elegante si no hay IA configurada.
- **Pruebas**: 57 checks específicos del módulo (parser, SSML, contexto, prompt, herramientas,
  leads por voz, degradación, controles) + 76 del sitio + 0 enlaces rotos + integración real del
  servidor (TTS neuronal devolviendo MP3, 503 claros sin clave, leads visibles en el panel).
