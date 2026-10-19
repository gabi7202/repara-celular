#!/usr/bin/env python3
"""
Webhook TTS GRATUITO con voces neuronales de Microsoft Edge (es-MX).
Sin API keys, sin costo: usa el mismo motor de "lectura en voz alta" de Edge.

Voz recomendada para Lupita (perfil pedido: mujer mexicana 45-55, tono medio-agudo,
simpática y alegre):  es-MX-DaliaNeural

Instalación y arranque
----------------------
    pip install edge-tts            # única dependencia, gratis
    python3 tools/tts-edge.py       # escucha en http://localhost:8055

Luego conecta el sitio (dos opciones):
  A) Servidor propio:  TTS_WEBHOOK=http://localhost:8055/tts ADMIN_PIN=... node server.js
  B) Vercel:           variable TTS_WEBHOOK=https://tu-servidor-tts/tts
  C) Directo desde el navegador: en datos/agente.json → tts.webhook.url = "http://localhost:8055/tts"
     (solo para pruebas locales; en producción usa A o B para no exponer el puerto y evitar CORS)

API
---
  POST /tts    {"text":"...", "voice":"es-MX-DaliaNeural", "format":"mp3"}
               → audio/mpeg (o audio/wav con format=wav)
  GET  /voices → lista de voces en español de México
  GET  /health → {"ok":true}

Notas de prosodia
-----------------
El sitio envía el texto completo en una sola petición, sin marcas de prosodia ni SSML. Usa comas y
puntos para las pausas y los signos españoles de apertura/cierre (¿? y ¡!) para la entonación.
Edge TTS aplica el ritmo y tono globales configurados en el webhook.
"""
import json
import re
import sys
import asyncio
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PUERTO = int(sys.argv[1]) if len(sys.argv) > 1 else 8055
VOZ_POR_DEFECTO = "es-MX-DaliaNeural"

try:
    import edge_tts
except ImportError:
    sys.exit("Falta la dependencia:  pip install edge-tts")

# Marcas de prosodia del prompt maestro, por si llegan crudas: las convertimos a rate/pitch
RE_MARCA = re.compile(r"\[\[\s*(p:\d+|r:[0-9.]+|t:[+-]?[0-9.]+|v:[a-zñ]+|e:[a-zñ]+|n:[a-zñ]+|/)\s*\]\]", re.I)


def limpiar(texto: str):
    """Quita marcas técnicas heredadas para que el sintetizador solo lea el texto."""
    rate, pitch = 1.0, 1.0
    for m in RE_MARCA.finditer(texto or ""):
        tok = m.group(1).lower()
        if tok.startswith("r:"):
            rate = float(tok[2:])
        elif tok.startswith("t:"):
            pitch = 1 + float(tok[2:]) / 100.0
    limpio = RE_MARCA.sub("", texto or "")
    limpio = re.sub(r"\s+", " ", limpio).strip()
    return limpio, rate, pitch


def pct(valor: float) -> str:
    p = int(round((valor - 1) * 100))
    return f"{'+' if p >= 0 else ''}{p}%"


def hz(valor: float) -> str:
    h = int(round((valor - 1) * 50))
    return f"{'+' if h >= 0 else ''}{h}Hz"


async def sintetizar(texto, voz, rate, pitch, volume, formato):
    limpio, r_auto, p_auto = limpiar(texto)
    if not limpio:
        return b""
    # rate/pitch explícitos del cliente tienen prioridad; si no llegaron, usamos los del marcado
    rate_final = rate if isinstance(rate, str) and rate.strip() not in ("", "+0%") else pct(r_auto)
    pitch_final = pitch if isinstance(pitch, str) and pitch.strip() not in ("", "+0Hz") else hz(p_auto)
    # edge-tts espera volumen RELATIVO ("+0%", "-20%"), no absoluto ("100%")
    try:
        vol_num = int(str(volume if volume not in (None, "") else "100").replace("%", "").replace("+", ""))
    except ValueError:
        vol_num = 100
    vol_num = max(0, min(200, vol_num))
    vol = f"{vol_num - 100:+d}%"
    salida = []
    com = edge_tts.Communicate(limpio, voice=voz, rate=rate_final, pitch=pitch_final, volume=vol)
    async for pedazo in com.stream():
        if pedazo["type"] == "audio":
            salida.append(pedazo["data"])
    return b"".join(salida)


