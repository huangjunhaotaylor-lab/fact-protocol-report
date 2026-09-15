# feishu-bsp-bridge — 飞书任意信息 → BSP 独立插件

将**飞书上的任意信息**按 **BSP 1.1 协议** 写入 Reality Layer 的独立插件包。
BSP 协议是来源无关的：Evidence 的合法来源包括会议 / PRD / 邮件 / ERP / 飞书 / Jira / 表格 / Agent / AI / 人工（协议 6.1）。

```
飞书信息源（文档 / 群聊消息 / 妙记 / 任务 / 邮件 / 表格 / 审批）
   │  适配器归一化（SourceContent：纯文本 + bspSource 映射）
   ▼
Evidence  (content=原文, source_id=来源引用, checksum 由 BSP 计算, 不可变)
   │  按句切分，逐字来自原文（满足 BSP 的 includes 强校验）
   ▼
Fragment × N
   │  主体+事实 表述（AC-008 判断词校验由 BSP 服务端强制）
   ▼
Signal（锚定 Object）
   │  同 Evidence 共现 Object → references（AC-013 可追溯）
   ▼
Relation
```

## 支持的信息源

| type | 信息源 | EvidenceSource | 状态 |
|---|---|---|---|
| `doc` | 云文档 docx / wiki（URL 自动解包） | feishu | ✅ 实测 |
| `chat` | 群聊消息（IM，含发送者名/时间戳，卡片文本归一化） | feishu | ✅ 实测 |
| `minutes` | 妙记（会议纪要：摘要/待办/章节/关键词） | meeting | ✅ 实现 |
| `task` | 任务（Task） | feishu | ✅ 实现 |
| `mail` | 邮件（Mail） | email | ⚠️ 实验性 |
| `sheet` | 电子表格（Sheets） | spreadsheet | ⚠️ 实验性 |
| `bitable` | 多维表格（Bitable） | spreadsheet | ⚠️ 实验性 |
| `approval` | 审批（Approval） | other | ⚠️ 实验性 |

## 为什么是"独立插件"

- 不侵入 BSP 服务端代码：只通过 BSP 的 REST API 写入（`/api/evidences`、`/api/fragments`、`/api/signals`、`/api/objects`）
- 飞书侧通过官方 CLI `lark-cli` 子进程调用，复用其独立凭证库，无需自建 OAuth
- 协议约束（原文不可变、Fragment 必须来自原文、Signal 必须锚定 Object、判断词拒绝）全部由 BSP 服务端强制执行，插件只做"忠实搬运 + 合理切分"
- 可作为 npm 包独立发布，也可放在 `plugins/` 下随仓库分发

## 前置条件

```bash
# 1. lark-cli 可用且认证有效
lark-cli auth status        # 期望 user.tokenStatus = valid

# 2. BSP 服务已启动
cd .. && npm install && npm run build && npm start   # 默认 :3000
```

## 安装与运行

插件零运行时依赖，复用仓库根目录的 tsx / vitest：

```bash
cd plugins/feishu-bsp-bridge

# 环境变量（可选）
export LARK_CLI_BIN=$(which lark-cli)     # 默认取 PATH
export BSP_API_BASE=http://localhost:3000 # 默认值

# 检查连通性
npm run cli -- auth-check

# 列出全部信息源
npm run cli -- sources

# 搜索飞书文档
npm run cli -- search --query "会议" --limit 5

# 预览任意信息源内容（不写入）
npm run cli -- fetch chat --ref oc_xxx --limit 20

# 任意信息源 → BSP（示例：群聊消息）
npm run cli -- ingest-source chat --ref oc_xxx --object-name "华南仓项目群" \
  --signal-body "华南仓项目群确认 3 月 20 日完成首批发货。" --limit 100

# 云文档 → BSP
npm run cli -- ingest --doc <token或URL> --object-name "仓库盘点流程" \
  --signal-body "仓库目前使用 Excel 进行盘点。"

# 妙记 → BSP
npm run cli -- ingest-source minutes --ref ob_xxx --object-name "周会" \
  --signal-body "周会确认盘点模块二期范围覆盖华南仓全部库区。"

# 同一份证据追加第二个观察（多对象，为生成关系铺路）
npm run cli -- attach-signal --evidence <evidence_id> \
  --body "恒晟交付项目计划于 3 月 20 日完成首批发货。" \
  --object-name "恒晟交付项目" --signal-type event

# 批量导入（manifest 见 examples/manifest.demo.json；结尾自动 gen-relations，--no-relations 关闭）
npm run cli -- batch-ingest --manifest examples/manifest.demo.json --continue-on-error

# 自动生成 references 关系（同 Evidence 共现 Object）
npm run cli -- gen-relations

# 验证证据链
npm run cli -- trace --signal <signal_id>
```

