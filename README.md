TikTok API - Production
=======================

This repository contains a production-ready FastAPI service that integrates with EnsembleData to fetch TikTok posts. The automation in this repo includes Docker, docker-compose, systemd service template, and monitoring configs.

Quick start (local, requires Docker):

1. Copy environment example and fill values:

   cp .env.production.example .env.production

   # edit .env.production and set ENSEMBLEDATA_TOKEN and DATABASE_URL

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
   - `ENSEMBLEDATA_TOKEN` — your token
   - `REDIS_HOST`, `REDIS_PORT`, etc., as needed
4. Deploy. The `vercel.json` config routes all requests to `api/index.py` which serves the FastAPI app.

Notes:
- Serverless functions on Vercel have execution time limits. For long-running EnsembleData fetches or high-concurrency workloads consider deploying to a container platform (K8s) or using Vercel's Advanced/Enterprise options.
- Local redis/postgres are not available on Vercel; use managed services and set the connection strings in the environment.


Next steps / Recommendations:

- Rotate any exposed secrets immediately.
- Use a proper secret manager (Vault, AWS Secrets Manager, Azure Key Vault) for production secrets.
- Add real integration tests that exercise the app with a running Docker Compose stack.
- Set up alerting (Sentry is scaffolded) and metrics scraping (Prometheus).
