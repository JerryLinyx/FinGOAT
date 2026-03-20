FROM python:3.11-slim

WORKDIR /app
ENV PYTHONPATH=/app/services/market-data-service:/app/services/python-common

RUN apt-get update && apt-get install -y \
    gcc \
    g++ \
    && rm -rf /var/lib/apt/lists/*

COPY services/python-common /app/services/python-common
COPY services/market-data-service /app/services/market-data-service

RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r /app/services/python-common/requirements.txt

WORKDIR /app/services/market-data-service

EXPOSE 8002

HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
    CMD python -c "import requests; requests.get('http://localhost:8002/health')"

CMD ["uvicorn", "market_data_service:app", "--host", "0.0.0.0", "--port", "8002", "--log-level", "info"]
