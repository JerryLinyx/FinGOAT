---
id: ADR-036
kind: decision
title: qwen3.5-flash Thread Lock Pickle Fix
date: 2026-03-19
status: active
supersedes: null
superseded_by: null
implements: []
verified_by: []
---

# qwen3.5-flash Thread Lock Pickle Fix

## Background

在使用 `DashScope / qwen3.5-flash` 分析 `NVDA` 时，运行链路报错：

- `TypeError: cannot pickle '_thread.lock' object`

该问题出现在 `TradingAgents` 图执行之前的配置/构图阶段，而不是 DashScope provider 本身的路由或模型调用失败。

## Problem and impact

- 任务在分析启动阶段直接失败，无法进入正常的 agent 执行。
- 错误信息表面看像 provider 兼容问题，但实际是本地对象被错误放入可深拷贝配置中。
- 由于 `get_config()` / `deepcopy(config)` 在数据流和图初始化路径中被频繁调用，该问题会阻断整条分析主链路。

## Current state analysis

排查结果如下：

- `services/trading-service/trading_service.py` 在创建 `UsageCollector` 后，把 collector 放进了 `config["usage_collector"]`。
- `UsageCollector` 持有 Redis client，定义见 `services/python-common/usage_collector.py`。
- Redis client 内部包含 `_thread.lock`，因此不能被 `pickle/deepcopy`。
- `TradingAgents/tradingagents/dataflows/config.py` 的 `get_config()` 会对全局 `_config` 执行 `deepcopy`。
- 只要 collector 被混进 config，后续任一 `deepcopy(config)` 都会报：
  - `TypeError: cannot pickle '_thread.lock' object`

最小复现已确认：

- `deepcopy({"usage_collector": UsageCollector(..., Redis(...))})`
- 可稳定触发同样的 `_thread.lock` 错误

## Options considered

### 方案 A：继续把 collector 放进 config，但给 collector/Redis client 定制序列化逻辑

- 优点：调用方改动少
- 缺点：把运行时对象留在配置字典里，边界仍然错误
- 缺点：需要为第三方 client 做脆弱兼容，长期不可维护

### 方案 B：保持 config 纯数据，把 usage collector 作为显式运行时参数传递

- 优点：配置与运行时对象边界清晰
- 优点：彻底避开 `deepcopy/pickle` 风险
- 优点：更符合当前 v0.2 的契约与配置治理方向

## Tradeoff comparison

选择方案 B。

原因：

- collector 本质上是执行期依赖，不是配置项
- config 应保持“可复制、可序列化、可记录”的纯数据属性
- 该修复最小且稳定，不需要侵入 Redis client 或 LangChain 对象

## Final decision

将 `usage_collector` 从 `config` 中剥离，不再通过配置字典传递。

改为：

- `trading_service.py` 创建 collector
- 显式传入 `TradingAgentsGraph(..., usage_collector=collector)`
- 再由 `TradingAgentsGraph -> GraphSetup -> 各 agent node` 逐层透传

## Implementation design

涉及改动：

- `services/trading-service/trading_service.py`
  - 删除 `config["usage_collector"] = collector`
  - 改为 `TradingAgentsGraph(debug=False, config=config, usage_collector=collector)`

- `TradingAgents/tradingagents/graph/trading_graph.py`
  - 为 `TradingAgentsGraph.__init__` 增加 `usage_collector` 参数
  - 构造 `GraphSetup` 时显式传入

- `TradingAgents/tradingagents/graph/setup.py`
  - 为 `GraphSetup.__init__` 增加 `usage_collector` 参数
  - 内部不再从 `self.config.get("usage_collector")` 读取
  - 改为直接使用 `self.usage_collector`

设计原则：

- `config` 只保留 JSON-ish 的纯数据
- Redis client、collector、callback 等运行时对象一律不进入共享配置

## Testing and validation

已完成验证：

- 语法检查通过：
  - `python -m py_compile TradingAgents/tradingagents/graph/setup.py`
  - `python -m py_compile TradingAgents/tradingagents/graph/trading_graph.py`
  - `python -m py_compile services/trading-service/trading_service.py`

- 最小复现验证通过：
  - 新路径下：
    - `set_config(cfg)` 后 `get_config()` 可正常 `deepcopy`
    - `usage_collector` 不再出现在加载后的 config 中
  - 控制组验证：
    - 若把 collector 再塞回 config
    - `deepcopy(bad_config)` 仍稳定报：
      - `TypeError: cannot pickle '_thread.lock' object`

未完成的验证：

- 未在当前记录中完成一次完整的 `NVDA + qwen3.5-flash` 端到端分析复跑
- 本地 Python 环境另有独立依赖问题：
  - `numpy / pyarrow / bottleneck / eventlet`
- 这些问题会影响完整本地实例化，但与本次 `_thread.lock` 修复不是同一根因

## Outcome and follow-up

当前结论：

- `_thread.lock` / pickle 问题已定位并修复
- 根因不是 DashScope provider，而是 collector 被错误混入 config
- 该修复同时也改善了 `v0.2` 中“配置保持纯数据”的边界治理

后续建议：

- 重启 `trading-service` 后，用 `NVDA + qwen3.5-flash` 重新跑一次端到端验证
- 将“禁止在 config 中放置运行时对象”固化为开发约定
- 后续若继续增强 metrics / observability，保持：
  - collector 走显式依赖注入
  - config 只承载可序列化配置值
