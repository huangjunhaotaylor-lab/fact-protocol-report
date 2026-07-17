# BSP 1.1 开发任务分解

> 基于 [BSP 1.1 协议需求文档](./BSP-1.1-Protocol-Spec.md) 分解
> 技术栈：Node.js / TypeScript
> 最小闭环：`Evidence → Fragment → Signal → Object → Trace`

---

## 整体架构

```
┌─────────────────────────────────────────────────────────────┐
│                      BSP Reality Layer                      │
├──────────┬──────────┬──────────┬──────────┬─────────────────┤
│  Input   │ Protocol │ Storage  │  Query   │   Validation    │
│  Module  │  Objects │  Layer   │  Layer   │     Layer       │
│          │          │          │          │                 │
│ Evidence │ Evidence │Evidence  │ Trace    │ Schema Check    │
│ Fragment │ Fragment │Fragment  │ Query    │ Content Check   │
│ Signal   │ Signal   │Signal    │ Object   │ State Check     │
│ Object   │ Object   │Object    │ Signal   │ Signal Body     │
│          │ Relation │Relation  │ Timeline │   Check         │
│          │ State    │State     │          │                 │
│          │ Identity │Identity  │          │                 │
│          │ Context  │Context   │          │                 │
│          │ Timeline │          │          │                 │
├──────────┴──────────┴──────────┴──────────┴─────────────────┤
│                        API Layer (REST)                      │
├─────────────────────────────────────────────────────────────┤
│                         CLI Layer                            │
└─────────────────────────────────────────────────────────────┘
```

### 目录结构规划

```
src/
├── index.ts                      # 应用入口
├── config/
│   └── index.ts                  # 配置管理
├── types/                        # 协议对象类型定义
│   ├── evidence.ts
│   ├── fragment.ts
│   ├── signal.ts
│   ├── object.ts
│   ├── identity.ts
│   ├── relation.ts
│   ├── state.ts
│   ├── context.ts
│   └── timeline.ts
├── services/                     # 业务逻辑层
│   ├── evidence.service.ts
│   ├── fragment.service.ts
│   ├── signal.service.ts
│   ├── object.service.ts
│   ├── relation.service.ts
│   ├── state.service.ts
│   ├── identity.service.ts       # MVP 最小能力
│   ├── context.service.ts
│   └── timeline.service.ts       # MVP 最小能力
├── repositories/                 # 存储层
│   ├── base.repository.ts
│   ├── evidence.repository.ts
│   ├── fragment.repository.ts
│   ├── signal.repository.ts
│   ├── object.repository.ts
│   └── relation.repository.ts
├── validators/                   # 协议校验层
│   ├── schema.validator.ts
│   ├── content.validator.ts
│   ├── signal-body.validator.ts
│   └── state-machine.validator.ts
├── routes/                       # API 路由层
│   ├── evidence.routes.ts
│   ├── fragment.routes.ts
│   ├── signal.routes.ts
│   ├── object.routes.ts
│   ├── relation.routes.ts
│   └── query.routes.ts
├── queries/                      # 查询投影层
│   ├── trace.query.ts
│   ├── object-signals.query.ts
│   └── timeline.query.ts
├── utils/
│   ├── checksum.ts               # 内容校验和
│   ├── id-generator.ts           # ID 生成器
│   ├── logger.ts
│   └── errors.ts
└── tests/
    ├── evidence.test.ts
    ├── fragment.test.ts
    ├── signal.test.ts
    ├── object.test.ts
    ├── relation.test.ts
    ├── validation.test.ts
    └── trace.test.ts
```

---

## 任务总览

| Phase | 任务数 | 目标 |
|-------|--------|------|
| Phase 0 | 3 | 基础设施搭建 |
| Phase 1 | 5 | 核心协议对象（MVP 必须实现） |
| Phase 2 | 3 | 校验与约束系统 |
| Phase 3 | 2 | 查询与追溯 |
| Phase 4 | 2 | API 与 CLI |
| Phase 5 | 1 | 集成测试与验收 |
| **合计** | **16** | |

