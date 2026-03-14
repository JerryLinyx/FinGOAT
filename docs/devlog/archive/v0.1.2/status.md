# v0.1.2 Status

## Summary

`v0.1.2` 在 `v0.1.1` 的 Redis-backed 任务闭环基础上，进一步补齐了阶段可见性、取消/继续、Ollama 路由修复、Feed 数据链路重构，以及本地 OpenClaw 聊天页 MVP。

## Confirmed core capabilities

- Go 仍是主业务 API 边界，分析任务通过 PostgreSQL + Redis 进入 Python worker。
- Python worker 支持：
  - processing checkpoint 持续写回
  - worker 存活检测与自动重启
  - processing 队列恢复
  - 协作式 cancel / resume
- 前端分析页支持：
  - 阶段 timing 和 key outputs
  - 运行中阶段可见
  - logout/login 后恢复处理中任务
  - recent analyses 打开历史分析详情
- 交易分析响应已支持：
  - `execution_mode`（`default/openclaw`）
  - `stages` 作为阶段主展示契约（`analysis_report` 兼容保留）
- TradingAgents 图执行已升级为 async 主线，并支持独立 analyst 并发 fan-out。
- Ollama 主链路已经补齐：
  - 默认模型切到 `gemma3:1b`
  - embedding 默认不再回退到 OpenAI
  - 本地 embedding 不可用时，memory retrieval 会降级而不是打断分析
- Feed/文章链路已重构为数据库优先：
  - RSS 去重和批量回填
  - 智能 refresh（只在上次成功抓取过旧时才触发 ingest）
  - `feed_ingest_runs` 抓取运行记录
  - Feed 页字段映射修复，文章显示恢复正常
- 前端新增本地 OpenClaw Chat 页面 MVP：
  - 直连本机 OpenClaw gateway
  - 检测已注册 agents
  - analyst role -> existing agent match
  - match 完成后才能聊天

## Confirmed requirements carried forward

- `v0.2.0` 仍应继续收敛 Go/Python typed contract。
- 仍需统一 Go/Python/Docker 配置优先级。
- 仍需补后台定时 article ingest，而不仅依赖用户手动 refresh。
- 仍需把 OpenClaw 聊天页与 workflow 侧 role binding 连接起来，而不是停留在前端独立 MVP。

## Major unresolved problems

- Python 仍保留公共分析 task 接口，外部 API 边界尚未彻底单一化。
- Go/Python 结果结构仍有动态 JSON 区域，schema 仍不够硬。
- Python health 仍带旧的 OpenClaw adapter 探测，导致本地可用情况下仍可能显示 `degraded`。
- OpenClaw 聊天页目前是本地直连原生 gateway，不适合直接照搬到远程 VM 部署。
- Feed 目前仍缺后台定时抓取任务，智能 refresh 只是 DB-first 兜底方案，不是完整调度方案。

## Test and validation summary

- `go test ./...`
- `npm run build`
- `python -m py_compile ...`
- `python -m unittest ...`
- 多轮本地 API / Redis / PostgreSQL / provider 联调

## Outcome

`v0.1.2` 可以视为“工程化 MVP 收敛版”：

- 主分析链路可运行
- 运行态可见性明显增强
- 取消/继续与队列治理可用
- Feed 链路从“直接抓取思维”收敛到“DB-first”
- OpenClaw 方向完成了可交互 MVP 验证

## Follow-up for next version

- 收敛 Go/Python typed contract
- 彻底单一化外部 API 边界
- 增加 feed 定时 ingest
- 明确 VM/生产部署配置与密钥治理
- 把 OpenClaw role binding 扩展到 workflow 执行路径
