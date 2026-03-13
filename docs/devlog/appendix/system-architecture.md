# System Architecture

本文档描述当前系统的分层架构、模块协作关系，以及 v0.2 需要重点收紧的边界。

## 1. 当前架构总览

当前系统采用“前端 + Go 业务网关 + Python 分析服务 + TradingAgents 引擎 + PostgreSQL/Redis”的组合架构。

### 分层视图

- 表现层：`frontend`
- 编排层：`backend`
- 能力层：`langchain-v1` 和 `TradingAgents`
- 数据层：`PostgreSQL` 和 `Redis`
- 外部依赖层：LLM、金融数据源、RSS

## 2. 当前协作方式

### 用户分析请求链路

1. 用户在前端提交股票代码和日期
2. 前端调用 Go backend 的分析接口
3. Go 校验用户身份并记录任务
4. Go 调用 Python Trading Service
5. Python 调用 TradingAgents 图流程
6. TradingAgents 通过 vendor tools 获取行情、新闻、基本面等数据
7. Python 汇总结果并返回状态/结果
8. Go 更新任务和决策
9. 前端轮询并展示结果

### 文章链路

1. Go 从 RSS/Atom feed 获取数据
2. 解析并清洗内容
3. 去重后写入 PostgreSQL
4. 写入 Redis 缓存
5. 前端读取展示

## 3. 当前边界划分

### Frontend

- 负责展示和用户交互
- 不应拥有业务真相

### Go Backend

- 当前是最适合作为唯一业务 API 入口的层
- 应拥有持久化和业务状态主导权

### Python Trading Service

- 当前更适合被收敛为执行服务
- 不应长期持有业务任务真相

### TradingAgents

- 应专注于分析编排和 agent 能力
- 不应吸收过多产品接口与业务状态职责

## 4. 当前合理之处

- Go 和 Python 分工总体合理
- TradingAgents 被放在独立引擎层，边界清楚
- Vendor routing 抽象较好，后续替换供应商成本低
- PostgreSQL 已经承担了关键业务持久化

## 5. 当前不合理之处

### 运行态状态边界不清

- Python 同时是执行器和运行态状态拥有者

### Redis 职责设计不足

- 已引入 Redis，但没有承担核心协调责任

### 分析过程可观测性不足

- 系统能给结果，但不能很好展示“分析过程”

### 配置层不统一

- 多来源配置叠加，优先级不够明确

## 6. v0.2 目标架构方向

### 目标边界

- Frontend：展示和交互
- Go backend：唯一业务 API 入口 + 业务状态出口
- Redis：运行态协调层
- PostgreSQL：持久业务真相源
- Python Trading Service：执行器 / worker
- TradingAgents：分析引擎

### 目标收益

- 任务状态可恢复
- 服务边界更清晰
- 前后端更容易做透明度展示
- 后续吸收 RAG、结构化输出、valuation agent 时风险更低

## 7. 版本判断

当前架构方向是正确的，但 `v0.1.0` 仍处于“原型闭环已形成、服务边界尚未收紧”的阶段。`v0.2.0` 的重点不是增加更多 agent，而是收紧系统边界并把运行模型做稳。
