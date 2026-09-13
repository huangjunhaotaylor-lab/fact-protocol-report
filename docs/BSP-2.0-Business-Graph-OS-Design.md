# Business Graph OS — BSP 前端重设计文档

> Version: 0.1（讨论稿）｜ 2026-09-13
> 定位：BSP Reality Layer 的下一代前端——Bloom 的探索体验 × Linkurious 的企业分析 × BSP 的 Signal/Evidence/Timeline 协议模型
> 前置资产：BSP 1.1 后端（30 端点 + JSON 持久化，全部保留不动）、旧六页前端（作为管理视图保留）

---

## 一、产品核心思想（一句话）

**业务现实的图操作系统：每份证据、每个观察、每个对象都是图上的一等节点；探索像 Bloom 一样直觉，研判像 Linkurious 一样严谨，真实性由 BSP 协议全程兜底。**

三个来源各取一脉，不是拼盘而是分层：

| 来源 | 吸收什么 | 在 BSP 里的落点 |
|---|---|---|
| **Neo4j Bloom** | 场景式探索（scene）：搜索起手、逐层展开、物理布局、右键菜单、绝不一次倒全图 | 「探索」是默认动作——从任何一个节点出发，展开它的世界 |
| **Linkurious Enterprise** | 研判工作区：过滤器面板、**时间直方图滑杆**、节点分组、动态尺寸、路径高亮、保存视图 | 「研判」是深度动作——在时间轴上重现业务现实的演化，沿证据链定位真相 |
| **BSP 协议** | Signal/Evidence/Timeline 模型本身 | 「真实」是地基——状态机、不可变、checksum、全程可追溯全部显性可视 |

### 设计哲学四条

1. **Graph is the OS，Page is the App**：一个画布即整个系统。旧六页（录入/证据库/看板/追溯/对象/总览）不再是六个页面，而是同一个图工作区的六种「视角模式」。
2. **两个方向的运动**：正向**构建**（Evidence→划片→Signal→锚定，线索从现实世界进入图）与逆向**追溯**（Object→Signal→Fragment→Evidence 原文定位，从图回到现实世界）。Bloom 服务前者，Linkurious 服务后者，BSP 模型是两者共同的事实层。
3. **渐进披露（Progressive Disclosure）**：永远从搜索开始，展开邻居、收起枝叶，画布只承载当下分析所需的子图——这是 Bloom 的灵魂，也是大图不糊的根本。
4. **协议即视觉**：状态机决定节点外观与可用操作；不可变对象带锁形标识与 checksum 校验态；Invalid 节点不删除、只灰化降透明——协议规则不需要读文档，看图就懂。

## 二、BSP → 图模型映射（投影层契约）

BSP 不是图数据库，是 REST/JSON 协议后端。新增**图投影层**（不改任何现有业务代码，纯增量查询模块）：

### 节点（5 类，对应协议对象）

| 节点 | 视觉 | 尺寸编码 | 关键属性 |
|---|---|---|---|
| Evidence | 土棕方块 🔒 | 按 Fragment 数 | source / state / checksum 校验态 / created_at |
| Fragment | 暖灰小圆 | 固定小 | type / offset / speaker / state |
| Signal | 陶土圆 | 按 confidence | type / state / captured_at / occurred_at / context |
| Object | 灰绿大圆 | 按连接度 | type / state / identity / aliases |
| Relation | （作为边，也可投影为浅棕菱形节点） | — | type / derived_from |

### 边（6 类，全部来自现有 API 可推导）

| 边 | 来源 | 语义 |
|---|---|---|
| Evidence —HAS_FRAGMENT→ Fragment | fragment.evidence_id | 结构 |
| Fragment —SUPPORTS→ Signal | signal.fragments[] | 支撑（追溯链核心） |
| Signal —ANCHORS→ Object | signal.anchors[] | 锚定 |
| Object —RELATION{type}→ Object | relation | 事实关系 |
| Relation —DERIVED_FROM→ Signal | relation.derived_from | 出处（协议特色：关系也有证据） |
| Object —MERGED_INTO→ Object | merge 操作 | 身份归一留痕 |
| Evidence —SAME_CHAIN→ Evidence | evidence.chain_id | 证据链 |

### 时间轴（Timeline 作为一等坐标）

`captured_at` / `occurred_at` / `created_at` 统一进时间直方图；Object 的 Timeline 投影成为「围绕单对象的时间重排布局」。

### 新增后端端点（投影层，G0 交付）

```
GET /api/graph?limit=              — 全图投影（节点+边，默认限量）
GET /api/graph/expand/:kind/:id    — 单节点一度邻居展开（Bloom expand）
GET /api/graph/search?q=&kind=     — 结构化搜索（类型+属性+全文）
GET /api/graph/stats               — 直方图数据（时间/类型/状态分桶）
```

## 三、界面架构：一个工作区 + 四种模式

```
┌────────────────────────────────────────────────────────────┐
│  🔍 搜索条（结构化短语）          模式：探索│研判│构建│时间  │
├──────────┬──────────────────────────────────┬──────────────┤
│ 过滤器    │                                  │ 检查器        │
│ 面板      │         图 画 布                  │ 面板          │
│ (类型/状态 │   （物理布局 + 相机 + 小地图）     │ (属性/操作/   │
│ /属性直方图│                                  │  追溯/原文)   │
├──────────┴──────────────────────────────────┴──────────────┤
│  ⏱ 时间直方图滑杆（Linkurious 签名交互，拖动过滤全图）        │
└────────────────────────────────────────────────────────────┘
```

