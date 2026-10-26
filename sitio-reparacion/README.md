# TapaTech — Sitio de reparación de celulares (plantilla lista para cliente)

Sitio de una sola página + blog, **HTML/CSS/JS puro, sin build, sin dependencias, sin terceros**.
Diseñado para convertir por WhatsApp y rankear en Google Maps/búsquedas locales. Incluye a Lupita,
un asistente de voz con IA que opera mediante la API de Groq.

```
Prueba rápida: abre index.html en el navegador. Funciona sin servidor.
Servidor local: ejecuta `npm run dev` dentro de `sitio-reparacion` → http://127.0.0.1:3000
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
| 6 | Google Maps | `CONFIG.mapsUrl`, `CONFIG.mapsEmbed` + JSON-LD `hasMap` | `TU-ENLACE-DE-GOOGLE-MAPS` |
| 7 | Horarios | `CONFIG.horarios` (0=domingo … 6=sábado, formato 24 h) + texto en Ubicación | `horarios` |
| 8 | Coordenadas | JSON-LD `geo` + `og:image` si cambia el mapa | `14.889124` |
| 9 | Redes sociales | Facebook de Rafael Ortiz está enlazado en el footer y en `founder.sameAs`; añade otros perfiles solo al verificarlos | `TU-PERFIL`, `TU-PAGINA` |
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
├── favicon.svg (226 B) · manifest.webmanifest · robots.txt · sitemap.xml · llms.txt · vercel.json · 404.html
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
ADMIN_PIN=un-pin-largo-y-secreto node server.js      # http://127.0.0.1:3000
# panel:  http://127.0.0.1:3000/admin.html
# datos:  data/leads.jsonl  (+ data/backup-AAAA-MM-DD.jsonl)
```
Opcionales: `PORT`, `HOST` (por defecto `127.0.0.1`; configura `0.0.0.0` si el servidor debe
aceptar conexiones de otros equipos), `LEAD_WEBHOOK` (Slack, Google Sheets o WhatsApp Cloud API:
recibe cada lead al instante), `CORS_ORIGINS`. En producción ponlo detrás de Caddy/nginx o usa el
modo B para tener HTTPS.

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
11. Aviso centrado de recolección a domicilio después de avanzar 480 px o 65 % de la altura visible,
    una vez por sesión y con 24 horas de silencio si se cierra.
12. Mapa con fachada + "Cómo llegar" y "Copiar dirección".
13. CTA en el pie con WhatsApp, llamada y agendar.
14. Enlaces de reseñas a Google para dejar reseña (prueba social que se retroalimenta).
15. Blog con CTA al cotizador en cada guía.
16. Página 404 con salidas útiles (no deja al visitante atrapado).
17. `tel:` y `wa.me` en todas las páginas, incluidos los legales.

Todo empuja eventos a `dataLayer` (`lead_enviado`, `boleto_generado`, `oferta_aceptada`,
`wa_click_*`, `call_click_*`, `servicio_cotizar`, `wizard_paso`, `cita_*`), así puedes ver qué CTA
convierte y quitar los que estorben.

## 6. Agente de voz con IA ("Lupita") — Groq + STT + Edge TTS

Ya está **implementado y probado**, no es un espacio reservado. La persona habla por el micrófono
(con permiso del navegador y aviso visible), el sitio transcribe, Groq responde y una voz neuronal
en español de México lee la respuesta.

### Arquitectura

```
 micrófono ──▶ STT ──▶ /api/chat (Groq openai/gpt-oss-20b) ──▶ texto puntuado ──▶ /api/tts (Edge TTS) ──▶ audio
    ▲                   │ herramientas: cotizar, registrar_lead, agendar_cita, estado_abierto,
    └── barge-in ───────┘               verificar_folio, enviar_whatsapp   (se ejecutan en el navegador)
```

| Pieza | Qué se usa | Costo | Dónde se configura |
|---|---|---|---|
| **LLM** | Groq `openai/gpt-oss-20b` (respaldo `openai/gpt-oss-120b`) | Según límites y precios actuales de Groq | `GROQ_CHAT_MODEL` o `datos/agente.json → llm` |
| **STT** | Web Speech API del navegador (Chrome/Edge/Safari, `es-MX`) | $0 | automático |
| **STT respaldo** | Groq `whisper-large-v3-turbo` (Firefox o cuando se quiere precisión) | Gratis con límite | `datos/agente.json → stt` |
| **TTS principal** | Webhook **Edge TTS** con `es-MX-DaliaNeural` (`tools/tts-edge.py`) | **$0** (sin API key) | `TTS_WEBHOOK` |
| **TTS respaldo** | Voz de lectura del navegador (`speechSynthesis`) | $0 | navegador |

