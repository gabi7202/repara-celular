import json, urllib.request, urllib.error, urllib.parse, secrets, hashlib, base64

UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
REGISTER = "https://mcp.vidiq.com/mcp/register"
AUTHZ = "https://mcp.vidiq.com/mcp/authorize"
REDIRECT = "http://localhost:9654/callback"

def b64url(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()

# --- PKCE ---
verifier = b64url(secrets.token_bytes(32))
challenge = b64url(hashlib.sha256(verifier.encode()).digest())
state = b64url(secrets.token_bytes(12))

# --- Dynamic client registration (RFC 7591) ---
reg_payload = {
    "client_name": "Qwen Workspace MCP Client",
    "redirect_uris": [REDIRECT],
    "grant_types": ["authorization_code", "refresh_token"],
    "response_types": ["code"],
    "token_endpoint_auth_method": "none",
    "scope": "api",
}
data = json.dumps(reg_payload).encode()
r = urllib.request.Request(REGISTER, data=data, headers={
    "Content-Type": "application/json", "Accept": "application/json", "User-Agent": UA}, method="POST")
try:
    with urllib.request.urlopen(r, timeout=30) as resp:
        reg = json.loads(resp.read().decode())
        print("=== REGISTRO OK === HTTP", resp.status)
except urllib.error.HTTPError as e:
    print("=== REGISTRO FALLO === HTTP", e.code)
    print(e.read().decode(errors="replace")[:800])
    raise SystemExit(1)

client_id = reg.get("client_id")
print(json.dumps(reg, indent=1)[:600])

# --- Build authorize URL ---
params = {
    "response_type": "code",
    "client_id": client_id,
    "redirect_uri": REDIRECT,
    "code_challenge": challenge,
    "code_challenge_method": "S256",
    "scope": "api",
    "state": state,
}
auth_url = AUTHZ + "?" + urllib.parse.urlencode(params)

# --- Save flow state for the token exchange step ---
with open(".vidiq_oauth_flow.json", "w") as f:
    json.dump({"client_id": client_id, "verifier": verifier, "state": state,
               "redirect_uri": REDIRECT, "registration": reg}, f, indent=1)

print("\n=== URL DE AUTORIZACION (para el usuario) ===")
print(auth_url)
