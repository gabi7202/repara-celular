import json, urllib.request, urllib.error

KEY = "idiq_rkjD7tkQHzWVq4f2wISxhT8PWZy_lfd4TAlDIn56"
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
BASE = "https://mcp.vidiq.com"

def req(method, url, payload=None, headers=None):
    h = {"Accept": "application/json, text/event-stream", "User-Agent": UA}
    data = None
    if payload is not None:
        h["Content-Type"] = "application/json"
        data = json.dumps(payload).encode()
    if headers:
        h.update(headers)
    r = urllib.request.Request(url, data=data, headers=h, method=method)
    try:
        with urllib.request.urlopen(r, timeout=30) as resp:
            return resp.status, dict(resp.headers), resp.read().decode(errors="replace")
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read().decode(errors="replace")
    except Exception as e:
        return None, {}, "%s: %s" % (type(e).__name__, e)

init = {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {
    "protocolVersion": "2025-06-18", "capabilities": {},
    "clientInfo": {"name": "qwen-mcp-client", "version": "1.0.0"}}}

print("### 1) POST /mcp con Bearer -> headers completos del 401")
st, h, b = req("POST", BASE + "/mcp", init, {"Authorization": "Bearer " + KEY})
print("HTTP", st)
for k, v in h.items():
    print("  %s: %s" % (k, v))
print("body:", b[:300])

variants = [
    ("x-api-key", {"x-api-key": KEY}),
    ("Authorization sin Bearer", {"Authorization": KEY}),
    ("api-key header", {"api-key": KEY}),
    ("query ?api_key=", None),
]
print("\n### 2) Variantes de auth en /mcp")
for label, hdrs in variants:
    url = BASE + "/mcp" + ("?api_key=" + KEY if hdrs is None else "")
    st, h, b = req("POST", url, init, hdrs)
    print("%-28s -> HTTP %s | %s" % (label, st, b[:160].replace("\n", " ")))

print("\n### 3) Discovery OAuth / rutas auxiliares")
for path in ["/.well-known/oauth-authorization-server", "/.well-known/oauth-protected-resource",
             "/mcp/.well-known/oauth-authorization-server", "/", "/health", "/docs", "/mcp"]:
    st, h, b = req("GET", BASE + path, None, {})
    print("GET %-50s -> HTTP %s | %s" % (path, st, b[:140].replace("\n", " ")))
