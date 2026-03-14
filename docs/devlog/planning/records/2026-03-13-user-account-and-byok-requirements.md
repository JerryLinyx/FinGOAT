# v0.2.0 User Account And BYOK Requirements

## 1. 背景

当前系统已具备基础账号能力（`register/login` + JWT），但用户域仍停留在最小可用形态：

- 用户模型仍是 `username + password` 的简化结构
- 未形成独立的用户 Profile 维护入口
- 未支持 email 登录
- 未提供用户级 API Key 配置页面与后端契约

以上限制会直接影响 v0.2.0 的可扩展性（认证演进、个性化配置、第三方密钥管理）。

## 2. 已确认事实（来自当前代码）

- Go 认证路由仅包含 `POST /api/auth/register` 与 `POST /api/auth/login`。
- `backend/models/user.go` 当前字段为 `Username`、`Password`。
- 前端暂无独立 Profile 页面与 API Key 配置页面。
- `推断`：当前 API 调用密钥主要由服务端环境配置统一提供，而非用户自配置。

## 3. v0.2.0 新增需求清单（本次追加）

### P0

1. 重设计用户表（兼容后续账号体系扩展）：
   - email 唯一约束
   - password_hash 存储语义明确化
   - profile 相关字段（如 display_name、avatar_url）预留
   - created/updated 及软删除策略沿用现有 GORM 模型
2. 支持 email 登录（并规划历史 username 登录兼容迁移策略）。

### P1

1. 增加用户 Profile 页面（查看/编辑基础资料）。
2. 增加用户 API Key 配置页面（按 provider 保存与更新密钥配置）。

## 4. 设计约束与安全要求

- API Key 不能明文回显给前端。
- API Key 读写接口需走鉴权中间件。
- `推断`：若近期不引入 KMS，至少需要在数据库层加密或应用层加密后存储。
- 用户模型迁移需提供可回滚策略，避免影响现有登录用户。

## 5. 方案对比（摘要）

### 方案 A：维持 username 登录，仅补 Profile 页面

- 优点：改动小，短期上线快
- 缺点：后续账号能力和多端身份体系扩展受限

### 方案 B：先完成用户域基础重构（推荐）

- 优点：账号体系、配置体系一次收口，后续迭代成本更低
- 缺点：需要模型迁移与登录兼容处理

## 6. 决策

采用方案 B，作为 v0.2.0 的用户域基础建设项推进。

## 7. 当前状态

- 状态：已立项（待实现）
- 关联 backlog：`planning/task-backlog.md` 新增 P0/P1 条目
