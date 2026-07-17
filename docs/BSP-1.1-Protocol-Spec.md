# BSP 1.1 可开发协议需求文档（精准还原）

> **Version**: 1.1 Draft
> **Status**: Review
> **Document Type**: Protocol-based Product Requirement
> **Scope**: Reality Engine / Reality Layer

---

## 1. 需求目标

BSP（Business Signal Protocol，业务信号协议），用于定义企业现实信息如何被统一表达。

BSP 1.1 的目标是：

> 规定任何进入 Reality Engine 的企业现实信息，必须被转换为**统一、可追溯、可追加、可演化、与模型无关**的业务现实协议对象。

BSP 不负责判断现实，只负责表达现实。

它回答的问题是：

- 这条现实信息来自哪里？
- 原始证据是什么？
- 具体证据片段在哪里？
- 形成了什么业务观察？
- 关联哪个企业对象？
- 对象之间是否存在事实关系？
- 当前状态能否追溯到历史 Signal？

---

## 2. 产品边界

### BSP 负责

| # | 职责 |
|---|------|
| 1 | 原始证据保存 |
| 2 | 证据片段定位 |
| 3 | 业务观察表达 |
| 4 | 企业对象锚定 |
| 5 | 对象身份归一 |
| 6 | 事实关系表达 |
| 7 | 当前状态表达 |
| 8 | 时间线投影 |
| 9 | 证据链追溯 |
| 10 | 协议校验 |

### BSP 不负责

| # | 不属于 BSP |
|---|------------|
| 1 | 风险识别 |
| 2 | 问题诊断 |
| 3 | 决策建议 |
| 4 | KPI 分析 |
| 5 | BI 报表 |
| 6 | 工作流执行 |
| 7 | Agent 编排 |
| 8 | 任务分派 |
| 9 | 管理结论生成 |

> Issue / Risk / Decision / KPI / Workflow 可以基于 BSP 生成，但不属于 BSP Reality Layer。

---

## 3. 核心原则

| 原则 | 说明 |
|------|------|
| **Reality First** | BSP 只表达现实，不表达推理、判断、建议或结论。合法：「仓库目前使用 Excel 进行盘点。」不合法：「仓库库存管理存在严重问题。」 |
| **Everything Is Traceable** | 任何 Signal 必须能追溯到 Fragment，任何 Fragment 必须能追溯到 Evidence。 |
| **Object Centric** | 企业现实围绕 Object 组织。Signal 是 Object 的观察记录，不是 Reality Network 的中心。 |
| **Immutable Reality** | Evidence、Fragment 不可被改写。Signal 不覆盖旧 Signal，修正必须追加新记录或变更状态。 |
| **Semantic Independent** | BSP 不依赖任何 AI 模型。GPT、Claude、Gemini、规则系统、人工录入都必须输出同一协议结构。 |

---

## 4. BSP 1.1 核心链路

```
Input
  ↓
Evidence
  ↓
Fragment
  ↓
Signal
  ↓
Object Anchor
  ↓
Relation / State
  ↓
Timeline Projection
```

> BSP 1.1 相比 BSP 1.0 的关键变化是引入 **Fragment**。Fragment 不是实现细节，而是一等协议对象。它解决 Signal 只能追溯到整份 Evidence、粒度过粗的问题。

---

## 5. 核心协议对象

BSP 1.1 包含**九类协议对象**：

| # | 对象 | 说明 |
|---|------|------|
| 1 | Evidence | 原始证据 |
| 2 | Fragment | 证据片段 |
| 3 | Signal | 业务观察 |
| 4 | Object | 企业对象 |
| 5 | Identity | 对象身份归一 |
| 6 | Relation | 对象间事实关系 |
| 7 | State | 对象当前状态 |
| 8 | Context | 信号发生环境 |
| 9 | Timeline | 时间线投影 |

> 它们是协议对象，不等于九张数据库表。

---

## 6. 对象定义与字段约束

### 6.1 Evidence

