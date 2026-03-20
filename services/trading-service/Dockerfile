FROM python:3.11-slim

WORKDIR /app
ENV PYTHONPATH=/app/services/trading-service:/app/services/python-common:/app/TradingAgents

# Install system dependencies
RUN apt-get update && apt-get install -y \
    gcc \
    g++ \
    && rm -rf /var/lib/apt/lists/*

COPY TradingAgents /app/TradingAgents
COPY services/python-common /app/services/python-common
COPY services/trading-service /app/services/trading-service

# Install Python dependencies
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r /app/services/python-common/requirements.txt

# Install TradingAgents in editable mode
RUN pip install -e /app/TradingAgents

WORKDIR /app/services/trading-service

EXPOSE 8001

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD python -c "import requests; requests.get('http://localhost:8001/health')"

CMD ["uvicorn", "trading_service:app", "--host", "0.0.0.0", "--port", "8001", "--log-level", "info"]