### 模式 1：探索（默认，Bloom 层）
- **搜索起手**：支持近自然结构化短语——`Object 类型 Customer`、`Signal 状态 Captured`、`华南`（全文）。命中节点落入画布并自动展开一度。
- **双击展开**邻居（调 `/expand`）；**右键菜单**：展开 / 收起枝叶 / 隐藏 / 选定关联节点 / 追溯 / 状态操作。
- **框选**（marquee）批量隐藏或成组；**小地图**导航；物理布局可拖拽固定。

### 模式 2：研判（Linkurious 层）
- 左侧**过滤器面板**：按类型/状态/属性过滤，每属性带分布直方图。
- 底部**时间直方图滑杆**：拖动时间窗，全图节点边实时淡入淡出——"重现华南仓 8 月第 2 周的现实演化"。
- **节点分组**：按 Evidence 收拢其 Fragment、按 Object 收拢其 Signal（Linkurious grouping）；**动态尺寸**：连接度或 confidence 驱动。
- **追溯模式**：点击 Signal → 全图降噪，只高亮 Signal→Fragment→Evidence 路径，右侧检查器直接显示 Evidence 原文并**高亮片段定位**——旧追溯页的全部能力成为画布内行为。
- **保存场景**：当前画布（节点集+布局+过滤器）存为命名视图，可导出 JSON/图片。

### 模式 3：构建（BSP 原生，旧录入台进化）
- 新建 Evidence 落画布即成节点 → 右侧原文面板**划选文本** → 松手即生成 Fragment 节点并连线（旧录入台的划片交互移植进图）→ 勾选片段成 Signal → 拖一根线到 Object 完成锚定。
- 构建过程本身可视化：用户看着一条线索在自己手里"长成"图的一部分——这是产品最强的演示时刻。

### 模式 4：时间（Timeline 投影）
- 以时间为 X 轴重排全图（或单 Object 的 Signal 序列），节点按 captured_at 落位、连线保留——BSP 的 Timeline 投影从"列表"升级为"时间地图"。

### 检查器面板（右侧，全模式共享）
- 属性区（全字段）；**状态机操作区**（按当前状态动态可用的 verify/invalid/archive/merge，与协议一致）；**追溯区**（一键进追溯模式）；**原文区**（Evidence/Fragment 显示内容与 checksum 校验按钮）；**关联区**（邻居列表，点击入图）。

## 四、技术方案

| 层 | 决策 | 理由 |
|---|---|---|
| 图渲染 | **自研轻量 canvas 引擎**（速度verlet 力导向 + 四叉树命中检测 + 相机矩阵），~1000 行，零依赖 | 保持仓库零 CDN/离线可用纪律；500 节点内 60fps 无压力；交互完全可控 |
| 布局 | 力导向默认 + 时间轴布局 + 手动拖拽固定 | Bloom 式物理感 + Linkurious 式时间布局 |
| 后端 | 新增 `src/queries/graph.projection.ts` + `graph.routes.ts`，**不动**现有 services | 投影层纯增量，协议逻辑零风险 |
| 数据 | 前端场景状态（已展开节点集/隐藏集/过滤器/相机）内存管理 + localStorage 场景保存 | 场景是工作台状态，不是协议数据 |
| 旧六页 | 保留为「管理视图」入口（数据管理、批量操作），新工作区为默认首页 | 平滑过渡，已验证功能不丢 |

## 五、开发路径（五批次，批批可演示）

| 批次 | 内容 | 出口标准 |
|---|---|---|
| **G0 图投影层** | graph.projection + 4 端点 + 测试 | `/api/graph` 返回正确节点边；展开/搜索/统计语义正确 |
| **G1 图引擎内核** | canvas 力导向 + 相机 + 命中 + 拖拽 + 小地图 + BSP 五类节点视觉 | 500 节点 60fps；五类节点六色渲染；交互流畅 |
| **G2 探索模式** | 搜索条（结构化短语）、expand/收起、右键菜单、框选、检查器面板 | 从搜索到展开到详情的 Bloom 闭环 |
| **G3 研判模式** | 过滤器面板+属性直方图、时间直方图滑杆、分组、动态尺寸、追溯模式、场景保存 | Linkurious 核心三板斧齐备；追溯全链路高亮+原文定位 |
| **G4 构建+时间模式** | 图内录入（划片成 Fragment 上屏）、时间轴布局、演示数据、回归、README | 完整产品；npm test 全绿 |

**MVP 建议**：G0+G1+G2+G3 的追溯模式——这已经是"Bloom 探索 + Linkurious 时间轴 + BSP 追溯"的最小完整灵魂，G4 的图内构建可第二步。

## 六、战略延展（后续可选，本设计预留接口）

- **与 leadspace 融合**：Business Graph OS 可成为两套系统的统一外壳——BSP 提供图（现实层），leadspace 的 (b,d,u) 评估作为 Object/Signal 节点上的**意见叠加层**（节点光晕颜色=可用性，点击查看评估依据链）。届时这张图同时回答"发生了什么"与"此刻多可信"。
- **告警/Case**：Linkurious 的 alerts+case 模式可映射为 leadspace 的检验标签工作流（待归因检验=case）。

## 七、待你确认的决策点

1. **MVP 范围**：G0–G3追溯（推荐）还是直接 G0–G4 全量？
2. **自研 canvas 引擎**（零依赖、可控、工作量集中在 G1）vs 本地内嵌成熟库（如 vendor 一份 force-graph 单文件进仓库，仍无 CDN）——你更接受哪种？
3. **旧六页去留**：保留为管理视图（推荐）还是完全替换？
4. **视觉基底**：沿用暖色系，还是借这次重做调成更适合图分析的**深色画布**（节点在暗底上更聚焦，Bloom/Linkurious 均为深色或中性底）？