---

## Phase 0：基础设施搭建

### TASK-001：类型系统与协议对象定义

**优先级**：P0 | **估时**：1天 | **依赖**：无

**范围**：
- 定义全部九类协议对象的 TypeScript 类型/接口
- 定义状态枚举（EvidenceState, FragmentState, SignalState, ObjectState）
- 定义 Relation 类型枚举
- 定义 Object 类型枚举
- 定义 Context 接口

**文件**：`src/types/*.ts`

**验收**：
- 所有类型可被 import 使用
- 类型与文档 6.1-6.9 节字段完全一致

---

### TASK-002：存储层基础设施

**优先级**：P0 | **估时**：1.5天 | **依赖**：TASK-001

**范围**：
- Base Repository 抽象类（CRUD 基础方法）
- 内存存储实现（MVP 阶段，后续可替换为数据库）
- ID 生成器（EV-xxx, FRG-xxx, SIG-xxx, OBJ-xxx 前缀）
- Checksum 计算工具（用于 Evidence/Fragment 内容校验）
- 各协议对象的 Repository 实现

**文件**：`src/repositories/*.ts`, `src/utils/checksum.ts`, `src/utils/id-generator.ts`

**验收**：
- 各 Repository 可执行基本 CRUD
- ID 生成器按规范生成带前缀的 ID
- Checksum 可对内容计算哈希

---

### TASK-003：错误体系与日志

**优先级**：P0 | **估时**：0.5天 | **依赖**：无

**范围**：
- 自定义错误类（ProtocolViolationError, ValidationError, StateTransitionError 等）
- 统一错误响应格式
- 日志配置（已有 logger.ts，补充完善）

**文件**：`src/utils/errors.ts`, `src/utils/logger.ts`

**验收**：
- 协议违规可抛出明确错误类型
- 日志可输出结构化信息

---

## Phase 1：核心协议对象（MVP 必须）

### TASK-004：Evidence 服务

**优先级**：P0 | **估时**：1天 | **依赖**：TASK-001, TASK-002

**范围**：
- 创建 Evidence（保存原始 content，计算 checksum）
- 查看 Evidence 原文
- Evidence 状态管理（Created → Archived）
- **不可变性约束**：content 创建后不可修改
- 支持可选字段（source_id, version, chain_id, creator, attachments, metadata）

**对应需求**：6.1, AC-001, AC-002, 12.1, 12.2

**文件**：`src/services/evidence.service.ts`

**验收**：
- [x] AC-001：可创建 Evidence 并保存原始 content
- [x] AC-002：创建后 content 不允许修改（尝试修改抛出错误）

---

### TASK-005：Fragment 服务

**优先级**：P0 | **估时**：1天 | **依赖**：TASK-004

**范围**：
- 从 Evidence 创建 Fragment
- Fragment 必须引用 evidence_id（必填校验）
- Fragment.content 必须来自 Evidence 原文或附件（校验）
- 支持 定位字段（speaker, start_offset, end_offset, timestamp, page, section, row, column）
- Fragment 状态管理（Created → Archived）
- 一个 Evidence 可生成多个 Fragment
- **不可变性约束**：content 创建后不可修改

**对应需求**：6.2, AC-003, AC-004, 12.3, 12.4

**文件**：`src/services/fragment.service.ts`

**验收**：
- [x] AC-003：可从 Evidence 创建 Fragment
- [x] AC-004：Fragment 必须引用一个 Evidence

---

### TASK-006：Object 服务

**优先级**：P0 | **估时**：1天 | **依赖**：TASK-002

**范围**：
- 创建 Object（10 种类型：Project, System, Department, Customer, Product, Document, Process, Person, Organization, Task）
- Object 状态管理（Created → Active → Merged/Archived）
- 查看 Object 关联的 Signal 列表
- Object 合并（旧 Object 进入 Merged，保留合并来源）
- 支持可选字段（identity, aliases, attributes）

