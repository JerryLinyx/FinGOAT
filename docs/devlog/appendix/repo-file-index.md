---
title: Repo File Index
last_verified: 2026-03-19
verified_against: v0.2.0-dev
---

# Repo File Index

本文档是当前主线仓库的文件级责任索引，目标是把“哪些文件在负责什么”明确下来，供后续版本演进和 devlog 对照使用。

## Scope

- 覆盖当前仓库中主要 **tracked source / config / infra / docs** 文件
- 对运行时无语义差异的 **二进制图片、截图、logo、锁文件、样例输出** 采用分组说明
- `__pycache__`、本地 `.venv/`、其他未跟踪生成物不纳入此索引

## Root / Infra / Project Docs

- `.dockerignore`: 根级 Docker 构建忽略规则
- `.gitignore`: 根级 Git 忽略规则
- `CLAUDE.md`: 仓库级协作说明
- `DEPLOYMENT-CN.md`: 中文部署文档
- `DEPLOYMENT.md`: 英文部署文档
- `services/trading-service/Dockerfile`: Python trading/worker 服务镜像构建
- `PROJECT_ORGANIZATION.md`: 项目结构说明文档
- `README-CN.md`: 中文项目介绍
- `README.md`: 英文项目介绍
- `deploy.sh`: 部署脚本入口
- `docker-compose.yml`: 本地/VM 多服务编排主文件
- `assets/*.png|*.jpg|*.svg|*.ai|*.zip`: 品牌、截图、部署示意与 README 展示资产，不参与运行时逻辑

## TradingAgents Package

### Packaging / Entry / Metadata

- `TradingAgents/.env.example`: TradingAgents 独立运行的示例环境变量
- `TradingAgents/.gitignore`: Python 包目录忽略规则
- `TradingAgents/.python-version`: Python 版本约束
- `TradingAgents/LICENSE`: 开源许可证
- `TradingAgents/README.md`: TradingAgents 子项目说明
- `TradingAgents/main.py`: TradingAgents 本地 demo 入口
- `TradingAgents/pyproject.toml`: Python 包现代构建元数据
- `TradingAgents/requirements.txt`: 传统 requirements 依赖清单
- `TradingAgents/setup.py`: 兼容性安装入口
- `TradingAgents/test.py`: 简单测试/手工入口
- `TradingAgents/uv.lock`: Python 依赖锁文件

### CLI

- `TradingAgents/cli/__init__.py`: CLI 包初始化
- `TradingAgents/cli/main.py`: 终端交互式 CLI 主入口
- `TradingAgents/cli/models.py`: CLI 使用的数据模型/枚举
- `TradingAgents/cli/static/welcome.txt`: CLI 欢迎文案
- `TradingAgents/cli/utils.py`: CLI 交互工具与 provider/model 选项
- `TradingAgents/assets/cli/*.png`: CLI 文档截图

### Tests

- `TradingAgents/tests/test_agent_state_reducers.py`: agent state reducer 行为测试
- `TradingAgents/tests/test_embedding_settings.py`: embedding provider 路由与降级策略测试
- `TradingAgents/tests/test_global_news_routing.py`: global news vendor 路由测试
- `TradingAgents/tests/test_parallel_analyst_cleanup.py`: analyst 并发消息清理/聚合测试

### Agents

- `TradingAgents/tradingagents/agents/__init__.py`: agents 能力总导出
- `TradingAgents/tradingagents/agents/analysts/fundamentals_analyst.py`: 基本面 analyst 节点
- `TradingAgents/tradingagents/agents/analysts/market_analyst.py`: 技术/行情 analyst 节点
- `TradingAgents/tradingagents/agents/analysts/news_analyst.py`: 新闻 analyst 节点
- `TradingAgents/tradingagents/agents/analysts/social_media_analyst.py`: 社媒/舆情 analyst 节点
- `TradingAgents/tradingagents/agents/managers/research_manager.py`: 多方研究结论裁决与投资计划管理
- `TradingAgents/tradingagents/agents/managers/risk_manager.py`: 风险裁决与最终投资决策管理
- `TradingAgents/tradingagents/agents/researchers/bear_researcher.py`: 空头研究员辩论节点
- `TradingAgents/tradingagents/agents/researchers/bull_researcher.py`: 多头研究员辩论节点
- `TradingAgents/tradingagents/agents/risk_mgmt/aggresive_debator.py`: 激进风险视角节点
- `TradingAgents/tradingagents/agents/risk_mgmt/conservative_debator.py`: 保守风险视角节点
- `TradingAgents/tradingagents/agents/risk_mgmt/neutral_debator.py`: 中性风险视角节点
- `TradingAgents/tradingagents/agents/trader/trader.py`: trader 执行计划节点

