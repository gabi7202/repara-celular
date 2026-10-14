# TapaTech — Sitio de reparación de celulares (plantilla lista para cliente)

Sitio de una sola página + blog, **HTML/CSS/JS puro, sin build, sin dependencias, sin terceros**.
Diseñado para convertir por WhatsApp, rankear en Google Maps/búsquedas locales y quedar
**listo para recibir un agente de voz con IA en ~2 meses** sin rehacer nada.

```
Prueba rápida: abre index.html en el navegador. Funciona sin servidor.
Servidor local:  cd sitio-reparacion && python3 -m http.server 8080  → http://localhost:8080
```

---

## 1. Qué hay que cambiar antes de publicar (≈20 minutos)

Todo el sitio se alimenta de **un solo bloque**: `const CONFIG = { … }` al inicio del `<script>`
principal de `index.html` (línea ~1410). Cambia ahí y luego repasa los textos.

| # | Dato | Dónde | Buscar con Ctrl+F |
|---|------|-------|-------------------|
| 1 | Nombre del negocio | `CONFIG.nombre` + `<title>` + logo + footer + JSON-LD | `TapaTech` |
| 2 | Teléfono | `CONFIG.telefono` / `telefonoTxt` + enlaces `tel:` | `529622889585` y `962 288 9585` |
| 3 | WhatsApp | `CONFIG.whatsapp` (solo dígitos, con 52) | `529622889585` |
| 4 | Dominio | `CONFIG.dominio` + canonical + og:url + sitemap + robots | `TU-DOMINIO` |
| 5 | Dirección y referencia | `CONFIG.direccion` + sección Ubicación + footer + JSON-LD | `Quinceava Avenida Sur esq. 18a Calle Oriente, Col. Los Naranjos` |
| 6 | Google Maps | `CONFIG.mapsUrl`, `CONFIG.mapsEmbed` + JSON-LD `hasMap`/`sameAs` | `TU-ENLACE-DE-GOOGLE-MAPS` |
| 7 | Horarios | `CONFIG.horarios` (0=domingo … 6=sábado, formato 24 h) + texto en Ubicación | `horarios` |
| 8 | Coordenadas | JSON-LD `geo` + `og:image` si cambia el mapa | `14.889124` |
| 9 | Redes sociales | `sameAs` del JSON-LD + footer | `TU-PERFIL`, `TU-PAGINA` |
| 10 | Precios | `CATALOGO` (cotizador) + tabla de `#precios` + `datos/servicios.json` | `precios:` |
| 11 | Reseñas | sección `#resenas` — **pon reseñas reales de Google**, con nombre real | `María R.` |
| 12 | Fotos | `assets/hero.webp`, `taller.webp`, `consolas.webp`, `antes-despues.webp`, `og-cover.jpg` | — |

> **Fotos:** las actuales son de ejemplo (IA). Sustitúyalas por fotos reales del local, del técnico
> trabajando y de reparaciones antes/después. Es el cambio que más confianza genera y el que más
> convierte. Exporta a WebP (~1200 px de ancho, calidad 80) y conserva `width`/`height` en el `<img>`
> para no provocar saltos de layout (CLS).

Comando útil para verificar que no quedaron datos de ejemplo:

```bash
grep -rn "TU-DOMINIO\|529622889585\|TU-PERFIL\|TU-PAGINA\|TU-ENLACE\|TapaTech\|Av. Principal" --include="*.html" --include="*.json" --include="*.txt" --include="*.xml" .
```

---

## 2. Estructura de archivos

