#!/usr/bin/env python3
"""Verifica integridad del sitio: navegación, enlaces internos, SEO básico y placeholders.
Uso: python3 tools/check.py   (desde la carpeta del sitio)"""
import os, re, sys, json

# Ejecutar desde la carpeta del sitio:  python3 tools/check.py
ROOT = '.'
PAGINAS = ['index.html', '404.html', 'privacidad.html', 'terminos.html', 'admin.html',
           'blog/index.html', 'blog/cuanto-cuesta-cambiar-la-pantalla-de-un-celular-en-tapachula/index.html']
errores, avisos = [], []
def ok(c, msg): (errores if not c else avisos).append(msg) if not c else None

# 1) páginas existen + SEO básico + navegación
for p in PAGINAS:
    ruta = os.path.join(ROOT, p)
    if not os.path.exists(ruta): errores.append('Falta la página ' + p); continue
    h = open(ruta, encoding='utf-8').read()
    base = f'[{p}] '
    ok(bool(re.search(r'<title>.{10,}</title>', h)), base + 'sin <title> adecuado')
    ok('name="description"' in h or p in ('admin.html',), base + 'sin meta description')
    ok('rel="canonical"' in h or p in ('admin.html', '404.html'), base + 'sin canonical')
    ok('lang="es' in h, base + 'sin lang="es-MX"')
    ok('favicon.svg' in h, base + 'sin favicon')
    if p != 'admin.html':
        ok(h.count('<nav') >= 1, base + 'sin navegación')
        ok('Cotizador' in h or p == '404.html', base + 'nav sin enlace al Cotizador')
        ok('ftr-grid' in h or p == '404.html', base + 'sin pie unificado')
    ok('burger' in h or p in ('admin.html',), base + 'sin menú móvil')

# 2) enlaces y recursos internos resuelven
def existe(ruta_rel, pagina):
    if not ruta_rel: return True
    if ruta_rel.startswith(('/', '\\')):
        dest = os.path.normpath(os.path.join(ROOT, ruta_rel.lstrip('/\\')))
    else:
        base_dir = os.path.dirname(os.path.join(ROOT, pagina))
        dest = os.path.normpath(os.path.join(base_dir, ruta_rel))
    return (os.path.exists(dest) or os.path.exists(os.path.join(dest, 'index.html'))
            or os.path.exists(dest + '.html') or dest.endswith('/'))
total = rotos = 0
for p in PAGINAS:
    ruta = os.path.join(ROOT, p)
    if not os.path.exists(ruta): continue
    h = open(ruta, encoding='utf-8').read()
    for attr in re.findall(r'(?:href|src)="([^"]+)"', h):
        if attr.startswith(('http://', 'https://', 'tel:', 'mailto:', 'data:', '#', 'javascript:', '//')): continue
        if '${' in attr or "'" in attr or attr.startswith(','): continue   # plantillas JS
        total += 1
        limpio = attr.split('#')[0].split('?')[0]
        if not limpio: continue
        if not existe(limpio, p):
            rotos += 1; errores.append(f'[{p}] enlace roto → {attr}')
avisos.append(f'{total} referencias internas revisadas, {rotos} rotas')

# 3) index.html: JSON-LD, terceros, imgs
h = open(os.path.join(ROOT, 'index.html'), encoding='utf-8').read()
ld = re.findall(r'<script type="application/ld\+json">(.*?)</script>', h, re.S)
for b in ld:
    try: json.loads(b)
    except Exception as e: errores.append('JSON-LD inválido: ' + str(e))
ok(not re.findall(r'<script[^>]+src="http', h), 'index.html carga scripts de terceros')
h_sin_scripts = re.sub(r'<script.*?</script>', '', h, flags=re.S)
imgs = re.findall(r'<img[^>]+>', h_sin_scripts)
ok(imgs and all(re.search(r'width="\d+"', i) and 'alt="' in i for i in imgs), 'index.html: img sin width/alt (%d imgs)' % len(imgs))
ok(h.count('<h1') == 1, 'index.html debe tener exactamente 1 H1 (tiene %d)' % h.count('<h1'))
# IDs duplicados
ids = re.findall(r'\sid="([^"]+)"', h)
dup = {i for i in ids if ids.count(i) > 1}
ok(not dup, 'index.html: ids duplicados → ' + ', '.join(sorted(dup)[:6]))
# 4) placeholders pendientes (informativo)
ph = len(re.findall(r'TU-DOMINIO|TU-PERFIL|TU-PAGINA|TU-ENLACE|Av\. Principal #000', h))
avisos.append(f'{ph} placeholders por reemplazar con los datos reales del cliente')

print('\n'.join('❌ ' + e for e in errores) if errores else '✅ Sin errores')
print('\n'.join('ℹ️  ' + a for a in avisos))
print(f'\n{len(errores)} errores · {len(avisos)} avisos')
sys.exit(1 if errores else 0)
