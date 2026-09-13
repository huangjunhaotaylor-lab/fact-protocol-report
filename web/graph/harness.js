/* ============================================================
   G1 图引擎验证台 — mock 数据 + 全交互演示（不进导航，不接 API）
   300 节点（五类按比例）/ 500 边 · 确定性伪随机 · 自包含
   ============================================================ */

import { GraphEngine } from './engine.js';

/* ---------------- mock 数据生成 ---------------- */

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20260913);
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const rint = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));

const DAY = 86400000;
const NOW = Date.now();
const ts = (daysAgo) => new Date(NOW - daysAgo * DAY).toISOString();

function mockGraph() {
  const nodes = [];
  const edges = [];
  const edgeKeys = new Set();
  const addEdge = (source, target, kind) => {
    const key = `${source}|${target}|${kind}`;
    if (edgeKeys.has(key) || source === target) return false;
    edgeKeys.add(key);
    edges.push({ id: `e-${edges.length + 1}`, source, target, kind });
    return true;
  };

  // Evidence ×60（土棕方块 · 带 created_at · checksum 校验态）
  const evTexts = ['采购合同扫描', '验收单', '对账单', '质检报告', '物流面单', '会议纪要', '发票影像', '入库单'];
  const evidences = [];
  for (let i = 1; i <= 60; i++) {
    const id = `ev-${i}`;
    evidences.push(id);
    nodes.push({
      id, kind: 'Evidence',
      label: `EV-${String(i).padStart(3, '0')} ${pick(evTexts)}`,
      state: pick(['Created', 'Verified', 'Verified', 'Verified', 'Archived']),
      type: pick(['contract', 'receipt', 'report', 'photo']),
      created_at: ts(rand() * 120),
      checksum_ok: rand() < 0.88,
    });
  }

  // Fragment ×130（暖灰小圆 · 无时间字段 → 跟随 Evidence）
  const fragments = [];
  for (let i = 1; i <= 130; i++) {
    const id = `fr-${i}`;
    fragments.push(id);
    nodes.push({
      id, kind: 'Fragment',
      label: `F-${String(i).padStart(3, '0')}`,
      state: pick(['Created', 'Verified', 'Verified']),
      type: pick(['text', 'table', 'amount', 'date']),
    });
    addEdge(pick(evidences), id, 'HAS_FRAGMENT'); // 每个碎片挂一份证据
  }

  // Signal ×60（陶土圆 · confidence · captured_at/occurred_at）
  const sigTypes = ['交付延迟', '库存异常', '报价变更', '质量投诉', '账期风险', '数量短缺'];
  const signals = [];
  for (let i = 1; i <= 60; i++) {
    const id = `sg-${i}`;
    signals.push(id);
    nodes.push({
      id, kind: 'Signal',
      label: `SIG-${String(i).padStart(3, '0')} ${pick(sigTypes)}`,
      state: pick(['Captured', 'Captured', 'Verified', 'Verified', 'Invalid', 'Archived']),
      type: pick(['delay', 'stock', 'price', 'quality', 'payment']),
      captured_at: ts(rand() * 120),
      occurred_at: rand() < 0.5 ? ts(rand() * 120) : undefined,
      confidence: Math.round(rand() * 90 + 10) / 100,
    });
  }

  // Object ×40（灰绿大圆 · 按连接度）
  const objNames = ['华南仓', '华东仓', '华北仓', '启明电子', '恒瑞物流', '安捷供应链', '订单 PO-', '物料 SKU-', '客户-', '供应商-'];
  const objects = [];
  for (let i = 1; i <= 40; i++) {
    const id = `obj-${i}`;
    objects.push(id);
    nodes.push({
      id, kind: 'Object',
      label: `${pick(objNames)}${i}`,
      state: pick(['Active', 'Active', 'Active', 'Merged', 'Archived']),
      type: pick(['Warehouse', 'Customer', 'Supplier', 'Order', 'Material']),
    });
  }

  // Relation ×10（浅棕灰菱形 · 无时间字段 → 跟随 Signal）
  const relations = [];
  for (let i = 1; i <= 10; i++) {
    const id = `rel-${i}`;
    relations.push(id);
    nodes.push({
      id, kind: 'Relation',
      label: pick([' supplies ', ' ships_to ', ' owes ', ' belongs_to ']).trim() + ` #${i}`,
      state: pick(['Active', 'Verified']),
      type: pick(['supplies', 'ships_to', 'owes', 'belongs_to']),
    });
  }

  // Fragment —SUPPORTS→ Signal（每信号 2-3 个碎片）
  for (const sg of signals) {
    const n = rint(2, 3);
    for (let k = 0; k < n; k++) addEdge(pick(fragments), sg, 'SUPPORTS');
  }
  // Signal —ANCHORS→ Object（每信号 1-2 个对象）
  for (const sg of signals) {
    const n = rint(1, 2);
    for (let k = 0; k < n; k++) addEdge(sg, pick(objects), 'ANCHORS');
  }
  // Object —RELATION→ Object
  for (let i = 0; i < 55; i++) addEdge(pick(objects), pick(objects), 'RELATION');
  // Relation —DERIVED_FROM→ Signal（关系也有证据）
  for (const rl of relations) addEdge(rl, pick(signals), 'DERIVED_FROM');
  // Object —MERGED_INTO→ Object
  for (let i = 0; i < 8; i++) addEdge(pick(objects), pick(objects), 'MERGED_INTO');
  // Evidence —SAME_CHAIN→ Evidence（证据链）
  for (let i = 0; i < 24; i++) addEdge(pick(evidences), pick(evidences), 'SAME_CHAIN');
  // 补足到 500 边
  let guard = 0;
  while (edges.length < 500 && guard++ < 4000) {
    if (rand() < 0.6) addEdge(pick(fragments), pick(signals), 'SUPPORTS');
    else addEdge(pick(signals), pick(objects), 'ANCHORS');
  }

  return { nodes, edges };
}

