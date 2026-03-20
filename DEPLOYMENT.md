# FinGOAT Docker & Kubernetes Deployment Guide

## 🐳 Docker Compose Deployment

### Prerequisites
- Docker 20.10+
- Docker Compose 2.0+

### Quick Start

1. **Configure API Keys**
   ```bash
   cd services/trading-service
   cp .env.trading .env
   # Edit .env and fill in your API keys
   ```

2. **Build and start all services**
   ```bash
   docker-compose up -d --build
   ```

3. **Check service status**
   ```bash
   docker-compose ps
   docker-compose logs -f
   ```

4. **Access the app**
   - Entry (Nginx): http://localhost  *(on GCP VM use http://<VM public IP>)*
   - Frontend: http://localhost:8080
   - Backend API: http://localhost:3000
   - Trading Service: http://localhost:8001/docs
   - PostgreSQL: localhost:5432
   - Redis: localhost:6379

> GCP VM tip: open TCP port 80; for HTTPS, add cert config in `nginx/default.conf` or terminate TLS via Cloud Load Balancer/Cloud Armor.

### Common Commands

```bash
# Stop all services
docker-compose down

# Stop and remove volumes (will clear the database)
docker-compose down -v

# View logs
docker-compose logs -f [service-name]

# Restart a single service
docker-compose restart backend

# Enter containers
docker-compose exec backend sh
docker-compose exec trading-service bash
```

### Service Topology

```
┌──────────────┐      ┌─────────────┐      ┌──────────────────┐
│   Nginx      │────▶ │   Backend   │────▶ │ Trading Service  │
│ (port 80)    │      │  (Go:3000)  │      │  (Python:8001)   │
│      │       │      └─────────────┘      └──────────────────┘
│      ▼       │              │                       │
│  Frontend    │              ▼                       ▼
│ (Nginx:80)   │       ┌─────────────┐        ┌─────────────┐
└──────────────┘       │  PostgreSQL │        │   LLM APIs  │
                       │    :5432    │        │  (OpenAI)   │
                       └─────────────┘        └─────────────┘
                              │
                              ▼
                       ┌─────────────┐
                       │    Redis    │
                       │    :6379    │
                       └─────────────┘
```

## ☸️ Kubernetes Deployment

### Prerequisites
- Kubernetes 1.20+
- kubectl configured
- Access to an image registry

### Steps

1. **Build and push images**
   ```bash
   export REGISTRY=your-registry.com
   export VERSION=v1.0.0
   
   docker build -t $REGISTRY/fingoat-backend:$VERSION -f backend/Dockerfile backend/
   docker build -t $REGISTRY/fingoat-frontend:$VERSION -f frontend/Dockerfile frontend/
   docker build -t $REGISTRY/fingoat-trading:$VERSION -f services/trading-service/Dockerfile .
   
   docker push $REGISTRY/fingoat-backend:$VERSION
   docker push $REGISTRY/fingoat-frontend:$VERSION
   docker push $REGISTRY/fingoat-trading:$VERSION
   ```

2. **Configure Secrets**
   
   Edit secrets in `k8s/deployment.yaml` with real API keys, or create via kubectl:
   ```bash
   kubectl create secret generic fingoat-secrets \
     --from-literal=postgres-password=your-password \
     --from-literal=openai-api-key=sk-... \
     --from-literal=alpha-vantage-api-key=... \
     -n fingoat
   ```

3. **Deploy to Kubernetes**
   ```bash
   kubectl create namespace fingoat
   kubectl apply -f k8s/deployment.yaml
   kubectl get all -n fingoat
   kubectl get pods -n fingoat -w
   ```

4. **Access the app**
   ```bash
   kubectl get svc frontend -n fingoat        # get LoadBalancer IP
   kubectl port-forward svc/frontend 8080:80 -n fingoat  # for local test
   # http://localhost:8080
   ```

### K8s Common Commands

```bash
kubectl get pods -n fingoat
kubectl logs -f deployment/backend -n fingoat
kubectl logs -f deployment/trading-service -n fingoat
kubectl exec -it deployment/backend -n fingoat -- sh
kubectl get svc -n fingoat
kubectl scale deployment backend --replicas=3 -n fingoat
kubectl delete namespace fingoat
```

### Production Tips

#### 1) Use Ingress (recommended)
```bash
kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/controller-v1.8.1/deploy/static/provider/cloud/deploy.yaml
kubectl apply -f https://github.com/cert-manager/cert-manager/releases/download/v1.13.0/cert-manager.yaml
```
Then fill your domain in the Ingress section of `k8s/deployment.yaml`.

#### 2) Managed storage
- AWS: RDS (PostgreSQL) + ElastiCache (Redis)
- GCP: Cloud SQL + Memorystore
- Azure: Azure Database for PostgreSQL + Azure Cache for Redis

#### 3) Resource tuning
```yaml
resources:
  requests:
    memory: "512Mi"
    cpu: "500m"
  limits:
    memory: "2Gi"
    cpu: "1000m"
```

