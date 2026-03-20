---
id: ADR-038
kind: decision
title: User Profile And BYOK Implementation
date: 2026-03-19
status: active
supersedes: ADR-020
superseded_by: null
implements: [ADR-020]
verified_by: []
---

# User Profile And BYOK Implementation

## Background

`ADR-020` 只记录了用户域与 BYOK 的需求和目标状态，但当前主线代码已经不再停留在“待实现”阶段：

- 用户模型已完成扩展
- Profile 页面已上线
- API Key 已支持按用户、按 provider 加密存储
- 分析请求链路已能自动注入用户自己的 provider key

这部分实现量已经足够形成独立的实现记录，否则 devlog 会长期停留在“有需求稿、缺实现稿”的不完整状态。

## Problem and impact

如果只保留需求记录，会导致几个问题：

- 无法从 devlog 直接看出用户域能力已经落地主线
- BYOK 会被误以为仍依赖服务端环境变量统一配置
- Profile / API Keys / email verification / task provider key injection 之间的关系不清楚
- 后续排查 provider 失败时，容易忽略“密钥来自用户侧配置”这一关键路径

## Current state analysis

当前主线已落地的用户域能力如下：

### 1. 用户模型已从最小账号扩展为可演进模型

`backend/models/user.go` 当前包含：

- `username`
- `password_hash`
- `email`
- `email_verified`
- `display_name`
- `avatar_url`
- `role`

这已经超出最初的 `username + password` 最小模型。

### 2. 注册 / 登录已支持 email-first，并保留 username 兼容

`backend/controllers/auth_controller.go` 当前行为：

- 注册优先支持 `{ email, password, display_name }`
- 兼容旧的 `{ username, password }`
- 登录支持：
  - `identifier + password`
  - 兼容 `email + password`
  - 兼容 `username + password`

### 3. Profile 接口与页面已实现

后端已提供：

- `GET /api/user/profile`
- `PUT /api/user/profile`

前端已提供：

- `frontend/src/components/ProfilePage.tsx`
- `frontend/src/services/userService.ts`

可编辑字段包括：

- `display_name`
- `avatar_url`
- `email`

### 4. 邮箱验证状态与 Profile 变更已打通

当前行为：

- email 注册后异步发送验证邮件
- `GET /api/auth/verify-email` 支持公开验证
- `POST /api/user/resend-verification` 支持用户重发
- 用户修改 email 时：
  - `email_verified` 自动重置为 `false`
  - 旧的未使用 verify token 会被删除
  - 新地址会触发新的验证邮件

### 5. BYOK 已真正实现，不只是 UI 占位

后端已提供：

- `GET /api/user/api-keys`
- `PUT /api/user/api-keys/:provider`
- `DELETE /api/user/api-keys/:provider`

支持 provider 列表包括：

- `openai`
- `anthropic`
- `google`
- `deepseek`
- `dashscope`
- `alpha_vantage`

别名兼容：

- `aliyun` 统一归一化为 `dashscope`

### 6. API Key 已加密存储

`backend/models/user_api_key.go` + `backend/utils/crypto.go` 当前实现：

- 每个用户、每个 provider 一条记录
- 明文不落库
- 使用 `AES-256-GCM` 加密
- 依赖环境变量：
  - `BYOK_ENCRYPTION_KEY`
- 前端只拿到：
  - `is_set`
  - `key_mask`

### 7. 用户侧密钥已接入真实分析链路

`backend/controllers/trading_controller.go` 当前行为：

- 非 Ollama provider 的 LLM 请求，会先读取用户在 Profile 里保存的 provider key
- `us` 市场分析会额外读取该用户的 `alpha_vantage` key
- 如果缺 key，会直接返回明确报错：
  - 提示用户去 `Profile & API Keys` 配置

因此，BYOK 不是“仅保存”，而是已经真正参与任务执行路径。

## Options considered

### 方案 A：维持需求稿即可，不补实现记录

- 优点：零额外文档成本
- 缺点：代码与 devlog 语义脱节

### 方案 B：补一条实现记录，明确主线已具备的用户域能力

- 优点：用户域演进闭环完整
- 优点：后续查 provider / auth / email 问题时更容易定位

## Tradeoff comparison

选择方案 B。

原因：

- 当前这部分功能已不是零散 patch，而是完整模块
- 它和交易分析链路、provider key 注入、RBAC、email verification 都有交叉
- 缺实现记录会直接削弱 devlog 的可追溯性

## Final decision

将“User Profile + BYOK + email/account integration”补写为独立实现记录，并把先前需求稿视为历史输入，而非当前状态描述。

## Implementation design

实现结构可归纳为四层：

### 1. 账号层

- 扩展 `User` 模型
- `JWT` 中加入 `uid + username`
- auth middleware 优先解析 `uid`

### 2. Profile 层

- 公开返回安全 profile 响应
- 允许用户更新昵称、头像、邮箱
- email 变更后自动刷新验证状态

### 3. Key 管理层

- 独立 `user_api_keys` 表
- provider 归一化
- AES-256-GCM 加密存储
- mask-only 回显

### 4. 任务注入层

- Go 在接收分析任务时读取用户密钥
- 将 LLM key 注入 `req.LLMConfig.APIKey`
- 将 Alpha Vantage key 注入 `req.AlphaVantageAPIKey`
- Python worker 不需要感知“密钥来自哪个用户表”，只消费已注入请求

## Testing and validation

从仓库可确认已有直接覆盖：

- `backend/controllers/auth_controller_test.go`
- `backend/models/user_test.go`
- `backend/utils/utils_test.go`

与本记录直接相关的实现信号：

- 用户域迁移和模型扩展已在主线代码中
- Profile 页面已消费后端 profile/api-key 接口
- 交易分析请求路径中已有 key 注入和缺 key 错误提示

本次补文档时未新增功能代码；验证以现有实现与测试覆盖为主。

## Outcome and follow-up

当前结论：

- 用户域重构已经进入主线，不再是“待实现”
- BYOK 已具备：
  - 加密存储
  - provider 归一化
  - 安全回显
  - 真实任务注入
- Profile / email verification / provider injection 已形成完整闭环

仍可继续增强：

- 支持更细粒度的 provider 列表与 key 元数据
- 增加管理员侧用户角色管理 / 提权入口
- 为 BYOK 增加最后更新时间、来源审计、验证探针
