#!/bin/bash
# FinGOAT GCP VM Deployment Script
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
echo "=== FinGOAT Deployment Script ==="

# ─── 1. Install Docker ────────────────────────────────────────────────────────
if ! command -v docker &>/dev/null; then
  echo "[1/3] Installing Docker..."
  sudo apt-get update -qq
  sudo apt-get install -y docker.io docker-compose curl
  sudo usermod -aG docker "$USER"
  sudo systemctl enable --now docker
else
  echo "[1/3] Docker already installed, skipping."
fi

# ─── 2. Configure environment ─────────────────────────────────────────────────
echo "[2/3] Configuring environment..."
cd "$ROOT_DIR"

ENV_FILE="./langchain-v1/.env"
if [ ! -f "$ENV_FILE" ]; then
  cp ./langchain-v1/.env.trading "$ENV_FILE"
  echo "Created .env from template."
fi

# Auto-detect GCP public IP
PUBLIC_IP=$(curl -sf \
  "http://metadata.google.internal/computeMetadata/v1/instance/network-interfaces/0/access-configs/0/external-ip" \
  -H "Metadata-Flavor: Google" || echo "")
if [ -n "$PUBLIC_IP" ]; then
  sed -i "s|FRONTEND_ORIGINS=.*|FRONTEND_ORIGINS=http://$PUBLIC_IP,http://localhost|g" docker-compose.yml
  echo "Updated FRONTEND_ORIGINS → http://$PUBLIC_IP"
fi

# ─── 3. Build and start ───────────────────────────────────────────────────────
echo "[3/3] Building and starting services..."
sg docker -c "docker-compose down --remove-orphans || true"
sg docker -c "docker-compose up -d --build"

echo ""
echo "=== Done ==="
[ -n "$PUBLIC_IP" ] && echo "Open: http://$PUBLIC_IP"
echo "Logs: docker-compose logs -f"
