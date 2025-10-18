# TikTok Cookie API

Minimal FastAPI service that scrapes TikTok directly using a browser cookie you supply.  
It exposes a single endpoint (`GET /v1/tiktok/posts`) that returns live post metadata for a username with optional pagination and epoch filtering. The code is dependency-light (only FastAPI/Pydantic/Uvicorn plus stdlib) so it runs cleanly on Vercel or any Python host.

## Key Features
- Real-time scraping – no external data providers or databases.
- Cookie-driven authentication; override per request with `X-TikTok-Cookie`.
- Query params: `username` (required), `page`, `per_page`, `start_epoch`, `end_epoch`.
- Structured response with `meta` block and normalised post fields (id, url, description, views, likes, comments, shares, epoch).
- Built-in HTML console at `/manage` for quick manual checks.
- Lightweight in-memory rate limiter and retry/backoff logic.

## Quick Start (local)
1. **Install deps**
   ```powershell
   py -3 -m pip install --upgrade pip
   py -3 -m pip install -r requirements.txt
   ```
2. **Set a TikTok cookie**
   - Edit `production_api_real.py` and replace `HARDCODED_TIKTOK_COOKIE` with your cookie string **(never commit real cookies)**, or plan to send it via `X-TikTok-Cookie` header at request time.
3. **Run the API**
   ```powershell
   py -3 -m uvicorn production_api_real:app --host 0.0.0.0 --port 8000
   ```
4. **Fetch data**
   ```powershell
   curl -H "X-TikTok-Cookie: s_v_web_id=...; tt_webid_v2=..." ^
        "http://localhost:8000/v1/tiktok/posts?username=techreviews&page=1&per_page=10"
   ```
5. **Use the console**
   Visit <http://localhost:8000/manage> to run queries from the browser (paste your cookie if needed).

## Response Shape
```jsonc
{
  "meta": {
    "page": 1,
    "total_pages": 8,
    "posts_per_page": 10,
    "total_posts": 76,
    "start_epoch": 1697068800,
    "end_epoch": 1729468800,
    "first_video_epoch": 1729382400,
    "last_video_epoch": 1697155200,
    "request_time": 1760758519,
    "username": "techreviews",
    "processing_time_ms": 184.32
  },
  "data": [
    {
      "video_id": "7423156789012345678",
      "url": "https://www.tiktok.com/@techreviews/video/7423156789012345678",
      "description": "This new AI gadget is mind-blowing! #tech #AI",
      "epoch_time_posted": 1729382400,
      "views": 2847523,
      "likes": 342891,
      "comments": 5847,
      "shares": 28934
    }
  ]
}
```

## Tests
```
py -3 -m pytest -q
```
Parser tests rely on the shared helper in `production_parser.py` to ensure the same logic is exercised.

## Deploying to Vercel
- `vercel.json` routes all traffic to `api/index.py`, which simply re-exports the FastAPI app.
- GitHub Action `.github/workflows/vercel-deploy.yml` deploys on pushes to `main`. Set repository secrets:
  - `VERCEL_TOKEN`
  - `VERCEL_ORG_ID`
  - `VERCEL_PROJECT_ID`
- In Vercel project settings add an environment variable `TIKTOK_COOKIE` if you want a global default cookie; otherwise send `X-TikTok-Cookie` per request.

## Security & Operational Notes
- TikTok cookies are sensitive. Rotate them regularly and keep them out of source control.
- Scraping may violate TikTok’s terms—ensure you have the right to use the data.
- Rate limiter is in-memory; scale-out deployments should switch to a shared store (e.g., Redis) if needed.
- Response accuracy depends on TikTok’s HTML. Parser has multiple fallbacks, but add fixtures/tests whenever layout changes are observed.

## Project Structure
- `production_api_real.py` – FastAPI application + TikTok client.
- `production_parser.py` – reusable parser helpers used by the app and tests.
- `api/index.py` – Vercel entrypoint.
- `tests/test_parser.py` – parser unit tests.
- `scripts/run_tests.ps1` – optional helper to run tests in a fresh venv.
