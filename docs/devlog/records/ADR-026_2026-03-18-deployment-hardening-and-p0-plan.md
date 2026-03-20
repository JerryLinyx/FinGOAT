---
id: ADR-026
kind: decision
title: Deployment Hardening & P0 Remediation — 2026-03-18
date: 2026-03-18
status: active
supersedes: null
superseded_by: null
implements: [ADR-021]
verified_by: []
---

# Deployment Hardening & P0 Remediation — 2026-03-18

## 1. Deployment Hardening (全部完成)

### 1.1 CORS 动态化

- **Go backend** (`router/router.go`): 已读取 `FRONTEND_ORIGINS` env var，无需改动。
- **Python trading service** (`trading_service.py`): 原来硬编码 `localhost:8080,localhost:5173`，改为：
  ```python
  _cors_origins_raw = os.getenv("FRONTEND_ORIGINS", "http://localhost:8080,http://localhost:5173")
  _cors_origins = [o.strip() for o in _cors_origins_raw.split(",") if o.strip()]
  _cors_allow_creds = not (_cors_origins == ["*"])
  ```
  支持 `"*"` 通配符（自动关闭 credentials 以满足浏览器规范）。

### 1.2 端口收敛 (`docker-compose.yml`)

所有内部服务端口移除主机映射，仅 nginx `:80` 对外暴露：

| 服务 | 修改前 | 修改后 |
|------|--------|--------|
| PostgreSQL | `5432:5432` | 仅内网 |
| Redis | `6379:6379` | 仅内网 |
| Go Backend | `3000:3000` | 仅内网（nginx `/api/` 代理） |
| Python Trading | `8001:8001` | 仅内网（Go 代理） |
| Frontend | `8080:80` | 仅内网（nginx `/` 代理） |
| **Nginx** | `80:80` | **唯一外部端口** |

### 1.3 Nginx 路由清理

- 移除 `/trading/` location block（原本将 Python 服务公开暴露）。
- 移除 `depends_on: trading-service`。
- 在 `/api/` block 增加 SSE 支持：`proxy_buffering off`、`proxy_cache off`、`proxy_read_timeout 600s`。

### 1.4 环境变量统一

docker-compose.yml 新增对两个服务的 `FRONTEND_ORIGINS` 传递，支持 GCP VM 部署时通过外部 `.env.production` 覆盖：
```yaml
FRONTEND_ORIGINS: ${FRONTEND_ORIGINS:-http://localhost,http://localhost:8080}
```

### 1.5 安全必需环境变量注入 (`docker-compose.yml`)

补全 backend 服务缺失的两个必需 env var，提供本地 dev 安全默认值、生产通过 `.env.production` 覆盖：

| 变量 | 本地 dev 默认 | 说明 |
|------|--------------|------|
| `JWT_SECRET` | `fingoat-dev-jwt-secret-DO-NOT-USE-IN-PROD` | JWT 签名密钥 |
| `BYOK_ENCRYPTION_KEY` | `ZmluZ29hdC1kZXYtaW5zZWN1cmUta2V5LTMyYnl0ZXM=` | AES-256-GCM 用户 API Key 加密，base64(32B) |
| `POSTGRES_PASSWORD` | `2233` | 同时作用于 postgres 容器和 backend DB_PASSWORD |

生产覆盖方式：
```bash
# 生成强密钥写入 .env.production（不提交 git）
echo "JWT_SECRET=$(openssl rand -hex 32)" >> .env.production
echo "BYOK_ENCRYPTION_KEY=$(openssl rand -base64 32)" >> .env.production
echo "POSTGRES_PASSWORD=$(openssl rand -base64 18)" >> .env.production
```

**前端 API baseURL 验证**：`VITE_API_URL` 为空时 `API_BASE_URL = ''`，所有 fetch 使用相对路径 `/api/...`，由外层 nginx 代理到 `backend:3000`。Docker 模式下无需额外配置。

---

## 2. P0 修复完成情况

### P0-1 ✅ DashScope tool-call orphan 净化

**文件**: `TradingAgents/tradingagents/graph/conditional_logic.py`