## CLI 命令

| 命令 | 说明 |
|---|---|
| `auth-check` | 检查 lark-cli 认证 + BSP 服务状态 |
| `sources` | 列出全部信息源类型与映射 |
| `search --query X` | 搜索飞书文档（默认仅标题、仅我的） |
| `read --doc X` | 预览 docx 原文（wiki URL 自动解包） |
| `fetch <type> --ref X` | 预览任意信息源内容（doc/chat/minutes/task/mail/sheet/bitable/approval） |
| `ingest-source <type> --ref X` | 任意信息源 → Evidence → Fragment → Signal → Object |
| `ingest --doc X` | 云文档（doc 来源的便捷别名） |
| `attach-signal` | 在已有 Evidence 上追加 Signal（复用其 Fragment，支持多对象锚定） |
| `batch-ingest` | manifest 批量导入（可混用多种来源、失败即停或继续、结尾自动 `gen-relations`、输出分类分布报告） |
| `gen-relations` | 自动生成 references 关系（同 Evidence 共现 Object，幂等去重） |
| `trace --signal ID` | 查看 Signal → Fragment → Evidence 全链路 |
| `objects` | 列出 BSP 中所有 Object |

### ingest / ingest-source 通用参数

| 参数 | 默认 | 说明 |
|---|---|---|
| `--ref` | 必填（ingest-source） | 来源引用：chat_id / minute_token / guid / message_id / token |
| `--doc` | 必填（ingest） | 云文档 token 或 URL（wiki 自动解包） |
| `--object-id` | — | 锚定已有 Object |
| `--object-name` | 来源标题 | 按名称查找/创建 Object |
| `--anchors` | — | 直接指定多个锚定 Object ID（覆盖单一锚点） |
| `--signal-body` | 第一个 Fragment | Signal 事实观察；含判断词会被 BSP 拒绝（AC-008） |
| `--signal-type` | observation | observation / event / change / status / action |
| `--confidence` | 0.9 | 抽取置信度 |
| `--min-len` | 4 | Fragment 最短字符数 |
| `--limit` | — | 聊天消息条数上限（chat 来源） |
| `--dry-run` | false | 仅打印计划 |

### attach-signal 参数

| 参数 | 默认 | 说明 |
|---|---|---|
| `--evidence` | 必填 | 已有 Evidence ID（复用其全部 Fragment） |
| `--body` | 必填 | Signal 事实观察（AC-008 校验） |
| `--anchors` | — | 锚定 Object ID 列表（与 `--object-name` 二选一） |
| `--object-name` | — | 按名称查找/创建 Object 作为唯一锚点 |
| `--signal-type` / `--confidence` | observation / 0.9 | 同 ingest |

### batch-ingest 参数

| 参数 | 说明 |
|---|---|
| `--manifest` | 必填，JSON 文件：`{"continueOnError": true, "documents": [{doc 或 type+ref, objectName?, anchors?, signalBody?, signalType?, confidence?, limit?, domains?, primary_domain?}]}`（可混用多种来源，见 `examples/manifest.demo.json`） |
| `--continue-on-error` | 单条失败继续（默认失败即停；manifest 级 `continueOnError` 亦可） |
| `--no-relations` | 关闭结尾自动 `gen-relations`（默认实跑完成后自动执行；`--dry-run` 时始终不执行） |
| `--dry-run` | 全量预演，不写入 |

### manifest 条目：domains / primary_domain 板块覆盖

每条文档可附带板块覆盖字段，Signal 创建（服务端自动分类）后立即调
`POST /api/signals/:id/domains` 覆盖为指定板块 —— 该接口会置 `domain_manual`，
等价于人工纠正，不会被后续自动重分类改写：