```
sitio-reparacion/
├── index.html            ← sitio completo: CSS, HTML y JS inline (238 KB → ~65 KB con gzip)
├── admin.html            ← PANEL del taller: leads, filtros, estados, notas, CSV (protegido con PIN)
├── server.js             ← servidor Node SIN dependencias: sitio + API de leads + proxy de IA
├── api/                  ← funciones serverless para Vercel (mismo contrato de API)
│   ├── _lib.js  leads.js  leads/[id].js  stats.js  leads.csv.js  eventos.js  health.js
│   └── chat.js  stt.js  tts.js            ← proxy de Groq (la clave nunca va al navegador)
├── supabase/schema.sql   ← tablas, índices, RLS y vistas para Postgres administrado
├── .env.example          ← GROQ_API_KEY, TTS_WEBHOOK, ADMIN_PIN, SUPABASE_*, LEAD_WEBHOOK
├── favicon.svg (226 B) · manifest.webmanifest · robots.txt · sitemap.xml · vercel.json · 404.html
├── privacidad.html       ← aviso de privacidad (INAI) + tratamiento de datos del equipo
├── terminos.html         ← garantía, exclusiones, abandono de equipo, ética de software
├── datos/
│   ├── servicios.json    ← fuente de verdad de precios/horarios (sitio, panel y agente de voz)
│   ├── agente.json       ← configuración del asistente: voz, modelos, prosodia, límites, escalado
│   └── prompt-agente.md  ← PROMPT MAESTRO de Lupita (edita aquí su personalidad y reglas)
├── blog/
│   ├── index.html
│   └── cuanto-cuesta-cambiar-la-pantalla-de-un-celular-en-tapachula/index.html
├── tools/
│   ├── tts-edge.py       ← webhook TTS GRATUITO con voz neuronal es-MX-DaliaNeural (edge-tts)
│   ├── inject-chrome.py  ← inyecta el mismo encabezado/pie en todas las páginas
│   └── check.py          ← verifica enlaces, navegación, SEO básico y placeholders
└── assets/
    ├── voz.js            ← motor del asistente: STT → Groq → TTS con parser de prosodia
    ├── hero.webp taller.webp consolas.webp antes-despues.webp og-cover.jpg
    ├── demo-lupita.mp3 · demo-lupita-prosodia.mp3 · voz-dalia.mp3 · voz-jorge.mp3  ← muestras de voz
    ├── doc.css (blog y legales) · iconos PWA · qrcode.min.js (referencia)
```

---

## 3. Cambiar precios sin romper nada

Los precios viven en **tres lugares** que deben coincidir:

1. `CATALOGO` (en `index.html`) → alimenta el **cotizador** (motor de cálculo).
2. La **tabla de `#precios`** → es lo que lee Google y el cliente desconfiado.
3. `datos/servicios.json` → lo que consumirá el **agente de voz IA** y cualquier chatbot.

Reglas del motor:

- Cada servicio tiene un rango por **marca**: `precios: { pantalla: { apple:{incell:[1100,1700], premium:[2000,4600]}, … } }`.
- El **modelo** ajusta el rango con `ajustar()`: gama alta (`pro max`, `ultra`, `plus`, `fold`, `s24`…) ×1.18;
  modelos viejos (`iphone 8`, `galaxy j`, `moto e`…) ×0.85; se redondea a múltiplos de $50.
- Los **extras** se suman al final: `CONFIG.extras = { domicilio:120, express:180, respaldo:150 }`.
- El servicio `diag` siempre devuelve `GRATIS`.

Si el cliente cambia de lista de precios: edita los tres archivos y vuelve a correr el test (sección 9).

---

## 4. Analítica (GA4) — activar en 5 minutos

El sitio **ya empuja eventos** a `window.dataLayer`. No carga nada de terceros hasta que tú lo digas,
así que hoy la página tiene 0 peticiones externas y 0 cookies.

Pega esto antes de `</body>` (o donde indica el comentario "ANALÍTICA"):

```html
<script async src="https://www.googletagmanager.com/gtag/js?id=G-XXXXXXXXXX"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', 'G-XXXXXXXXXX', { anonymize_ip: true });
</script>
```

Eventos disponibles (márcalos como **conversión** en GA4):

| Evento | Por qué importa |
|---|---|
| `lead_enviado` | Conversión principal: formulario de pre-diagnóstico completo |
| `boleto_generado` | Intención altísima: el cliente ya quiere ir o pedir recolección |
| `wa_click_hero`, `wa_click_cotizador`, `wa_click_domicilio`, `wa_click_flotante`, `wa_click_dock`, `wa_click_faq`, `wa_click_final` | Conversaciones por sección: te dice qué argumento vende |
| `call_click_*` | Llamadas (configúralo también como conversión) |
| `cotizador_dispositivo`, `cotizador_servicio`, `cotizador_calidad` | Qué se cotiza más y en qué calidad |
| `sintoma_click` | Qué problema trae la gente (útil para campañas y para el blog) |
| `mapa_abrir`, `copiar_direccion` | Intención de ir al local |
| `voice_click` | Uso del futuro agente de voz |