Evidence 表示现实世界中的原始证据。来源可以是会议、PRD、邮件、ERP、飞书、Jira、表格、Agent 输出、AI 输出或人工输入。

| 字段类别 | 字段 |
|----------|------|
| **必填** | `id`, `source`, `created_at`, `content`, `checksum`, `state` |
| **可选** | `source_id`, `version`, `chain_id`, `creator`, `attachments`, `metadata` |

**状态**：`Created` → `Archived`

**规则**：
- `content` 必须保存原文
- `content` 创建后不可被 AI 或用户改写
- `checksum` 用于校验原始内容是否变化
- `version` 表示证据版本
- `chain_id` 表示同一证据链

---

### 6.2 Fragment

Fragment 表示 Evidence 中可定位、可引用、可复用的证据片段。

| 字段类别 | 字段 |
|----------|------|
| **必填** | `id`, `evidence_id`, `type`, `content`, `checksum`, `state` |
| **可选** | `speaker`, `start_offset`, `end_offset`, `timestamp_start`, `timestamp_end`, `page`, `section`, `row`, `column`, `attachment_id`, `metadata` |

**状态**：`Created` → `Archived`

**规则**：
- Fragment 必须属于一个 Evidence
- Fragment.content 必须来自 Evidence 原文或原始附件
- Fragment 不允许保存 AI 改写后的内容
- 一个 Evidence 可以生成多个 Fragment
- 一个 Fragment 可以支撑多个 Signal

---

### 6.3 Signal

Signal 表示业务观察（Observation）。Signal 不是问题、风险、建议、决策或摘要。

| 字段类别 | 字段 |
|----------|------|
| **必填** | `id`, `type`, `body`, `fragments`, `anchors`, `context`, `state`, `captured_at`, `confidence` |
| **可选** | `actors`, `occurred_at`, `attributes` |

**状态**：
- `Captured` → `Verified`
- `Captured` → `Invalid`
- `Verified` → `Archived`

**规则**：
- Signal 必须引用至少一个 Fragment
- Signal 必须锚定至少一个 Object
- body 必须是事实观察
- confidence 表示抽取置信度，不表示业务重要性
- Verified 必须由人工或可信规则确认
- Invalid 表示错误识别，不得物理删除
- Archived 表示历史失效，不得物理删除

---

### 6.4 Object

Object 表示企业中的稳定实体。

**类型**：`Project`, `System`, `Department`, `Customer`, `Product`, `Document`, `Process`, `Person`, `Organization`, `Task`

| 字段类别 | 字段 |
|----------|------|
| **必填** | `id`, `type`, `name`, `state`, `created_at`, `updated_at` |
| **可选** | `identity`, `aliases`, `attributes` |

**状态**：
- `Created` → `Active`
- `Active` → `Merged`
- `Active` → `Archived`

**规则**：
- Object 是 Reality Network 的组织中心
- Object 不由单个 Signal 临时决定
- Object 名称变化不等于新 Object
- Object 合并后旧 Object 进入 Merged，不得删除

---

### 6.5 Identity

Identity 解决同一 Object 多名称问题。

| 字段类别 | 字段 |
|----------|------|
| **必填** | `id`, `canonical_name`, `aliases`, `confidence` |
| **可选** | `merged_from` |

**规则**：
- Identity 只表达命名归一，不表达业务判断
- Identity 可以演化
- 合并必须保留 `merged_from`

---

### 6.6 Relation

Relation 表示 Object 之间的事实关系。

| 字段类别 | 字段 |
|----------|------|
| **必填** | `id`, `source`, `target`, `type`, `derived_from`, `confidence`, `created_at` |

**Relation 类型**：`references`, `belongs_to`, `implements`, `depends_on`, `causes`, `blocks`, `affects`, `supersedes`

**规则**：
- source 和 target 必须是 Object
- derived_from 必须引用 Signal
- Relation 只表达事实关系，不表达建议、优先级或策略

---

### 6.7 State

State 表示 Object 当前状态，不表示历史。

| 字段类别 | 字段 |
|----------|------|
| **必填** | `object`, `current_state`, `updated_at`, `derived_from` |
| **可选** | `reason` |