class Manejador(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")

    def _json(self, codigo, obj):
        cuerpo = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(codigo)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(cuerpo)))
        self._cors()
        self.end_headers()
        self.wfile.write(cuerpo)

    def _audio(self, datos, mime):
        self.send_response(200)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(datos)))
        self.send_header("Cache-Control", "no-store")
        self._cors()
        self.end_headers()
        self.wfile.write(datos)

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self):
        if self.path.startswith("/health"):
            return self._json(200, {"ok": True, "motor": "edge-tts", "voz": VOZ_POR_DEFECTO})
        if self.path.startswith("/voices"):
            async def lista():
                out = []
                crudo = await edge_tts.list_voices()      # edge-tts 7.x: corrutina que devuelve lista
                for v in crudo:
                    if str(v.get("Locale", "")).startswith("es"):
                        out.append({"nombre": v["ShortName"], "locale": v["Locale"], "genero": v["Gender"]})
                return out
            voces = asyncio.run(lista())
            mex = [v for v in voces if v["locale"] == "es-MX"]
            return self._json(200, {"ok": True, "es_MX": mex, "otras_es": voces[:40]})
        return self._json(404, {"ok": False, "error": "usa POST /tts"})

    def do_POST(self):
        if not self.path.startswith("/tts"):
            return self._json(404, {"ok": False, "error": "ruta desconocida"})
        try:
            largo = int(self.headers.get("Content-Length") or 0)
            if largo <= 0 or largo > 64 * 1024:
                return self._json(400, {"ok": False, "error": "texto ausente o demasiado largo"})
            datos = json.loads(self.rfile.read(largo).decode("utf-8"))
        except Exception as e:
            return self._json(400, {"ok": False, "error": f"json invalido: {e}"})
        texto = str(datos.get("text") or "")[:1200]
        if not texto.strip():
            return self._json(400, {"ok": False, "error": "texto vacio"})
        voz = str(datos.get("voice") or VOZ_POR_DEFECTO)
        formato = str(datos.get("format") or "mp3").lower()
        # Segmentos que solo traen signos (una coma, puntos suspensivos) no tienen nada que
        # hablar: devolvemos 204 en vez de fallar, para que el cliente siga con la prosodia.
        if not re.sub(r"[\W_]", "", re.sub(r"\[\[[^\]]*\]\]", "", texto)):
            self.send_response(204)
            self.send_header("Content-Length", "0")
            self._cors()
            self.end_headers()
            return
        try:
            audio = asyncio.run(sintetizar(texto, voz, datos.get("rate"), datos.get("pitch"),
                                           datos.get("volume"), formato))
        except Exception as e:
            return self._json(502, {"ok": False, "error": f"edge_tts: {e}"})
        if not audio:
            return self._json(502, {"ok": False, "error": "audio vacio"})
        mime = "audio/wav" if formato == "wav" else "audio/mpeg"
        print(f"  TTS {voz} | {len(texto)} chars -> {len(audio)/1024:.1f} KB")
        return self._audio(audio, mime)

    def log_message(self, fmt, *args):
        pass


if __name__ == "__main__":
    print(f"Webhook TTS gratuito (edge-tts) en http://localhost:{PUERTO}")
    print(f"  POST /tts   voz por defecto: {VOZ_POR_DEFECTO}")
    print(f"  GET  /voices · GET /health")
    print("Conéctalo con: TTS_WEBHOOK=http://localhost:%d/tts node server.js" % PUERTO)
    ThreadingHTTPServer(("0.0.0.0", PUERTO), Manejador).serve_forever()
