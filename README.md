# 事实协议报告 (Fact Protocol Report)

本仓库用于存放事实协议报告相关代码与文档。

## 仓库信息

- **仓库地址**：https://github.com/huangjunhaotaylor-lab/fact-protocol-report
- **维护者**：HUANGJUNHAOTAYLOR-LAB

## 分支管理

本项目采用 Git Flow 简化版分支策略，详见 [BRANCHING.md](./BRANCHING.md)。

```
main          ← 稳定发布分支
 └── develop  ← 日常开发主干
      ├── feature/*   ← 新功能
      ├── fix/*       ← Bug 修复
      └── hotfix/*    ← 紧急修复
```

### 快速开始

```bash
# 克隆仓库
git clone https://github.com/huangjunhaotaylor-lab/fact-protocol-report.git
cd fact-protocol-report

# 切换到开发分支
git checkout develop

# 创建新功能分支
git checkout -b feature/your-feature
```

## 开发流程

1. 从 `develop` 拉取最新代码
2. 创建功能分支 `feature/xxx`
3. 开发并提交代码
4. 合并回 `develop`
5. 稳定后合并 `develop` → `main` 并打标签发布

## Web 界面

本仓库附带 BSP Reality Layer 的 Web 前端（`web/` 目录，零构建原生 ES Modules，无外部 CDN 依赖），由 Express 服务直接静态托管。

### Business Graph OS（默认入口）

`web/graph/` 是新一代图工作区，访问 `/static/graph/graph.html`（旧六页导航栏首位「◆ Graph OS」链接直达）：

- **三种模式一句话**：探索模式搜索命中节点、双击逐层展开业务图谱；研判模式用过滤器与时间直方图滑杆俯瞰全集、聚焦关键子图；追溯模式从任一 Signal 一键反查 Fragment → Evidence 原文定位，全程可视。
- 自研 Canvas 2D 图引擎（`engine.js`，零依赖）：velocity-verlet 力导向布局、网格桶斥力优化、相机缓动、小地图、框选/钉住/时间窗显隐过渡。
- 数据来自只读图投影层（`src/queries/graph.projection.ts` + `/api/graph*` 路由），不改动任何既有写路径。
- 旧六页（见下表）定位为**管理视图**：录入、校验、列表管理仍在旧页完成，graph.html 顶栏「管理视图 →」可反向跳转。

### 六个页面（管理视图）

| 页面 | 路径 | 说明 |
| --- | --- | --- |
| 总览 | `/static/index.html` | Reality Map：核心链路（Evidence → Fragment → Signal → Object → Relation → Timeline）实时状态与协议原则 |
| 录入台 | `/static/intake.html` | Evidence / Fragment / Signal 统一录入（Evidence 支持「从文件导入」.txt/.md/.json/.csv，纯前端读入原文框） |
| 证据库 | `/static/evidence.html` | Evidence 列表、原文查看与 Fragment 划取 |
| Signal 工作台 | `/static/signals.html` | Signal 校验（Verify）、标记 Invalid、归档 |
| 追溯 | `/static/trace.html` | Signal → Fragment → Evidence 全链路反查 |
| 对象全景 | `/static/objects.html` | Object 信号聚合、Timeline 与 Relation 视图 |

访问 `/` 会自动重定向到总览页。六个页面导航栏完全互通。

### 启动方式

```bash
npm install
npm run build
npm start
```

服务默认监听 **3000** 端口（见 `src/index.ts`，可用环境变量 `PORT` 覆盖），启动后打开 http://localhost:3000/ 即可。

开发模式可使用 `npm run dev`（tsx watch 热重载）。

### 演示数据

仓库提供演示种子脚本，通过 HTTP 调用本地 API 构造完整中文业务链路（会议纪要 / PRD / 邮件三类 Evidence，五种 Signal 类型与 Captured / Verified / Invalid 状态，四类 Object 与 Relation）：

```bash
# 确认服务已启动后运行
node scripts/seed-demo.mjs
```

- 目标地址可用环境变量覆盖：`BSP_API_BASE`（完整地址），或 `BSP_HOST` / `BSP_PORT`。
- **注意：脚本非幂等**，重复运行会产生重复数据；重跑前请停止服务并删除 `data/bsp-store.json`，再重启服务。

### 持久化

默认使用 JSON 文件持久化（`src/repositories/json-file-store.ts`）：

- 存储文件：`data/bsp-store.json`（随服务运行自动创建与保存）
- 可用环境变量 `BSP_STORE_PATH` 覆盖存储路径
- 测试环境（vitest / `NODE_ENV=test`）且未显式指定 `BSP_STORE_PATH` 时使用纯内存存储，不污染数据文件

### 测试

```bash
npm test   # vitest，38 个用例（含 JSON 持久化测试）
```
