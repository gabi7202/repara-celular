import json, urllib.request, urllib.error, urllib.parse, sys

UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
TOKEN_EP = "https://mcp.vidiq.com/mcp/token"

CODE = "2hhhmv9753QSbDfDFpj4Z5K7CYFaniIV"

with open(".vidiq_oauth_flow.json") as f:
    flow = json.load(f)

payload = {
    "grant_type": "authorization_code",
    "code": CODE,
    "redirect_uri": flow["redirect_uri"],
    "client_id": flow["client_id"],
    "code_verifier": flow["verifier"],
}

# Variant A: JSON body
req = urllib.request.Request(TOKEN_EP, data=json.dumps(payload).encode(), headers={
    "Content-Type": "application/json", "Accept": "application/json", "User-Agent": UA}, method="POST")
try:
    with urllib.request.urlopen(req, timeout=30) as resp:
        print("=== JSON VARIANT OK === HTTP", resp.status)
        tok = json.loads(resp.read().decode())
        with open(".vidiq_token.json", "w") as f:
            json.dump(tok, f, indent=1)
        print("access_token:", tok.get("access_token", "")[:12] + "...")
        sys.exit(0)
except urllib.error.HTTPError as e:
    print("=== JSON VARIANT FALLO === HTTP", e.code, e.read().decode(errors="replace")[:300])
