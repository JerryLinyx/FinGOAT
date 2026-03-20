# FinGOAT Docker & Kubernetes 部署指南

## 🐳 Docker Compose 部署

### 前置要求
- Docker 20.10+
- Docker Compose 2.0+

### 快速启动

1. **配置 API Keys**
   ```bash
   cd services/trading-service
   cp .env.trading .env
   # 编辑 .env 文件，填入你的 API keys
   ```

2. **构建并启动所有服务**
   ```bash
   docker-compose up -d --build
   ```

3. **查看服务状态**
   ```bash
   docker-compose ps
   docker-compose logs -f
   ```

4. **访问应用**
   - 入口 (Nginx): http://localhost   *(GCP VM 上用 http://<VM公网IP>)*
   - 前端容器: http://localhost:8080
   - 后端 API: http://localhost:3000
   - Trading Service: http://localhost:8001/docs
   - PostgreSQL: localhost:5432
   - Redis: localhost:6379

> GCP VM 提示：开放 TCP 80 端口；如需 HTTPS，在 `nginx/default.conf` 加证书配置或用 Cloud Load Balancer/Cloud Armor 终结 TLS。

### 常用命令

```bash
# 停止所有服务
docker-compose down

# 停止并删除卷 (会清空数据库)
docker-compose down -v

# 查看日志
docker-compose logs -f [service-name]

# 重启单个服务
docker-compose restart backend

# 进入容器
docker-compose exec backend sh
docker-compose exec trading-service bash
```

### 服务架构

```
┌──────────────┐      ┌─────────────┐      ┌──────────────────┐
│   Nginx      │────▶ │   Backend   │────▶ │ Trading Service  │
│ (port 80)    │      │  (Go:3000)  │      │  (Python:8001)   │
│      │       │      └─────────────┘      └──────────────────┘
│      ▼       │              │                       │
│  Frontend    │              ▼                       ▼
│ (Nginx:80)   │       ┌─────────────┐        ┌─────────────┐
└──────────────┘       │  PostgreSQL │        │ LLM APIs    │
                       │   :5432     │        │ (OpenAI等)  │
                       └─────────────┘        └─────────────┘
                              │
                              ▼
                       ┌─────────────┐
                       │    Redis    │
                       │   :6379     │
                       └─────────────┘
```

## ☸️ Kubernetes 部署

### 前置要求
- Kubernetes 1.20+
- kubectl 配置完成
- 镜像仓库访问权限

### 部署步骤

1. **构建并推送镜像**
   
   ```bash
   # 为你的镜像仓库打标签
   export REGISTRY=your-registry.com
   export VERSION=v1.0.0
   
   # 构建镜像
   docker build -t $REGISTRY/fingoat-backend:$VERSION -f backend/Dockerfile backend/
   docker build -t $REGISTRY/fingoat-frontend:$VERSION -f frontend/Dockerfile frontend/
   docker build -t $REGISTRY/fingoat-trading:$VERSION -f services/trading-service/Dockerfile .
   
   # 推送到镜像仓库
   docker push $REGISTRY/fingoat-backend:$VERSION
   docker push $REGISTRY/fingoat-frontend:$VERSION
   docker push $REGISTRY/fingoat-trading:$VERSION
   ```

2. **配置 Secrets**
   
   编辑 `k8s/deployment.yaml` 中的 Secret，填入真实的 API keys：
   
   ```bash
   # 或者使用 kubectl 创建 secret
   kubectl create secret generic fingoat-secrets \
     --from-literal=postgres-password=your-password \
     --from-literal=openai-api-key=sk-... \
     --from-literal=alpha-vantage-api-key=... \
     -n fingoat
   ```

3. **部署到 Kubernetes**
   
   ```bash
   # 创建 namespace
   kubectl create namespace fingoat
   
   # 应用所有配置
   kubectl apply -f k8s/deployment.yaml
   
   # 查看部署状态
   kubectl get all -n fingoat
   kubectl get pods -n fingoat -w
   ```

4. **访问应用**
   
   ```bash
   # 获取前端 LoadBalancer IP
   kubectl get svc frontend -n fingoat
   
   # 或使用 port-forward 测试
   kubectl port-forward svc/frontend 8080:80 -n fingoat
   # 访问 http://localhost:8080
   ```

