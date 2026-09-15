/* ============================================================
   BSP Business Graph OS — G1 图引擎内核（GraphEngine）
   纯 Canvas 2D + 原生 ES Module · 零外部依赖 · 苹果风专业色系
   ------------------------------------------------------------
   分区：
     1. 设计令牌与常量
     2. 纯函数 GraphMath（时间解析/缓动/相机变换/斥力桶/力计算/verlet）
        —— 布局数学与 Canvas IO 完全分离，可独立单测
     3. GraphEngine — 构造与事件绑定
     4. 数据管理（setData / addData / removeNodes）
     5. 布局（velocity-verlet 力导向 · 网格桶斥力 · 唤醒/休眠）
     6. 相机（平移 / 锚点缩放 / 300ms 缓动动画 / 适配）
     7. 渲染（主循环 / 背景点阵 / 边 / 节点 / 标签 / 覆盖层）
     8. 交互（命中 / 拖拽 / 框选 / hover / 右键 / 双击 / 键盘）
     9. 小地图
    10. 时间窗与显隐过渡
    11. 公共 API（dim / highlight / selection / sizing / exportPNG / destroy）
   ============================================================ */

/* ------------------------------------------------------------
   1. 设计令牌与常量（色值与 web/styles.css 对齐）
   ------------------------------------------------------------ */

export const KIND_COLORS = {
  Evidence: '#64748b', // 石板蓝灰
  Fragment: '#9aa5b1', // 浅石灰
  Signal:   '#4a5568', // 石墨蓝灰（主角色）
  Object:   '#52796f', // 灰青
  Relation: '#718096', // 中灰
};

/** 板块（domain）配色：低饱和、互不混淆、与节点类型色区分 */
export const DOMAIN_COLORS = {
  仓储运营:   '#b7791f', // 暗琥珀
  销售与交付: '#2f855a', // 灰绿
  项目推进:   '#5a67a8', // 靛蓝灰
  采购供应:   '#97516b', // 暗玫瑰
  财务:       '#6b5b8e', // 灰紫
  人力:       '#4a7ba6', // 钢蓝
  系统与工具: '#718096', // 中灰
};

const C = {
  bg:          '#f5f5f7',
  grid:        '#e4e4e8',
  ink:         '#1d1d1f',
  edge:        '#d2d2d7',
  accent:      '#4a5568',
  lockBad:     '#c53030',
  lockOk:      'rgba(255,255,255,0.92)',
  stCaptured:  '#b7791f',
  stVerified:  '#2f855a',
  desat:       '#b9bfc7', // Invalid 去饱和填充
  minimapBg:   '#ffffff',
  minimapLine: '#d2d2d7',
  labelHalo:   'rgba(245,245,247,0.92)',
  marqueeFill: 'rgba(74,85,104,0.10)',
};

const LAYOUT = {
  repulsion:     5200,  // 库仑斥力常数
  repelMaxDist:  260,   // 斥力截断距离（桶边长 = 此值 → 3×3 桶覆盖全部相互作用）
  springK:       0.02,  // 边弹簧系数
  restLen:       95,    // 默认弹簧原长
  restLenFrag:   46,    // HAS_FRAGMENT 弹簧原长（碎片贴近证据）
  restLenChain:  140,   // SAME_CHAIN 弹簧原长
  gravityK:      0.004, // 弱向心力系数
  fragEvidenceK: 0.006, // Fragment 对其 Evidence 的额外弱引力（视觉聚簇）
  overlapK:      0.6,   // 防重叠约束强度
  overlapPad:    8,     // 防重叠间隙
  damping:       0.82,  // 速度阻尼
  alphaDecay:    0.986, // alpha 衰减
  alphaMin:      0.02,  // 休眠阈值
  maxSpeed:      24,    // 速度上限（防爆）
  forceCap:      40,    // 单对斥力上限
};

const CAM = { minZoom: 0.15, maxZoom: 4, animMs: 300, wheelRate: 0.0016 };
const MINIMAP = { w: 160, h: 100, margin: 12, pad: 16 };
const TIME_FADE_MS = 200;         // 时间窗/板块显隐过渡时长
const OUT_OF_WINDOW_ALPHA = 0.08; // 窗外/域外节点边透明度
const DIM_ALPHA = 0.12;           // dim 状态透明度
const ARCHIVED_ALPHA = 0.35;      // Archived 状态透明度
const LABEL_MIN_ZOOM = 0.7;       // 标签显示缩放阈值
const CLICK_SLOP = 4;             // 点击/拖拽判定阈值（px）

const FONT_STACK =
  '-apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", ' +
  '"Microsoft YaHei", "Segoe UI", sans-serif';
// 注：canvas 字体串不支持 font-variant-numeric，数字 tabular-nums 由上层 DOM 面板保证。

/* ------------------------------------------------------------
   2. 纯函数 GraphMath —— 布局数学与 Canvas IO 分离（可单测）
   ------------------------------------------------------------ */

