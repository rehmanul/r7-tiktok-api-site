FROM python:3.11-slim

# Set working directory
WORKDIR /app

# Install system dependencies needed for runtime
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Create a non-root user for running the app
RUN useradd --create-home --home-dir /nonroot -M nonroot || true

# Copy requirements
COPY requirements_prod.txt /app/

# Install Python dependencies
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r /app/requirements_prod.txt

# Copy application code
COPY production_api_real.py /app/

# Create logs directory and set permissions
RUN mkdir -p /app/logs && chown -R nonroot:nonroot /app/logs /app

# Switch to non-root user
USER nonroot

# Expose port
EXPOSE 8000

# Health check - use curl if available
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1

# Run with gunicorn for production
CMD ["gunicorn", "production_api_real:app", "--workers", "4", "--worker-class", "uvicorn.workers.UvicornWorker", "--bind", "0.0.0.0:8000", "--access-logfile", "/app/logs/access.log", "--error-logfile", "/app/logs/error.log", "--log-level", "info"]
