import json, urllib.request, urllib.error, urllib.parse, sys

UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
TOKEN_EP = "https://mcp.vidiq.com/mcp/token"
MCP_EP = "https://mcp.vidiq.com/mcp"

CODE = "2hhhmv9753QSbDfDFpj4Z5K7CYFaniIV"
STATE = "v0oi-yPEt8c0_9uO"

# --- Load saved PKCE flow ---
with open(".vidiq_oauth_flow.json") as f:
    flow = json.load(f)

if flow["state"] != STATE:
    print("[!] State no coincide. Aborto por seguridad."); sys.exit(1)

# --- Step 1: exchange code for tokens ---
form = urllib.parse.urlencode({
    "grant_type": "authorization_code",
    "code": CODE,
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
    print("=== TOKEN OK === HTTP", resp.status)
except urllib.error.HTTPError as e:
    print("=== TOKEN FALLO === HTTP", e.code)
    print(e.read().decode(errors="replace")[:800]); sys.exit(1)

with open(".vidiq_token.json", "w") as f:
    json.dump(tok, f, indent=1)
print("access_token:", tok.get("access_token", "")[:12] + "...")
print("refresh_token:", ("si" if tok.get("refresh_token") else "no"),
      "| expires_in:", tok.get("expires_in"), "| scope:", tok.get("scope"))

ACCESS = tok["access_token"]

# --- MCP plumbing ---
def parse_body(ctype, raw):
    if "text/event-stream" in (ctype or ""):
        events = []
        for line in raw.splitlines():
            if line.startswith("data:"):
                p = line[5:].strip()
                if p:
                    try: events.append(json.loads(p))
                    except json.JSONDecodeError: events.append({"raw": p})
        return events
    try: return json.loads(raw)
    except json.JSONDecodeError: return {"raw": raw[:2000]}

def mcp_post(payload, session_id=None, proto_ver=None):
    headers = {"Content-Type": "application/json",
               "Accept": "application/json, text/event-stream",
               "Authorization": "Bearer " + ACCESS,
               "User-Agent": UA}
    if session_id: headers["Mcp-Session-Id"] = session_id
    if proto_ver: headers["MCP-Protocol-Version"] = proto_ver
    r = urllib.request.Request(MCP_EP, data=json.dumps(payload).encode(), headers=headers, method="POST")
    try:
        with urllib.request.urlopen(r, timeout=60) as resp:
            return resp.status, resp.headers.get("Mcp-Session-Id"), resp.headers.get("Content-Type", ""), resp.read().decode(errors="replace")
    except urllib.error.HTTPError as e:
        return e.code, e.headers.get("Mcp-Session-Id"), e.headers.get("Content-Type", ""), e.read().decode(errors="replace")

# --- Step 2: initialize ---
init = {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {
    "protocolVersion": "2025-06-18", "capabilities": {},
    "clientInfo": {"name": "qwen-workspace-client", "version": "1.0.0"}}}
st, sid, ct, body = mcp_post(init)
print("\n=== INITIALIZE === HTTP", st, "| SID:", sid)
init_resp = parse_body(ct, body)
items = init_resp if isinstance(init_resp, list) else [init_resp]
srv_info = {}
for ev in items:
    if isinstance(ev, dict) and ev.get("result"):
        srv_info = ev["result"]
print(json.dumps(srv_info, indent=1)[:800])
pv = srv_info.get("protocolVersion", "2025-06-18")

if st not in (200, 202):
    print("Handshake fallo:", body[:500]); sys.exit(1)

# --- Step 3: initialized notification ---
st2, _, _, _ = mcp_post({"jsonrpc": "2.0", "method": "notifications/initialized"}, sid, pv)
print("\n=== NOTIF === HTTP", st2)

# --- Step 4: tools/list ---
st3, _, ct3, b3 = mcp_post({"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}}, sid, pv)
tools_resp = parse_body(ct3, b3)
with open("vidiq_tools.json", "w") as f:
    json.dump(tools_resp, f, ensure_ascii=False, indent=1)
print("\n=== TOOLS === HTTP", st3)
items = tools_resp if isinstance(tools_resp, list) else [tools_resp]
n = 0
for ev in items:
    for t in (ev.get("result", {}) or {}).get("tools", []):
        n += 1
        print("%2d. %-38s %s" % (n, t.get("name"), (t.get("description") or "").split("\n")[0][:110]))
print("\nTotal herramientas:", n)

with open(".vidiq_session", "w") as f:
    json.dump({"session_id": sid, "protocol_version": pv}, f)
print("Sesion MCP guardada:", sid)
