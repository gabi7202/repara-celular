import json, urllib.request, urllib.error

KEY = "idiq_rkjD7tkQHzWVq4f2wISxhT8PWZy_lfd4TAlDIn56"
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"

def req(method, url, payload=None, extra_headers=None):
    headers = {"Accept": "application/json, text/event-stream", "User-Agent": UA}
    data = None
    if payload is not None:
        headers["Content-Type"] = "application/json"
        data = json.dumps(payload).encode()
    if extra_headers:
        headers.update(extra_headers)
    r = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(r, timeout=30) as resp:
            body = resp.read().decode(errors="replace")
            return resp.status, dict(resp.headers), body
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read().decode(errors="replace")
    except Exception as e:
        return None, {}, "%s: %s" % (type(e).__name__, e)

def init_msg(pv):
    return {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {
        "protocolVersion": pv, "capabilities": {},
        "clientInfo": {"name": "qwen-mcp-client", "version": "1.0.0"}}}

probes = [
    ("POST /mcpv  Bearer  pv=2025-03-26", "POST", "https://mcp.vidiq.com/mcpv", init_msg("2025-03-26"), {"Authorization": "Bearer " + KEY}),
    ("POST /mcpv  Bearer  pv=2024-11-05", "POST", "https://mcp.vidiq.com/mcpv", init_msg("2024-11-05"), {"Authorization": "Bearer " + KEY}),
    ("POST /mcp   Bearer  pv=2025-06-18", "POST", "https://mcp.vidiq.com/mcp",  init_msg("2025-06-18"), {"Authorization": "Bearer " + KEY}),
    ("POST /mcpv  x-api-key pv=2025-06-18", "POST", "https://mcp.vidiq.com/mcpv", init_msg("2025-06-18"), {"x-api-key": KEY}),
    ("POST /mcpv  Bearer+query pv=2025-06-18", "POST", "https://mcp.vidiq.com/mcpv?key=" + KEY, init_msg("2025-06-18"), {"Authorization": "Bearer " + KEY}),
    ("GET  /mcpv  Bearer (SSE open)", "GET", "https://mcp.vidiq.com/mcpv", None, {"Authorization": "Bearer " + KEY}),
    ("POST /mcpv  sin auth (control)", "POST", "https://mcp.vidiq.com/mcpv", init_msg("2025-06-18"), {}),
]

for label, method, url, payload, hdrs in probes:
    st, h, body = req(method, url, payload, hdrs)
    ct = h.get("Content-Type", h.get("content-type", ""))
    sid = h.get("Mcp-Session-Id", h.get("mcp-session-id", ""))
    print("=" * 70)
    print(label, "-> HTTP", st, "| CT:", ct, "| SID:", sid)
    print(body[:400].replace("\n", " ") if body else "(cuerpo vacio)")
