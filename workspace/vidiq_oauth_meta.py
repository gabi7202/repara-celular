import json, urllib.request

UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"

def get(url):
    r = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    with urllib.request.urlopen(r, timeout=30) as resp:
        return resp.read().decode(errors="replace")

for u in ["https://mcp.vidiq.com/.well-known/oauth-authorization-server",
          "https://mcp.vidiq.com/.well-known/oauth-protected-resource"]:
    print("=" * 70)
    print(u)
    try:
        print(json.dumps(json.loads(get(u)), indent=1))
    except Exception as e:
        print("ERROR:", e)