### Agent Utils

- `TradingAgents/tradingagents/agents/utils/agent_states.py`: LangGraph state schema / reducers
- `TradingAgents/tradingagents/agents/utils/agent_utils.py`: 通用 agent helper 与消息清理工具
- `TradingAgents/tradingagents/agents/utils/core_stock_tools.py`: 核心股价工具定义
- `TradingAgents/tradingagents/agents/utils/fundamental_data_tools.py`: 基本面工具定义
- `TradingAgents/tradingagents/agents/utils/memory.py`: 记忆层、embedding 路由、pgvector/chroma 存储
- `TradingAgents/tradingagents/agents/utils/news_data_tools.py`: 新闻/insider 工具定义
- `TradingAgents/tradingagents/agents/utils/technical_indicators_tools.py`: 技术指标工具定义

### Dataflows

- `TradingAgents/tradingagents/dataflows/__init__.py`: dataflow 包初始化
- `TradingAgents/tradingagents/dataflows/akshare_utils.py`: A 股 / AKShare 数据拉取与归一化
- `TradingAgents/tradingagents/dataflows/alpha_vantage.py`: Alpha Vantage 聚合入口
- `TradingAgents/tradingagents/dataflows/alpha_vantage_common.py`: Alpha Vantage 公共请求与限流错误
- `TradingAgents/tradingagents/dataflows/alpha_vantage_fundamentals.py`: Alpha Vantage 基本面数据
- `TradingAgents/tradingagents/dataflows/alpha_vantage_indicator.py`: Alpha Vantage 技术指标数据
- `TradingAgents/tradingagents/dataflows/alpha_vantage_news.py`: Alpha Vantage 新闻 / 宏观 / insider
- `TradingAgents/tradingagents/dataflows/alpha_vantage_stock.py`: Alpha Vantage OHLCV 数据
- `TradingAgents/tradingagents/dataflows/config.py`: dataflow 全局配置加载与 deep-copy 读取
- `TradingAgents/tradingagents/dataflows/google.py`: Google News 抓取入口
- `TradingAgents/tradingagents/dataflows/googlenews_utils.py`: Google News 辅助解析
- `TradingAgents/tradingagents/dataflows/interface.py`: vendor 路由中枢
- `TradingAgents/tradingagents/dataflows/local.py`: 本地缓存 / Reddit / Finnhub / SimFin 混合数据入口
- `TradingAgents/tradingagents/dataflows/openai.py`: OpenAI Web Search / fundamentals 辅助数据
- `TradingAgents/tradingagents/dataflows/reddit_utils.py`: Reddit 新闻抓取与清洗
- `TradingAgents/tradingagents/dataflows/stockstats_utils.py`: 技术指标计算辅助
- `TradingAgents/tradingagents/dataflows/utils.py`: dataflow 公共工具
- `TradingAgents/tradingagents/dataflows/y_finance.py`: yfinance 数据拉取与格式化
- `TradingAgents/tradingagents/dataflows/yfin_utils.py`: yfinance 低层辅助

### Graph / Orchestration

- `TradingAgents/tradingagents/default_config.py`: TradingAgents 默认配置
- `TradingAgents/tradingagents/graph/__init__.py`: graph 包导出
- `TradingAgents/tradingagents/graph/conditional_logic.py`: analyst / debate / risk 节点流转判断
- `TradingAgents/tradingagents/graph/propagation.py`: 初始状态与 graph 运行参数准备
- `TradingAgents/tradingagents/graph/reflection.py`: 反思/经验总结逻辑
- `TradingAgents/tradingagents/graph/setup.py`: LangGraph 节点与边构造
- `TradingAgents/tradingagents/graph/signal_processing.py`: 最终 BUY/SELL/HOLD 信号整理
- `TradingAgents/tradingagents/graph/trading_graph.py`: TradingAgentsGraph 主编排入口
- `TradingAgents/tradingagents/llm_provider.py`: 多 provider LLM 构造工厂

