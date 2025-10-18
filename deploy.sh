#!/bin/bash

# Production Deployment Script
set -e

echo "========================================"
echo "TikTok API - Production Deployment"
echo "========================================"

# Check if .env.production exists
if [ ! -f .env.production ]; then
    echo "❌ Error: .env.production not found"
    echo "Please copy .env.production.example and configure it"
    exit 1
fi

# Load environment variables
export $(cat .env.production | xargs)

# Optional: check for TIKTOK_COOKIE presence
if grep -q "^TIKTOK_COOKIE=" .env.production; then
    echo "TIKTOK_COOKIE found in .env.production (will be used as default cookie)"
else
    echo "Note: TIKTOK_COOKIE not found in .env.production. You can supply cookies per-request via X-TikTok-Cookie header or set TIKTOK_COOKIE in env."
fi

echo ""
echo "✅ Environment validated (basic checks)"
echo ""

# Pull latest images
echo "📥 Pulling Docker images..."
docker-compose pull

# Build application
echo "🔨 Building application..."
docker-compose build

# Stop existing containers
echo "🛑 Stopping existing containers..."
docker-compose down

# Start services
echo "🚀 Starting services..."
docker-compose up -d

# Wait for services to be healthy
echo ""
echo "⏳ Waiting for services to start..."
sleep 10

# Check health
echo ""
echo "🏥 Checking service health..."
curl -f http://localhost:8000/health || echo "⚠️  API not responding yet"

echo ""
echo "========================================"
echo "✅ Deployment Complete!"
echo "========================================"
echo ""
echo "Services running:"
echo "  - API: http://localhost:8000"
echo "  - API Docs: http://localhost:8000/api/docs"
echo "  - Nginx: http://localhost:80"
echo "  - Redis UI: http://localhost:8081"
echo ""
echo "View logs:"
echo "  docker-compose logs -f api"
echo ""
echo "Check status:"
echo "  docker-compose ps"
echo ""