**对应需求**：6.4, AC-012, 12.7, 12.11

**文件**：`src/services/object.service.ts`

**验收**：
- [x] AC-012：Object 可以关联多个 Signal

---

### TASK-007：Signal 服务

**优先级**：P0 | **估时**：1.5天 | **依赖**：TASK-005, TASK-006

**范围**：
- 从一个或多个 Fragment 创建 Signal
- Signal 必须引用至少一个 Fragment（校验）
- Signal 必须锚定至少一个 Object（校验）
- Signal body 必须是事实观察（调用校验器）
- Signal 状态管理（Captured → Verified/Invalid, Verified → Archived）
- 标记 Signal 为 Verified（人工确认）
- 标记 Signal 为 Invalid（不得物理删除）
- confidence 字段记录抽取置信度
- 支持可选字段（actors, occurred_at, attributes）

**对应需求**：6.3, AC-005, AC-006, AC-007, AC-008, AC-011, 12.5, 12.6, 12.8, 12.9, 12.10

**文件**：`src/services/signal.service.ts`

**验收**：
- [x] AC-005：可基于一个或多个 Fragment 创建 Signal
- [x] AC-006：创建无 Fragment 的 Signal 时，系统必须拒绝
- [x] AC-007：Signal 必须至少锚定一个 Object
- [x] AC-008：body 包含判断类表达时拒绝或标记待确认
- [x] AC-011：Invalid 后不得物理删除

---

### TASK-008：Relation 服务

**优先级**：P1 | **估时**：1天 | **依赖**：TASK-006, TASK-007

**范围**：
- 创建 Relation（source Object → target Object）
- Relation 类型（references, belongs_to, implements, depends_on, causes, blocks, affects, supersedes）
- derived_from 必须引用 Signal（校验）
- source 和 target 必须是 Object（校验）

**对应需求**：6.6, AC-013

**文件**：`src/services/relation.service.ts`

**验收**：
- [x] AC-013：Relation 必须能追溯到 derived_from Signal

---

## Phase 2：校验与约束系统

### TASK-009：Schema 校验器

**优先级**：P0 | **估时**：1天 | **依赖**：TASK-001

**范围**：
- 校验各协议对象必填字段是否齐全
- 校验字段类型是否正确
- 校验枚举值是否合法
- 创建无 Evidence 的 Fragment 时拒绝
- 创建无 Fragment 的 Signal 时拒绝
- 创建无 Object Anchor 的 Signal 时拒绝
- 创建无法追溯来源的 Relation 时拒绝

**对应需求**：10, AC-006, AC-007, AC-013

**文件**：`src/validators/schema.validator.ts`

**验收**：
- 所有禁止场景（文档 10 节）均被拦截

---

### TASK-010：Signal Body 内容校验器

**优先级**：P0 | **估时**：1天 | **依赖**：TASK-007

**范围**：
- 检测 Signal body 中的判断类表达
- 禁止词汇列表：`存在严重问题`、`风险较高`、`建议`、`应该`、`需要优化`、`可能导致`、`必须改进`、`不合理`、`落后`、`低效`
- 检测到禁止词汇时：拒绝创建或标记为待人工确认
- 合法格式校验：主体 + 当前行为 / 当前状态 / 已发生事实

**对应需求**：10, AC-008

**文件**：`src/validators/signal-body.validator.ts`, `src/validators/content.validator.ts`

**验收**：
- [x] AC-008：body 包含判断类表达时，系统拒绝或标记待确认
- 合法 Signal 可通过校验

---

### TASK-011：状态机校验器

**优先级**：P0 | **估时**：0.5天 | **依赖**：TASK-004, TASK-005, TASK-006, TASK-007

**范围**：
- Evidence 状态机：Created → Archived
- Fragment 状态机：Created → Archived
- Signal 状态机：Captured → Verified, Captured → Invalid, Verified → Archived
- Object 状态机：Created → Active, Active → Merged, Active → Archived
- 非法状态转移拒绝
- 不可变对象修改拒绝（Evidence.content, Fragment.content）
- Invalid/Archived 不可物理删除