export const GraphMath = {
  /** 时间解析：number 原样；ISO 字符串 Date.parse；空 → null */
  parseTime(v) {
    if (v == null) return null;
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : null;
  },

  easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
  },

  clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  },

  /**
   * 相机模型：cam = {x, y, z}，(x,y) 为视口中心对准的世界坐标，z 为缩放。
   * 屏幕 → 世界：wx = (sx - w/2)/z + cam.x
   */
  screenToWorld(cam, w, h, sx, sy) {
    return { x: (sx - w / 2) / cam.z + cam.x, y: (sy - h / 2) / cam.z + cam.y };
  },

  /** 世界 → 屏幕（screenToWorld 的逆变换）：sx = (wx - cam.x)*z + w/2 */
  worldToScreen(cam, w, h, wx, wy) {
    return { x: (wx - cam.x) * cam.z + w / 2, y: (wy - cam.y) * cam.z + h / 2 };
  },

  /** 网格桶键：|坐标| < 32768*cell 内唯一（本场景坐标 << 该上限） */
  _bucketKey(gx, gy) {
    return (gx + 32768) * 65536 + (gy + 32768);
  },

  /**
   * 库仑斥力 + 防重叠：网格桶优化，每桶仅检查 3×3 邻桶。
   * 桶边长 = repelMaxDist，故所有距离 < repelMaxDist 的节点对必落在邻桶内，
   * 距离 ≥ repelMaxDist 的节点对被显式截断，无遗漏、无越界。复杂度 O(n·k)。
   */
  _applyRepulsion(nodes, p) {
    const cell = p.repelMaxDist;
    const maxD2 = cell * cell;
    const buckets = new Map();
    for (const nd of nodes) {
      const key = GraphMath._bucketKey(Math.floor(nd.x / cell), Math.floor(nd.y / cell));
      let arr = buckets.get(key);
      if (!arr) { arr = []; buckets.set(key, arr); }
      arr.push(nd);
    }
    for (const a of nodes) {
      const acx = Math.floor(a.x / cell), acy = Math.floor(a.y / cell);
      let fx = 0, fy = 0;
      for (let gx = acx - 1; gx <= acx + 1; gx++) {
        for (let gy = acy - 1; gy <= acy + 1; gy++) {
          const bucket = buckets.get(GraphMath._bucketKey(gx, gy));
          if (!bucket) continue;
          for (const b of bucket) {
            if (b === a) continue;
            let dx = a.x - b.x, dy = a.y - b.y;
            let d2 = dx * dx + dy * dy;
            if (d2 > maxD2) continue;
            if (d2 < 0.01) { // 完全重叠：确定性微扰（基于 id 长度避免随机不可复现发散）
              dx = 0.3 + (a.id.length % 5) * 0.11;
              dy = 0.4 - (a.id.length % 3) * 0.17;
              d2 = dx * dx + dy * dy;
            }
            const d = Math.sqrt(d2);
            // 库仑斥力 F = k/d²，带上限
            let f = p.repulsion / d2;
            if (f > p.forceCap) f = p.forceCap;
            fx += (dx / d) * f;
            fy += (dy / d) * f;
            // 防重叠半径约束：d < r1+r2+pad 时强力推开
            const minD = a.r + b.r + p.overlapPad;
            if (d < minD) {
              const fo = p.overlapK * (minD - d);
              fx += (dx / d) * fo;
              fy += (dy / d) * fo;
            }
          }
        }
      }
      a.nfx += fx;
      a.nfy += fy;
    }
  },

  /**
   * 一帧力计算：清零 → 斥力/防重叠（桶）→ 边弹簧 → Fragment 额外引力 → 弱向心力。
   * 结果写入 node.nfx / node.nfy。纯函数，不触碰 canvas。
   */
  computeForces(nodes, edges, p) {
    if (!nodes.length) return;
    for (const nd of nodes) { nd.nfx = 0; nd.nfy = 0; }
    GraphMath._applyRepulsion(nodes, p);

    // 边弹簧：F = k·(d - rest)，d > rest 时相互拉近
    for (const e of edges) {
      const s = e.s, t = e.t;
      const dx = t.x - s.x, dy = t.y - s.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 0.01;
      const ux = dx / d, uy = dy / d;
      const rest = e.kind === 'HAS_FRAGMENT' ? p.restLenFrag
                 : e.kind === 'SAME_CHAIN'   ? p.restLenChain
                 : p.restLen;
      const f = p.springK * (d - rest);
      s.nfx += ux * f; s.nfy += uy * f;
      t.nfx -= ux * f; t.nfy -= uy * f;

      // Fragment 对其 Evidence 的额外弱引力（视觉聚簇）：
      // 在普通弹簧之外再向 Evidence 轻拉 Fragment；Evidence 只受 20% 反作用（更"重"）。
      if (e.kind === 'HAS_FRAGMENT') {
        const frag  = s.kind === 'Fragment' ? s : (t.kind === 'Fragment' ? t : null);
        if (frag) {
          const other = frag === s ? t : s;
          const dir = frag === s ? 1 : -1; // frag 指向 other 的方向
          const f2 = p.fragEvidenceK * (d - 26);
          frag.nfx  += ux * f2 * dir;
          frag.nfy  += uy * f2 * dir;
          other.nfx -= ux * f2 * dir * 0.2;
          other.nfy -= uy * f2 * dir * 0.2;
        }
      }
    }

    // 弱向心力：朝当前质心，防止整体漂移
    let cx = 0, cy = 0;
    for (const nd of nodes) { cx += nd.x; cy += nd.y; }
    cx /= nodes.length; cy /= nodes.length;
    for (const nd of nodes) {
      nd.nfx += (cx - nd.x) * p.gravityK;
      nd.nfy += (cy - nd.y) * p.gravityK;
    }
  },

  /** velocity-verlet 第 1 步：用上一帧力更新位置（dt = 1，力按 alpha 缩放） */
  verletPositions(nodes, alpha) {
    for (const n of nodes) {
      if (n.pinned) { n.vx = 0; n.vy = 0; continue; }
      n.x += n.vx + 0.5 * n.fx * alpha;
      n.y += n.vy + 0.5 * n.fy * alpha;
    }
  },

  /** velocity-verlet 第 3 步：用新旧力平均更新速度，阻尼 + 限速；新力转存为旧力 */
  verletVelocities(nodes, alpha, damping, maxSpeed) {
    for (const n of nodes) {
      if (!n.pinned) {
        let vx = (n.vx + 0.5 * (n.fx + n.nfx) * alpha) * damping;
        let vy = (n.vy + 0.5 * (n.fy + n.nfy) * alpha) * damping;
        const sp = Math.sqrt(vx * vx + vy * vy);
        if (sp > maxSpeed) { vx = (vx / sp) * maxSpeed; vy = (vy / sp) * maxSpeed; }
        n.vx = vx; n.vy = vy;
      }
      n.fx = n.nfx; n.fy = n.nfy;
    }
  },
};

/* ------------------------------------------------------------
   3. GraphEngine — 构造与事件绑定
   ------------------------------------------------------------ */

export class GraphEngine {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {Object} hooks { onNodeClick, onNodeDblClick, onNodeContext,
   *                         onSelectionChange, onBackgroundClick, onHover }
   */
  constructor(canvas, hooks = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.hooks = hooks || {};

    // 图数据（节点为输入对象的浅拷贝 + 布局字段）
    this.nodes = [];
    this.edges = [];
    this.nodeById = new Map();
    this.adj = new Map(); // id -> Array<{node, edge}>

    // 相机与动画
    this.cam = { x: 0, y: 0, z: 1 };
    this._camAnim = null;

    // 布局状态
    this.alpha = 0;      // >0 表示布局活跃；0 表示休眠
    this.sizing = 'fixed';

    // 视觉状态
    this.selection = new Set(); // 选中节点 id
    this.dimSet = null;         // Set<id> | null（集合外降噪）
    this.hlNodes = new Set();   // 高亮路径节点 id
    this.hlEdges = new Set();   // 高亮路径边 id
    this.timeWindow = null;     // [t0, t1] | null
    this.domain = null;         // 板块聚焦名 | null
    this.hoverNode = null;
    this._hoverNeighborSet = null; // Set<id>（含自身）
    this._hoverEdgeSet = null;     // Set<edge>

    // 交互状态
    this._drag = null;    // {node, offX, offY, moved, sx, sy}
    this._pan = null;     // {sx, sy, camX, camY, moved}
    this._marquee = null; // {x0, y0, x1, y1, additive}
    this._mmDrag = false;
    this._shiftDown = false;

    // 性能与尺寸
    this.fps = 0;
    this.w = 0; this.h = 0; this.dpr = 1;
    this._frameCount = 0;
    this._fpsTime = 0;
    this._lastFrame = 0;
    this._destroyed = false;

    this._listeners = [];
    this._bindEvents();
    this._resize();
    this._ro = new ResizeObserver(() => this._resize());
    this._ro.observe(canvas.parentElement || canvas);

    this._raf = requestAnimationFrame((t) => this._frame(t));
  }