/* ---------------- 引擎初始化 ---------------- */

const { nodes, edges } = mockGraph();

const $ = (id) => document.getElementById(id);
const tip = $('tip');
const menu = $('menu');
const hideMenu = () => { menu.hidden = true; };

const engine = new GraphEngine($('graph'), {
  onNodeClick(node) {
    $('selVal').textContent = String(engine.getSelection().length);
  },
  onNodeDblClick(node) {
    engine.focusNode(node.id, true);
  },
  onNodeContext(node, x, y) {
    showMenu(node, x, y);
  },
  onSelectionChange(sel) {
    $('selVal').textContent = String(sel.length);
    hideMenu();
  },
  onBackgroundClick() {
    hideMenu();
    tip.hidden = true;
  },
  onHover(node, x, y) {
    if (!node) { tip.hidden = true; return; }
    tip.innerHTML =
      `<span class="tt-kind" style="color:${kindColor(node.kind)}">${node.kind}</span>` +
      `<div class="tt-label">${esc(node.label || node.id)}</div>` +
      `<div class="tt-meta">` +
      `<div><span class="k">状态</span>${esc(node.state ?? '—')}</div>` +
      (node.confidence != null ? `<div><span class="k">置信度</span><span class="num">${node.confidence.toFixed(2)}</span></div>` : '') +
      (node.checksum_ok === false ? `<div><span class="k">checksum</span><b style="color:#b06a4a">校验失败</b></div>` : '') +
      `<div><span class="k">连接度</span><span class="num">${node.degree}</span></div>` +
      `<div><span class="k">钉住</span>${node.pinned ? '是（右键可释放）' : '否'}</div>` +
      `</div>`;
    const wrap = $('wrap').getBoundingClientRect();
    tip.style.left = Math.min(x + 14, wrap.width - 290) + 'px';
    tip.style.top = Math.min(y + 14, wrap.height - 150) + 'px';
    tip.hidden = false;
  },
});

engine.setData(nodes, edges);
// 初始视角：等布局初步沉降后适配全图
setTimeout(() => engine.zoomToFit(true), 350);