**对应需求**：11

**文件**：`src/validators/state-machine.validator.ts`

**验收**：
- 所有非法状态转移被拦截
- 不可变字段修改被拦截

---

## Phase 3：查询与追溯

### TASK-012：证据链追溯查询

**优先级**：P0 | **估时**：1天 | **依赖**：TASK-007

**范围**：
- Signal → Fragment 追溯：从 Signal 查看支撑它的 Fragment
- Fragment → Evidence 追溯：从 Fragment 查看原始 Evidence
- Signal → Evidence 全链路追溯：Signal → Fragment → Evidence
- 查看 Fragment 在 Evidence 中的位置

**对应需求**：12.8, 12.4, AC-009, AC-010

**文件**：`src/queries/trace.query.ts`

**验收**：
- [x] AC-009：可从 Signal 查看支撑它的 Fragment
- [x] AC-010：可从 Fragment 查看原始 Evidence

---

### TASK-013：Object → Signal 查询 & Timeline 投影

**优先级**：P1 | **估时**：1天 | **依赖**：TASK-006, TASK-007

**范围**：
- Object → Signal 列表查询：查看 Object 关联的所有 Signal
- Timeline 投影：围绕 Object 的 Signal 时间投影
- Timeline 只能由 Signal 查询生成，不能独立写入

**对应需求**：6.9, 12.11, AC-012, AC-014

**文件**：`src/queries/object-signals.query.ts`, `src/queries/timeline.query.ts`

**验收**：
- [x] AC-014：Timeline 只能由 Signal 生成，不能独立写入

---

## Phase 4：API 与 CLI

### TASK-014：REST API 层

**优先级**：P0 | **估时**：1.5天 | **依赖**：TASK-004 ~ TASK-012

**范围**：
- Evidence API：POST /evidence, GET /evidence/:id
- Fragment API：POST /fragments, GET /fragments/:id, GET /evidence/:id/fragments
- Signal API：POST /signals, GET /signals/:id, PATCH /signals/:id/state, GET /signals/:id/trace
- Object API：POST /objects, GET /objects/:id, GET /objects/:id/signals
- Relation API：POST /relations, GET /relations
- Query API：GET /trace/:signalId, GET /timeline/:objectId
- 统一错误响应格式

**文件**：`src/routes/*.ts`

**验收**：
- 所有核心用户动作（12 节）均可通过 API 完成
- 验收标准 AC-001 ~ AC-015 均可通过 API 测试

---

### TASK-015：CLI 交互层

**优先级**：P1 | **估时**：1天 | **依赖**：TASK-014

**范围**：
- 命令行工具支持核心用户动作
- 交互式创建 Evidence → Fragment → Signal → Object
- 查看证据链
- 标记 Signal 状态

**文件**：`src/cli/*.ts`

**验收**：
- 可通过 CLI 完成标准示例（文档 14 节）全流程

---

## Phase 5：集成测试与验收

### TASK-016：集成测试与 AC 验收

**优先级**：P0 | **估时**：1.5天 | **依赖**：所有任务

**范围**：
- 编写全部 15 条验收标准（AC-001 ~ AC-015）的自动化测试
- 标准示例端到端测试（文档 14 节）
- 协议违规场景测试（创建无 Fragment 的 Signal、修改不可变字段等）
- 状态流转测试
- 追溯链路完整性测试

**文件**：`src/tests/*.test.ts`

**验收**：
- [x] AC-001 ~ AC-015 全部通过
- 标准示例可端到端运行
- 所有禁止场景均被正确拦截

---

## 任务分布总表