  _on(el, ev, fn, opts) {
    el.addEventListener(ev, fn, opts);
    this._listeners.push([el, ev, fn, opts]);
  }

  _bindEvents() {
    const c = this.canvas;
    this._on(c, 'mousedown',   (e) => this._onMouseDown(e));
    this._on(window, 'mousemove', (e) => this._onMouseMove(e));
    this._on(window, 'mouseup',   (e) => this._onMouseUp(e));
    this._on(c, 'wheel',       (e) => this._onWheel(e), { passive: false });
    this._on(c, 'dblclick',    (e) => this._onDblClick(e));
    this._on(c, 'contextmenu', (e) => this._onContextMenu(e));
    this._on(c, 'mouseleave',  () => this._setHover(null));
    this._on(window, 'keydown', (e) => {
      if (e.key === 'Shift') this._shiftDown = true;
      if (e.key === 'Escape') this._onEscape();
    });
    this._on(window, 'keyup', (e) => { if (e.key === 'Shift') this._shiftDown = false; });
  }

  /* ------------------------------------------------------------
     4. 数据管理
     ------------------------------------------------------------ */

  /** 全量替换图数据 */
  setData(nodes = [], edges = []) {
    this.nodes = [];
    this.edges = [];
    this.nodeById.clear();
    this.adj.clear();
    this.selection.clear();
    this.hlNodes.clear();
    this.hlEdges.clear();
    this.dimSet = null;
    this._setHover(null);
    this.addData(nodes, edges);
  }

  /** 增量添加（已存在的 id 跳过；端点缺失的边跳过） */
  addData(nodes = [], edges = []) {
    for (const raw of nodes) {
      if (this.nodeById.has(raw.id)) continue;
      const i = this.nodes.length;
      const ang = i * 2.399963; // 黄金角螺旋散布，避免初值重叠
      const rad = 30 + 14 * Math.sqrt(i);
      const nd = Object.assign({}, raw, {
        x: Math.cos(ang) * rad + (Math.random() - 0.5) * 24,
        y: Math.sin(ang) * rad + (Math.random() - 0.5) * 24,
        vx: 0, vy: 0, fx: 0, fy: 0, nfx: 0, nfy: 0,
        pinned: false,
        degree: 0,
        r: 10,
        _time: GraphMath.parseTime(raw.captured_at ?? raw.occurred_at ?? raw.created_at),
        _tAlpha: 1,       // 时间窗当前透明度
        _tAlphaTarget: 1, // 时间窗目标透明度
        _dAlpha: 1,       // 板块当前透明度
        _dAlphaTarget: 1, // 板块目标透明度
      });
      this.nodes.push(nd);
      this.nodeById.set(nd.id, nd);
      this.adj.set(nd.id, []);
    }
    for (const raw of edges) {
      const s = this.nodeById.get(raw.source);
      const t = this.nodeById.get(raw.target);
      if (!s || !t) continue;
      const e = Object.assign({}, raw, { s, t });
      this.edges.push(e);
      this.adj.get(s.id).push({ node: t, edge: e });
      this.adj.get(t.id).push({ node: s, edge: e });
      s.degree++;
      t.degree++;
    }
    for (const nd of this.nodes) nd.r = this._radius(nd);
    if (this.timeWindow) this._applyTimeWindow();
    if (this.domain) this._applyDomain();
    this._wake(1);
  }

  /** 删除节点及其关联边 */
  removeNodes(ids = []) {
    const kill = new Set(ids);
    if (!kill.size) return;
    this.nodes = this.nodes.filter((n) => !kill.has(n.id));
    this.edges = this.edges.filter((e) => !kill.has(e.s.id) && !kill.has(e.t.id));
    this._rebuildIndex();
    for (const id of kill) {
      this.selection.delete(id);
      this.hlNodes.delete(id);
      if (this.dimSet) this.dimSet.delete(id);
    }
    this.hlEdges = new Set([...this.hlEdges].filter((eid) =>
      this.edges.some((e) => e.id === eid)));
    if (this.hoverNode && kill.has(this.hoverNode.id)) this._setHover(null);
    if (this.timeWindow) this._applyTimeWindow();
    if (this.domain) this._applyDomain();
    this._wake(0.6);
  }

  _rebuildIndex() {
    this.nodeById = new Map(this.nodes.map((n) => [n.id, n]));
    this.adj = new Map(this.nodes.map((n) => [n.id, []]));
    for (const n of this.nodes) n.degree = 0;
    for (const e of this.edges) {
      this.adj.get(e.s.id).push({ node: e.t, edge: e });
      this.adj.get(e.t.id).push({ node: e.s, edge: e });
      e.s.degree++;
      e.t.degree++;
    }
    for (const nd of this.nodes) nd.r = this._radius(nd);
  }

  _radius(nd) {
    switch (nd.kind) {
      case 'Evidence': return 13;
      case 'Fragment': return 6;
      case 'Signal':
        return this.sizing === 'confidence'
          ? 8 + 10 * (typeof nd.confidence === 'number' ? nd.confidence : 0.5)
          : 11;
      case 'Object':
        return this.sizing === 'degree' ? 12 + 3 * Math.sqrt(nd.degree || 0) : 14;
      case 'Relation': return 9;
      default: return 10;
    }
  }

  /* ------------------------------------------------------------
     5. 布局（velocity-verlet · alpha 衰减自动休眠 · 拖拽/加数据唤醒）
     ------------------------------------------------------------ */

  _wake(a = 1) {
    this.alpha = Math.max(this.alpha, a);
  }

  _layoutStep() {
    GraphMath.verletPositions(this.nodes, this.alpha);
    GraphMath.computeForces(this.nodes, this.edges, LAYOUT);
    GraphMath.verletVelocities(this.nodes, this.alpha, LAYOUT.damping, LAYOUT.maxSpeed);
    this.alpha *= LAYOUT.alphaDecay;
    if (this.alpha < LAYOUT.alphaMin) this.alpha = 0; // 休眠：之后每帧跳过力计算
  }

