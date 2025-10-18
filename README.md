TikTok API - Production
=======================

This repository contains a production-ready FastAPI service that fetches TikTok posts by scraping TikTok using a browser cookie you provide (no third-party data provider required). The automation in this repo includes Docker, docker-compose, systemd service template, and monitoring configs.

Quick start (local, requires Docker):

1. Copy environment example and fill values:

   cp .env.production.example .env.production

   # edit .env.production and set TIKTOK_COOKIE (optional) and DATABASE_URL

2. Build and start:

   docker-compose build
   docker-compose up -d

3. Check health:

   curl <http://localhost:8000/health>

CI:

A GitHub Actions workflow is included at `.github/workflows/ci.yml` which runs lint and basic repository checks on push.

Security & Secrets:

- Do NOT commit `.env.production` with real secrets. Use a secret manager or CI secrets.
- Ports for Postgres and Redis are not published to the host in `docker-compose.yml` to minimize exposure.
- This deployment is live-data only: there is no caching layer and no database. The app fetches TikTok pages on-demand.
- You can hardcode a cookie in `.env.production` under `TIKTOK_COOKIE` for convenience, but this is not recommended for security reasons. Prefer Vercel env vars or per-request `X-TikTok-Cookie`.

Files changed by automation:

- `production_api_real.py` — environment-driven config, improved logging and startup handling
- `Dockerfile` — runs as non-root, adds healthcheck and log dir permissions
- `docker-compose.yml` — removed host port mappings for DB/Redis and added resource limits for `api`
- `.dockerignore` — reduce build context
- `.env.production` sanitized (backup saved as `.env.production.bak`)
- `README.md` (this file)
- `.github/workflows/ci.yml` (CI)
- `tests/test_repo_smoke.py` (basic smoke tests)

Vercel Deployment
-----------------

This project can be deployed to Vercel using the Python runtime. A small wrapper is provided at `api/index.py` which exposes the FastAPI `app` to Vercel.

Steps to deploy to Vercel:

1. Sign in to Vercel and create a new project connected to this GitHub repository.
2. Ensure `requirements.txt` is present (it is in the repo). Vercel will install dependencies from this file.
3. In the Vercel project settings, add environment variables (do NOT put secrets in the repository):
    - `TIKTOK_COOKIE` — optional cookie string if you want a global default
    - `REDIS_HOST`, `REDIS_PORT`, etc., as needed
4. Deploy. The `vercel.json` config routes all requests to `api/index.py` which serves the FastAPI app.

Notes:

- Serverless functions on Vercel have execution time limits. For long-running EnsembleData fetches or high-concurrency workloads consider deploying to a container platform (K8s) or using Vercel's Advanced/Enterprise options.
- Local redis/postgres are not available on Vercel; use managed services and set the connection strings in the environment.

Using your own TikTok cookies (no EnsembleData)
---------------------------------------------

This project can use your TikTok browser cookies to fetch pages directly from TikTok instead of relying on EnsembleData.

Two ways to provide cookies:

1) Per-request header: include `X-TikTok-Cookie` with the value from your browser (example: `s_v_web_id=...; tt_webid_v2=...; ...`).
    Example curl:

```bash
curl -H "X-API-Key: prod_key_001" -H "X-TikTok-Cookie: 's_v_web_id=...; tt_webid_v2=...; '" \
   "https://your-vercel-deployment.vercel.app/v1/tiktok/posts?username=someuser"
```

2) Global environment variable: set `TIKTOK_COOKIE` in Vercel Project Settings (Environment Variables). The app will use this cookie as a default client.

How to extract cookies from your browser (Chrome/Chromium):

1. Open Developer Tools (F12) -> Application -> Cookies -> <https://www.tiktok.com>
2. Copy the cookie key/value pairs and join them with `;` (semicolon + space)
3. Use the cookie string in the `X-TikTok-Cookie` header or set `TIKTOK_COOKIE` in Vercel.

Caveats & legality:

- Scraping TikTok may violate their terms of service. Ensure you have the right to use and store these cookies. Do not expose other users' private data.
- Cookies expire and must be refreshed when invalid.
- Vercel serverless functions have limited execution time — long scraping may fail.

Next steps / Recommendations:

- Rotate any exposed secrets immediately.
- Use a proper secret manager (Vault, AWS Secrets Manager, Azure Key Vault) for production secrets.
- Add real integration tests that exercise the app with a running Docker Compose stack.
- Set up alerting (Sentry is scaffolded) and metrics scraping (Prometheus).