新增 `sanitize_orphan_tool_calls(messages)` 函数：
- 从 messages 列表末尾往前扫描
- 找到没有配对 ToolMessage 的 AIMessage（带 `tool_calls`）
- deep-copy 并清空 `tool_calls` 和 `additional_kwargs["tool_calls"]`
- 保留模型产出的文本内容
- 记录 warning 日志

调用时机：analyst 达到迭代上限（`MAX_ANALYST_TOOL_ITERATIONS`）退出时，在返回 `"Analyst Join"` 前调用净化。

**修复了**: GLM-4.7、kimi-k2.5 及所有 DashScope 模型的工具调用孤儿问题（DashScope 要求严格配对）。

### P0-2 ⏳ DashScope 端到端验证

**依赖 P0-1**（已完成）。待用 `dashscope / qwen-plus` 在 BABA 跑完整 9 阶段验证。

### P0-3 ✅ Python 公开端点限制

**文件**: `services/trading-service/trading_service.py`

以下端点标记为 `deprecated=True, tags=["deprecated"]`，文档字符串注明弃用理由：

| 端点 | 替代 |
|------|------|
| `POST /api/v1/analyze` | Go `POST /api/trading/analyze` |
| `POST /api/v1/analyze/sync` | Go `POST /api/trading/analyze` |
| `GET /api/v1/tasks` | Go `GET /api/trading/analyses` |
| `DELETE /api/v1/analysis/{task_id}` | Go `POST /api/trading/analysis/{task_id}/cancel` |
| `GET /api/v1/config` | 由 Go 后端 per-user profile 管理 |

保留：`GET /health`、`GET /api/v1/analysis/{task_id}/stream`（Go 代理流式中继需要）。

### P0-4 ✅ Go ↔ Python 类型合约

**文件**: `backend/controllers/trading_runtime.go`

新增 `validateAnalysisRequest()` 函数，对齐 Python Pydantic 约束：

```go
var (
    tickerPattern = regexp.MustCompile(`^[A-Za-z0-9.\-]{1,10}$`)
    datePattern   = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)
)

func validateAnalysisRequest(req *AnalysisRequest) string {
    // Ticker: 1-10 chars, alphanumeric + dot + hyphen
    // Date: YYYY-MM-DD + 可解析日历日期
    // max_debate_rounds: 1-5 (0 = 未设置，跳过校验)
    // max_risk_discuss_rounds: 1-5
}
```

在 `RequestAnalysis` handler 中，在 LLM key 注入之前调用，校验失败返回 HTTP 400。

### P0-5 ⏳ 用户表重设计 + Email 认证

**延期**：需要决定邮件发送服务（Resend / SMTP / 跳过验证）。

### P0-6 ✅ 服务 API 所有权收敛

通过 §1.2–1.4（端口收敛 + Nginx 路由清理）+ P0-3（端点弃用）完成。
Go 后端是唯一对外 trading API；Python 是纯内部 worker。

---

## 3. 剩余 BLOCKER（GCP 部署前必须处理）

| # | 问题 | 状态 |
|---|------|------|
| B1 | `services/trading-service/.env`、`TradingAgents/.env` 含明文 API Key 被提交 git | ⚠️ 未处理：需要轮换 key + bfg 清理历史 |
| B2 | JWT_SECRET 回退到不安全值 | ⚠️ 需要在 .env.production 中强制设置 |
| B3 | HTTPS / TLS 未配置（nginx 只有 80） | ⚠️ 建议 GCP LB 终止 TLS |
| B4 | 数据库密码 `2233` | ⚠️ 需要强密码注入 |

---

## 4. 其他部署注意事项（见 GCP 部署计划）

- VM 推荐规格：`e2-standard-4`（4vCPU / 16GB）起步；trading-service + ChromaDB 吃内存
- 磁盘：建议 50GB SSD（Docker 镜像 ~3GB + PG 数据）
- 只开 80/443 防火墙规则，其余端口全部关闭
- `.env.production` 不提交 git，通过 `scp` 或 Secret Manager 注入
