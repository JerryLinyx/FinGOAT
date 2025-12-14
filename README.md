# FinGOAT: Financial Graph-Orchestrated Agentic Trading

[English](./README.md) | [中文](./README-CN.md)

**Demo Video**: [YouTube](https://youtu.be/f5eHl32v5gU)

| UNI | GitHub | Branch | Focus / Tasks |
|-------|--------|--------|---------------|
| yl6061| <a href="https://github.com/JerryLinyx"><img src="https://github.com/JerryLinyx.png?size=60" alt="JerryLinyx avatar" width="36"/></a> [JerryLinyx](https://github.com/JerryLinyx) | `main` | - Python Backend<br>- Go Backend<br>- PostgreSQL DB<br>- Redis<br>- Docker Compose<br>- GCP VM Deployment<br>- Multi-Models Support<br>- Ollama Local Inference<br>- RSS Feeds<br>- Frontend |
| gq2142| <a href="https://github.com/codewith-lab"><img src="https://github.com/codewith-lab.png?size=60" alt="codewith-lab avatar" width="36"/></a> [codewith-lab](https://github.com/codewith-lab) | `dev_gq2142` | - Multi-agents Async-Execution<br>- Enhanced Prompt Engineering<br>- Investment Workflow Redesign<br>- MCP on Quantitative & Factor-Based Scoring<br>- Decision Transparency<br>- Frontend |
| ag4969| <a href="https://github.com/akhilg24"><img src="https://github.com/akhilg24.png?size=60" alt="akhilg24 avatar" width="36"/></a> [akhilg24](https://github.com/akhilg24) | `rag_fund` | - RAG for Fundamentals Agent<br>- Vector DB |

FinGOAT is a full-stack financial intelligence system that combines real-time data ingestion, graph-structured knowledge modeling, and agentic decision workflows.
The stack includes a Go backend (Gin + GORM + PostgreSQL + Redis) and a TypeScript/React frontend built with Vite.

![](assets/infra.png)


**Tribute to the Original Project:**

Thanks to the [Tauric Research](https://github.com/TauricResearch) team for their multi-agent trading framework [TradingAgents](https://github.com/TauricResearch/TradingAgents)!

## Deployment
- Full guide: [DEPLOYMENT.md](./DEPLOYMENT.md)
- Chinese version: [DEPLOYMENT-CN.md](./DEPLOYMENT-CN.md)

## Getting Started

### Quick Start

```bash
git clone https://github.com/JerryLinyx/FinGOAT.git
cd FinGOAT
```

![](assets/appinfra.png)

### Backend Setup (Gin+GORM+PostgreSQL+Redis+Viper+JWT+Docker)

#### Install dependencies
```bash
cd backend

go mod init github.com/JerryLinyx/FinGOAT

go get -u github.com/gin-gonic/gin
go get github.com/spf13/viper
go get -u gorm.io/gorm
go get -u gorm.io/driver/postgres
go get -u google.golang.org/grpc
go get -u golang.org/x/crypto/bcrypt
go get github.com/golang-jwt/jwt/v5
go get -u github.com/go-redis/redis/v8
go get github.com/gin-contrib/cors

go mod tidy
```

#### Start PostgreSQL
```bash
docker pull postgres:15.14-alpine3.21

docker run --name fingoat-pg \
  --restart=unless-stopped \
  -d -p 5432:5432 \
  -v pgdata:/var/lib/postgresql/data \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=2233 \
  -e POSTGRES_DB=fingoat_db \
  postgres:15.14-alpine3.21
```
#### Start Redis
```bash
docker run -d \
  --name fingoat-redis \
  -p 6379:6379 \
  -v redisdata:/data \
  redis:7.2
```
#### Run the Server
```bash
go run main.go
# curl http://localhost:3000/api/trading/health
```


### Frontend Setup (TypeScript+Vite+React)
```bash
npm create vite@latest frontend

cd frontend
npm install
npm run build
npm run dev
# http://localhost:5173/
```

### Agents Setup (LangChain+LangGraph+FastAPI)

1) Create Python env and install deps
```bash
cd langchain-v1
python3 -m venv .venv
source .venv/bin/activate

# if needed
conda deactivate

pip install --upgrade pip
pip install -r requirements.txt

# for python3
# python3 -m pip install --upgrade pip
# python3 -m pip install -r requirements.txt
```

2) Configure API keys and service settings
```bash
cp .env.trading .env
# set OPENAI_API_KEY and ALPHA_VANTAGE_API_KEY (Or other apis)
# adjust TRADING_SERVICE_PORT / CORS_ORIGINS if needed
```

3) Run the FastAPI microservice
```bash
# dev mode (auto reload logs to console)
python trading_service.py
# python3 trading_service.py
# http://localhost:8001/

# production-style
uvicorn trading_service:app --host 0.0.0.0 --port 8001 --workers 4
```
Service docs live at http://localhost:8001/docs and health at `/health`.

4) Sample request to trigger analysis
```bash
curl -X POST http://localhost:8001/api/v1/analyze \
  -H "Content-Type: application/json" \
  -d '{
        "ticker": "NVDA",
        "date": "2024-05-10",
        "llm_config": {
          "deep_think_llm": "gpt-4o-mini",
          "quick_think_llm": "gpt-4o-mini",
          "max_debate_rounds": 1
        }
      }'
```
The response returns a `task_id`; poll `/api/v1/analysis/{task_id}` for the result.

#### Screenshots
**Login Page**
![](assets/login.png)

**Dashboard Page**
![](assets/dashboard1.png)

## Overview

FinGOAT (Financial Graph-Orchestrated Agentic Trading) is a full-stack financial intelligence system that aligns modern LLM agents with CFA-style workflows. It uses a graph-orchestrated, asynchronous multi-agent design to keep analyst roles independent, scored, and risk-adjusted instead of forcing consensus. Fundamental analysis is grounded with RAG over real filings/transcripts, and outputs are persisted for auditability.

**What makes it different**
- Graph-orchestrated, asynchronous multi-agents (LangGraph) instead of linear chains, cutting latency and improving stability.
- Quantitative conviction + risk adjustments inspired by PM/RM practice; decisions stay explainable and traceable.
- Fundamentals agent with RAG over filings/transcripts; technical/news/sentiment agents stay independent.
- Provider-flexible LLM layer (OpenAI/Anthropic/Google/DeepSeek/Aliyun) with local fallback via Ollama/vLLM.
- Production-ready stack: Go (Gin+GORM+JWT) API gateway, FastAPI agent service, React/Vite frontend, PostgreSQL + Redis, Docker Compose/K8s, Nginx reverse proxy.

## Background

### The evolution of LLMs in finance
- LLMs are widely used for news interpretation, earnings summaries, sentiment, and fundamentals, but many pipelines remain opaque and slow.
- Agent frameworks (LangChain/LangGraph, Dify, N8N, Coze) enable multi-role setups, yet real investment teams rely on independent views, scoring, and risk control.
- FinGOAT targets this gap with graph-orchestrated, CFA-aligned multi-agents that stay auditable and latency-aware.

## Problem statement
- **Transparency**: Reasoning chains are often opaque; hard to trace why a decision was made.
- **Latency**: Sequential pipelines inflate end-to-end time; slow for interactive use.
- **Stability**: Forcing consensus among heterogeneous agents can create unstable, low-trust outputs.

## Our solution
- **Graph-orchestrated, asynchronous agents** (LangGraph) to cut critical-path latency and improve predictability.
- **Quantitative conviction + risk adjustment** to aggregate heterogeneous signals into explainable BUY/SELL/HOLD calls.
- **RAG-grounded fundamentals** to tie LLM reasoning to filings/transcripts instead of free-form generation.
- **Provider-flexible + local models** (OpenAI/Anthropic/Google/DeepSeek/Aliyun; Ollama/vLLM) to balance cost/privacy/latency.
- **Productionized stack** with Go API gateway, FastAPI agent service, React/Vite UI, PostgreSQL + Redis, Docker Compose/K8s, and Nginx as entry proxy.

### How it works (analysis flow)
- Analysts (technical/news/sentiment/fundamentals) run asynchronously and keep their own views.
- PM engine aggregates signals into BUY/SELL/HOLD with base conviction.
- Risk manager adjusts conviction by company/valuation/sentiment/macro/disagreement factors.
- Decision and full analysis report are persisted in PostgreSQL; Redis is used for caching; UI surfaces both headline and detailed JSON.

### Fundamentals RAG
- Sources: SEC 10-K, earnings call transcripts, analyst reports, investor presentations.
- Pipeline: Financial docs → embeddings → ChromaDB → RAG prompt → grounded fundamentals signals (direction, key factors, risks).

## System Architecture

### Full Stack Components

#### Frontend
- Vite + React UI, showing analysis status/results, provider/model controls.
- Nginx reverse proxy for the SPA.

#### Go backend (API gateway)
- Gin router with CORS; JWT auth; Viper config.
- GORM + PostgreSQL for persistence; go-redis for cache/session.

#### Python agent service
- FastAPI + LangChain/LangGraph for graph-orchestrated agents.
- Multi-LLM support (OpenAI/Anthropic/Google/DeepSeek/Aliyun, Ollama/vLLM).

#### Data layer
- PostgreSQL for tasks/decisions/articles.
- Redis for cache and future stream/event use.
- RSS ingestion for news articles.

### Deployment

- Docker Compose for local dev/prod parity; Nginx as entry.
- Kubernetes manifests (`k8s/`) for scaling, LB/Ingress, and health probes.
- Secrets via env files or K8s Secrets; swap DB/Redis to managed services as needed.

## Model Zoo

![](./assets/zoo.jpg)

### Supported LLM Providers

The system supports multiple model APIs beyond OpenAI:

#### Commercial APIs
| Provider | Model | Input (per 1M tokens) | Output (per 1M tokens) |
|----------|-------|----------------------|------------------------|
| OpenAI | GPT-4o | $2.50 | $10.00 |
| OpenAI | GPT-4o-mini | $0.15 | $0.60 |
| Anthropic | Claude 3.5 Sonnet | $3.00 | $15.00 |
| Google | Gemini 1.5 Pro | $1.25 | $5.00 |
| DeepSeek | DeepSeek V3 | $0.27 | $1.10 |

#### Cost-Effective Options
- **Aliyun Bailian**: Cheaper API alternatives for cost-sensitive deployments
- **Ollama**: Deploy models locally for private and free inference

### Local Model Deployment + Latency Evaluation

**Gemma 3 Model Variants:**

| Model | Size | Ollama Command | Latency (Serial Mode) |
|-------|------|----------------|----------------------|
| Gemma 3 1B | 815MB | `ollama run gemma3:1b` | 115.23s |
| Gemma 3 4B | 3.3GB | `ollama run gemma3` | 320.50s |
| Gemma 3 12B | 8.1GB | `ollama run gemma3:12b` | 690.82s |
| Gemma 3 27B | 17GB | `ollama run gemma3:27b` | 1131.48s |

**Key Insights:**
- Smaller models → lower latency; larger models → stronger reasoning.
- Local inference preserves privacy and removes API cost; balance capability vs. response time per use case.

## Future Work

### End-to-End Live Trading Loop
- Integration with real brokerage APIs (Alpaca/Robinhood)
- Simulated and live execution capabilities
- Real-time portfolio tracking

### Agent Disagreement & Uncertainty Modeling
- Cross-agent covariance analysis
- Disagreement heatmaps
- Uncertainty-aware conviction adjustments
- Trigger deeper analysis when agents diverge significantly

### Reinforcement Learning Portfolio Agents
- RL-based portfolio optimization
- Adaptive strategy learning from market feedback
- Multi-objective optimization (return, risk, drawdown)

### Financial RAG 2.0
- Domain-tuned embeddings for financial documents
- Financial knowledge graphs
- Enhanced retrieval with temporal awareness
- Multi-modal document understanding

### Personalized Investor Profiling
- User studies and behavioral analysis
- User-specific risk curves and investment horizons
- Factor preferences and constraint modeling
- Customized recommendation engines

## Contributing

We welcome contributions!



## Citation

If you use FinGOAT in your research, please cite:

```bibtex
@software{fingoat2025,
  title = {FinGOAT: Financial Graph-Orchestrated Agentic Trading},
  author = {Lin, Yuxuan and Qian, Gaolin and Gadde, Akhil},
  year = {2025},
  url = {https://github.com/JerryLinyx/FinGOAT}
}
```
