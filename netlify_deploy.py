import os, json, hashlib, time, urllib.request, urllib.error, mimetypes

NETLIFY_TOKEN = "nfp_optnphRDW3mfZA2wKrWCH9LVmpGJWkX27e3c"
DIR = os.path.dirname(os.path.abspath(__file__))
API = "https://api.netlify.com/api/v1"

def api(path, method="GET", data=None, raw=False):
    url = API + path
    headers = {"Authorization": f"Bearer {NETLIFY_TOKEN}"}
    if data is not None and not raw:
        headers["Content-Type"] = "application/json"
        body = json.dumps(data).encode()
    elif raw:
        body = data
        headers["Content-Type"] = "application/octet-stream"
    else:
        body = None
    req = urllib.request.Request(url, data=body, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        print(f"  API Error {e.code}: {e.read().decode()[:200]}")
        return None

# 1. Create site
print("\n  📦 Creating Netlify site...")
site = api("/sites", "POST", {"name": "facehunt-search", "custom_domain": None})
if not site or "id" not in site:
    print("  ❌ Site creation failed, trying with random name...")
    site = api("/sites", "POST", {"name": "", "custom_domain": None})
if not site or "id" not in site:
    print(f"  ❌ Failed: {site}")
    exit(1)

site_id = site["id"]
site_url = site.get("ssl_url") or site.get("url", "?")
site_name = site.get("name", "?")
print(f"  ✅ Site: {site_name}")
print(f"  🌐 URL: {site_url}")

# 2. Get files
skip_dirs = {".git", "__pycache__", "node_modules"}
skip_files = {"netlify_deploy.py", "GITHUB_SSH_KEY.txt"}
files = []
for root, dirs, fnames in os.walk(DIR):
    dirs[:] = [d for d in dirs if d not in skip_dirs]
    for fname in fnames:
        if fname in skip_files: continue
        fpath = os.path.join(root, fname)
        rel = os.path.relpath(fpath, DIR)
        if rel.startswith("."): continue
        files.append({
            "path": f"/{rel}",
            "local": fpath,
            "sha1": hashlib.sha1(open(fpath, "rb").read()).hexdigest(),
            "size": os.path.getsize(fpath)
        })
files.sort(key=lambda x: x["path"])

print(f"  📁 {len(files)} files to deploy")

# 3. Start deploy
manifest = [{"path": f["path"], "sha1": f["sha1"], "size": f["size"]} for f in files]
print("  🚀 Starting deploy...")
deploy = api(f"/sites/{site_id}/deploys", "POST", {"files": manifest, "functions": []})
if not deploy or "id" not in deploy:
    print(f"  ❌ Deploy failed: {deploy}")
    exit(1)

deploy_id = deploy["id"]
required = deploy.get("required", [])
print(f"  📤 Uploading {len(required)} files...")

for req_file in required:
    fpath = req_file["path"].lstrip("/")
    local_path = os.path.join(DIR, fpath)
    key = req_file.get("key", "")
    if os.path.exists(local_path) and key:
        data = open(local_path, "rb").read()
        put_req = urllib.request.Request(key, data=data, method="PUT", 
            headers={"Content-Type": "application/octet-stream"})
        try:
            urllib.request.urlopen(put_req, timeout=120)
        except Exception as e:
            print(f"    ⚠️ {fpath}: {e}")

# 4. Wait for deploy
print("  ⏳ Waiting for deploy...")
for i in range(60):
    time.sleep(2)
    status = api(f"/sites/{site_id}/deploys/{deploy_id}")
    if not status: continue
    state = status.get("state", "")
    print(f"    [{i*2}s] {state}")
    if state == "ready":
        print(f"\n  ✅ DEPLOY READY!")
        break
    elif state == "error":
        print(f"\n  ❌ Deploy error")
        break

# 5. Set environment variable
print("\n  🔑 Setting FACECHECK_ACCOUNTS env var...")
env_data = [
    {"key": "FACECHECK_ACCOUNTS",
     "value": '[{"name":"Account 2","token":"R9nm3AAxa0LFn+yN+wCXpYLLqWurLHN0sh6dURx+FZDaKuUx9hgCRxtq2EWzWUc4AqWvCQ+Tirk=","account_id":"GHJN-F6IZ-WAKR"},{"name":"Old Account","token":"x+Y1Le+x//b8sY0E70JgjIYurok0aqTMDsu0vsJWVPKihdVQ25WRJWuTnS8lH3b7y1+CTv8g3gw=","account_id":"UZ2G-2PNM-UZZQ"},{"name":"Account 1","token":"mJ/vHLqKO/KboRvqDNgn4CqSEJ/+dYWoRpiV3UYyLZRHR4Utj2lU2DD3xcDhHMRSZilIY+CdoRY=","account_id":"DUAF-JWBN-KZMV"},{"name":"Account 5","token":"iHv7l45jnuwm0LrIU0VxCBcK8oyA9CEZwKFq95QsZ2urxQVSj2ONN22Nae6DWDc7DLAjzjgBPg=","account_id":"1Z95-ZDUU-H45F"}]',
     "values": [{"context": "all", "value": '[{"name":"Account 2","token":"R9nm3AAxa0LFn+yN+wCXpYLLqWurLHN0sh6dURx+FZDaKuUx9hgCRxtq2EWzWUc4AqWvCQ+Tirk=","account_id":"GHJN-F6IZ-WAKR"},{"name":"Old Account","token":"x+Y1Le+x//b8sY0E70JgjIYurok0aqTMDsu0vsJWVPKihdVQ25WRJWuTnS8lH3b7y1+CTv8g3gw=","account_id":"UZ2G-2PNM-UZZQ"},{"name":"Account 1","token":"mJ/vHLqKO/KboRvqDNgn4CqSEJ/+dYWoRpiV3UYyLZRHR4Utj2lU2DD3xcDhHMRSZilIY+CdoRY=","account_id":"DUAF-JWBN-KZMV"},{"name":"Account 5","token":"iHv7l45jnuwm0LrIU0VxCBcK8oyA9CEZwKFq95QsZ2urxQVSj2ONN22Nae6DWDc7DLAjzjgBPg=","account_id":"1Z95-ZDUU-H45F"}]'}]
    }
]
env_result = api(f"/sites/{site_id}/env", "PUT", env_data)
if env_result:
    print(f"  ✅ Environment variable set!")
else:
    print(f"  ⚠️ Env var might need manual setup")

print(f"\n  ═══════════════════════════════")
print(f"  🎉 DEPLOY COMPLETE!")
print(f"  🌐 {site_url}")
print(f"  ═══════════════════════════════")
