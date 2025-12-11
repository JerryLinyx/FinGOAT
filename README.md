# FinGOAT: Financial Graph-Orchestrated Agentic Trading

[English](./README.md) | [中文](./README-CN.md)

**Demo Video**: [YouTube](https://youtu.be/f5eHl32v5gU)

FinGOAT is a full-stack financial intelligence system that combines real-time data ingestion, graph-structured knowledge modeling, and agentic decision workflows.
The stack includes a Go backend (Gin + GORM + PostgreSQL + Redis) and a TypeScript/React frontend built with Vite.

![](assets/infra.png)

## Getting Started

### Quick Start

```bash
git clone https://github.com/JerryLinyx/FinGOAT.git
cd FinGOAT
```

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

FinGOAT (Financial Graph-Orchestrated Agentic Trading) is a full-stack financial intelligence system that bridges the gap between modern LLM-based analysis and traditional CFA-aligned investment workflows. The system combines real-time data interpretation with rigorous financial theories and domain-specific judgment, mirroring how real investment teams operate with independent views, transparent scoring, and risk-driven decision processes.

## Background

### The Evolution of Financial Analysis

- **LLMs in Finance**: Large Language Models are increasingly used to interpret financial news, fundamentals, earnings transcripts, and sentiment signals
- **Agent Frameworks**: Recent frameworks (e.g., LangChain, Dify, N8N, Coze) demonstrate multi-role analyst pipelines using LLMs
- **Modern Asset Management**: Real-time news interpretation, rigorous financial theories, and domain-specific judgment
- **Real Investment Teams**: Independent views, transparent scoring, and risk-driven decision processes

FinGOAT aims to bridge this gap by providing **Graph-Orchestrated multi-Agents**, combining LLM-based analysis with a CFA-aligned, quantitatively structured, and transparent investment workflow.

## Problem Statement

Current multi-agent trading frameworks face several critical challenges:

### Limited Transparency
- Multi-stage interactions with ambiguous reasoning
- Inconsistent agent opinions
- Difficult to trace decision-making process

### High Latency
- Multi-turn sequential execution
- Bottlenecks in agent coordination

### Unstable Outcomes
- "All agents must converge" assumption is unrealistic
- Lack of robust disagreement handling

### Reference: 
- [Blackrock Alpha Agent](https://arxiv.org/pdf/2508.11152v1)
- [Trading Agents](arxiv.org/pdf/2412.20138)

## Our Solution

### Multi-Agent Layer with COF + Self-Reflection

**Key Improvements:**

1. **Asynchronous Analyst Execution**
   - Parallel processing of analyst agents
   - Significant reduction in end-to-end runtime

2. **Enhanced Prompt Engineering**
   - Chain-of-Thought (COF) reasoning
   - Self-reflection mechanisms

3. **Streamlined, CFA-Consistent Investment Workflow**
   - Aligned with professional investment analysis standards
   - Transparent decision-making process

4. **Quantitative and Factor-Based Scoring**
   - Objective, measurable conviction scores
   - Risk-adjusted recommendations

### Quantitative Scoring via MCP Calling

#### PM Engine
- **Direction**: Buy/Sell/Hold recommendation
- **Base Conviction**: Initial confidence score

#### Risk Manager
Adjusts convictions based on multiple risk factors:
- Company-specific risk
- Valuation uncertainty
- Sentiment risk
- Macro risk
- Analyst disagreement

### Sample Analysis Workflow

The system provides comprehensive analysis across multiple dimensions:

1. **Technical Analysis**: Chart patterns, momentum indicators, volume analysis
2. **Social Media Sentiment**: Real-time sentiment from Twitter, Reddit, StockTwits
3. **News Analysis**: Breaking news impact and sentiment
4. **Fundamentals**: Financial statements, ratios, growth metrics
5. **Valuation**: DCF, multiples, peer comparison
6. **PM Engine**: Portfolio management recommendations
7. **Risk Management**: Multi-factor risk assessment

Example output for NVDA:
- **Direction**: Buy
- **Conviction**: +10%
- **Key Outputs**: Detailed analysis from each agent with supporting evidence

### Fundamentals Analyst's RAG Architecture

The system processes various financial documents:
- SEC 10-K filings with actual financial statements
- Earnings transcripts from quarterly calls with management commentary
- Analyst reports with price targets
- Company investor presentations with actual numbers

**RAG Pipeline:**
```
Financial Documents → Embeddings → ChromaDB → RAG Pipeline
```

## System Architecture

### Full Stack Components

#### Frontend
- **Framework**: Vite + React for UI
- **Proxy**: Nginx for reverse proxy
- **Features**: Real-time dashboard, analysis visualization, multi-LLM provider support

#### Go Backend
- **Router**: Gin with CORS support
- **Authentication**: JWT for secure access
- **Configuration**: Viper for flexible config management
- **Database**: GORM for PostgreSQL ORM, Go-Redis for caching

#### Database Layer
- **PostgreSQL**: Primary data store for consistency
- **Redis**: Caching layer for performance
- **RSS Feeds**: Real-time article ingestion

#### Python Backend
- **API**: FastAPI for Agent Service
- **Orchestration**: LangChain/LangGraph for agent coordination
- **Multi-LLM Support**: OpenAI, Anthropic, Google, DeepSeek, Aliyun Bailian, local Ollama models

### Deployment

**Containerization:**
- Docker Compose for service isolation
- Individual containers for frontend, backend, database, and agent services

**Cloud Infrastructure:**
- Deployed on GCP VM
- Load balancing for high availability
- Secrets management for API keys and credentials

## Model Zoo

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
| Gemma 3 1B | 815MB | `ollama run gemma:3b` | 115.23s |
| Gemma 3 4B | 3.3GB | `ollama run gemma:4b` | 320.50s |
| Gemma 3 12B | 8.1GB | `ollama run gemma:12b` | 690.82s |
| Gemma 3 27B | 17GB | `ollama run gemma:27b` | 1131.48s |

**Key Insights:**
- Smaller models provide lower latency
- Local deployment ensures privacy and eliminates API costs
- Trade-off between model capability and response time

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