> Alternativa sin Google: [Plausible](https://plausible.io) o [Umami](https://umami.is) autoalojado
> (~1 KB, sin cookies, sin aviso de cookies). Si el cliente quiere privacidad total, es mejor opción.

---

## 5. Base de datos de clientes y panel del taller

El sitio **captura y guarda** cada solicitud con los datos que necesitas para operar:
nombre, celular, correo, tipo de equipo, marca, modelo, falla, detalles, si quiere servicio a
domicilio y su colonia, forma de contacto preferida, fecha y hora de cita, la cotización que vio,
de dónde viene (UTM/referer/página), consentimiento de privacidad y folio.

### Tres modos de funcionamiento (elige uno)

| Modo | Qué necesitas | Dónde quedan los datos | Ideal para |
|---|---|---|---|
| **A. Servidor propio** (`server.js`) | Node ≥ 18 en un VPS, Render, Fly, Railway o tu PC | `data/leads.jsonl` + respaldo diario | Empezar hoy, sin cuentas de terceros |
| **B. Vercel + Supabase** | Cuenta gratis en Supabase + variables de entorno | Postgres administrado con RLS | Sitio en Vercel y datos en la nube |
| **C. Solo WhatsApp** | Nada | Cola en el dispositivo del cliente + WhatsApp | Pruebas o si el cliente aún no decide |

Los tres comparten el mismo contrato de API (`POST /api/leads`), así que puedes empezar en A y
migrar a B sin tocar el sitio. Si ninguno responde, el sitio **encola el lead en `localStorage`
y lo reenvía solo** cuando vuelve la conexión: no se pierde ninguna solicitud.

### Modo A — servidor propio (2 minutos)

```bash
cd sitio-reparacion
ADMIN_PIN=un-pin-largo-y-secreto node server.js      # http://localhost:3000
# panel:  http://localhost:3000/admin.html
# datos:  data/leads.jsonl  (+ data/backup-AAAA-MM-DD.jsonl)
```
Opcionales: `PORT`, `LEAD_WEBHOOK` (Slack, Google Sheets o WhatsApp Cloud API: recibe cada lead al
instante), `CORS_ORIGINS`. En producción ponlo detrás de Caddy/nginx o usa el modo B para tener HTTPS.

### Modo B — Vercel + Supabase

1. Crea un proyecto en [supabase.com](https://supabase.com) y ejecuta `supabase/schema.sql` en *SQL Editor*.
2. Copia la URL del proyecto y la **service_role key** (nunca la expongas en el navegador).
3. En Vercel → *Settings → Environment Variables*: `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`,
   `ADMIN_PIN`, opcional `LEAD_WEBHOOK`.
4. En `index.html` → `CONFIG.db.supabase = { url, anonKey }` con la **anon key** (esta sí es pública;
   gracias a RLS solo permite INSERT, nunca leer datos de otros clientes).
5. Despliega. `api/leads.js`, `api/leads/[id].js`, `api/stats.js`, `api/leads.csv.js`,
   `api/eventos.js` y `api/health.js` quedan disponibles automáticamente.

### Panel del taller (`/admin.html`)

- Pide el **PIN** (guardado en `sessionStorage`, nunca en el código del sitio).
- KPIs: total, hoy, últimos 7 días, diagnósticos, citas, llamadas pedidas, a domicilio, autorizados, perdidos.
- Filtros por tipo, estado, búsqueda libre y "solo sin atender".
- Cambio de **estado** en línea: nuevo → contactado → cotizado → autorizado → en reparación → entregado / perdido.
- **Notas** por folio, botones de WhatsApp y llamada por cliente, borrado, **exportar CSV**,
  refresco automático cada 30 s.
- `robots.txt`, `vercel.json` y el servidor envían `noindex` para `/admin.html`: nunca se indexa.

### API (contrato)

```
POST   /api/leads           { nombre, telefono, equipo, modelo, falla, tipo, … } → 201 { ok, id, folio }
GET    /api/leads?pin=      &tipo=&estado=&desde=&q=&limit=          → { ok, total, leads[] }
PATCH  /api/leads/:id?pin=  { estado?, notas? }                      → { ok, lead }
DELETE /api/leads/:id?pin=                                           → { ok, borrado }
GET    /api/leads.csv?pin=                                           → CSV (Excel/Sheets)
GET    /api/stats?pin=                                               → métricas agregadas
POST   /api/eventos         { event, data }                          → analítica propia (opcional)
GET    /api/health                                                   → { ok, ts, leads }
```
Incluye validación anti-spam (rechaza envíos sin nombre/teléfono), límite de 25 solicitudes por IP
y minuto, respaldo diario y `ETag`/304 para las páginas.

### Qué envía el sitio (tipos de lead)

| Tipo | Se dispara cuando | Datos |
|---|---|---|
| `diagnostico` | Asistente de 3 pasos (falla → modelo → contacto) | completo + consentimiento |
| `cita` | Elige "Agendar cita en el local" con día y hora | + `cita_fecha`, `cita_hora` |
| `callback` | Elige "Prefiero que me llamen" | + teléfono |
| `cotizacion` | Genera un boleto con folio y QR | equipo, modelo, servicio, rango de precio |
| `oferta` | Acepta el modal de descuento | nombre, teléfono, oferta |

El **asistente** valida paso a paso (no deja avanzar con campos vacíos), normaliza el teléfono
(acepta `(962) 123-4567`, `+52 962…`, y lo guarda como 10 dígitos), genera horarios reales a partir
de `CONFIG.horarios` (deshabilita horas pasadas y días cerrados) y al final **abre WhatsApp con el
mensaje ya escrito** con el mismo folio que quedó en la base de datos. Así puedes cruzar
"leads registrados" contra "reparaciones terminadas" y conocer tu tasa de cierre real.

## 5b. Navegación y conversión (qué se mejoró y por qué)

**Navegación**
- Mismo encabezado y pie en **todas** las páginas (home, blog, artículo, privacidad, términos, 404),
  con el prefijo relativo correcto según la profundidad: desde cualquier página puedes ir a
  Servicios, Cotizador, Precios, A domicilio, Proceso, Reseñas, FAQ, Ubicación, Blog, WhatsApp y Agendar.
- Menú móvil con hamburguesa, cierre por `Escape` o tocando fuera, y `aria-expanded` correcto.
- **Scrollspy**: el menú resalta la sección visible.
- Anclas con desplazamiento suave y compensación del encabezado fijo; al entrar desde el blog con
  `../#cotizador` el sitio hace scroll automáticamente al cotizador.
- **Prefetch** de las páginas internas al pasar el cursor: el blog y las legales abren al instante.
- Botón "volver arriba" y barra de progreso de lectura.
- `tools/check.py` verifica que ningún enlace interno esté roto (198 referencias revisadas) y
  `tools/inject-chrome.py` vuelve a sincronizar encabezado/pie si cambias la marca.

**Fluidez y animaciones**
- Solo se animan `transform` y `opacity` (nada de `box-shadow` ni `layout` en cada frame): las sombras
  de las tarjetas son un pseudo-elemento que cambia de opacidad.
- Un único listener de scroll con `requestAnimationFrame` y `passive:true` para progreso + botón
  arriba + parallax de las fichas del hero.
- `content-visibility:auto` en las secciones bajo el pliegue: el móvil renderiza menos y scrollea suave.
- Acordeones (FAQ y mitos) con animación de apertura/cierre real vía Web Animations API.
- **Modo ahorro**: con `prefers-reduced-motion`, `Save-Data`, poca RAM o ≤2 núcleos se desactivan
  animaciones y parallax automáticamente (`html[data-lite="1"]`).
- Cero fuentes web y cero terceros: no hay parpadeo de texto ni bloqueos de render.

**Conversión (17 puntos de contacto)**
1. Header: WhatsApp + Agendar siempre visibles (sticky).
2. Hero: 3 CTAs (cotizar, WhatsApp, ver precios) + teléfono clickeable.
3. Barra fija móvil: Llamar / Cotizar / WhatsApp con `safe-area-inset`.
4. WhatsApp flotante con mensaje precargado.
5. 6 tarjetas de síntoma que precargan el cotizador con un toque.
6. Las 20 filas de servicios son clickeables y llevan al cotizador con ese servicio.
7. Cotizador con rango al instante + "Confirmar por WhatsApp" + boleto con folio y QR.
8. 6 tiras de CTA al final de cada sección, con el mensaje adecuado al contexto.
9. Asistente de 3 pasos (falla → modelo → contacto) con WhatsApp, llamada o **cita con día y hora**.
10. Solicitud de recolección a domicilio con colonia.
11. Modal de oferta por intención de salida (desktop) o 60 % de scroll (móvil), 1 vez por sesión y
    7 días de silencio si lo cierran.
12. Mapa con fachada + "Cómo llegar" y "Copiar dirección".
13. CTA en el pie con WhatsApp, llamada y agendar.
14. Enlaces de reseñas a Google para dejar reseña (prueba social que se retroalimenta).
15. Blog con CTA al cotizador en cada guía.
16. Página 404 con salidas útiles (no deja al visitante atrapado).
17. `tel:` y `wa.me` en todas las páginas, incluidos los legales.

Todo empuja eventos a `dataLayer` (`lead_enviado`, `boleto_generado`, `oferta_aceptada`,
`wa_click_*`, `call_click_*`, `servicio_cotizar`, `wizard_paso`, `cita_*`), así puedes ver qué CTA
convierte y quitar los que estorben.

## 6. Agente de voz con IA ("Lupita") — Groq + STT + TTS neuronal gratis

Ya está **implementado y probado**, no es un espacio reservado. La persona habla por el micrófono
(con permiso del navegador y aviso visible), el sitio transcribe, Groq responde y una voz neuronal
en español de México lee la respuesta **con pausas, ritmo y entonación reales**.

### Arquitectura

```
 micrófono ──▶ STT ──▶ /api/chat (Groq llama-3.3-70b) ──▶ texto con marcas de prosodia ──▶ parser ──▶ TTS ──▶ audio por segmentos
    ▲                   │ herramientas: cotizar, registrar_lead, agendar_cita, estado_abierto,
    └── barge-in ───────┘               verificar_folio, enviar_whatsapp   (se ejecutan en el navegador)
```

| Pieza | Qué se usa | Costo | Dónde se configura |
|---|---|---|---|
| **LLM** | Groq `llama-3.3-70b-versatile` (o `llama-3.1-8b-instant`) | Gratis con límite; luego ~USD $0.05–0.60/M tokens | `datos/agente.json → llm` |
| **STT** | Web Speech API del navegador (Chrome/Edge/Safari, `es-MX`) | $0 | automático |
| **STT respaldo** | Groq `whisper-large-v3-turbo` (Firefox o cuando se quiere precisión) | Gratis con límite | `datos/agente.json → stt` |
| **TTS principal** | Webhook **Edge TTS** con `es-MX-DaliaNeural` (`tools/tts-edge.py`) | **$0** (sin API key) | `TTS_WEBHOOK` o `agente.json → tts.webhook.url` |
| **TTS respaldo** | Groq `playai-tts` | Gratis con límite | `agente.json → tts.groq` |
| **TTS final** | `speechSynthesis` del navegador | $0 | siempre disponible |

El orden se cambia en `datos/agente.json → tts.ordenMotores`. Si el motor neuronal falla, el sitio
**cae solo a la voz del navegador** y, si ni eso, deja la respuesta escrita en pantalla: nunca se
queda callado.

### La voz pedida (perfil verificado)

> Mujer mexicana de 45 a 55 años, tono medio-agudo (nunca grave), simpática y alegre.

`edge-tts` solo tiene **dos** voces es-MX: `es-MX-DaliaNeural` (mujer adulta, cálida) y
`es-MX-JorgeNeural` (hombre). **Dalia es la que cumple el perfil** y queda por defecto.
Muestras generadas con este sistema, listas para escuchar:

- `assets/demo-lupita.mp3` — saludo y cotización (112 KB).
- `assets/demo-lupita-prosodia.mp3` — mismo texto **segmentado**: se oyen los cambios de ritmo en
  precios y direcciones, el tono más alto en la parte alegre y el más bajo en la empática (280 KB).
- `assets/voz-dalia.mp3` / `assets/voz-jorge.mp3` — comparación de las dos voces es-MX.

Para regenerarlas: `python3 tools/tts-edge.py 8055` y luego POST a `/tts`.

### Prosodia: por qué Lupita no habla "de corrido"

El TTS lee plano porque no sabe dónde respirar. La solución es que **el modelo escriba la intención
y el cliente la convierta en audio**. En `datos/prompt-agente.md` el agente tiene obligación de
marcar su respuesta:

| Marca | Efecto | Uso |
|---|---|---|
| `[[p:200]]` `[[p:500]]` `[[p:900]]` | pausa de 200/500/900 ms | antes de un dato, entre ideas, cambio de tema |
| `[[r:0.85]]` / `[[r:1.1]]` | más lento / más rápido | precios, folios, teléfonos, direcciones |
| `[[t:+10]]` / `[[t:-8]]` | sube / baja el tono | entusiasmo, advertencias |
| `[[v:strong]]` / `[[v:soft]]` | énfasis / suavidad | "garantía escrita", empatía |
| `[[e:alegre]]` `[[e:serio]]` `[[e:empatico]]` | preset de emoción (ritmo+tono+volumen) | saludo, políticas, cliente molesto |
| `[[n:digitos]]` | deletrea dígitos y baja el ritmo | teléfonos y folios |
| `[[/]]` | vuelve a la normalidad | cierra cualquier énfasis |

`assets/voz.js` parsea esas marcas y produce segmentos `{text, rate, pitch, volume, pauseAfter}`.
Según el motor activo:

- **Navegador**: una `SpeechSynthesisUtterance` por segmento con su `rate`/`pitch`, y `setTimeout`
  real entre segmentos para las pausas.
- **Webhook Edge**: una petición por segmento con `rate` y `pitch` en notación Edge (`-15%`, `+4Hz`);
  el cliente reproduce los audios en cola respetando `pauseAfter`.
- **SSML**: `TAPATECH_VOZ.aSSML()` genera `<speak xml:lang="es-MX">` con `<prosody>`, `<break time>`
  y `<emphasis>` para Azure/Polly/Google si algún día se cambia de motor.

Detalles que evitan el "leído de corrido": los números se escriben **como se pronuncian** ("de mil
doscientos a mil seiscientos pesos"), las frases tienen máximo ~35 palabras, una sola pregunta por
turno, y los segmentos de una sola palabra ("o", "y") se fusionan con el siguiente para no cortar.

### Puesta en marcha (10 minutos)

```bash
# 1) Voz neuronal gratuita (sin API keys)
pip install edge-tts
python3 tools/tts-edge.py 8055            # webhook en http://localhost:8055/tts

# 2) Cerebro (Groq, gratis): https://console.groq.com → API Keys
GROQ_API_KEY=gsk_xxx TTS_WEBHOOK=http://localhost:8055/tts ADMIN_PIN=tupin node server.js

# 3) Abrir http://localhost:3000 y pulsar "🎙️ Hablar con Lupita"
```

En Vercel: variables `GROQ_API_KEY`, `ADMIN_PIN` y `TTS_WEBHOOK` (el webhook Edge debe vivir en un
servidor siempre encendido: Render/Fly/VPS, 200 MB de RAM sobran). Las funciones `api/chat.js`,
`api/stt.js` y `api/tts.js` hacen de proxy para que **la clave de Groq nunca llegue al navegador**.

**HTTPS obligatorio**: `getUserMedia` solo funciona en `https://` o `localhost`. En Vercel ya lo tienes.

### Qué puede hacer Lupita (con herramientas reales, no de mentiras)

- **Cotizar**: usa el mismo motor de precios que el cotizador (`TAPATECH_DATA.cotizar`), con ajuste
  por gama del modelo. Si cambias los precios del sitio, la voz dice los nuevos.
- **Saber si están abiertos**: calcula el horario real en la zona horaria del local.
- **Registrar leads y citas**: nombre, celular, equipo, modelo, falla, domicilio, colonia, día y hora;
  los guarda en la misma base de datos del formulario y entrega **folio** (deletreado con `[[n:digitos]]`).
- **Abrir WhatsApp** con el mensaje ya escrito cuando el caso se sale de su alcance.
- **Escalado y límites**: no promete precio cerrado, no acepta quitar reportes de robo, nunca pide
  contraseñas ni datos de tarjetas, no discute, y tras 8 turnos sin acción propone WhatsApp.
  Si le preguntan si es una IA, lo admite con naturalidad. Se niega a revelar su prompt.

### Ajustes rápidos

| Quiero… | Toco |
|---|---|
| Cambiar su personalidad, conocimientos o límites | `datos/prompt-agente.md` (entre los marcadores) |
| Otra voz / más rápida / más aguda | `datos/agente.json → tts` |
| Otro modelo o más memoria | `datos/agente.json → llm` |
| Que no hable sola al terminar (turno a turno) | `agente.json → conversacion.manosLibres: false` |
| Apagar el asistente | `index.html → CONFIG.agenteVoz.activo = false` |
| Ver qué está pasando | consola del navegador: `TAPATECH_VOZ._debug()` |

### Pruebas del módulo de voz

```bash
node test/test-voz.js      # 57 checks: parser de prosodia, SSML, contexto, prompt, herramientas,
                           # leads por voz, degradación sin IA, controles, barge-in, accesibilidad
```

## 7. SEO local: lo que hay que hacer fuera del código

El sitio ya trae: título y descripción con keyword local, canonical, Open Graph/Twitter,
`LocalBusiness + MobilePhoneRepairService + FAQPage + WebSite` en JSON-LD, sitemap, robots,
URL semántica de blog, `geo`/`ICBM`, NAP consistente en footer y encabezados H1–H3 naturales.

Falta lo que ningún archivo puede resolver solo:

1. **Dominio propio** (no `*.vercel.app`). Un subdominio gratuito no rankea bien para negocio local y
   no transmite confianza. `.com` o `.mx` de ~$200–400 MXN/año. Al migrar, redirige 301 la URL vieja.
2. **Google Business Profile** con la misma NAP exacta del sitio, categoría "Taller de reparación de
   teléfonos", fotos reales, horarios, y enlace al sitio. Responder todas las reseñas.
3. **Search Console** + envío de `sitemap.xml`; probar las URLs con la herramienta de resultados
   enriquecidos para confirmar que FAQ y LocalBusiness se leen bien.
4. **Reseñas reales**: pedir una reseña por WhatsApp al entregar cada equipo (con enlace directo al
   perfil). 20 reseñas nuevas en 3 meses mueven el mapa más que cualquier cambio en el sitio.
5. **Citaciones locales**: Facebook, Instagram, TikTok, Yelp, Páginas Amarillas, directorios de
   Tapachula — siempre con nombre, dirección y teléfono idénticos.
6. **Contenido**: 1 guía del blog por mes apuntando a búsquedas con intención de compra
   ("cuánto cuesta cambiar pantalla iPhone 13 Tapachula", "reparar Xbox no da imagen Tapachula",
   "mi celular se mojó qué hago"). Enlazar cada guía al cotizador.
7. **Páginas de zona** (cuando haya dominio y tráfico): `/reparacion-de-celulares-tapachula-centro/`,
   `/…-puerto-madero/`, `/reparacion-de-xbox-tapachula/`. Una por servicio+zona, contenido único.

---

## 8. Por qué este sitio es rápido (y los otros no)

| Métrica | Este sitio | Referencia competitiva |
|---|---|---|
| Peticiones críticas | **2** (HTML + hero) | 15–40 (fuentes, CSS externo, analytics, ads, mapas) |
| HTML | 226 KB → **63 KB con gzip** (+304 Not Modified) | 86–113 KB sin comprimir en la respuesta |
| JS de terceros en carga | **0 KB** | gtag 533 KB + AdSense 205 KB + push-ads 5 KB |
| Fuentes web | **0** (system stack) | 2 familias de Google Fonts bloqueando render |
| Mapa de Google | **fachada** (se carga al tocar) ≈ 0 KB inicial | iframe directo ≈ 500 KB–1 MB |
| Imágenes | WebP 26–62 KB, `width`/`height`, lazy + LQIP | PNG 90–600 KB o 0 imágenes |
| Cookies / consentimiento | **No requiere** (0 cookies hasta activar GA4) | Aviso de cookies + AdSense |

Resultado esperado en PageSpeed móvil: **95–100**, LCP < 1.5 s en 4G, CLS 0, TBT bajo.
El servidor propio ya sirve gzip y `ETag` (las visitas repetidas no descargan nada).
(Vercel y Cloudflare Pages sirven gzip/brotli automáticamente; `vercel.json` ya fija caché de 1 año
para `/assets` y HSTS.)

---

## 9. Pruebas (3 suites, todas en verde)

```bash
# 1) 75 verificaciones de comportamiento en jsdom (cotizador, asistente, BD, modal, nav, a11y)
cd "$ARENA_WORKSPACE"
npm i --prefix /tmp/t jsdom          # una sola vez
node test/test-sitio.js < sitio-reparacion/index.html

# 2) Integridad del sitio: enlaces, navegación, SEO básico, JSON-LD, ids duplicados
cd sitio-reparacion && python3 tools/check.py

# 3) Servidor + API + panel (integración real)
ADMIN_PIN=prueba node server.js &    # luego POST/GET/PATCH a /api/leads
```

La suite 1 comprueba, entre otras cosas: JSON-LD parseable, cero scripts externos, cero iframes en
carga inicial, imágenes con dimensiones y `alt`, 20 filas de servicio clickeables, cotizador con
ajuste por modelo, boleto con folio y QR, **asistente de 3 pasos con validación**, teléfono
normalizado, **lead enviado a la API con UTM y consentimiento**, **cola local y reenvío automático
cuando no hay servidor**, modal de oferta con límite de 7 días, acordeones, tabs, tema, mapa con
fachada, datos expuestos para el agente de voz y ausencia de errores de runtime.

## 10. Despliegue

**Vercel** (recomendado, ya incluye `vercel.json`):
```bash
npm i -g vercel
cd sitio-reparacion
vercel            # preview
vercel --prod     # producción
```
Luego: *Settings → Domains* → agrega el dominio del cliente y apunta el DNS (A `76.76.21.21` o
CNAME `cname.vercel-dns.com`). Activa HTTPS automático y HSTS.

**Netlify**: arrastra la carpeta al panel, o `netlify deploy --prod --dir sitio-reparacion`.
Crea un `_redirects` con `/* /404.html 404` si quieres la 404 personalizada.

**Cloudflare Pages** (mejor latencia en LATAM): conecta el repo, build command vacío, output `/`.

**GitHub Pages**: funciona, pero exige que los enlaces relativos apunten a carpetas con `index.html`
(ya es así) y no permite cabeceras de seguridad personalizadas.

Al publicar: cambia `reparaciondecelulares.vercel.app` en `index.html`, `robots.txt`, `sitemap.xml`, blog y legales;
sube el sitemap en Search Console; y si el cliente tenía un sitio viejo (`*.vercel.app`), pon un
**redirect 301** desde ahí para no perder el tráfico y las reseñas ya indexadas.

---

## 10b. Despliegue con base de datos incluida

Si quieres sitio + API + panel en un solo lugar (sin Vercel):

```bash
# VPS con Ubuntu/Debian
scp -r sitio-reparacion user@servidor:/var/www/tapttech
ssh user@servidor
cd /var/www/tapttech
ADMIN_PIN=$(openssl rand -hex 16) PORT=3000 nohup node server.js > server.log 2>&1 &
# mejor: crea un servicio systemd o usa pm2
npm i -g pm2 && ADMIN_PIN=... pm2 start server.js --name tapttech && pm2 save
```
Pon delante Caddy (HTTPS automático) o nginx:

```
# /etc/caddy/Caddyfile
tapttech.mx {
  encode gzip zstd
  reverse_proxy localhost:3000
}
```
Respalda `data/leads.jsonl` (ya se copia solo una vez al día dentro de `data/`).

## 11. Mantenimiento

- **Agregar un artículo al blog**: copia `blog/cuanto-cuesta-…/index.html`, cambia la carpeta por el
  slug, actualiza `<title>`, meta description, canonical, og:url, JSON-LD `Article` (fechas, headline,
  wordCount) y agrega la tarjeta en `blog/index.html` + una línea en `sitemap.xml`.
- **Cambiar horarios**: solo `CONFIG.horarios` + el texto de la sección Ubicación + JSON-LD
  `openingHoursSpecification` + `datos/servicios.json`. El indicador "Abierto ahora" se recalcula solo
  cada minuto con la zona horaria `America/Mexico_City`.
- **Días festivos / vacaciones**: agrega un arreglo `CONFIG.cierres = ['2026-12-25','2027-01-01']` y
  compáralo en `estadoAbierto()` si el cliente lo necesita.
- **Actualizar precios de importación**: sección 3. Considera poner la fecha de vigencia en la tabla
  (`<caption>`) para que el cliente no te reclame precios viejos.

---

## 12. Notas legales y de honestidad (importante)

- **Reseñas**: usa únicamente reseñas reales y enlazables al perfil de Google. Testimonios inventados
  son publicidad engañosa (ilegal en México) y motivo de acción manual de Google.
- **`aggregateRating` en el schema**: viene comentado a propósito. Actívalo solo con reseñas reales y
  `reviewCount` igual al número real de tu perfil.
- **Precios**: el sitio publica rangos y lo declara. Nunca presentes el rango como precio final.
- **Software**: el sitio declara explícitamente que no se retiran reportes de robo ni se clona IMEI.
  Mantén esa política en el mostrador: protege al cliente y al negocio.
- **Datos personales**: `privacidad.html` cubre el flujo real (WhatsApp + endpoint opcional). Si el
  cliente activa el endpoint, debe decir dónde se guardan los leads y quién accede.
- **Accesibilidad**: contraste AA, foco visible, `aria-expanded` en el menú, `details/summary` nativos,
  `prefers-reduced-motion`, textos `alt` descriptivos, barra inferior con `safe-area-inset` para iPhone.
  Si el cliente agrega más secciones, conserva esos patrones.
