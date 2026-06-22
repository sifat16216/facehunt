# ⬡ FACE HUNT — AI Face Search Engine

AI-powered face search engine. Upload a face photo and search across **1.38 billion indexed faces** to find social media profiles and web presence.

## Features

- 🔍 **Face Recognition** — Upload any face photo to search
- 🚀 **Serverless** — Runs on Netlify Edge Functions (zero server cost)
- 🎯 **Smart Token Rotation** — Priority-based account management for best results
- 🌐 **Multi-Platform** — Detects TikTok, Instagram, Facebook, Twitter, YouTube, LinkedIn & more
- 🎨 **Glass UI** — Modern glassmorphism design with laser scanning animation

## Architecture

```
frontend (index.html) → Netlify Function → facecheck.id API
```

## Environment Variables (Netlify)

| Variable | Description |
|----------|------------|
| `FACECHECK_ACCOUNTS` | JSON array of accounts with tokens (see setup) |

### FACECHECK_ACCOUNTS format:
```json
[
  {"name":"Account 2","token":"TOKEN_HERE","account_id":"GHJN-F6IZ-WAKR"},
  {"name":"Old Account","token":"TOKEN_HERE","account_id":"UZ2G-2PNM-UZZQ"}
]
```

## Deploy

1. Fork/push to GitHub
2. Connect repo to Netlify
3. Add `FACECHECK_ACCOUNTS` env var
4. Deploy!

---

**Developed by TOHIDUL ISLAM SIFAT**
