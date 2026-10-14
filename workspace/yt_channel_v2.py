import urllib.request, re, json, xml.etree.ElementTree as ET

UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
CH = "UC_8UVNRF2OuNHt-svr7x06w"

def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "es-419,es;q=0.9"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read().decode(errors="replace")

# --- 1) RSS feed: ultimos 15 videos con views ---
print("=" * 62)
xml_txt = fetch(f"https://www.youtube.com/feeds/videos.xml?channel_id={CH}")
ns = {"a": "http://www.w3.org/2005/Atom", "media": "http://search.yahoo.com/mrss/", "yt": "http://gdata.youtube.com/schemas/2007"}
root = ET.fromstring(xml_txt)
entries = root.findall("a:entry", ns)
print("CANAL (RSS):", root.findtext("a:title", default="?", namespaces=ns))
print("VIDEOS EN FEED (max 15 mas recientes):", len(entries))
vids = []
for e in entries:
    vid = e.findtext("yt:videoId", default="", namespaces=ns)
    title = e.findtext("a:title", default="", namespaces=ns)
    pub = e.findtext("a:published", default="", namespaces=ns)[:10]
    stats = e.find(".//media:statistics", ns)
    views = stats.get("views") if stats is not None else "?"
    vids.append({"id": vid, "title": title, "published": pub, "views": views})
for i, v in enumerate(vids, 1):
    print("%2d. %s | %s vistas | %s | %s" % (i, v["published"], v["views"], v["id"], v["title"][:66]))
with open("canal_videos.json", "w") as f:
    json.dump(vids, f, ensure_ascii=False, indent=1)

# --- 2) About page: estadisticas del canal ---
print("=" * 62)
html = fetch(f"https://www.youtube.com/channel/{CH}/about")
m = re.search(r'"aboutChannelViewModel":(\{.*?\}),"', html)
def grab(pattern, txt, label):
    mm = re.search(pattern, txt)
    print(label, mm.group(1) if mm else "n/d")

grab(r'"subscriberCountText":"([^"]+)"', html, "Suscriptores:")
grab(r'"videoCountText":"([^"]+)"', html, "Videos:")
grab(r'"viewCountText":"([^"]+)"', html, "Vistas totales:")
grab(r'"joinedDateText":\{"content":"([^"]+)"', html, "Se unio:")
grab(r'"country":"([^"]+)"', html, "Pais:")