### OpenClaw Integration

- `TradingAgents/tradingagents/openclaw/__init__.py`: OpenClaw adapter 导出
- `TradingAgents/tradingagents/openclaw/adapter.py`: OpenClaw stage runtime 调用与结果映射

### Assets / Samples

- `TradingAgents/assets/*.png`: 子项目 README/CLI/agent 说明图
- `TradingAgents/assets/wechat.png`: 微信相关展示图

## Go Backend

### Build / Entry / Docs

- `backend/.dockerignore`: backend 镜像构建忽略规则
- `backend/Dockerfile`: Go backend 镜像构建
- `backend/TRADING_API.md`: 对外 trading API 文档
- `backend/go.mod`: Go 模块定义
- `backend/go.sum`: Go 依赖锁定
- `backend/main.go`: backend 启动入口
- `backend/fingoat-backend`: 已编译 backend 二进制产物（tracked artifact）

### Config / Global

- `backend/config/config.go`: YAML + env 配置加载
- `backend/config/config.yaml`: 默认配置
- `backend/config/db.go`: PostgreSQL 初始化
- `backend/config/email.go`: SMTP / verification 邮件配置与发送
- `backend/config/migrate.go`: GORM + schema / pgvector / legacy migration
- `backend/config/redis.go`: Redis 初始化
- `backend/global/global.go`: 全局 DB / Redis / config 持有

### Controllers

- `backend/controllers/article_controller.go`: RSS/article 列表、刷新、详情
- `backend/controllers/article_controller_test.go`: article controller 测试
- `backend/controllers/auth_controller.go`: register/login/email verification/resend
- `backend/controllers/auth_controller_test.go`: auth controller 测试
- `backend/controllers/chart.go`: chart / quote / terminal 路由代理与行情逻辑
- `backend/controllers/chart_test.go`: chart controller 测试
- `backend/controllers/exchange_rate_controller.go`: 汇率接口
- `backend/controllers/feed_controller.go`: feed board、偏好、like/save、源列表
- `backend/controllers/feed_controller_test.go`: feed controller 测试
- `backend/controllers/health_controller.go`: health 接口
- `backend/controllers/like_controller.go`: article 点赞控制器
- `backend/controllers/ollama_controller.go`: Ollama `/api/tags` 代理与模型探测
- `backend/controllers/trading_controller.go`: trading API 主入口、任务创建、provider key 注入
- `backend/controllers/trading_runtime.go`: Redis runtime/queue 协调与结构定义
- `backend/controllers/trading_runtime_test.go`: trading runtime 辅助逻辑测试
- `backend/controllers/usage_controller.go`: usage summary / task usage / admin usage
- `backend/controllers/user_controller.go`: profile / API keys 管理

### Middlewares

- `backend/middlewares/auth_middleware.go`: JWT 解析与 auth context 注入
- `backend/middlewares/role_middleware.go`: admin RBAC 保护

### Models

- `backend/models/article.go`: article 数据模型
- `backend/models/email_token.go`: email verify/reset token 模型
- `backend/models/exchange_rate.go`: 汇率模型
- `backend/models/feed.go`: feed item / preference / save/like 数据模型
- `backend/models/feed_ingest_run.go`: feed ingest 审计模型
- `backend/models/rss_feed.go`: RSS source 模型
- `backend/models/trading_analysis.go`: trading task / decision / metrics 模型
- `backend/models/usage.go`: usage events / analysis run metrics 模型
- `backend/models/user.go`: 用户模型与 role 规范化
- `backend/models/user_api_key.go`: per-user provider key 加密存储模型
- `backend/models/user_test.go`: user model / role 相关测试

### Utils / Router

- `backend/router/router.go`: Gin 路由注册总入口
- `backend/utils/crypto.go`: BYOK AES-256-GCM 加解密与 mask
- `backend/utils/utils.go`: bcrypt/JWT 通用工具
- `backend/utils/utils_test.go`: JWT/密码工具测试