function kindColor(kind) {
  return { Evidence: '#a67c52', Fragment: '#b8ab97', Signal: '#b06a4a', Object: '#7d8471', Relation: '#8a8578' }[kind] || '#8a8578';
}
function esc(s) {
  return String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

/* ---------------- FPS 状态面板 ---------------- */

setInterval(() => {
  const fps = engine.fps;
  const el = $('fpsVal');
  el.textContent = String(fps);
  el.className = 'v ' + (fps >= 55 ? 'good' : 'bad');
  $('cntVal').textContent = `${engine.nodes.length} / ${engine.edges.length}`;
  $('layoutVal').textContent = engine.alpha > 0 ? `活跃 α=${engine.alpha.toFixed(2)}` : '休眠';
  $('zoomVal').textContent = engine.cam.z.toFixed(2) + 'x';
}, 500);

/* ---------------- 右键菜单（上层绘制，引擎只抛坐标） ---------------- */

function showMenu(node, x, y) {
  const items = [
    { label: '聚焦节点', act: () => engine.focusNode(node.id, true) },
    node.pinned
      ? { label: '释放钉住', act: () => engine.setPinned(node.id, false) }
      : { label: '钉住节点', act: () => engine.setPinned(node.id, true) },
    'sep',
    { label: '高亮追溯链（向 Evidence）', act: () => traceChain(node) },
    { label: '一度邻居外降噪', act: () => dimToNeighbors(node) },
    { label: '清除高亮 / 降噪', act: () => { engine.clearHighlight(); engine.dimExcept(null); } },
  ];
  menu.innerHTML = '';
  for (const it of items) {
    if (it === 'sep') {
      const d = document.createElement('div');
      d.className = 'sep';
      menu.appendChild(d);
      continue;
    }
    const b = document.createElement('button');
    b.className = 'mi';
    b.textContent = it.label;
    b.addEventListener('click', () => { hideMenu(); it.act(); });
    menu.appendChild(b);
  }
  const wrap = $('wrap').getBoundingClientRect();
  menu.style.left = Math.min(x, wrap.width - 220) + 'px';
  menu.style.top = Math.min(y, wrap.height - 230) + 'px';
  menu.hidden = false;
}
document.addEventListener('mousedown', (e) => {
  if (!menu.hidden && !menu.contains(e.target)) hideMenu();
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideMenu(); });

/** 追溯链演示：沿 SUPPORTS / HAS_FRAGMENT / DERIVED_FROM / ANCHORS 反向上溯至 Evidence */
function traceChain(node) {
  const UPSTREAM = new Set(['SUPPORTS', 'HAS_FRAGMENT', 'DERIVED_FROM', 'ANCHORS']);
  const nodeIds = new Set([node.id]);
  const edgeIds = new Set();
  let frontier = [node];
  for (let depth = 0; depth < 3 && frontier.length; depth++) {
    const next = [];
    for (const cur of frontier) {
      for (const { node: nb, edge } of engine.adj.get(cur.id) || []) {
        if (!UPSTREAM.has(edge.kind)) continue;
        // 只沿 target→source 方向（追溯语义：碎片←支撑←信号←锚定）
        if (edge.target !== cur.id) continue;
        if (!nodeIds.has(nb.id)) { nodeIds.add(nb.id); next.push(nb); }
        edgeIds.add(edge.id);
      }
    }
    frontier = next;
  }
  engine.highlightPath([...nodeIds], [...edgeIds]);
  engine.dimExcept(nodeIds);
}

function dimToNeighbors(node) {
  const set = new Set([node.id]);
  for (const { node: nb } of engine.adj.get(node.id) || []) set.add(nb.id);
  engine.dimExcept(set);
}

/* ---------------- 顶栏控件 ---------------- */

$('sizingSeg').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-mode]');
  if (!btn) return;
  for (const b of $('sizingSeg').querySelectorAll('button')) b.classList.toggle('on', b === btn);
  engine.setSizing(btn.dataset.mode);
});
$('btnFit').addEventListener('click', () => engine.zoomToFit(true));
$('btnClear').addEventListener('click', () => {
  engine.clearSelection();
  engine.clearHighlight();
  engine.dimExcept(null);
});
$('btnPng').addEventListener('click', () => {
  const url = engine.exportPNG();
  const a = document.createElement('a');
  a.href = url;
  a.download = `bsp-graph-${Date.now()}.png`;
  a.click();
});

/* ---------------- 时间直方图滑杆（双 range 模拟双头） ---------------- */

const timed = nodes
  .map((n) => Date.parse(n.captured_at ?? n.occurred_at ?? n.created_at))
  .filter((t) => Number.isFinite(t))
  .sort((a, b) => a - b);
const T0 = timed[0], T1 = timed[timed.length - 1];
const SL_MAX = 1000;
const s2t = (s) => T0 + ((T1 - T0) * s) / SL_MAX;
const fmt = (t) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

$('t0Label').textContent = fmt(T0);
$('t1Label').textContent = fmt(T1);

function drawHisto() {
  const cv = $('histo');
  const track = $('gtTrack');
  const w = track.clientWidth, h = 44;
  const dpr = window.devicePixelRatio || 1;
  cv.width = w * dpr; cv.height = h * dpr;
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const BINS = 48;
  const bins = new Array(BINS).fill(0);
  for (const t of timed) bins[Math.min(BINS - 1, Math.floor(((t - T0) / (T1 - T0)) * BINS))]++;
  const max = Math.max(...bins, 1);
  const bw = w / BINS;
  ctx.fillStyle = '#d9d0c0';
  for (let i = 0; i < BINS; i++) {
    const bh = Math.max(2, (bins[i] / max) * (h - 4));
    ctx.fillRect(i * bw + 1, h - bh, bw - 2, bh);
  }
}

function applyTimeWindow() {
  let s0 = Number($('twMin').value);
  let s1 = Number($('twMax').value);
  if (s0 > s1) [s0, s1] = [s1, s0];
  $('twWindow').style.left = (s0 / SL_MAX) * 100 + '%';
  $('twWindow').style.width = ((s1 - s0) / SL_MAX) * 100 + '%';
  if (s0 <= 0 && s1 >= SL_MAX) {
    $('twLabel').textContent = '全时段';
    engine.setTimeWindow(null);
  } else {
    $('twLabel').textContent = `${fmt(s2t(s0))} ~ ${fmt(s2t(s1))}`;
    engine.setTimeWindow([s2t(s0), s2t(s1)]);
  }
}
$('twMin').addEventListener('input', applyTimeWindow);
$('twMax').addEventListener('input', applyTimeWindow);
$('twReset').addEventListener('click', () => {
  $('twMin').value = '0';
  $('twMax').value = String(SL_MAX);
  applyTimeWindow();
});

window.addEventListener('resize', drawHisto);
drawHisto();
applyTimeWindow();
