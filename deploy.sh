#!/bin/bash

set -euo pipefail

ENV_FILE="${ENV_FILE:-.env.production}"

if ! command -v docker >/dev/null 2>&1; then
  echo "ERROR: Docker is required but was not found in PATH."
  exit 1
fi

if ! command -v docker compose >/dev/null 2>&1; then
  echo "ERROR: Docker Compose V2 is required (docker compose)."
  exit 1
fi

if [ ! -f "${ENV_FILE}" ]; then
  echo "ERROR: Environment file '${ENV_FILE}' not found."
  echo "   Create one (e.g. copy env.production.example) before deploying."
  exit 1
fi

echo "Deploying TikTok API using Docker Compose"
echo "-------------------------------------------"
echo "Environment file: ${ENV_FILE}"
echo ""

echo "[1/4] Building image..."
docker compose --env-file "${ENV_FILE}" build

echo "[2/4] Stopping existing containers..."
docker compose --env-file "${ENV_FILE}" down --remove-orphans

echo "[3/4] Starting services..."
docker compose --env-file "${ENV_FILE}" up -d

echo "[4/4] Waiting for health check..."
for attempt in {1..10}; do
  if curl -fsS "http://localhost:${PORT:-3000}/health" >/dev/null 2>&1; then
    echo "API is healthy."
    docker compose --env-file "${ENV_FILE}" ps
    exit 0
  fi
  echo "Waiting for service to become healthy (attempt ${attempt}/10)..."
  sleep 3
done

echo "WARNING: API health check did not succeed. Inspect logs with:"
echo "    docker compose --env-file \"${ENV_FILE}\" logs -f"
exit 1