## Frontend

### Build / Entry / Config

- `frontend/.dockerignore`: frontend 镜像忽略规则
- `frontend/.gitignore`: frontend 忽略规则
- `frontend/Dockerfile`: React 构建 + Nginx 静态发布
- `frontend/README.md`: frontend 说明
- `frontend/eslint.config.js`: ESLint 配置
- `frontend/index.html`: Vite 入口 HTML
- `frontend/nginx.conf`: 静态站点 Nginx 配置
- `frontend/package-lock.json`: npm 锁文件
- `frontend/package.json`: frontend 依赖与脚本
- `frontend/public/vite.svg`: Vite 默认静态资源
- `frontend/tsconfig.app.json`: 应用 tsconfig
- `frontend/tsconfig.json`: 根 tsconfig
- `frontend/tsconfig.node.json`: Node/Vite tsconfig
- `frontend/vite.config.ts`: Vite dev/build 配置

### App Shell / Global Styles

- `frontend/src/App.css`: 主界面样式
- `frontend/src/App.tsx`: 应用壳层、认证、配置、页面切换、侧栏布局
- `frontend/src/index.css`: 全局样式
- `frontend/src/main.tsx`: React 挂载入口
- `frontend/src/assets/react.svg`: React 静态资源

### Feature Styles

- `frontend/src/ChartPage.css`: 图表/terminal 页面样式
- `frontend/src/OpenClawPage.css`: OpenClaw 页面样式
- `frontend/src/TradingAnalysis.css`: trading analysis 页面样式
- `frontend/src/components/FeedPage.css`: feed board 页面样式

### Components

- `frontend/src/components/AdminDashboard.tsx`: admin usage 仪表盘
- `frontend/src/components/AgentFlowGraph.tsx`: agent flow / stage 可视化
- `frontend/src/components/AgentResultsModule.tsx`: agent 结果模块化展示
- `frontend/src/components/ChartPage.tsx`: chart / quote / terminal UI
- `frontend/src/components/FeedPage.tsx`: feed board 页面
- `frontend/src/components/OpenClawPage.tsx`: OpenClaw 页面与本地 gateway 交互
- `frontend/src/components/ProfilePage.tsx`: profile + API key 配置页
- `frontend/src/components/TradingAnalysis.tsx`: trading 任务主面板
- `frontend/src/components/UsagePage.tsx`: 用户 usage 页
- `frontend/src/components/agentStages.ts`: stage 元数据解析与状态构建

### Services / Types

- `frontend/src/services/feedService.ts`: feed board API 客户端
- `frontend/src/services/openclawGateway.ts`: OpenClaw gateway API 客户端
- `frontend/src/services/tradingService.ts`: trading / chart / terminal / ollama / SSE API 客户端
- `frontend/src/services/usageService.ts`: usage / admin usage API 客户端
- `frontend/src/services/userService.ts`: profile / API key / resend verification API 客户端
- `frontend/src/types/user.ts`: user/profile/api key TypeScript 类型

## Python Services (`services/`)

### Runtime / Core

- `services/trading-service/.env.trading`: trading-service 示例环境变量
- `services/trading-service/README.md`: trading-service 使用文档
- `services/python-common/json_safety.py`: LangChain/消息对象 JSON-safe 转换
- `services/trading-service/monitor_task.py`: 任务轮询与观察辅助脚本
- `services/trading-service/quick_test.py`: 快速手工测试脚本
- `services/python-common/requirements.txt`: trading-service 依赖
- `services/trading-service/trading_service.py`: FastAPI worker / runtime / streaming / stage assembly 主实现
- `services/python-common/usage_collector.py`: usage event 采集与 Redis flush

### Example Apps / Historical Experiments

- `langchain-v1/app-langagents-fs.py`: 旧实验入口（文件系统方向）
- `langchain-v1/app-langagents.py`: 旧实验入口（langagents）
- `langchain-v1/app-langchain.py`: 旧实验入口（langchain）
- `langchain-v1/app-langgraph.py`: 旧实验入口（langgraph）

### Tests

