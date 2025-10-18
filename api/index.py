# Vercel Python ASGI entrypoint wrapper
# Vercel will install requirements.txt and run this file as a serverless function.

from production_api_real import app

# Vercel expects a top-level 'app' variable that is an ASGI/WSGI application.
# We're simply exposing the FastAPI app defined at project root.

__all__ = ["app"]