**规则**：
- State 必须由 Signal 推导或人工基于 Signal 确认
- 历史由 Signal 记录
- State 改变时必须保留 `derived_from`

---

### 6.8 Context

Context 表示 Signal 发生环境。

| 字段 | 说明 |
|------|------|
| `channel` | 渠道 |
| `source` | 来源 |
| `organization` | 组织 |
| `location` | 位置 |
| `meeting` | 会议 |
| `document` | 文档 |
| `system` | 系统 |

**规则**：
- Context 只描述环境
- Context 不表达业务意义、风险等级或管理判断

---

### 6.9 Timeline

Timeline 表示围绕 Object 的 Signal 时间投影。

| 字段 | 说明 |
|------|------|
| `object` | 目标对象 |
| `signals` | 关联 Signal 列表 |
| `start` | 起始时间 |
| `end` | 结束时间 |

**规则**：
- Timeline 是 Projection（投影）
- Timeline 由 Signal 查询生成
- Timeline 不作为独立 Reality Source 写入

---

## 7. MVP 开发范围

### 第一版必须实现

| # | 功能 |
|---|------|
| 1 | Evidence 创建与原文保存 |
| 2 | Fragment 创建与证据定位 |
| 3 | Signal 创建与 Fragment 引用 |
| 4 | Object 创建与 Signal 锚定 |
| 5 | Relation 创建与 Signal 来源绑定 |
| 6 | Signal 状态管理 |
| 7 | Evidence → Fragment → Signal 追溯 |
| 8 | Object → Signal 查询 |
| 9 | 基础协议校验 |

### 第一版暂不实现或只做最小能力

| # | 功能 |
|---|------|
| 1 | Identity 自动合并 |
| 2 | State 自动推导 |
| 3 | Timeline 高级视图 |
| 4 | 复杂 Relation 推理 |
| 5 | Risk / Issue / Decision Projection |
| 6 | Agent 编排 |
| 7 | BI 报表 |
| 8 | 工作流执行 |

---

## 8. 输入规范

所有输入必须遵循：

```
Input → Evidence → Fragment → Signal → Object Anchor → Relation / State
```

**禁止从 Input 直接生成**：Issue、Risk、Decision、Advice、KPI、Workflow、Task Assignment

> 如果上层系统产生了 Risk、Issue、Decision，这些结果若要进入 Reality Engine，必须重新作为 Evidence 输入，而不是直接写入 Reality Layer。

---

## 9. 输出规范

### BSP Reality Layer 允许输出

Evidence、Fragment、Signal、Object、Identity、Relation、State、Context

### BSP 可以提供查询投影

Timeline

### BSP 不允许作为 Reality 输出

Issue、Risk、Decision、Suggestion、KPI、Workflow

---

## 10. 校验规则

### 系统必须拒绝以下情况

| # | 拒绝场景 |
|---|----------|
| 1 | 创建无 Evidence 的 Fragment |
| 2 | 创建无 Fragment 的 Signal |
| 3 | 创建无 Object Anchor 的 Signal |
| 4 | 创建无法追溯来源的 Relation |
| 5 | 修改 Evidence.content |
| 6 | 修改 Fragment.content |
| 7 | 物理删除 Invalid Signal |
| 8 | 在 BSP 层创建 Risk / Issue / Decision |

### Signal body 不应包含以下判断类表达

`存在严重问题`、`风险较高`、`建议`、`应该`、`需要优化`、`可能导致`、`必须改进`、`不合理`、`落后`、`低效`

### 合法 Signal 应为

**主体 + 当前行为 / 当前状态 / 已发生事实**

**示例**：
- 仓库目前使用 Excel 进行盘点。
- 客服部门每周手工汇总退货申请。
- 项目 A 的上线时间从 6 月 10 日调整为 6 月 24 日。

---

## 11. 状态流转