  /* ------------------------------------------------------------
     6. 相机（平移 / 光标锚点缩放 / 300ms 缓动 / 适配）
     ------------------------------------------------------------ */

  _animateCam(to) {
    this._camAnim = {
      from: { x: this.cam.x, y: this.cam.y, z: this.cam.z },
      to,
      t0: performance.now(),
      dur: CAM.animMs,
    };
  }

  _cancelCamAnim() {
    this._camAnim = null;
  }

  _stepCamAnim(t) {
    const a = this._camAnim;
    const p = Math.min(1, (t - a.t0) / a.dur);
    const e = GraphMath.easeOutCubic(p);
    this.cam.x = a.from.x + (a.to.x - a.from.x) * e;
    this.cam.y = a.from.y + (a.to.y - a.from.y) * e;
    this.cam.z = a.from.z + (a.to.z - a.from.z) * e;
    if (p >= 1) this._camAnim = null;
  }

  /** 聚焦节点（居中，缩放至少到 1.3） */
  focusNode(id, animated = true) {
    const nd = this.nodeById.get(id);
    if (!nd) return;
    const to = {
      x: nd.x,
      y: nd.y,
      z: GraphMath.clamp(Math.max(this.cam.z, 1.3), CAM.minZoom, CAM.maxZoom),
    };
    if (animated) this._animateCam(to);
    else { this._cancelCamAnim(); Object.assign(this.cam, to); }
  }

  /** 全图适配（留 80px 边距） */
  zoomToFit(animated = true) {
    if (!this.nodes.length) return;
    const bb = this._graphBBox();
    const zx = (this.w - 160) / Math.max(1, bb.w);
    const zy = (this.h - 160) / Math.max(1, bb.h);
    const to = {
      x: bb.cx,
      y: bb.cy,
      z: GraphMath.clamp(Math.min(zx, zy), CAM.minZoom, CAM.maxZoom),
    };
    if (animated) this._animateCam(to);
    else { this._cancelCamAnim(); Object.assign(this.cam, to); }
  }

