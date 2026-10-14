import json, urllib.request, urllib.error, urllib.parse, sys, os, time

# Uso: python3 vidiq_call.py <tool_name> '<json_args>'
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
TOKEN_EP = "https://mcp.vidiq.com/mcp/token"
MCP_EP = "https://mcp.vidiq.com/mcp"
TOKEN_FILE = ".vidiq_token.json"

with open(TOKEN_FILE) as f:
    tok = json.load(f)
with open(".vidiq_oauth_flow.json") as f:
    flow = json.load(f)

# --- Auto-refresh si el token expiro (expires_in=3600s, usamos margen de 120s) ---
issued = os.path.getmtime(TOKEN_FILE)
if time.time() - issued > tok.get("expires_in", 3600) - 120 and tok.get("refresh_token"):
    form = urllib.parse.urlencode({
        "grant_type": "refresh_token",
        "refresh_token": tok["refresh_token"],
        "client_id": flow["client_id"],
    }).encode()
    r = urllib.request.Request(TOKEN_EP, data=form, headers={
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "application/json", "User-Agent": UA}, method="POST")
    try:
        with urllib.request.urlopen(r, timeout=30) as resp:
            tok = json.loads(resp.read().decode())
        with open(TOKEN_FILE, "w") as f:
            json.dump(tok, f, indent=1)
        print("[i] Token renovado automaticamente.", file=sys.stderr)
    except urllib.error.HTTPError as e:
        print("[!] Refresh fallo:", e.code, e.read().decode(errors="replace")[:200], file=sys.stderr)

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
    except json.JSONDecodeError: return {"raw": raw[:4000]}

def mcp_post(payload, msg_id):
    headers = {"Content-Type": "application/json",
               "Accept": "application/json, text/event-stream",
               "Authorization": "Bearer " + ACCESS,
               "MCP-Protocol-Version": "2025-06-18",
               "User-Agent": UA}
    r = urllib.request.Request(MCP_EP, data=json.dumps(payload).encode(), headers=headers, method="POST")
    try:
        with urllib.request.urlopen(r, timeout=120) as resp:
            return resp.status, resp.headers.get("Content-Type", ""), resp.read().decode(errors="replace")
    except urllib.error.HTTPError as e:
        return e.code, e.headers.get("Content-Type", ""), e.read().decode(errors="replace")

tool = sys.argv[1]
args = json.loads(sys.argv[2]) if len(sys.argv) > 2 else {}

# El servidor es stateless (no exige sesion), pero hacemos initialize por correccion del protocolo
st, ct, body = mcp_post({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {
    "protocolVersion": "2025-06-18", "capabilities": {},
    "clientInfo": {"name": "qwen-workspace-client", "version": "1.0.0"}}}, 1)
mcp_post({"jsonrpc": "2.0", "method": "notifications/initialized"}, 0)

st, ct, body = mcp_post({"jsonrpc": "2.0", "id": 2, "method": "tools/call",
                         "params": {"name": tool, "arguments": args}}, 2)
resp = parse_body(ct, body)
items = resp if isinstance(resp, list) else [resp]
out = None
for ev in items:
    if isinstance(ev, dict) and ("result" in ev or "error" in ev):
        out = ev
print(json.dumps(out, ensure_ascii=False, indent=1))