Edge recibe el texto completo en una sola petición, conservando comas y puntos para sus pausas y los
signos `¿...?` y `¡...!` para la entonación. No se usa PlayAI ni otro TTS de pago; si Edge falla, el
navegador habla como respaldo y la respuesta escrita permanece visible.

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

Para que la voz suene natural, el prompt pide frases cortas y puntuación ortográfica: comas para
pausas breves, puntos entre ideas, y signos de apertura/cierre en preguntas y exclamaciones. Los
números se escriben como se pronuncian ("de mil doscientos a mil seiscientos pesos").

### Puesta en marcha

```bash
# 1) Voz neuronal gratuita (sin API keys)
pip install edge-tts
python3 tools/tts-edge.py 8055            # webhook en http://localhost:8055/tts

# 2) Crea una clave nueva en https://console.groq.com → API Keys y configúrala localmente.
#    Nunca pegues claves en el código ni en el chat; usa .env local (ignorado por Git).
#    La clave que se compartió durante la configuración debe revocarse antes de usar Lupita.
GROQ_API_KEY=tu_clave_nueva GROQ_CHAT_MODEL=openai/gpt-oss-20b TTS_WEBHOOK=http://localhost:8055/tts ADMIN_PIN=tu_pin_seguro node server.js

# 3) Abrir http://localhost:3000 y pulsar "🎙️ Hablar con Lupita"
```

En Vercel, `.env` no se importa automáticamente: añade `GROQ_API_KEY`, `GROQ_CHAT_MODEL` y
`ADMIN_PIN` en *Project → Settings → Environment Variables* y vuelve a desplegar. Para conservar
Edge TTS, `TTS_WEBHOOK` debe apuntar a un endpoint HTTPS público alojado aparte; Vercel no inicia
el servicio Python. Sin él, el servidor intenta su TTS de respaldo. Las funciones `api/chat.js`,
`api/stt.js` y `api/tts.js` hacen de proxy para que **la clave de Groq nunca llegue al navegador**.

**HTTPS obligatorio**: `getUserMedia` solo funciona en `https://` o `localhost`. En Vercel ya lo tienes.

### Qué puede hacer Lupita (con herramientas reales, no de mentiras)

- **Cotizar**: usa el mismo motor de precios que el cotizador (`TAPATECH_DATA.cotizar`), con ajuste
  por gama del modelo. Si cambias los precios del sitio, la voz dice los nuevos.
- **Saber si están abiertos**: calcula el horario real en la zona horaria del local.
- **Registrar leads y citas** solo después de una autorización afirmativa explícita: nombre, celular,
  equipo, modelo, falla y datos de la solicitud. Entrega un folio únicamente cuando la API confirma
  que se guardó. En Vercel, configura Supabase o `LEAD_WEBHOOK` para no depender de almacenamiento
  efímero.
- **Preparar WhatsApp** con un mensaje listo; el visitante debe tocar el enlace visible para abrirlo.
- **Escalado y límites**: no promete precio cerrado, no acepta quitar reportes de robo, nunca pide
  contraseñas ni datos de tarjetas, no insiste tras una negativa y finaliza tras 8 turnos sin acción.
  Las notificaciones no se solicitan automáticamente y no hay seguimiento programado después de cerrar
  el sitio. Notificaciones web requieren permiso previo del visitante; cualquier seguimiento comercial
  futuro debe implementarse con consentimiento explícito y un canal de envío real.
  Si le preguntan si es una IA, lo admite con naturalidad. Se niega a revelar su prompt.

### Límite de Groq (429) y prompt duplicado — corregido

El plan gratuito de Groq permite **8 000 TPM por modelo** en `gpt-oss-20b`. El
navegador enviaba `datos/prompt-agente.md` como `sistema` y el servidor añadía
el mismo prompt otra vez: una sola petición pesaba ~9 000 tokens, así que Groq
respondía **429 en cada turno** (el síntoma era "Lupita no tiene la IA").

Ahora:

- El prompt vive **solo en el servidor** (`api/chat.js` y `server.js`); el
  navegador ya no lo descarga ni lo reenvía.
- `componerSistema()` descarta una copia del maestro si un cliente antiguo
  todavía la manda, para no volver a duplicar tokens.