  _graphBBox() {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const nd of this.nodes) {
      if (nd.x < minX) minX = nd.x;
      if (nd.y < minY) minY = nd.y;
      if (nd.x > maxX) maxX = nd.x;
      if (nd.y > maxY) maxY = nd.y;
    }
    if (!Number.isFinite(minX)) { minX = minY = -100; maxX = maxY = 100; }
    const pad = 40;
    return {
      cx: (minX + maxX) / 2,
      cy: (minY + maxY) / 2,
      w: maxX - minX + pad * 2,
      h: maxY - minY + pad * 2,
    };
  }

  /* ------------------------------------------------------------
     7. 渲染（主循环 / 背景点阵 / 边 / 节点 / 标签 / 覆盖层）
     ------------------------------------------------------------ */

  _frame(t) {
    if (this._destroyed) return;
    const dt = Math.min(64, t - (this._lastFrame || t));
    this._lastFrame = t;

    // FPS 统计（500ms 窗口）
    this._frameCount++;
    if (t - this._fpsTime >= 500) {
      this.fps = Math.round((this._frameCount * 1000) / (t - this._fpsTime));
      this._frameCount = 0;
      this._fpsTime = t;
    }

    if (this._camAnim) this._stepCamAnim(t);
    if (this.alpha > 0) this._layoutStep(); // 休眠时跳过力计算
    this._stepDimAlpha(dt);                 // 时间窗/板块透明度插值
    this._render(this.ctx, {});             // 每帧重绘

    this._raf = requestAnimationFrame((tt) => this._frame(tt));
  }

  _render(ctx, opts) {
    const { w, h, dpr, cam } = this;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // 画布底
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, w, h);

    // 世界变换
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.scale(cam.z, cam.z);
    ctx.translate(-cam.x, -cam.y);

    this._drawGrid(ctx, w, h);
    this._drawEdges(ctx);
    this._drawNodes(ctx);
    this._drawLabels(ctx);

    ctx.restore();

    // 屏幕空间覆盖层
    if (!opts.skipOverlays) this._drawMarquee(ctx);
    if (!opts.skipMinimap) this._drawMinimap(ctx);
  }

  /** 点阵网格：间距 28px 世界单位、1px 级点；缩小时自适应加倍间距，过低缩放淡出 */
  _drawGrid(ctx, w, h) {
    const z = this.cam.z;
    if (z < 0.35) return;
    let spacing = 28;
    while (spacing * z < 16) spacing *= 2;
    const tl = GraphMath.screenToWorld(this.cam, w, h, 0, 0);
    const br = GraphMath.screenToWorld(this.cam, w, h, w, h);
    ctx.fillStyle = C.grid;
    ctx.globalAlpha = Math.min(1, (z - 0.35) / 0.25);
    const r = 0.75 / z; // ≈1.5 屏幕 px 的点
    for (let x = Math.floor(tl.x / spacing) * spacing; x <= br.x; x += spacing) {
      for (let y = Math.floor(tl.y / spacing) * spacing; y <= br.y; y += spacing) {
        ctx.fillRect(x - r, y - r, r * 2, r * 2);
      }
    }
    ctx.globalAlpha = 1;
  }

  _edgeDash(kind, z) {
    switch (kind) {
      case 'DERIVED_FROM':
      case 'SAME_CHAIN':   return [5 / z, 4 / z];   // 虚线
      case 'MERGED_INTO':  return [1.6 / z, 3.4 / z]; // 点线
      default:             return [];                // 实线（SUPPORTS/ANCHORS/HAS_FRAGMENT/RELATION）
    }
  }

  /** 边透明度 = 两端点时间窗与板块透明度的最严者，再叠加 dim 通道 */
  _edgeAlpha(e) {
    let a = Math.min(e.s._tAlpha, e.t._tAlpha, e.s._dAlpha, e.t._dAlpha);
    if (this.dimSet && !(this.dimSet.has(e.s.id) && this.dimSet.has(e.t.id))) {
      a *= DIM_ALPHA;
    }
    return a;
  }

  _drawEdges(ctx) {
    const z = this.cam.z;
    const hoverActive = !!(this.hoverNode && this._hoverEdgeSet);

    // 第一遍：普通边
    for (const e of this.edges) {
      const isHl = this.hlEdges.has(e.id) || (hoverActive && this._hoverEdgeSet.has(e));
      if (isHl) continue;
      let a = this._edgeAlpha(e);
      if (hoverActive) a *= 0.35; // hover 时非相邻边退后
      if (a <= 0.004) continue;
      ctx.globalAlpha = Math.min(1, a);
      ctx.strokeStyle = C.edge;
      ctx.lineWidth = 1.2 / z;
      ctx.setLineDash(this._edgeDash(e.kind, z));
      ctx.beginPath();
      ctx.moveTo(e.s.x, e.s.y);
      ctx.lineTo(e.t.x, e.t.y);
      ctx.stroke();
    }

    // 第二遍：高亮边（hover 相邻 / 高亮路径），压在上层
    for (const e of this.edges) {
      const isHl = this.hlEdges.has(e.id) || (hoverActive && this._hoverEdgeSet.has(e));
      if (!isHl) continue;
      const a = Math.min(e.s._tAlpha, e.t._tAlpha, e.s._dAlpha, e.t._dAlpha);
      if (a <= 0.004) continue;
      ctx.globalAlpha = Math.min(1, a);
      ctx.strokeStyle = C.accent;
      ctx.lineWidth = 2.5 / z;
      ctx.setLineDash(this._edgeDash(e.kind, z));
      ctx.beginPath();
      ctx.moveTo(e.s.x, e.s.y);
      ctx.lineTo(e.t.x, e.t.y);
      ctx.stroke();
    }

    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }

  /** 节点透明度 = 时间窗 ∩ 板块（取最严者），再叠 dim / Archived / hover 通道 */
  _nodeAlpha(nd) {
    let a = Math.min(nd._tAlpha, nd._dAlpha);
    if (this.dimSet && !this.dimSet.has(nd.id)) a *= DIM_ALPHA;
    if (nd.state === 'Archived') a *= ARCHIVED_ALPHA;
    if (this.hoverNode && this._hoverNeighborSet && !this._hoverNeighborSet.has(nd.id)) a *= 0.55;
    return a;
  }

  _roundRectPath(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /** Evidence 左上角小锁：checksum_ok === false 时红色 */
  _drawLock(ctx, x, y, z, bad) {
    const s = 7 / z; // 恒定屏幕尺寸
    const lx = x - s / 2, ly = y - s / 2;
    ctx.strokeStyle = bad ? C.lockBad : C.lockOk;
    ctx.fillStyle = bad ? C.lockBad : C.lockOk;
    ctx.lineWidth = 1.2 / z;
    // 锁梁
    ctx.beginPath();
    ctx.arc(lx + s * 0.5, ly + s * 0.42, s * 0.26, Math.PI, 0);
    ctx.stroke();
    // 锁体
    ctx.fillRect(lx + s * 0.14, ly + s * 0.42, s * 0.72, s * 0.5);
  }

  _drawNodes(ctx) {
    const z = this.cam.z;
    for (const nd of this.nodes) {
      const a = this._nodeAlpha(nd);
      if (a <= 0.004) continue;
      const { x, y, r } = nd;
      const selected = this.selection.has(nd.id);
      const invalid = nd.state === 'Invalid';
      const fill = invalid ? C.desat : (KIND_COLORS[nd.kind] || '#718096');
      // Signal 板块外环（primary_domain 着色）；无主线板块不画
      const domColor = nd.kind === 'Signal' && !invalid && nd.primary_domain
        ? (DOMAIN_COLORS[nd.primary_domain] || null)
        : null;

      ctx.globalAlpha = Math.min(1, a);

      // 选中光晕（8% 透明度，先画垫在节点下）
      if (selected) {
        ctx.globalAlpha = Math.min(1, a) * 0.08;
        ctx.fillStyle = C.accent;
        ctx.beginPath();
        ctx.arc(x, y, r + 9 / z, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = Math.min(1, a);
      }

      // 节点形状
      ctx.fillStyle = fill;
      switch (nd.kind) {
        case 'Evidence': {
          this._roundRectPath(ctx, x - r, y - r, r * 2, r * 2, 4 / z);
          ctx.fill();
          this._drawLock(ctx, x - r + 4.5 / z, y - r + 4.5 / z, z, nd.checksum_ok === false);
          break;
        }
        case 'Relation': { // 菱形
          ctx.beginPath();
          ctx.moveTo(x, y - r);
          ctx.lineTo(x + r, y);
          ctx.lineTo(x, y + r);
          ctx.lineTo(x - r, y);
          ctx.closePath();
          ctx.fill();
          break;
        }
        default: { // Fragment / Signal / Object：圆
          ctx.beginPath();
          ctx.arc(x, y, r, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // Signal 状态色环：Captured 暖黄 / Verified 灰绿（内环，r+2，宽 2.5）
      if (nd.kind === 'Signal' && !invalid &&
          (nd.state === 'Captured' || nd.state === 'Verified')) {
        ctx.strokeStyle = nd.state === 'Captured' ? C.stCaptured : C.stVerified;
        ctx.lineWidth = 2.5 / z;
        ctx.beginPath();
        ctx.arc(x, y, r + 2 / z, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Signal 板块外环：与内环间隔 1.5px，环宽 2px
      // （内环外沿 r+3.25 → 间隙 1.5 → 外环内沿 r+4.75，中心 r+5.75）
      if (domColor) {
        ctx.strokeStyle = domColor;
        ctx.lineWidth = 2 / z;
        ctx.beginPath();
        ctx.arc(x, y, r + 5.75 / z, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Invalid 斜杠
      if (invalid) {
        ctx.strokeStyle = C.accent;
        ctx.lineWidth = 2 / z;
        ctx.beginPath();
        ctx.moveTo(x - r * 0.65, y + r * 0.65);
        ctx.lineTo(x + r * 0.65, y - r * 0.65);
        ctx.stroke();
      }

      // 选中环：#4a5568 2px 外环（有板块外环时再外移，避免叠环）
      if (selected) {
        ctx.strokeStyle = C.accent;
        ctx.lineWidth = 2 / z;
        ctx.beginPath();
        ctx.arc(x, y, r + (domColor ? 9 : 4) / z, 0, Math.PI * 2);
        ctx.stroke();
      } else if (nd === this.hoverNode) {
        ctx.strokeStyle = C.accent;
        ctx.lineWidth = 1.5 / z;
        ctx.beginPath();
        ctx.arc(x, y, r + (domColor ? 8.5 : 3) / z, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }

  /** 标签：缩放 > 0.7 显示；选中节点恒显；白色描边保可读 */
  _drawLabels(ctx) {
    const z = this.cam.z;
    const showAll = z > LABEL_MIN_ZOOM;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.font = `${11 / z}px ${FONT_STACK}`;
    ctx.lineJoin = 'round';
    for (const nd of this.nodes) {
      const selected = this.selection.has(nd.id);
      if (!showAll && !selected) continue;
      const a = this._nodeAlpha(nd);
      if (a <= 0.02) continue;
      let label = nd.label || nd.id;
      if (label.length > 24) label = label.slice(0, 23) + '…';
      const ty = nd.y + nd.r + 5 / z;
      ctx.globalAlpha = Math.min(1, a);
      ctx.lineWidth = 3.5 / z;
      ctx.strokeStyle = C.labelHalo;
      ctx.strokeText(label, nd.x, ty);
      ctx.fillStyle = C.ink;
      ctx.fillText(label, nd.x, ty);
    }
    ctx.globalAlpha = 1;
  }

  /** 框选选框：半透明石墨 */
  _drawMarquee(ctx) {
    const m = this._marquee;
    if (!m) return;
    const x = Math.min(m.x0, m.x1), y = Math.min(m.y0, m.y1);
    const w = Math.abs(m.x1 - m.x0), h = Math.abs(m.y1 - m.y0);
    ctx.fillStyle = C.marqueeFill;
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = C.accent;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(x + 0.5, y + 0.5, w, h);
    ctx.setLineDash([]);
  }

  /* ------------------------------------------------------------
     8. 交互（命中 / 拖拽 / 框选 / hover / 右键 / 双击 / 键盘）
     ------------------------------------------------------------ */

  _pos(e) {
    const rect = this.canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  _hitNode(pos) {
    const wpt = GraphMath.screenToWorld(this.cam, this.w, this.h, pos.x, pos.y);
    const pad = 3 / this.cam.z;
    for (let i = this.nodes.length - 1; i >= 0; i--) {
      const nd = this.nodes[i];
      const dx = wpt.x - nd.x, dy = wpt.y - nd.y;
      const rr = nd.r + pad;
      if (dx * dx + dy * dy <= rr * rr) return nd;
    }
    return null;
  }

  _onMouseDown(e) {
    if (e.button === 2) return; // 右键交给 contextmenu
    const pos = this._pos(e);

    // 小地图：点击移动视口 / 拖动连续跟随
    if (this._mmHit(pos)) {
      this._mmDrag = true;
      this._mmMove(pos, true); // 点击 = 300ms 动画
      return;
    }

    this._cancelCamAnim();
    const nd = this._hitNode(pos);

    if (nd && !e.shiftKey) {
      // 节点拖拽：拖后钉住（pinned），右键菜单可"释放"
      const wpt = GraphMath.screenToWorld(this.cam, this.w, this.h, pos.x, pos.y);
      this._drag = {
        node: nd,
        offX: nd.x - wpt.x,
        offY: nd.y - wpt.y,
        sx: pos.x, sy: pos.y,
        moved: false,
      };
      nd.pinned = true;
      this._wake(0.5);
    } else if (e.shiftKey) {
      // Shift+拖拽：框选 marquee
      this._marquee = { x0: pos.x, y0: pos.y, x1: pos.x, y1: pos.y, additive: e.metaKey || e.ctrlKey };
    } else {
      // 空白拖拽：平移
      this._pan = { sx: pos.x, sy: pos.y, camX: this.cam.x, camY: this.cam.y, moved: false };
    }
    this._updateCursor();
  }

  _onMouseMove(e) {
    const pos = this._pos(e);

    if (this._mmDrag) { this._mmMove(pos, false); return; }

    if (this._drag) {
      const d = this._drag;
      if (!d.moved && Math.hypot(pos.x - d.sx, pos.y - d.sy) > CLICK_SLOP) d.moved = true;
      const wpt = GraphMath.screenToWorld(this.cam, this.w, this.h, pos.x, pos.y);
      d.node.x = wpt.x + d.offX;
      d.node.y = wpt.y + d.offY;
      d.node.vx = 0; d.node.vy = 0;
      this._wake(0.35);
      return;
    }

    if (this._pan) {
      const p = this._pan;
      if (!p.moved && Math.hypot(pos.x - p.sx, pos.y - p.sy) > CLICK_SLOP) p.moved = true;
      this.cam.x = p.camX - (pos.x - p.sx) / this.cam.z;
      this.cam.y = p.camY - (pos.y - p.sy) / this.cam.z;
      this._updateCursor();
      return;
    }

    if (this._marquee) {
      this._marquee.x1 = pos.x;
      this._marquee.y1 = pos.y;
      return;
    }

    // hover：高亮相邻节点边 + onHover
    const nd = this._hitNode(pos);
    this._setHover(nd, pos);
    this._updateCursor();
  }

  _onMouseUp(e) {
    if (this._mmDrag) { this._mmDrag = false; return; }

    if (this._drag) {
      const d = this._drag;
      this._drag = null;
      if (!d.moved) this._clickNode(d.node, e); // 未移动 = 点击
      // 拖过的节点保持 pinned（拖后钉住）
      this._updateCursor();
      return;
    }

    if (this._pan) {
      if (!this._pan.moved) {
        // 背景点击：清选择
        if (this.selection.size) {
          this.selection.clear();
          this.hooks.onSelectionChange?.([]);
        }
        this.hooks.onBackgroundClick?.();
      }
      this._pan = null;
      this._updateCursor();
      return;
    }

    if (this._marquee) {
      const m = this._marquee;
      this._marquee = null;
      // 框选坐标换算：屏幕矩形两角 → 世界矩形
      const wa = GraphMath.screenToWorld(this.cam, this.w, this.h, Math.min(m.x0, m.x1), Math.min(m.y0, m.y1));
      const wb = GraphMath.screenToWorld(this.cam, this.w, this.h, Math.max(m.x0, m.x1), Math.max(m.y0, m.y1));
      const hit = [];
      for (const nd of this.nodes) {
        if (nd.x >= wa.x && nd.x <= wb.x && nd.y >= wa.y && nd.y <= wb.y) hit.push(nd);
      }
      if (!m.additive) this.selection.clear();
      for (const nd of hit) this.selection.add(nd.id);
      this.hooks.onSelectionChange?.(this.getSelection());
    }
  }

  _clickNode(nd, e) {
    if (e.metaKey || e.ctrlKey) {
      if (this.selection.has(nd.id)) this.selection.delete(nd.id);
      else this.selection.add(nd.id);
    } else {
      this.selection.clear();
      this.selection.add(nd.id);
    }
    this.hooks.onNodeClick?.(nd);
    this.hooks.onSelectionChange?.(this.getSelection());
  }

  _onDblClick(e) {
    const nd = this._hitNode(this._pos(e));
    if (nd) this.hooks.onNodeDblClick?.(nd);
  }

  _onContextMenu(e) {
    e.preventDefault();
    const pos = this._pos(e);
    const nd = this._hitNode(pos);
    if (nd) {
      // 右键即选中（替换选择），再把屏幕坐标抛给上层画菜单
      this.selection.clear();
      this.selection.add(nd.id);
      this.hooks.onSelectionChange?.(this.getSelection());
      this.hooks.onNodeContext?.(nd, pos.x, pos.y);
    }
  }

  _onWheel(e) {
    e.preventDefault();
    this._cancelCamAnim();
    const pos = this._pos(e);
    const z0 = this.cam.z;
    const z1 = GraphMath.clamp(z0 * Math.exp(-e.deltaY * CAM.wheelRate), CAM.minZoom, CAM.maxZoom);
    if (z1 === z0) return;
    // 光标锚点缩放：缩放前后光标下的世界点不动
    // 缩放前：wx = (sx - w/2)/z0 + x0 → 求 wx；缩放后保持 sx 不变：x1 = wx - (sx - w/2)/z1
    const wx = (pos.x - this.w / 2) / z0 + this.cam.x;
    const wy = (pos.y - this.h / 2) / z0 + this.cam.y;
    this.cam.x = wx - (pos.x - this.w / 2) / z1;
    this.cam.y = wy - (pos.y - this.h / 2) / z1;
    this.cam.z = z1;
  }

  _onEscape() {
    this._marquee = null;
    const had = this.selection.size || this.hlNodes.size || this.hlEdges.size || this.dimSet;
    this.selection.clear();
    this.clearHighlight();
    this.dimSet = null;
    if (had) this.hooks.onSelectionChange?.([]);
  }

  _setHover(nd, pos) {
    if (nd === this.hoverNode) {
      if (nd && pos) this.hooks.onHover?.(nd, pos.x, pos.y);
      return;
    }
    this.hoverNode = nd;
    if (nd) {
      const nset = new Set([nd.id]);
      const eset = new Set();
      for (const { node, edge } of this.adj.get(nd.id) || []) {
        nset.add(node.id);
        eset.add(edge);
      }
      this._hoverNeighborSet = nset;
      this._hoverEdgeSet = eset;
      if (pos) this.hooks.onHover?.(nd, pos.x, pos.y);
    } else {
      this._hoverNeighborSet = null;
      this._hoverEdgeSet = null;
      if (this.canvas.style) this.canvas.style.cursor = 'default';
      this.hooks.onHover?.(null, 0, 0);
    }
  }

  _updateCursor() {
    let cur = 'default';
    if (this._pan && this._pan.moved) cur = 'grabbing';
    else if (this._shiftDown && !this._drag) cur = 'crosshair';
    else if (this._drag || this.hoverNode) cur = this._drag ? 'grabbing' : 'pointer';
    else if (this._pan) cur = 'grab';
    this.canvas.style.cursor = cur;
  }

  /* ------------------------------------------------------------
     9. 小地图（右下角 160×100 · 全图缩略 + 视口框 · 点击移动视口）
     ------------------------------------------------------------ */

  _mmHit(pos) {
    const m = this._mm;
    return !!m && pos.x >= m.x && pos.x <= m.x + m.w && pos.y >= m.y && pos.y <= m.y + m.h;
  }

  _mmMove(pos, animate) {
    if (!this._mmToWorld) return;
    const wpt = this._mmToWorld(pos.x, pos.y);
    if (animate) this._animateCam({ x: wpt.x, y: wpt.y, z: this.cam.z });
    else { this._cancelCamAnim(); this.cam.x = wpt.x; this.cam.y = wpt.y; }
  }

  _drawMinimap(ctx) {
    const { w, h } = this;
    const mw = MINIMAP.w, mh = MINIMAP.h;
    const mx = w - mw - MINIMAP.margin, my = h - mh - MINIMAP.margin;
    this._mm = { x: mx, y: my, w: mw, h: mh };

    // 卡片底
    this._roundRectPath(ctx, mx, my, mw, mh, 8);
    ctx.fillStyle = C.minimapBg;
    ctx.fill();
    ctx.strokeStyle = C.minimapLine;
    ctx.lineWidth = 1;
    ctx.stroke();

    if (!this.nodes.length) { this._mmToWorld = null; return; }

    const bb = this._graphBBox();
    const scale = Math.min((mw - MINIMAP.pad) / Math.max(1, bb.w),
                           (mh - MINIMAP.pad) / Math.max(1, bb.h));
    const toX = (wx) => mx + mw / 2 + (wx - bb.cx) * scale;
    const toY = (wy) => my + mh / 2 + (wy - bb.cy) * scale;
    this._mmToWorld = (px, py) => ({
      x: bb.cx + (px - mx - mw / 2) / scale,
      y: bb.cy + (py - my - mh / 2) / scale,
    });

    ctx.save();
    this._roundRectPath(ctx, mx, my, mw, mh, 8);
    ctx.clip();

    // 全图缩略（按类型着色的小点，透明度跟随时间窗与板块聚焦）
    for (const nd of this.nodes) {
      ctx.globalAlpha = 0.75 * Math.min(1, Math.min(nd._tAlpha, nd._dAlpha) + 0.15);
      ctx.fillStyle = KIND_COLORS[nd.kind] || '#718096';
      ctx.fillRect(toX(nd.x) - 1.1, toY(nd.y) - 1.1, 2.2, 2.2);
    }

    // 视口框
    const tl = GraphMath.screenToWorld(this.cam, w, h, 0, 0);
    const br = GraphMath.screenToWorld(this.cam, w, h, w, h);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = C.accent;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(toX(tl.x), toY(tl.y), (br.x - tl.x) * scale, (br.y - tl.y) * scale);

    ctx.restore();
  }

  /* ------------------------------------------------------------
     10. 时间窗 / 板块聚焦与显隐过渡
     ------------------------------------------------------------ */

  /**
   * 设定时间窗；窗外节点边降至 8% 透明度（200ms 平滑过渡）。
   * 时间取 captured_at ?? occurred_at ?? created_at；
   * 无时间字段的节点（Fragment/Relation）跟随其关联节点显隐（取邻居最大值）。
   * @param {[number, number] | null} range
   */
  setTimeWindow(range) {
    this.timeWindow = range ? [Number(range[0]), Number(range[1])] : null;
    this._applyTimeWindow();
  }

  _applyTimeWindow() {
    const tw = this.timeWindow;
    for (const nd of this.nodes) {
      if (!tw) { nd._tAlphaTarget = 1; continue; }
      if (nd._time != null) {
        nd._tAlphaTarget = nd._time >= tw[0] && nd._time <= tw[1] ? 1 : OUT_OF_WINDOW_ALPHA;
      } else {
        nd._tAlphaTarget = -1; // 待关联推导
      }
    }
    if (tw) {
      // 两遍传播：覆盖 无时间 → 有时间 → 无时间 的短链（如 Relation→Signal）
      for (let pass = 0; pass < 2; pass++) {
        for (const nd of this.nodes) {
          if (nd._tAlphaTarget !== -1) continue;
          let best = -1;
          for (const { node } of this.adj.get(nd.id) || []) {
            if (node._tAlphaTarget >= 0) best = Math.max(best, node._tAlphaTarget);
          }
          if (best >= 0) nd._tAlphaTarget = best;
        }
      }
      for (const nd of this.nodes) if (nd._tAlphaTarget === -1) nd._tAlphaTarget = 1;
    }
  }

  /**
   * 板块聚焦：域外节点边降至 8% 透明度（200ms 平滑过渡），相机不动。
   * 归属判定：
   *  - Signal/Object：自身 domains 含该板块；
   *  - Fragment/Evidence（无板块字段）：沿 edges 一至二跳内任一 Signal 属该板块则保留；
   *  - Relation：两端（全部相邻节点）都显形才显形，无相邻边时保留。
   * 与时间窗为独立通道，最终透明度在 _nodeAlpha/_edgeAlpha 取最严者合成。
   * @param {string | null} domain 板块名；null/空串取消聚焦
   */
  setDomain(domain) {
    this.domain = domain || null;
    this._applyDomain();
  }

  _applyDomain() {
    const d = this.domain;
    if (!d) {
      for (const nd of this.nodes) nd._dAlphaTarget = 1;
      return;
    }
    // 第一遍：Signal/Object 按自身 domains 判定
    for (const nd of this.nodes) {
      if (nd.kind === 'Signal' || nd.kind === 'Object') {
        nd._dAlphaTarget = (Array.isArray(nd.domains) && nd.domains.includes(d))
          ? 1 : OUT_OF_WINDOW_ALPHA;
      } else if (nd.kind !== 'Relation') {
        nd._dAlphaTarget = -1; // Fragment/Evidence：待跟随关联 Signal
      }
    }
    // 第二遍：Fragment/Evidence —— 一至二跳内任一域内 Signal 则保留
    const hitSignal = (n) => n.kind === 'Signal' && n._dAlphaTarget === 1;
    for (const nd of this.nodes) {
      if (nd._dAlphaTarget !== -1) continue;
      const hop1 = (this.adj.get(nd.id) || []).map((a) => a.node);
      let keep = hop1.some(hitSignal);
      if (!keep) {
        for (const n1 of hop1) {
          if (n1 === nd) continue;
          const hop2 = (this.adj.get(n1.id) || []).map((a) => a.node);
          if (hop2.some(hitSignal)) { keep = true; break; }
        }
      }
      nd._dAlphaTarget = keep ? 1 : OUT_OF_WINDOW_ALPHA;
    }
    // 第三遍：Relation —— 全部相邻节点显形才显形；孤立 Relation 保留
    for (const nd of this.nodes) {
      if (nd.kind !== 'Relation') continue;
      const nb = (this.adj.get(nd.id) || []).map((a) => a.node);
      nd._dAlphaTarget = (!nb.length || nb.every((n) => n._dAlphaTarget === 1))
        ? 1 : OUT_OF_WINDOW_ALPHA;
    }
  }

  /** 200ms 线性逼近目标透明度（时间窗 + 板块双通道） */
  _stepDimAlpha(dt) {
    if (dt <= 0) return;
    const step = dt / TIME_FADE_MS;
    for (const nd of this.nodes) {
      let diff = nd._tAlphaTarget - nd._tAlpha;
      if (Math.abs(diff) <= step) nd._tAlpha = nd._tAlphaTarget;
      else nd._tAlpha += Math.sign(diff) * step;
      diff = nd._dAlphaTarget - nd._dAlpha;
      if (Math.abs(diff) <= step) nd._dAlpha = nd._dAlphaTarget;
      else nd._dAlpha += Math.sign(diff) * step;
    }
  }

  /* ------------------------------------------------------------
     11. 公共 API（dim / highlight / selection / sizing / export / destroy）
     ------------------------------------------------------------ */

  /** 集合外节点边降至 12% 透明度；null 取消降噪 */
  dimExcept(idSet) {
    this.dimSet = idSet ? new Set(idSet) : null;
  }

  /** 高亮路径：指定节点与边以石墨色 2.5 宽渲染 */
  highlightPath(nodeIds = [], edgeIds = []) {
    this.hlNodes = new Set(nodeIds);
    this.hlEdges = new Set(edgeIds);
  }

  clearHighlight() {
    this.hlNodes.clear();
    this.hlEdges.clear();
  }

  /** @returns {Array} 选中的节点对象（含原始字段 + 布局字段 x/y/pinned/degree 等） */
  getSelection() {
    return this.nodes.filter((n) => this.selection.has(n.id));
  }

  clearSelection() {
    if (!this.selection.size) return;
    this.selection.clear();
    this.hooks.onSelectionChange?.([]);
  }

  /** 钉住 / 释放（释放后节点重新参与布局） */
  setPinned(id, bool) {
    const nd = this.nodeById.get(id);
    if (!nd) return;
    nd.pinned = !!bool;
    if (!bool) this._wake(0.3);
  }

  /** 尺寸编码：'fixed' | 'confidence'（Signal）| 'degree'（Object） */
  setSizing(mode) {
    if (!['fixed', 'confidence', 'degree'].includes(mode) || mode === this.sizing) return;
    this.sizing = mode;
    for (const nd of this.nodes) nd.r = this._radius(nd);
    this._wake(0.4); // 半径变化 → 重排防重叠
  }

  /** 导出当前视口为 PNG dataURL（不含小地图与选框） */
  exportPNG() {
    const off = document.createElement('canvas');
    off.width = Math.max(1, Math.round(this.w * this.dpr));
    off.height = Math.max(1, Math.round(this.h * this.dpr));
    const octx = off.getContext('2d');
    this._render(octx, { skipMinimap: true, skipOverlays: true });
    return off.toDataURL('image/png');
  }

  /** HiDPI 适配：按 devicePixelRatio 设置 backing store */
  _resize() {
    const el = this.canvas.parentElement || this.canvas;
    const rect = el.getBoundingClientRect();
    const w = Math.max(1, rect.width);
    const h = Math.max(1, rect.height);
    this.dpr = window.devicePixelRatio || 1;
    this.w = w; this.h = h;
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
  }

  /** 销毁：停帧、摘监听器、断开观察器 */
  destroy() {
    this._destroyed = true;
    cancelAnimationFrame(this._raf);
    if (this._ro) this._ro.disconnect();
    for (const [el, ev, fn, opts] of this._listeners) el.removeEventListener(ev, fn, opts);
    this._listeners = [];
    this.nodes = [];
    this.edges = [];
    this.nodeById.clear();
    this.adj.clear();
  }
}