#### 4) Horizontal Pod Autoscaler
```bash
kubectl autoscale deployment backend --cpu-percent=70 --min=2 --max=10 -n fingoat
kubectl autoscale deployment trading-service --cpu-percent=80 --min=2 --max=5 -n fingoat
```

## 🔧 Troubleshooting

### Docker Compose
```bash
docker-compose ps
docker-compose logs --tail=100 [service-name]
docker network inspect fingoat-network
docker-compose build --no-cache [service-name]
docker-compose up -d --force-recreate [service-name]
```

### Kubernetes
```bash
kubectl describe pod <pod-name> -n fingoat
kubectl logs <pod-name> -n fingoat --previous
kubectl logs <pod-name> -n fingoat --all-containers
kubectl top pods -n fingoat
kubectl top nodes
kubectl get configmap backend-config -n fingoat -o yaml
kubectl get secret fingoat-secrets -n fingoat -o yaml
```

### Running Docker Compose on a GCP VM
- Prep: install Docker & Compose, open port 80; ensure disk size or mount a data disk for DB persistence.
- Secrets: create `services/trading-service/.env` on the VM (API keys), optionally export `POSTGRES_PASSWORD`, `FRONTEND_ORIGINS`, etc., to override defaults.
- Start: `docker-compose up -d --build`; entry is `http://<VM public IP>` (Nginx 80 -> frontend/backend).
- Health: `curl http://<VM public IP>/api/health` (backend); `curl http://<VM public IP>/trading/health` (trading service).
- TLS: add cert paths in `nginx/default.conf` for 443, or terminate TLS via cloud load balancer.

## 📊 Observability and Logs

### Recommended stack
1. **Logs**: ELK Stack or Loki
2. **Monitoring**: Prometheus + Grafana
3. **Tracing**: Jaeger
4. **UI**: Kubernetes Dashboard

### Install Prometheus & Grafana
```bash
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm install prometheus prometheus-community/kube-prometheus-stack -n monitoring --create-namespace
```

## ☁️ Running Docker Compose on GCP VM (step-by-step)

1. Create VM and open ports  
   - Linux (Ubuntu/Debian recommended), disk ≥50GB.  
   - Allow 80 (HTTP); optionally 8080/3000/8001 for debugging.

2. Install Docker & Compose  
   ```bash
   sudo apt-get update
   sudo apt-get install -y ca-certificates curl gnupg vim
   ```
   Add Docker GPG Key
   ```bash
   sudo install -m 0755 -d /etc/apt/keyrings
   curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
   | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
   sudo chmod a+r /etc/apt/keyrings/docker.gpg
   ```
   Add Docker official APT repo
   ```bash
   echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
   | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
   ```
   ```bash
   sudo apt-get update
   sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
   ```

3. Clone repo  
   ```bash
   git clone https://github.com/JerryLinyx/FinGOAT.git && cd FinGOAT
   ```

4. Configure secrets / env vars  
   ```bash
   cd services/trading-service
   cp .env.trading .env    # fill OPENAI_API_KEY / DASHSCOPE_API_KEY / ALPHA_VANTAGE_API_KEY etc.
   cd ..

   cd TradingAgents
   cp .env.example .env

   export POSTGRES_PASSWORD='<strong-password>'
   # Optional:
   # export FRONTEND_ORIGINS="http://<domain>,http://<VM_IP>"
   # export LLM_TIMEOUT=300
   ```

5. Start all services  
   ```bash
   docker --version
   docker compose version
   sudo usermod -aG docker $USER
   exit
   docker ps
   docker compose up -d --build
   ```

6. Health checks  
   ```bash
   curl http://localhost/api/health
   curl http://localhost/trading/health
   ```
   Browser entry: `http://<VM public IP>/`

7. Logs and maintenance  
   ```bash
   docker compose ps
   docker compose logs -f backend   # or frontend / nginx / trading-service
   docker compose restart nginx frontend
   docker compose down              # stop (keep volumes)
   ```

8. HTTPS (optional)  
   - Add cert paths in `nginx/default.conf` and listen on 443, or offload TLS with a cloud load balancer.

## 🔐 Security Tips

1. **Do not hardcode secrets** — use Kubernetes Secrets or Vault.
2. **Private image registry**
   ```bash
   kubectl create secret docker-registry regcred \
     --docker-server=<your-registry> \
     --docker-username=<username> \
     --docker-password=<password> \
     -n fingoat
   ```
3. **Enable Network Policies** to restrict pod-to-pod access.
4. **Update images regularly** and run vulnerability scans (e.g., Trivy).

## 📝 Env Vars

### Backend (Go)
- `GIN_MODE`: release/debug

### Trading Service (Python)
- `TRADING_SERVICE_PORT`: service port (default 8001)
- `LLM_PROVIDER`: openai/claude/gemini etc.
- `LLM_BASE_URL`: LLM API endpoint
- `OPENAI_API_KEY`: OpenAI API key
- `ALPHA_VANTAGE_API_KEY`: Alpha Vantage API key