### K8s 常用命令

```bash
# 查看 Pod 状态
kubectl get pods -n fingoat

# 查看 Pod 日志
kubectl logs -f deployment/backend -n fingoat
kubectl logs -f deployment/trading-service -n fingoat

# 进入 Pod
kubectl exec -it deployment/backend -n fingoat -- sh

# 查看服务
kubectl get svc -n fingoat

# 扩容
kubectl scale deployment backend --replicas=3 -n fingoat

# 删除所有资源
kubectl delete namespace fingoat
```

### 生产环境优化

#### 1. 使用 Ingress (推荐)

如果有域名，使用 Ingress 而不是 LoadBalancer：

```bash
# 安装 Nginx Ingress Controller
kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/controller-v1.8.1/deploy/static/provider/cloud/deploy.yaml

# 安装 cert-manager (自动 HTTPS)
kubectl apply -f https://github.com/cert-manager/cert-manager/releases/download/v1.13.0/cert-manager.yaml
```

然后在 `k8s/deployment.yaml` 的 Ingress 配置中填入你的域名。

#### 2. 持久化存储

生产环境建议使用云服务商的托管数据库：
- AWS: RDS (PostgreSQL) + ElastiCache (Redis)
- GCP: Cloud SQL + Memorystore
- Azure: Azure Database for PostgreSQL + Azure Cache for Redis

#### 3. 资源限制调整

根据实际负载调整 `resources` 配置：

```yaml
resources:
  requests:
    memory: "512Mi"
    cpu: "500m"
  limits:
    memory: "2Gi"
    cpu: "1000m"
```

#### 4. 水平自动扩展 (HPA)

```bash
kubectl autoscale deployment backend --cpu-percent=70 --min=2 --max=10 -n fingoat
kubectl autoscale deployment trading-service --cpu-percent=80 --min=2 --max=5 -n fingoat
```

## 🔧 故障排查

### Docker Compose

```bash
# 检查容器状态
docker-compose ps

# 查看完整日志
docker-compose logs --tail=100 [service-name]

# 检查网络
docker network inspect fingoat-network

# 重新构建
docker-compose build --no-cache [service-name]
docker-compose up -d --force-recreate [service-name]
```

### Kubernetes

```bash
# 检查 Pod 事件
kubectl describe pod <pod-name> -n fingoat

# 查看详细日志
kubectl logs <pod-name> -n fingoat --previous
kubectl logs <pod-name> -n fingoat --all-containers

# 检查资源使用
kubectl top pods -n fingoat
kubectl top nodes

# 检查配置
kubectl get configmap backend-config -n fingoat -o yaml
kubectl get secret fingoat-secrets -n fingoat -o yaml
```

### 在 GCP VM 上运行 Docker Compose

- 准备：安装 Docker & Docker Compose，开放 80 端口；如果要持久化数据库，确保 VM 磁盘大小充足或挂载独立数据盘。
- Secrets：在 VM 上创建 `services/trading-service/.env`（包含各 API Key），并按需导出 `POSTGRES_PASSWORD`、`FRONTEND_ORIGINS` 等环境变量以覆盖默认值。
- 启动：`docker-compose up -d --build`；入口为 `http://<VM 公网 IP>`（Nginx 80 -> 前端/后端）。
- 健康检查：`curl http://<VM 公网 IP>/api/health` 验证后端；`curl http://<VM 公网 IP>/trading/health` 验证 Trading 服务。
- TLS：可在 `nginx/default.conf` 加入证书路径启用 443，或用 Cloud Load Balancer 终结 TLS。

## 📊 监控和日志

### 推荐工具

1. **日志收集**: ELK Stack 或 Loki
2. **监控**: Prometheus + Grafana
3. **追踪**: Jaeger
4. **可视化**: Kubernetes Dashboard

### 安装 Prometheus 和 Grafana

```bash
# 使用 Helm
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm install prometheus prometheus-community/kube-prometheus-stack -n monitoring --create-namespace
```

