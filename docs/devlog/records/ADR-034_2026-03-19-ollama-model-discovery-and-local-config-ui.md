---
id: ADR-034
kind: decision
title: Ollama Model Discovery And Local Config UI
date: 2026-03-19
status: active
supersedes: null
superseded_by: null
implements: []
verified_by: []
---

# Ollama Model Discovery And Local Config UI

## Background

主线已把 Ollama 作为本地默认 provider 使用，但早期配置体验仍有明显缺口：

- 前端只能手填模型名
- 用户无法知道当前 Ollama host 上到底有哪些本地模型
- `base_url` 若填写不规范（例如带 `/v1`）会带来探测和调用不一致

代码里这部分已经做成了一条完整功能链，但当前 devlog 里没有独立实现记录，只在若干 Ollama 相关记录中间接提到默认模型或 embedding 路由。

## Problem and impact

没有模型发现能力时，会出现几个典型问题：

- 本地模型名拼错，提交分析后才失败
- 用户不知道某个模型是否已下载到本机 Ollama
- 前端模型 preset 与实际本地模型状态脱节
- Host 写成 `http://localhost:11434/v1` 或其它变体时，探测与实际调用容易不一致

这不是“纯 UX 小问题”，而是本地默认执行模式可用性的关键组成部分。

## Current state analysis

当前仓库已经实现了完整的 Ollama 本地模型探测与配置闭环：

### 1. Go backend 提供模型发现代理接口

`backend/controllers/ollama_controller.go` 当前提供：

- `GET /api/trading/ollama/models`

行为：

- 接收可选 `base_url`
- 归一化 host
- 代理请求到 Ollama 原生：
  - `GET {base_url}/api/tags`
- 将结果安全返回前端

### 2. Host 归一化逻辑已实现

`normalizeOllamaBaseURL(...)` 当前会：

- 空值回退到 `http://localhost:11434`
- 过滤非法 URL
- 去掉尾部 `/`
- 去掉 `/v1`
- 清空 query / fragment

这让“探测模型”和“实际聊天调用”使用同一主机语义。

### 3. 前端已支持自动探测模型

`frontend/src/services/tradingService.ts` 当前提供：

- `getOllamaModels(baseUrl)`

`frontend/src/App.tsx` 当前行为：

- 切到 `executionMode === 'ollama'` 时自动探测
- 支持手动 `Refresh list`
- 保存探测成功的 host，避免重复请求
- 将预设模型和已探测本地模型合并显示

### 4. UI 已形成本地配置工作流

Ollama 模式下当前 UI 已提供：

- `Ollama Model` 下拉 + 自定义输入框
- `Ollama Host` 输入框
- `Detected Models` 区域
- 探测错误提示与空状态文案

这意味着本地 Ollama 配置不再只是手写字符串，而是可探测、可刷新、可回退的实际配置界面。

## Options considered

### 方案 A：只保留静态模型 preset

- 优点：实现最简单
- 缺点：与本地实际模型状态脱节
- 缺点：用户仍然要自己猜模型名和下载状态

### 方案 B：增加后端代理的本地模型发现能力

- 优点：前端无需直接访问用户本地 Ollama
- 优点：统一鉴权与错误处理
- 优点：可以对 host 做归一化和输入防御

## Tradeoff comparison

选择方案 B。

原因：

- 这条链路最贴合当前 FinGOAT 的 Go gateway 架构
- 不要求浏览器直接跨域访问用户 Ollama
- 使本地默认执行模式真正具备“可配置、可诊断、可探测”的最低可用性

## Final decision

将 Ollama 本地模型发现做成正式能力：

- Go 负责 host 归一化与 `/api/tags` 代理
- 前端负责自动刷新、模型合并、错误展示
- 用户可以在本地模式下快速确认“有哪些模型实际可用”

## Implementation design

### Backend

新增：

- `backend/controllers/ollama_controller.go`
- 路由：
  - `GET /api/trading/ollama/models`

设计点：

- 5 秒超时，避免 UI 长时间挂起
- 非 200 状态转为显式错误
- 只回传前端真正需要的字段：
  - `name`
  - `modified_at`
  - `size`

### Frontend service

新增：

- `tradingService.getOllamaModels(baseUrl)`

### Frontend app shell

在 `App.tsx` 中增加：

- `ollamaModels`
- `ollamaModelsLoading`
- `ollamaModelsError`
- `detectOllamaModels(force)`
- `ollamaModelOptions`

行为规则：

- 首次进入 Ollama 模式自动探测
- host 未变化且已有结果时，默认不重复请求
- 用户可强制刷新
- 探测结果与静态 preset 合并，既保留推荐值，也展示本地真实值

## Testing and validation

从当前代码可以确认：

- 后端路由已注册：
  - `GET /api/trading/ollama/models`
- 前端服务调用已存在
- App UI 已消费返回结果并在 Ollama 模式下显示

本次补文档未单独发起新的 live Ollama 探测请求；记录依据为主线代码状态和调用链闭环。

## Outcome and follow-up

当前结论：

- Ollama 已不只是“默认 provider”，而是具备基本发现能力的本地运行模式
- 模型名不再完全依赖手工输入
- host 归一化减少了 `/v1`、尾斜杠等常见输入误差

后续可以继续增强：

- 增加模型能力标签（chat / embedding）
- 标记推荐模型与当前选中模型
- 在探测失败时给出更具体的本地排查指引
- 如后续支持远程 Ollama，可增加更严格的 host allowlist / SSRF 防护