| 任务ID | 名称 | Phase | 优先级 | 估时 | 依赖 |
|--------|------|-------|--------|------|------|
| TASK-001 | 类型系统与协议对象定义 | 0 | P0 | 1天 | - |
| TASK-002 | 存储层基础设施 | 0 | P0 | 1.5天 | 001 |
| TASK-003 | 错误体系与日志 | 0 | P0 | 0.5天 | - |
| TASK-004 | Evidence 服务 | 1 | P0 | 1天 | 001, 002 |
| TASK-005 | Fragment 服务 | 1 | P0 | 1天 | 004 |
| TASK-006 | Object 服务 | 1 | P0 | 1天 | 002 |
| TASK-007 | Signal 服务 | 1 | P0 | 1.5天 | 005, 006 |
| TASK-008 | Relation 服务 | 1 | P1 | 1天 | 006, 007 |
| TASK-009 | Schema 校验器 | 2 | P0 | 1天 | 001 |
| TASK-010 | Signal Body 内容校验器 | 2 | P0 | 1天 | 007 |
| TASK-011 | 状态机校验器 | 2 | P0 | 0.5天 | 004-007 |
| TASK-012 | 证据链追溯查询 | 3 | P0 | 1天 | 007 |
| TASK-013 | Object→Signal 查询 & Timeline | 3 | P1 | 1天 | 006, 007 |
| TASK-014 | REST API 层 | 4 | P0 | 1.5天 | 004-012 |
| TASK-015 | CLI 交互层 | 4 | P1 | 1天 | 014 |
| TASK-016 | 集成测试与 AC 验收 | 5 | P0 | 1.5天 | 全部 |

**总估时**：约 17.5 人天

---

## 依赖关系图

```
TASK-001 (类型定义)
  ├──→ TASK-002 (存储层)
  │      ├──→ TASK-004 (Evidence)
  │      │      ├──→ TASK-005 (Fragment)
  │      │      │      ├──→ TASK-007 (Signal)
  │      │      │      │      ├──→ TASK-008 (Relation)
  │      │      │      │      ├──→ TASK-010 (Body校验)
  │      │      │      │      ├──→ TASK-012 (追溯查询)
  │      │      │      │      └──→ TASK-013 (Timeline)
  │      │      │      └──→ TASK-011 (状态机)
  │      │      └──→ TASK-011 (状态机)
  │      └──→ TASK-006 (Object)
  │             ├──→ TASK-007 (Signal)
  │             ├──→ TASK-008 (Relation)
  │             └──→ TASK-013 (Timeline)
  ├──→ TASK-009 (Schema校验)
  └─── (独立) TASK-003 (错误体系)

TASK-004~013 ──→ TASK-014 (API) ──→ TASK-015 (CLI)
TASK-001~015 ──→ TASK-016 (集成测试)
```

---

## 开发里程碑

| 里程碑 | 包含任务 | 目标 | 预计 |
|--------|----------|------|------|
| M1：基础就绪 | TASK-001~003 | 类型、存储、错误体系 | 第 1-2 天 |
| M2：核心闭环 | TASK-004~007 | Evidence→Fragment→Signal→Object | 第 3-6 天 |
| M3：校验完备 | TASK-008~011 | Relation + 全部校验规则 | 第 7-9 天 |
| M4：查询可用 | TASK-012~013 | 追溯 + Timeline | 第 10-11 天 |
| M5：接口就绪 | TASK-014~015 | API + CLI | 第 12-14 天 |
| M6：验收通过 | TASK-016 | AC-001~015 全通过 | 第 15-17 天 |

---

## MVP 最小闭环验收清单

```
Evidence 创建 ✓ → Fragment 创建 ✓ → Signal 创建 ✓ → Object 锚定 ✓ → 追溯查询 ✓
```

- [ ] 有原文（Evidence content 保存）
- [ ] 有片段（Fragment 定位）
- [ ] 有观察（Signal body）
- [ ] 有对象（Object 锚定）
- [ ] 有状态（State 管理）
- [ ] 有追溯（Evidence ← Fragment ← Signal）
- [ ] 不覆盖（Immutable Reality）
- [ ] 不混入判断（Signal body 校验）
- [ ] 不依赖模型（Semantic Independent）