## ☁️ 在 GCP VM 上运行 Docker Compose

1. 创建 VM 并开放端口  
   - 选择 Linux（推荐 Ubuntu/Debian），磁盘 ≥50GB。  
   - 防火墙放行 80（HTTP），可选放行 8080/3000/8001（调试）。

2. 安装 Docker & Compose（VM 上执行）  
   ```bash
   sudo apt-get update
   sudo apt-get install -y \
    ca-certificates \
    curl \
    gnupg \
    vim
   ```
   Add Docker GPG Key
   ```bash
   sudo install -m 0755 -d /etc/apt/keyrings
   curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
   | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
   sudo chmod a+r /etc/apt/keyrings/docker.gpg
   ```

   Add Docker official APT Repo
   ```bash
   echo \
      "deb [arch=$(dpkg --print-architecture) \
      signed-by=/etc/apt/keyrings/docker.gpg] \
      https://download.docker.com/linux/ubuntu \
      $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
      | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
   ```

   ```bash
   sudo apt-get update

   sudo apt-get install -y \
    docker-ce \
    docker-ce-cli \
    containerd.io \
    docker-buildx-plugin \
    docker-compose-plugin
   ```

3. 拉代码  
   ```bash
   git clone https://github.com/JerryLinyx/FinGOAT.git && cd FinGOAT
   ```

4. 配置 Secrets / 环境变量  
   ```bash
   cd services/trading-service
   cp .env.trading .env           # 如无则复制模板
   # 编辑 .env 填写 OPENAI_API_KEY / DASHSCOPE_API_KEY / ALPHA_VANTAGE_API_KEY 等
   cd ..

   cd TradingAgents
   cp .env.example .env  

   # 设置强密码覆盖默认 DB 密码（当前 shell）
   export POSTGRES_PASSWORD='<strong-password>'
   # 可选：export FRONTEND_ORIGINS="http://<域名>,http://<VM_IP>"
   # 可选：export LLM_TIMEOUT=300
   ```

5. 启动全部服务  
   ```bash
   docker --version
   docker compose version
   sudo usermod -aG docker $USER
   exit
   docker ps
   docker compose up -d --build
   ```

6. 健康检查  
   ```bash
   curl http://localhost/api/health
   curl http://localhost/trading/health
   ```
   浏览器访问入口：`http://<VM 公网 IP>/`

7. 日志与维护  
   ```bash
   docker compose ps
   docker compose logs -f backend   # 或 frontend / nginx / trading-service
   # 重启
   docker compose restart nginx frontend
   # 停止（保留数据卷）
   docker compose down
   ```

8. HTTPS（可选）  
   - 在 `nginx/default.conf` 添加证书并监听 443，或使用 GCP 负载均衡终结 TLS。 

## 🔐 安全建议

1. **不要在代码中硬编码 secrets**
   - 使用 Kubernetes Secrets 或 HashiCorp Vault
   
2. **使用私有镜像仓库**
   ```bash
   kubectl create secret docker-registry regcred \
     --docker-server=<your-registry> \
     --docker-username=<username> \
     --docker-password=<password> \
     -n fingoat
   ```

3. **启用 Network Policies**
   - 限制 Pod 之间的网络访问

4. **定期更新镜像**
   - 使用漏洞扫描工具 (如 Trivy)

## 📝 环境变量说明

### Backend (Go)
- `GIN_MODE`: release/debug

### Trading Service (Python)
- `TRADING_SERVICE_PORT`: 服务端口 (默认 8001)
- `LLM_PROVIDER`: openai/claude/gemini 等
- `LLM_BASE_URL`: LLM API endpoint
- `OPENAI_API_KEY`: OpenAI API key
- `ALPHA_VANTAGE_API_KEY`: Alpha Vantage API key
- 其他 LLM provider keys

## 🚀 性能优化

1. **使用多阶段构建** (已实现)
   - 减小镜像体积
   
2. **启用构建缓存**
   ```bash
   docker-compose build --parallel
   ```

3. **调整副本数**
   ```yaml
   replicas: 3  # 根据负载调整
   ```

4. **使用 CDN 加速前端**
   - 将静态资源上传到 CDN