```json
{
  "doc": "<token>",
  "objectName": "智慧仓储系统",
  "signalBody": "盘点模块二期范围覆盖华南仓全部库区。",
  "domains": ["仓储运营"],
  "primary_domain": "仓储运营"
}
```

- `domains`：非空字符串数组；`primary_domain` 必须是 `domains` 之一（缺省取 `domains[0]`）
- 覆盖失败时该条记为失败，错误信息会保留已创建的 Signal id，便于排查

### batch-ingest 报告：分类分布

批量完成后（非 dry-run）结果中附带 `domainReport` 段，统计本批创建信号的板块分布：

```json
{
  "manifest": "examples/manifest.demo.json",
  "total": 2, "succeeded": 2, "failed": 0,
  "items": [ ... ],
  "domainReport": {
    "total_signals": 2,
    "by_domain": { "仓储运营": 2, "项目推进": 1 },
    "primary_counts": { "仓储运营": 2 },
    "unclassified": [ { "signal": "SIG-xxx", "label": "chat:oc_yyy" } ]
  },
  "relations": { "proposed": [ ... ], "created": [ ... ] },
  "dryRun": false
}
```

- `by_domain`：domains 分布（一个信号可属多个板块，分别计数）
- `primary_counts`：主线板块（primary_domain）计数
- `unclassified`：未归口信号清单（signal id + 来源条目），可去板块管理页归口

## 库 API

```ts
import {
  ingestDocument, attachSignal, batchIngest, generateRelations, computeRelations,
  splitContent, searchDocs, checkAuth,
} from './src/index';

// 单篇录入
const result = await ingestDocument({
  doc: 'https://xxx.feishu.cn/wiki/XXX', // token 或 URL
  objectName: '仓库盘点流程',
  signalBody: '仓库目前使用 Excel 进行盘点。',
});
// result: { document, object, evidence, fragments, signal, skipped }

// 同证据追加观察（多对象）
await attachSignal({
  evidenceId: result.evidence.id,
  body: '恒晟交付项目计划于 3 月 20 日完成首批发货。',
  objectName: '恒晟交付项目',
  type: 'event',
});

// 关系自动生成（幂等）
const rel = await generateRelations({ dryRun: true }); // { proposed, created, skipped }
```

## 测试

```bash
npm test    # vitest：45 用例（切分 / ingest / attach-signal / batch / relations）
```

## 设计说明

- **来源无关管线**：`ingestContent(SourceContent)` 是唯一落库管线；各来源适配器（`sources.ts`）只负责把飞书信息归一化为"纯文本 content + bspSource + metadata"，与落库逻辑完全解耦
- **来源映射**：doc/chat/task → `feishu`；minutes → `meeting`；mail → `email`；sheet/bitable → `spreadsheet`；approval → `other`（对应 BSP EvidenceSource 枚举）
- **Fragment 切分**：先按换行、再按句读符号（。！？!?；;）切分，保留分隔符，保证每个 Fragment 都是原文连续子串 —— 这是 BSP「Fragment 必须来自原文」约束的充分条件
- **Signal body**：默认取第一个 Fragment 原文；若 BSP 因 AC-008（判断词）拒绝，错误会带出违规词，需人工改写为「主体+事实」表述后重试
- **多对象观察**：同一份原始证据（一个 Evidence）涉及多个对象时，用 `attach-signal` 复用其 Fragment 追加 Signal，每次锚定不同 Object —— 这是 `gen-relations` 能发现共现关系的必要前提
- **Relation 自动生成**：同一 Evidence 内共现的 Object 两两生成双向 `references`，`derived_from` 取真实 Signal（AC-013），与已有关系按 `source|target|type` 去重，可重复运行（幂等）；只表达"同一原始证据中出现过"，不表达业务判断
- **板块覆盖与分类分布**（G4）：manifest 条目可带 `domains` / `primary_domain`，在 Signal 创建后走 `POST /api/signals/:id/domains` 人工纠正通道（服务端置 `domain_manual`）；批量结束输出 `domainReport`（domains 分布 + 主线板块计数 + 未归口清单），dry-run 不产出
- **不可变性**：Evidence/Fragment 一旦写入不可改写（BSP 服务端强制），错误重录需新建，符合 Immutable Reality 原则
