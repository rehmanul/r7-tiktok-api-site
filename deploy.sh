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

# Check for EnsembleData token
if [ "$ENSEMBLEDATA_TOKEN" = "your_token_here" ]; then
    echo "❌ Error: Please configure ENSEMBLEDATA_TOKEN in .env.production"
    exit 1
fi

echo ""
echo "✅ Environment validated"
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
