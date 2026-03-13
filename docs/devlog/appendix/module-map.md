# Module Map

本文档描述当前系统的核心模块、职责、输入输出、关键依赖和已知薄弱点。

## 1. Frontend

- 位置：`frontend/`
- 模块职责：用户交互、认证流程、文章流展示、分析任务提交、结果轮询与展示
- 输入：
  - 用户登录/注册表单
  - ticker/date/模型配置
  - 后端返回的文章与分析结果
- 输出：
  - 对 Go backend 的 HTTP 请求
  - 用户可见的页面状态与分析结果
- 关键依赖：
  - Go backend API
  - 浏览器 localStorage
- 与其他模块的关系：
  - 仅通过 Go backend 访问业务能力
  - 不直接调用 Python Trading Service
- 当前实现状态：部分完成
- 已知风险：
  - `App.tsx` 职责过重
  - 主线缺乏阶段透明度展示

## 2. Go Backend

- 位置：`backend/`
- 模块职责：
  - JWT 鉴权
  - 业务 API 统一入口
  - 文章/RSS 管理
  - 分析任务持久化
  - 协调 Python Trading Service
- 输入：
  - 前端 HTTP 请求
  - Python Trading Service 返回
  - PostgreSQL/Redis 读写结果
- 输出：
  - 面向前端的 JSON API
  - 分析任务与决策持久化记录
- 关键依赖：
  - PostgreSQL
  - Redis
  - Python Trading Service
- 与其他模块的关系：
  - 是系统当前的业务控制层
  - 面向前端屏蔽 Python 细节
- 当前实现状态：已完成基础闭环
- 已知风险：
  - 和 Python 的契约偏弱类型
  - 运行中状态依赖 Python

## 3. Python Trading Service

- 位置：`langchain-v1/`
- 模块职责：
  - 接受分析请求
  - 包装 TradingAgents
  - 返回任务状态和分析结果
- 输入：
  - `ticker`
  - `date`
  - `llm_config`
  - `data_vendor_config`
- 输出：
  - `task_id`
  - `status`
  - `decision`
  - `analysis_report`
- 关键依赖：
  - TradingAgents
  - LLM provider
  - 外部金融数据源
- 与其他模块的关系：
  - 当前由 Go backend 内部调用
- 当前实现状态：已完成
- 已知风险：
  - 任务状态存于进程内存
  - 运行期与持久态边界不清晰

## 4. TradingAgents Engine

- 位置：`TradingAgents/`
- 模块职责：
  - 多 agent 图编排
  - analyst/research/risk/trader 角色执行
  - 数据工具调用
  - 最终信号生成
- 输入：
  - 股票代码
  - 分析日期
  - LLM 配置
  - vendor 配置
- 输出：
  - 完整 agent state
  - 最终决策信号
- 关键依赖：
  - LangGraph
  - LLM provider abstraction
  - tool routing
- 与其他模块的关系：
  - 是 Python Trading Service 的核心引擎层
- 当前实现状态：已完成
- 已知风险：
  - 输出结构标准化不足
  - 图流程复杂度已开始上升

## 5. Data Vendor Routing

- 位置：`TradingAgents/tradingagents/dataflows/`
- 模块职责：
  - 将逻辑工具映射到实际供应商
  - 提供 fallback 路由
- 输入：
  - 逻辑方法名，如 `get_stock_data`
  - 标准化参数
- 输出：
  - 供应商返回的数据文本或分析数据
- 关键依赖：
  - `yfinance`
  - `alpha_vantage`
  - `openai`
  - `google`
  - `local`
- 与其他模块的关系：
  - 被 TradingAgents 的工具层调用
- 当前实现状态：已完成
- 已知风险：
  - 缓存和限流尚未系统化

## 6. Persistence Layer

- 位置：`backend/models/` + `backend/config/`
- 模块职责：
  - 保存用户、文章、分析任务、决策
- 输入：
  - Go 业务层实体
- 输出：
  - 可查询的持久记录
- 关键依赖：
  - PostgreSQL
  - GORM
- 与其他模块的关系：
  - 当前业务真相源候选层
- 当前实现状态：已完成
- 已知风险：
  - 运行态尚未纳入统一存储设计

## 7. Redis Layer

- 位置：`backend/controllers/article_controller.go`、`backend/controllers/like_controller.go`
- 模块职责：
  - 当前用于文章缓存与点赞计数
- 输入：
  - 缓存 key
  - 点赞 key
- 输出：
  - 缓存数据
  - 计数值
- 关键依赖：
  - Redis
- 与其他模块的关系：
  - 目前是辅助层
- 当前实现状态：部分完成
- 已知风险：
  - 职责过轻，未进入核心任务链路

## 8. Infra And Entry

- 位置：`docker-compose.yml`、`nginx/`、`k8s/`
- 模块职责：
  - 本地编排
  - 统一入口反向代理
  - 部署方向预留
- 当前实现状态：已完成基础部署形态
- 已知风险：
  - 与应用层配置治理尚未统一
