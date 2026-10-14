import json, urllib.request, urllib.error, sys

URL = "https://mcp.vidiq.com/mcpv"
KEY = "idiq_rkjD7tkQHzWVq4f2wISxhT8PWZy_lfd4TAlDIn56"
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"

def parse_body(ctype, raw):
    """Parse plain JSON or SSE (text/event-stream) responses."""
    if "text/event-stream" in (ctype or ""):
        events = []
        for line in raw.splitlines():
            if line.startswith("data:"):
                payload = line[5:].strip()
                if payload:
                    try: events.append(json.loads(payload))
                    except json.JSONDecodeError: events.append({"raw": payload})
        return events
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return {"raw": raw[:3000]}

def post(payload, session_id=None):
    data = json.dumps(payload).encode()
    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
        "Accept-Encoding": "identity",
        "Authorization": "Bearer " + KEY,
        "User-Agent": UA,
        "MCP-Protocol-Version": "2025-06-18",
    }
    if session_id:
        headers["Mcp-Session-Id"] = session_id
    req = urllib.request.Request(URL, data=data, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=45) as r:
            return r.status, r.headers.get("Mcp-Session-Id"), r.headers.get("Content-Type", ""), r.read().decode(errors="replace")
    except urllib.error.HTTPError as e:
        return e.code, e.headers.get("Mcp-Session-Id"), e.headers.get("Content-Type", ""), e.read().decode(errors="replace")
    except Exception as e:
        return None, None, None, "%s: %s" % (type(e).__name__, e)

def main():
    # --- Step 1: initialize ---
    init = {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {
        "protocolVersion": "2025-06-18", "capabilities": {},
        "clientInfo": {"name": "qwen-workspace-client", "version": "1.0.0"}}}
    status, sid, ctype, body = post(init)
    print("=== INITIALIZE ===")
    print("HTTP:", status, "| Session-Id:", sid, "| Content-Type:", ctype)
    parsed = parse_body(ctype, body)
    print(json.dumps(parsed, ensure_ascii=False, indent=1)[:2500])
    if status not in (200, 202):
        print("\n[!] Handshake fallo. Cuerpo completo:")
        print(body[:3000]); sys.exit(1)

    # --- Step 2: notifications/initialized ---
    st2, _, ct2, b2 = post({"jsonrpc": "2.0", "method": "notifications/initialized"}, session_id=sid)
    print("\n=== NOTIF INITIALIZED === HTTP:", st2, b2[:200])

    # --- Step 3: tools/list ---
    st3, _, ct3, b3 = post({"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}}, session_id=sid)
    print("\n=== TOOLS/LIST === HTTP:", st3)
    tools_resp = parse_body(ct3, b3)
    with open("vidiq_tools.json", "w") as f:
        json.dump(tools_resp, f, ensure_ascii=False, indent=1)
    items = tools_resp if isinstance(tools_resp, list) else [tools_resp]
    for ev in items:
        for t in ev.get("result", {}).get("tools", []):
            print("- %s: %s" % (t.get("name"), (t.get("description") or "")[:140].replace("\n", " ")))

    with open(".vidiq_session", "w") as f:
        f.write(sid or "")
    print("\nSession guardada en .vidiq_session:", sid)

if __name__ == "__main__":
    main()