| 对象 | 状态流转 |
|------|----------|
| Evidence | `Created` → `Archived` |
| Fragment | `Created` → `Archived` |
| Signal | `Captured` → `Verified`；`Captured` → `Invalid`；`Verified` → `Archived` |
| Object | `Created` → `Active`；`Active` → `Merged`；`Active` → `Archived` |

**状态规则**：
- Invalid 不代表删除，只代表错误识别
- Archived 不代表删除，只代表不再作为当前有效现实
- Merged 必须保留合并来源
- Verified 表示人工或可信规则确认

---

## 12. 核心用户动作

第一版系统至少支持：

| # | 用户动作 |
|---|----------|
| 1 | 创建 Evidence |
| 2 | 查看 Evidence 原文 |
| 3 | 从 Evidence 创建 Fragment |
| 4 | 查看 Fragment 在 Evidence 中的位置 |
| 5 | 从 Fragment 创建 Signal |
| 6 | 将 Signal 锚定到 Object |
| 7 | 创建或选择 Object |
| 8 | 查看 Signal 的证据链 |
| 9 | 标记 Signal 为 Verified |
| 10 | 标记 Signal 为 Invalid |
| 11 | 查看 Object 关联的 Signal 列表 |

---

## 13. 验收标准

| 编号 | 验收标准 |
|------|----------|
| AC-001 | 用户可以创建 Evidence，并保存原始 content |
| AC-002 | Evidence 创建后，content 不允许被修改 |
| AC-003 | 用户可以从 Evidence 创建 Fragment |
| AC-004 | Fragment 必须引用一个 Evidence |
| AC-005 | 用户可以基于一个或多个 Fragment 创建 Signal |
| AC-006 | 创建无 Fragment 的 Signal 时，系统必须拒绝 |
| AC-007 | Signal 必须至少锚定一个 Object |
| AC-008 | Signal body 包含明显建议、风险、结论类表达时，系统必须拒绝或标记为待人工确认 |
| AC-009 | 用户可以从 Signal 查看支撑它的 Fragment |
| AC-010 | 用户可以从 Fragment 查看原始 Evidence |
| AC-011 | Signal 被标记为 Invalid 后不得物理删除 |
| AC-012 | Object 可以关联多个 Signal |
| AC-013 | Relation 必须能追溯到 derived_from Signal |
| AC-014 | Timeline 只能由 Signal 生成，不能独立写入 Reality Layer |
| AC-015 | 系统不得在 BSP 层创建 Risk、Issue、Decision |

---

## 14. 标准示例

**原始输入**：
> 会议纪要：张三说："仓库目前还是使用 Excel 进行盘点。"

**Evidence**：
```yaml
id: EV-001
source: meeting
content: 张三说："仓库目前还是使用 Excel 进行盘点。"
state: Created
```

**Fragment**：
```yaml
id: FRG-001
evidence_id: EV-001
type: Speech
speaker: 张三
content: 仓库目前还是使用 Excel 进行盘点。
timestamp_start: 00:15:32
state: Created
```

**Signal**：
```yaml
id: SIG-001
type: observation
body: 仓库目前使用 Excel 进行盘点。
fragments:
  - FRG-001
anchors:
  - OBJ-INVENTORY-PROCESS
actors:
  - 张三
context:
  channel: meeting
state: Captured
confidence: 0.92
```

**Object**：
```yaml
id: OBJ-INVENTORY-PROCESS
type: Process
name: 仓库盘点流程
state: Active
```

**不允许在 BSP 层直接生成**：
```yaml
Issue: 仓库盘点流程落后
Risk: 库存准确性风险较高
Decision: 应上线 WMS 系统
```

---

## 15. 开发结论

BSP 1.1 的最小可开发闭环是：

```
Evidence → Fragment → Signal → Object → Trace
```

只要该闭环成立，BSP 就具备基础运行能力。

第一版开发的核心不是智能分析，而是建立 Reality Layer 的协议约束：

- 有原文
- 有片段
- 有观察
- 有对象
- 有状态
- 有追溯
- 不覆盖
- 不混入判断
- 不依赖模型

> 以上是 BSP 1.1 的开发边界。
