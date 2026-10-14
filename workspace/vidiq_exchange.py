import json, urllib.request, urllib.error, urllib.parse, sys

# Uso: python3 vidiq_exchange.py "http://localhost:9654/callback?code=...&state=..."
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
TOKEN_EP = "https://mcp.vidiq.com/mcp/token"
MCP_EP = "https://mcp.vidiq.com/mcp"

callback = sys.argv[1]
q = urllib.parse.parse_qs(urllib.parse.urlparse(callback).query)
code = q["code"][0]
state = q.get("state", [None])[0]

with open(".vidiq_oauth_flow.json") as f:
    flow = json.load(f)

if state and flow["state"] != state:
    print("[!] State no coincide (posible CSRF o URL vieja). Aborto."); sys.exit(1)

form = urllib.parse.urlencode({
    "grant_type": "authorization_code",
    "code": code,
    "redirect_uri": flow["redirect_uri"],
    "client_id": flow["client_id"],
    "code_verifier": flow["verifier"],
}).encode()
req = urllib.request.Request(TOKEN_EP, data=form, headers={
    "Content-Type": "application/x-www-form-urlencoded",
    "Accept": "application/json", "User-Agent": UA}, method="POST")
try:
    with urllib.request.urlopen(req, timeout=30) as resp:
        tok = json.loads(resp.read().decode())
    print("=== TOKEN OK ===")
except urllib.error.HTTPError as e:
    print("=== TOKEN FALLO === HTTP", e.code, e.read().decode(errors="replace")[:400]); sys.exit(1)

with open(".vidiq_token.json", "w") as f:
    json.dump(tok, f, indent=1)
print("access_token:", tok.get("access_token", "")[:14] + "... | refresh:", bool(tok.get("refresh_token")), "| expires_in:", tok.get("expires_in"), "| scope:", tok.get("scope"))

ACCESS = tok["access_token"]

def parse_body(ctype, raw):
    if "text/event-stream" in (ctype or ""):
        ev = []
        for line in raw.splitlines():
            if line.startswith("data:"):
                p = line[5:].strip()
                if p:
                    try: ev.append(json.loads(p))
                    except json.JSONDecodeError: ev.append({"raw": p})
        return ev
    try: return json.loads(raw)
    except json.JSONDecodeError: return {"raw": raw[:2000]}

def mcp_post(payload, session_id=None, proto_ver=None):
    headers = {"Content-Type": "application/json",
               "Accept": "application/json, text/event-stream",
               "Authorization": "Bearer " + ACCESS, "User-Agent": UA}
    if session_id: headers["Mcp-Session-Id"] = session_id
    if proto_ver: headers["MCP-Protocol-Version"] = proto_ver
    r = urllib.request.Request(MCP_EP, data=json.dumps(payload).encode(), headers=headers, method="POST")
    try:
        with urllib.request.urlopen(r, timeout=60) as resp:
            return resp.status, resp.headers.get("Mcp-Session-Id"), resp.headers.get("Content-Type", ""), resp.read().decode(errors="replace")
    except urllib.error.HTTPError as e:
        return e.code, e.headers.get("Mcp-Session-Id"), e.headers.get("Content-Type", ""), e.read().decode(errors="replace")

# Handshake MCP
init = {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {
    "protocolVersion": "2025-06-18", "capabilities": {},
    "clientInfo": {"name": "qwen-workspace-client", "version": "1.0.0"}}}
st, sid, ct, body = mcp_post(init)
print("=== INITIALIZE === HTTP", st, "| SID:", sid)
resp = parse_body(ct, body)
items = resp if isinstance(resp, list) else [resp]
srv = {}
for ev in items:
    if isinstance(ev, dict) and ev.get("result"): srv = ev["result"]
print(json.dumps(srv, indent=1)[:600])
if st not in (200, 202):
    print("Fallo handshake:", body[:400]); sys.exit(1)
pv = srv.get("protocolVersion", "2025-06-18")

mcp_post({"jsonrpc": "2.0", "method": "notifications/initialized"}, sid, pv)

st3, _, ct3, b3 = mcp_post({"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}}, sid, pv)
tr = parse_body(ct3, b3)
with open("vidiq_tools.json", "w") as f:
    json.dump(tr, f, ensure_ascii=False, indent=1)
print("=== TOOLS === HTTP", st3)
items = tr if isinstance(tr, list) else [tr]
n = 0
for ev in items:
    for t in (ev.get("result", {}) or {}).get("tools", []):
        n += 1
        print("%2d. %-40s %s" % (n, t.get("name"), (t.get("description") or "").split("\n")[0][:100]))
print("Total herramientas:", n)

with open(".vidiq_session", "w") as f:
    json.dump({"session_id": sid, "protocol_version": pv}, f)
print("=== CONEXION COMPLETA ===")