- El orden es estable (prompt → contexto) para que el **caché de Groq**
  descuente la parte repetida; los tokens cacheados no consumen TPM.
- Si un modelo agota su cupo, `api/_groq.js` pasa al respaldo
  `openai/gpt-oss-120b` (cada modelo tiene su propio TPM) y recuerda el que
  funcionó para los siguientes turnos.
- `GET /api/health` ahora informa `version`, `modelo_chat`,
  `modelos_respaldo`, `prompt` y `tts`, sin exponer la clave.

Para comprobar el deploy después de subir cambios:

```bash
curl https://TU-DOMINIO.vercel.app/api/health
# version: 2026-10-26-chat-tpm, prompt.ok: true, modelos_respaldo: [...]
```

### Ajustes rápidos

| Quiero… | Toco |
|---|---|
| Cambiar su personalidad, conocimientos o límites | `datos/prompt-agente.md` (entre los marcadores) |
| Otra voz / más rápida / más aguda | `datos/agente.json → tts` |
| Otro modelo o más memoria | `datos/agente.json → llm` |
| Que no hable sola al terminar (turno a turno) | `agente.json → conversacion.manosLibres: false` |
| Apagar el asistente | `index.html → CONFIG.agenteVoz.activo = false` |
| Ver qué está pasando | consola del navegador: `TAPATECH_VOZ._debug()` |

### Verificar el módulo de voz

```bash
node --check assets/voz.js
node --check api/chat.js
node --check api/tts.js
```

No hay una suite automatizada `test/test-voz.js` incluida en este directorio. La clave placeholder
debe dejar el estado de `/api/health` como `FALTA_GROQ_API_KEY`, y no debe hacer llamadas reales a Groq.

## 7. SEO local y visibilidad en buscadores/IA

La página principal prioriza **reparación de celulares en Tapachula**; el contenido también responde
consultas como “reparación de celulares cerca de ti”, explica servicios, precios aproximados,
garantía, dirección, horario y recolección. El H1 mantiene un tamaño fluido: 59 px máximo en escritorio
y aproximadamente 28 px en un móvil de 390 px de ancho. Los títulos de servicios son H3 bajo su H2.

El sitio incluye canonical, Open Graph, un sitemap, `robots.txt` abierto a crawlers generales y
`llms.txt` con un resumen y enlaces a las páginas. Los datos JSON-LD usan tipos Schema.org existentes
(`LocalBusiness`, `Store`, `Service`, `WebSite` y `FAQPage`) y el número de teléfono del negocio.
`llms.txt` es una convención voluntaria: no es un estándar de indexación ni garantiza que una IA
consulte, indexe o cite la página. Autorizar el rastreo tampoco garantiza aparecer en respuestas.

Para mejorar la visibilidad fuera del código:

1. Verifica el negocio en Google Business Profile y Bing Places; mantén nombre, teléfono, dirección,
   horarios, categoría y URL idénticos al sitio. Usa el enlace real del perfil de Maps.
2. Registra el dominio desplegado en Google Search Console y Bing Webmaster Tools; envía el sitemap,
   inspecciona las URLs principales y corrige cualquier error de rastreo o canonical.
3. Añade únicamente URLs reales de perfiles sociales y del perfil de Google. El sitio no inventa
   perfiles: los enlaces de ejemplo se quitaron hasta disponer de los enlaces oficiales.
4. Solicita reseñas auténticas después de cada reparación y responde con información útil; no ofrezcas
   recompensas condicionadas ni publiques reseñas inventadas.
5. Publica guías basadas en preguntas que los clientes hacen de verdad, con diagnóstico, alternativas,
   precios claramente sujetos al modelo y enlaces a la cotización. No dupliques artículos ni crees
   páginas casi idénticas para colonias solo para repetir “cerca de mí”.
6. Confirma que teléfono, correo, dirección, cobertura y tarifas sean correctos antes de publicarlos.
   El correo actual se conserva tal como está configurado y debe verificarse con el negocio.

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

## 9. Verificaciones disponibles

```bash
python tools/check.py
node --check assets/voz.js
node --check api/chat.js
node --check api/tts.js
node --check api/health.js
node --check server.js
node --check sw.js
```

`tools/check.py` comprueba enlaces internos, navegación, SEO básico, JSON-LD, IDs y placeholders.
No hay suites `test/test-sitio.js` ni `test/test-voz.js` actualmente incluidas; valida manualmente
el flujo de voz en HTTPS o `localhost`, con una clave Groq válida configurada fuera del código.

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
