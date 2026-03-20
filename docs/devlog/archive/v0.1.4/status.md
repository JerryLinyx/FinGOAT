# v0.1.4 Status

## Summary

`v0.1.4` 将当前主线收敛为一个可运行、可验证、可追溯的工程化基线版本。

相较于 `v0.1.2`，本次封版最重要的变化是：

- Python 服务从 `langchain-v1` 过渡到明确的 `services/trading-service`、`services/market-data-service`、`services/python-common` 边界
- 用户域补齐了 email-first 注册/登录、Profile、BYOK、自助 usage/admin 可见性
- `chart / quote / terminal` 已通过独立 market-data service 收敛成统一产品壳层
- devlog 已引入 ADR 编号、`current/records/appendix/archive` 分层与版本归档机制

## Confirmed core capabilities

- Go 仍是外部业务 API 主边界，负责 auth / profile / feed / trading / usage / admin。
- Python trading service 已作为内部执行服务运行：
  - Redis queue 消费
  - runtime checkpoint 写回
  - task usage 采集与回灌
  - task resume
- market-data service 已独立运行并提供：
  - `quote`
  - `chart`
  - `terminal`
  - `CN / US` 市场参数归一化
- 用户域已具备：
  - email-first 注册/登录
  - JWT 鉴权
  - profile 读取与更新
  - per-user provider key 加密存储
  - admin usage 聚合查询
- Feed 主读链路可用：
  - `articles`
  - `feed`
  - `feed sources`
  - `feed preferences`
- Docker 主开发链路可用：
  - `postgres`
  - `redis`
  - `backend`
  - `trading-service`
  - `market-data-service`
  - `frontend`
  - `nginx`

## Confirmed release limitations

- US 分析任务仍要求用户配置 `alpha_vantage` key，否则提交会被 Go backend 直接拒绝。
- 分析任务虽然可以成功入队并进入阶段执行，但当前容器默认配置下，memory embedding 调用仍可能因上游连接不可达而失败。
- `GET /api/trading/ollama/models` 在 Docker 场景下仍默认探测 `http://localhost:11434`，容器内会把它解释为自身网络命名空间，导致 host Ollama 自动发现失败。
- Feed refresh 仍存在 RSS 内容编码清洗问题，某些文章 excerpt 会触发 PostgreSQL UTF-8 插入错误。
- PgVector memory 目前仍会在某些调用路径上回退到内存态 ChromaDB，而不是稳定使用 PostgreSQL 向量存储。
- OpenClaw gateway 仍是可选外部依赖；未启动时 trading health 会显示 `degraded/unavailable`，但不阻止默认执行路径启动。

## Test and validation summary

- `go test ./...`
- `npm run build`
- `python -m py_compile ...`
- `python -m unittest ...`
- `docker compose config`
- `docker compose up -d --build`
- 容器内 smoke test 覆盖：
  - auth register / login
  - profile get / put
  - API key get / put
  - usage summary
  - admin usage summary / users
  - `articles`
  - `feed`
  - `feed preferences`
  - `trading health`
  - `trading analyses`
  - `CN quote / chart / terminal`
  - `US analyze` submit / query / resume

## Outcome

`v0.1.4` 可以视为“多服务边界重组后的工程基线版”：

- 服务目录结构比 `v0.1.2` 明确
- 用户配置、usage/admin、market-data 主线已经进入可演示状态
- 版本文档、决策记录与归档机制已经成型
- 主要剩余问题集中在 provider 连通性、编码清洗和边界治理，而不是骨架是否存在

## Follow-up for next version

- 修复 Ollama host 发现逻辑，使容器场景默认可达 host Ollama
- 修复 feed refresh 的 UTF-8 / excerpt 清洗链路
- 让 trading graph 的 embedding / memory 路径在 Docker 默认配置下稳定可运行
- 继续收紧 Go/Python typed contract 和错误模型
- 明确 `v0.2.0` 的产品目标与版本范围
