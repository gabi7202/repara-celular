import json, urllib.request, re, sys

UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
CH = "UC_8UVNRF2OuNHt-svr7x06w"

def fetch(url):
    req = urllib.request.Request(url, headers={
        "User-Agent": UA,
        "Accept-Language": "es-419,es;q=0.9,en;q=0.8",
        "Cookie": "CONSENT=YES+cb.20210328-17-p0.en+FX+417; SOCS=CAISNQgQEitib3FfaWRlbnRpdHlmcm9udGVuZHVpc2VydmVyXzIwMjMwODI5LjA3X3AxGgJlbiACGgYIgLC_pwY",
    })
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read().decode(errors="replace")

def extract_initial_data(html):
    m = re.search(r"var ytInitialData = (\{.*?\});</script>", html, re.DOTALL)
    if not m:
        m = re.search(r'window\["ytInitialData"\] = (\{.*?\});', html, re.DOTALL)
    return json.loads(m.group(1)) if m else None

def walk(obj, key):
    """Yield all dicts under any occurrence of `key`."""
    if isinstance(obj, dict):
        for k, v in obj.items():
            if k == key:
                yield v
            yield from walk(v, key)
    elif isinstance(obj, list):
        for it in obj:
            yield from walk(it, key)

try:
    html = fetch(f"https://www.youtube.com/channel/{CH}/videos")
except Exception as e:
    print("ERROR fetching:", e); sys.exit(1)

data = extract_initial_data(html)
if not data:
    print("No se encontro ytInitialData. Len html:", len(html))
    print(html[:500]); sys.exit(1)

# --- Channel header info ---
print("=" * 60)
try:
    page = data["contents"]["twoColumnBrowseResultsRenderer"]["tabs"]
    for tab in page:
        tr = tab.get("tabRenderer", {})
        if tr.get("selected"):
            print("Tab activo:", tr.get("title"))
except Exception as e:
    print("header parse:", e)

for hm in walk(data, "pageHeaderRenderer"):
    try:
        vm = hm["content"]["pageHeaderViewModel"]
        title = vm["title"]["content"]
        print("CANAL:", title)
        meta = vm.get("metadata", {}).get("contentMetadataViewModel", {}).get("metadataRows", [])
        for row in meta:
            parts = [p.get("text", {}).get("content", "") for p in row.get("metadataParts", [])]
            print("  ", " | ".join([p for p in parts if p]))
        print("Handle/desc:", json.dumps(vm.get("description", {}), ensure_ascii=False)[:200])
    except Exception as e:
        print("header vm parse:", e)

# --- Videos ---
print("=" * 60)
vids = []
for vr in walk(data, "videoRenderer"):
    try:
        vids.append({
            "id": vr.get("videoId"),
            "title": "".join(r.get("text", "") for r in vr.get("title", {}).get("runs", [])),
            "views": vr.get("viewCountText", {}).get("simpleText", ""),
            "published": vr.get("publishedTimeText", {}).get("simpleText", ""),
            "length": vr.get("lengthText", {}).get("simpleText", ""),
        })
    except Exception:
        pass
for rg in walk(data, "richItemRenderer"):
    c = rg.get("content", {})
    vr = c.get("videoRenderer")
    if vr and vr.get("videoId") not in [v["id"] for v in vids]:
        vids.append({
            "id": vr.get("videoId"),
            "title": "".join(r.get("text", "") for r in vr.get("title", {}).get("runs", [])),
            "views": (vr.get("viewCountText", {}) or {}).get("simpleText", ""),
            "published": (vr.get("publishedTimeText", {}) or {}).get("simpleText", ""),
            "length": (vr.get("lengthText", {}) or {}).get("simpleText", ""),
        })

print("VIDEOS ENCONTRADOS EN /videos:", len(vids))
for i, v in enumerate(vids[:30], 1):
    print("%2d. [%s] %s | %s | %s | %s" % (i, v["id"], v["title"][:70], v["views"], v["published"], v["length"]))

with open("canal_videos.json", "w") as f:
    json.dump(vids, f, ensure_ascii=False, indent=1)

# --- About page for description/keywords ---
try:
    html2 = fetch(f"https://www.youtube.com/channel/{CH}/about")
    d2 = extract_initial_data(html2)
    for ci in walk(d2, "channelMetadataRenderer"):
        print("\n=== METADATA ===")
        print("Titulo:", ci.get("title"))
        print("Descripcion:", (ci.get("description") or "")[:600])
        print("Keywords:", (ci.get("keywords") or "")[:400])
        print("VanityUrl:", ci.get("vanityChannelUrl"))
        break
except Exception as e:
    print("about parse error:", e)
