import json, urllib.request, urllib.parse, secrets, hashlib, base64

UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
AUTHZ = "https://mcp.vidiq.com/mcp/authorize"

with open(".vidiq_oauth_flow.json") as f:
    flow = json.load(f)  # reuse client_id + redirect_uri ya registrados

def b64url(raw): return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()

verifier = b64url(secrets.token_bytes(32))
challenge = b64url(hashlib.sha256(verifier.encode()).digest())
state = b64url(secrets.token_bytes(12))

params = {
    "response_type": "code",
    "client_id": flow["client_id"],
    "redirect_uri": flow["redirect_uri"],
    "code_challenge": challenge,
    "code_challenge_method": "S256",
    "scope": "api",
    "state": state,
}
auth_url = AUTHZ + "?" + urllib.parse.urlencode(params)

flow.update({"verifier": verifier, "state": state})
with open(".vidiq_oauth_flow.json", "w") as f:
    json.dump(flow, f, indent=1)

print(auth_url)