- `services/trading-service/test_analysis_report_serialization.py`: analysis_report 序列化测试
- `services/trading-service/test_trading_service.py`: trading_service 手工/集成测试辅助
- `services/trading-service/tests/__init__.py`: tests 包初始化
- `services/trading-service/tests/mock_pipeline/README.md`: mock pipeline 测试说明
- `services/trading-service/tests/mock_pipeline/__init__.py`: mock pipeline 包初始化
- `services/trading-service/tests/mock_pipeline/fixtures/fake_decision.json`: mock 决策 fixture
- `services/trading-service/tests/mock_pipeline/fixtures/fake_graph_state.json`: mock graph state fixture
- `services/trading-service/tests/mock_pipeline/test_mock_analysis_pipeline.py`: mock 分析流水测试
- `services/trading-service/tests/mock_pipeline/test_openclaw_stage_contract.py`: OpenClaw stage contract 测试
- `services/trading-service/tests/mock_pipeline/test_redis_worker_client.py`: Redis worker client 测试

### Sample Outputs

- `langchain-v1/eval_results/*/*.json`: 历史分析状态日志样例，用于回放与对比，不参与主运行逻辑

## Devlog / Architecture Docs

### Top-level

- `docs/devlog/README.md`: devlog 使用说明
- `docs/devlog/appendix/README.md`: appendix 使用说明
- `docs/devlog/current/README.md`: current 区使用说明
- `docs/devlog/records/README.md`: ADR 记录索引
- `docs/devlog/archive/README.md`: archive 区说明

### Current Appendix

- `docs/devlog/appendix/agent-role-map.md`: agent / analyst 角色映射
- `docs/devlog/appendix/analysis-report-schema.md`: analysis_report / stages schema 说明
- `docs/devlog/appendix/data-models.md`: 核心数据模型梳理
- `docs/devlog/appendix/interfaces.md`: 核心接口清单
- `docs/devlog/appendix/module-map.md`: 模块职责摘要
- `docs/devlog/appendix/repo-file-index.md`: 仓库文件级责任索引（本文）
- `docs/devlog/appendix/service-boundaries.md`: 服务边界说明
- `docs/devlog/appendix/system-architecture.md`: 系统架构概览
- `docs/devlog/appendix/team-branches-review.md`: 分支能力评估
- `docs/devlog/appendix/templates/adr-record-template.md`: ADR 记录模板
- `docs/devlog/appendix/templates/version-review-template.md`: 版本复盘模板
- `docs/devlog/appendix/vendor-routing.md`: provider / vendor 路由说明

### Archive

- `docs/devlog/archive/v0.1.0/*`: `v0.1.0` 冻结快照
- `docs/devlog/archive/v0.1.1/*`: `v0.1.1` 冻结快照
- `docs/devlog/archive/v0.1.2/*`: `v0.1.2` 冻结快照

### Current Planning

- `docs/devlog/current/overview.md`: 当前版本总纲索引页
- `docs/devlog/current/prd.md`: 当前版本产品需求与解决方向
- `docs/devlog/current/capabilities.md`: 当前能力矩阵
- `docs/devlog/current/milestones.md`: v0.2 里程碑
- `docs/devlog/current/problems-and-debts.md`: 问题与技术债清单
- `docs/devlog/current/task-backlog.md`: 当前 backlog
- `docs/devlog/records/ADR-001_*` 至 `ADR-018_*`: v0.2 启动、Redis runtime、provider 基础修复、chart/feed 初期问题记录
- `docs/devlog/records/ADR-019_*` 至 `ADR-025_*`: requirement 衔接、chart feature、SSE、DashScope/tool-call、provider keying 记录
- `docs/devlog/records/ADR-026_*` 至 `ADR-031_*`: deployment、email、feed、observability、pgvector、review 记录
- `docs/devlog/records/ADR-032_*` 至 `ADR-038_*`: chart terminal、usage token、thread-lock、BYOK、Ollama、仓库同步记录

## Non-runtime Support Artifacts

- `package-lock` / `go.sum` / `uv.lock`: 依赖锁定文件
- `*.png / *.jpg / *.svg / *.ai / *.zip`: 文档、品牌、截图资产
- `eval_results/*.json`: 历史运行输出样例

这些文件不直接承载业务逻辑，但对复现、部署、展示和版本对齐仍然重要。
