/* ============================================================
   BSP Business Graph OS — 工作区应用（G2 探索 + G3 研判 + 追溯）
   原生 ES Module · 零外部依赖 · 暖色系
   分层：
     1. 工具与 API
     2. 应用状态
     3. 引擎装配（hooks）
     4. 数据同步（master 全集 ⇄ 引擎，过滤回放）
     5. 搜索 / 展开 / 收起 / 隐藏
     6. 右键菜单
     7. 检查器面板（属性 / checksum / 原文 / 关联 / 状态操作）
     8. 追溯模式（MVP 核心）
     9. 研判模式（过滤器 + 时间直方图滑杆）
    10. 场景（保存 / 加载 / 导出 / 导入）
    11. 杂项 UI（toast / 空态 / 加载 / 折叠 / 键盘）
    12. 启动
   ============================================================ */

import { GraphEngine } from './engine.js';

/* ------------------------------------------------------------
   1. 工具与 API
   ------------------------------------------------------------ */

const $ = (id) => document.getElementById(id);

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

async function api(path, options) {
  const res = await fetch(path, options);
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      if (body && body.error && body.error.message) msg = body.error.message;
    } catch (_) { /* 非 JSON 错误体 */ }
    throw new Error(msg);
  }
  return res.json();
}

function fmtTime(ts) {
  const d = new Date(ts);
  if (!Number.isFinite(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const KIND_CN = {
  Evidence: '证据', Fragment: '片段', Signal: '信号', Object: '对象', Relation: '关系',
};

const KIND_BADGE_CLS = {
  Evidence: 'k-Evidence', Fragment: 'k-Fragment', Signal: 'k-Signal',
  Object: 'k-Object', Relation: 'k-Relation',
};

/* ------------------------------------------------------------
   2. 应用状态
   ------------------------------------------------------------ */

const state = {
  mode: 'explore',            // explore | judge
  trace: null,                // { signal, chainData, fragPos: Map<fragId,{evId,start,end}> }
  master: { nodes: new Map(), edges: new Map() }, // 原始全集（过滤回放的数据源）
  hidden: new Set(),          // 手动隐藏的节点 id
  collapsed: new Set(),       // 收起邻居移除的叶子 id（重新展开其父节点时复活）
  expandedFrom: new Map(),    // id -> Set<由该节点展开引入的 id>
  filters: {
    kinds: { Evidence: true, Fragment: true, Signal: true, Object: true, Relation: true },
    sigStates: { Captured: true, Verified: true, Invalid: true, Archived: true },
    objType: '',
    sizing: 'fixed',
    dimIsolated: false,
  },
  timeWindow: null,           // [t0, t1] | null
  histo: null,                // { min, max, buckets: [{start,end,count}] }
  currentScene: null,         // 当前加载/保存的场景名
  traceSel: null,             // 追溯面板当前选中的 fragment id
};

const SCENE_KEY = 'bgo-scenes';
const FRAG_COLORS = 6; // 原文高亮六色循环

/* ------------------------------------------------------------
   3. 引擎装配
   ------------------------------------------------------------ */

const engine = new GraphEngine($('graph'), {
  onNodeClick: (nd) => { if (!state.trace) renderInspector(nd); },
  onNodeDblClick: (nd) => { expandNode(nd); },
  onNodeContext: (nd, x, y) => { openMenu(nd, x, y); },
  onSelectionChange: (sel) => {
    if (state.trace) return; // 追溯中保持追溯面板
    if (sel.length === 1) renderInspector(sel[0]);
    else if (sel.length > 1) renderMultiSelection(sel);
    else renderInspectorPlaceholder();
  },
  onBackgroundClick: () => { closeMenu(); closeSceneMenu(); },
  onHover: (nd, x, y) => { renderTip(nd, x, y); },
});

/* ------------------------------------------------------------
   4. 数据同步（master 全集 ⇄ 引擎）
   ------------------------------------------------------------ */

/** 节点是否通过当前过滤器（含手动隐藏） */
function nodeAllowed(n) {
  if (state.hidden.has(n.id) || state.collapsed.has(n.id)) return false;
  if (!state.filters.kinds[n.kind]) return false;
  if (n.kind === 'Signal' && n.state && !state.filters.sigStates[n.state]) return false;
  if (n.kind === 'Object' && state.filters.objType && n.type !== state.filters.objType) return false;
  return true;
}

/**
 * 数据入图：写入 master 全集，再按过滤器回放进引擎。
   opts.defer=true 时跳过回放（批量加载场景用，之后手动 applyFilters 一次）。
 */
function addToGraph(nodes = [], edges = [], opts = {}) {
  const newIds = nodes.filter((n) => !engine.nodeById.has(n.id)).map((n) => n.id);
  for (const n of nodes) if (!state.master.nodes.has(n.id)) state.master.nodes.set(n.id, n);
  for (const e of edges) if (!state.master.edges.has(e.id)) state.master.edges.set(e.id, e);
  if (!opts.defer) {
    applyFilters();
    if (opts.fade !== false && !engine.timeWindow) fadeIn(newIds);
  }
  updateFilterCounts();
  updateEmptyState();
  if (state.mode === 'judge') rebuildHisto();
}

/** 新节点淡入：借用引擎时间窗透明度插值（200ms 线性到 1） */
function fadeIn(ids) {
  for (const id of ids) {
    const nd = engine.nodeById.get(id);
    if (nd && nd._tAlpha === 1 && nd._tAlphaTarget === 1) {
      nd._tAlpha = 0.15;
    }
  }
}

/** 过滤回放：master 全集 → 过滤器 → removeNodes + addData 恢复 */
function applyFilters() {
  const allowed = new Set();
  for (const n of state.master.nodes.values()) if (nodeAllowed(n)) allowed.add(n.id);

  const inEngine = new Set(engine.nodeById.keys());
  const toRemove = [...inEngine].filter((id) => !allowed.has(id));
  const toAdd = [];
  for (const id of allowed) {
    if (!inEngine.has(id)) toAdd.push(state.master.nodes.get(id));
  }
  const knownEdges = new Set(engine.edges.map((e) => e.id));
  const addEdges = [];
  for (const e of state.master.edges.values()) {
    if (!knownEdges.has(e.id) && allowed.has(e.source) && allowed.has(e.target)) addEdges.push(e);
  }

  if (toRemove.length) engine.removeNodes(toRemove);
  if (toAdd.length || addEdges.length) engine.addData(toAdd, addEdges);
  applyDimIsolated();
  updateEmptyState();
  if (state.mode === 'judge') rebuildHisto();
}

/** 引擎内直接移除（收起邻居用，不触碰 master/hidden） */
function removeFromScene(ids) {
  if (!ids.length) return;
  engine.removeNodes(ids);
  applyDimIsolated();
  updateEmptyState();
  if (state.mode === 'judge') rebuildHisto();
}

/** 清空画布 + 全集（场景「清空画布」） */
function clearAll() {
  engine.setData([]);
  state.master.nodes.clear();
  state.master.edges.clear();
  state.hidden.clear();
  state.collapsed.clear();
  state.expandedFrom.clear();
  state.currentScene = null;
  exitTrace(true);
  updateFilterCounts();
  updateEmptyState();
  if (state.mode === 'judge') rebuildHisto();
}

/** 淡出孤立节点开关应用 */
function applyDimIsolated() {
  if (state.trace) return; // 追溯 dim 优先
  if (!state.filters.dimIsolated || state.mode !== 'judge') {
    if (!state.trace) engine.dimExcept(null);
    return;
  }
  const keep = engine.nodes.filter((n) => n.degree > 0).map((n) => n.id);
  engine.dimExcept(keep.length ? new Set(keep) : null);
}

/* ------------------------------------------------------------
   5. 搜索 / 展开 / 收起 / 隐藏
   ------------------------------------------------------------ */

async function doSearch(q) {
  const query = (q != null ? q : $('searchInput').value).trim();
  if (!query) return;
  showLoading(true);
  try {
    const r = await api(`/api/graph/search?q=${encodeURIComponent(query)}`);
    if (!r.total) {
      toast(`未命中「${query}」相关节点`, 'warn');
      flashSearchMiss();
      return;
    }
    addToGraph(r.nodes, r.edges);
    engine.focusNode(r.nodes[0].id);
    toast(`命中 ${r.total} 个节点`);
  } catch (err) {
    toast(`搜索失败：${err.message}`);
  } finally {
    showLoading(false);
  }
}

async function expandNode(nd, opts = {}) {
  closeMenu();
  try {
    const d = await api(`/api/graph/expand/${nd.kind}/${encodeURIComponent(nd.id)}`);
    const introduced = [];
    for (const n of d.nodes) if (!engine.nodeById.has(n.id)) introduced.push(n.id);
    if (!engine.nodeById.has(d.node.id)) introduced.push(d.node.id);
    if (introduced.length) {
      const s = state.expandedFrom.get(nd.id) || new Set();
      for (const id of introduced) s.add(id);
      state.expandedFrom.set(nd.id, s);
      for (const id of introduced) state.collapsed.delete(id); // 重新展开父节点 → 复活已收起叶子
    }
    addToGraph([d.node, ...d.nodes], d.edges, opts);
    if (!opts.silent) toast(introduced.length ? `展开 ${introduced.length} 个邻居` : '没有新的邻居');
    return d;
  } catch (err) {
    if (!opts.silent) toast(`展开失败：${err.message}`);
    return null;
  }
}

/** 收起邻居：移除由该节点展开引入、且自身未再展开的叶子节点 */
function collapseNeighbors(nd) {
  const intro = state.expandedFrom.get(nd.id);
  if (!intro || !intro.size) { toast('该节点没有可收起的展开'); return; }
  const kill = [];
  for (const id of intro) {
    const n = engine.nodeById.get(id);
    if (!n) continue;
    if (state.expandedFrom.has(id)) continue; // 它自己也展开过，保留
    if (n.degree > 1) continue;               // 已与其他节点相连，非叶子
    if (state.trace && id === state.trace.signal.id) continue;
    kill.push(id);
  }
  if (!kill.length) { toast('没有可收起的叶子节点'); return; }
  for (const id of kill) intro.delete(id);
  for (const id of kill) state.collapsed.add(id); // 排除出过滤回放，防止后续 applyFilters 复活
  removeFromScene(kill);
  toast(`已收起 ${kill.length} 个节点`);
}

function hideNodes(ids) {
  for (const id of ids) state.hidden.add(id);
  applyFilters();
  updateEmptyState();
  toast(`已隐藏 ${ids.length} 个节点`);
}

function hideUnselected() {
  const sel = new Set(engine.getSelection().map((n) => n.id));
  if (!sel.size) { toast('请先选中要保留的节点'); return; }
  const ids = engine.nodes.filter((n) => !sel.has(n.id)).map((n) => n.id);
  hideNodes(ids);
}

/* ------------------------------------------------------------
   6. 右键菜单
   ------------------------------------------------------------ */

function stateOpsFor(nd) {
  const ops = [];
  if (nd.kind === 'Signal') {
    if (nd.state === 'Captured') {
      ops.push({ label: '核认 Verified', run: () => api(`/api/signals/${encodeURIComponent(nd.id)}/verify`, { method: 'POST' }) });
      ops.push({ label: '标记 Invalid', run: () => api(`/api/signals/${encodeURIComponent(nd.id)}/invalid`, { method: 'POST' }) });
    } else if (nd.state === 'Verified') {
      ops.push({ label: '归档 Archived', run: () => api(`/api/signals/${encodeURIComponent(nd.id)}/archive`, { method: 'PATCH' }) });
    }
  } else if (nd.kind === 'Object') {
    if (nd.state === 'Created') {
      ops.push({ label: '激活 Active', run: () => api(`/api/objects/${encodeURIComponent(nd.id)}/activate`, { method: 'PATCH' }) });
    } else if (nd.state === 'Active') {
      ops.push({ label: '归档 Archived', run: () => api(`/api/objects/${encodeURIComponent(nd.id)}/archive`, { method: 'PATCH' }) });
    }
  }
  return ops;
}

async function doStateOp(nd, op) {
  try {
    const updated = await op.run();
    // 同步引擎节点与 master 数据
    nd.state = updated.state;
    nd.data = updated;
    const m = state.master.nodes.get(nd.id);
    if (m) { m.state = updated.state; m.data = updated; }
    applyFilters(); // 状态可能影响过滤（如 Archived chip）
    toast(`已更新为 ${updated.state}`);
    if (!state.trace) {
      const cur = engine.nodeById.get(nd.id);
      if (cur && engine.getSelection().some((s) => s.id === nd.id)) renderInspector(cur);
    }
  } catch (err) {
    toast(`操作失败：${err.message}`);
  }
}

function openMenu(nd, x, y) {
  const menu = $('menu');
  menu.textContent = '';
  const ops = stateOpsFor(nd);

  const addItem = (label, fn, disabled) => {
    const b = el('button', 'mi', label);
    if (disabled) b.disabled = true;
    else b.addEventListener('click', () => { closeMenu(); fn(); });
    menu.append(b);
  };
  const addSep = () => menu.append(el('div', 'sep'));

  addItem('展开邻居', () => expandNode(nd));
  addItem('收起邻居', () => collapseNeighbors(nd), !(state.expandedFrom.get(nd.id) || new Set()).size);
  addItem('聚焦', () => engine.focusNode(nd.id));
  addItem('释放钉住', () => { engine.setPinned(nd.id, false); toast('已释放钉住'); }, !nd.pinned);
  addSep();
  if (nd.kind === 'Signal') addItem('进入追溯', () => enterTrace(nd));
  for (const op of ops) addItem(op.label, () => doStateOp(nd, op));
  if (nd.kind === 'Signal' || ops.length) addSep();
  addItem('隐藏节点', () => hideNodes([nd.id]));
  addItem('隐藏未选中', () => hideUnselected());

  // 定位（画布相对坐标，越界收敛）
  menu.hidden = false;
  const wrap = $('wrap').getBoundingClientRect();
  const mw = menu.offsetWidth, mh = menu.offsetHeight;
  menu.style.left = `${Math.max(4, Math.min(x, wrap.width - mw - 4))}px`;
  menu.style.top = `${Math.max(4, Math.min(y, wrap.height - mh - 4))}px`;
}

function closeMenu() { $('menu').hidden = true; }

/* ------------------------------------------------------------
   7. 检查器面板
   ------------------------------------------------------------ */

function renderInspectorPlaceholder() {
  const body = $('inspectorBody');
  body.textContent = '';
  $('inspectorTitle').textContent = '检查器';
  const ph = el('div', 'bi-placeholder');
  ph.append(document.createTextNode('点击画布中的节点查看详情'), el('br'));
  ph.append(el('small', null, '右键节点打开操作菜单 · 双击展开邻居'));
  body.append(ph);
}

function renderMultiSelection(sel) {
  const body = $('inspectorBody');
  body.textContent = '';
  body.append(el('div', 'bi-selcount', `已选中 ${sel.length} 个节点`));
  const byKind = {};
  for (const n of sel) byKind[n.kind] = (byKind[n.kind] || 0) + 1;
  const list = el('div', 'bi-kindcounts');
  for (const [k, c] of Object.entries(byKind)) {
    const row = el('div', 'bi-kindrow');
    row.append(el('span', `dot ${KIND_BADGE_CLS[k]}`), el('span', null, `${k} × ${c}`));
    list.append(row);
  }
  body.append(list);
  const hideBtn = el('button', 'btn small bi-act', '隐藏未选中');
  hideBtn.addEventListener('click', hideUnselected);
  body.append(hideBtn);
}

/** 属性表：kind 相关字段全展示，空值省略 */
const PROP_FIELDS = {
  Evidence: [
    ['id', 'ID'], ['source', '来源'], ['source_id', '来源 ID'], ['state', '状态'],
    ['version', '版本'], ['chain_id', '证据链'], ['creator', '创建者'],
    ['checksum', 'Checksum'], ['created_at', '创建时间'],
  ],
  Fragment: [
    ['id', 'ID'], ['evidence_id', '所属 Evidence'], ['type', '类型'], ['speaker', '说话人'],
    ['state', '状态'], ['start_offset', '起始偏移'], ['end_offset', '结束偏移'],
    ['page', '页码'], ['section', '章节'], ['row', '行号'], ['column', '列号'],
    ['timestamp_start', '起始时间戳'], ['timestamp_end', '结束时间戳'],
    ['checksum', 'Checksum'],
  ],
  Signal: [
    ['id', 'ID'], ['type', '类型'], ['state', '状态'], ['body', '观察内容'],
    ['captured_at', '捕获时间'], ['occurred_at', '发生时间'], ['confidence', '置信度'],
  ],
  Object: [
    ['id', 'ID'], ['type', '类型'], ['name', '名称'], ['state', '状态'],
    ['identity', '身份 ID'], ['created_at', '创建时间'], ['updated_at', '更新时间'],
  ],
  Relation: [
    ['id', 'ID'], ['type', '关系类型'], ['source', 'Source'], ['target', 'Target'],
    ['derived_from', '派生自 Signal'], ['confidence', '置信度'], ['created_at', '创建时间'],
  ],
};

function propRow(k, v) {
  const tr = el('tr');
  tr.append(el('td', 'pk', k));
  const td = el('td', 'pv');
  td.textContent = String(v);
  if (String(v).length > 40) td.title = String(v);
  tr.append(td);
  return tr;
}

function renderInspector(nd) {
  const body = $('inspectorBody');
  body.textContent = '';
  $('inspectorTitle').textContent = '检查器';
  const d = nd.data || {};

  // 头部：类型徽标 + label + 状态徽标
  const head = el('div', 'bi-nodehead');
  head.append(el('span', `badge kind ${KIND_BADGE_CLS[nd.kind]}`, nd.kind));
  head.append(el('span', 'bi-label', nd.label || nd.id));
  if (nd.state) head.append(el('span', `badge state st-${nd.state}`, nd.state));
  body.append(head);

  // Evidence / Fragment：checksum 校验
  if (nd.kind === 'Evidence' || nd.kind === 'Fragment') {
    const row = el('div', 'bi-verify');
    const btn = el('button', 'btn small', '校验 checksum');
    const res = el('span', 'bi-verify-res');
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      res.textContent = '校验中…';
      res.className = 'bi-verify-res';
      try {
        const base = nd.kind === 'Evidence' ? '/api/evidences' : '/api/fragments';
        const r = await api(`${base}/${encodeURIComponent(nd.id)}/verify`);
        const ok = !!r.integrity;
        res.textContent = ok ? '✓ 校验通过' : '✗ 校验失败';
        res.classList.add(ok ? 'ok' : 'bad');
        nd.checksum_ok = ok; // 引擎按 checksum_ok === false 画红锁
        const m = state.master.nodes.get(nd.id);
        if (m) m.checksum_ok = ok;
      } catch (err) {
        res.textContent = `✗ ${err.message}`;
        res.classList.add('bad');
      } finally {
        btn.disabled = false;
      }
    });
    row.append(btn, res);
    body.append(row);
  }

  // Signal：confidence 条
  if (nd.kind === 'Signal' && typeof nd.confidence === 'number') {
    const box = el('div', 'bi-conf');
    box.append(el('div', 'bf-title', '置信度'));
    const barWrap = el('div', 'confbar');
    const fill = el('div', 'confbar-fill');
    fill.style.width = `${Math.round(Math.max(0, Math.min(1, nd.confidence)) * 100)}%`;
    barWrap.append(fill);
    box.append(barWrap, el('div', 'confbar-num', String(nd.confidence)));
    body.append(box);
  }

  // 属性表
  const fields = PROP_FIELDS[nd.kind] || [];
  const table = el('table', 'bi-props');
  for (const [key, label] of fields) {
    let v = d[key];
    if (v == null || v === '') continue;
    if (key === 'checksum') v = String(v).slice(0, 16) + '…';
    if (Array.isArray(v)) v = v.join('、');
    table.append(propRow(label, v));
  }
  if (nd.kind === 'Object' && Array.isArray(d.aliases) && d.aliases.length) {
    table.append(propRow('别名', d.aliases.join('、')));
  }
  if (d.attributes && typeof d.attributes === 'object' && Object.keys(d.attributes).length) {
    table.append(propRow('附加属性', JSON.stringify(d.attributes)));
  }
  if (table.childNodes.length) body.append(table);

  // Signal：context 七字段 + actors
  if (nd.kind === 'Signal') {
    const ctx = d.context || {};
    const ctxFields = [
      ['channel', '渠道'], ['source', '来源'], ['organization', '组织'],
      ['location', '位置'], ['meeting', '会议'], ['document', '文档'], ['system', '系统'],
    ];
    const ctxBox = el('div', 'bi-ctx');
    ctxBox.append(el('div', 'bf-title', 'Context'));
    const ctxTable = el('table', 'bi-props');
    let has = false;
    for (const [k, label] of ctxFields) {
      if (ctx[k] == null || ctx[k] === '') continue;
      has = true;
      ctxTable.append(propRow(label, ctx[k]));
    }
    if (has) ctxBox.append(ctxTable);
    else ctxBox.append(el('div', 'bi-none', '（无）'));
    body.append(ctxBox);
    if (Array.isArray(d.actors) && d.actors.length) {
      const ab = el('div', 'bi-actors');
      ab.append(el('div', 'bf-title', '参与者'));
      const chips = el('div', 'bf-chips');
      for (const a of d.actors) chips.append(el('span', 'chip static', String(a)));
      ab.append(chips);
      body.append(ab);
    }
  }

  // Evidence：查看原文（Fragment 六色高亮定位）
  if (nd.kind === 'Evidence') {
    const det = el('div', 'bi-evtext');
    const toggle = el('button', 'btn small', '查看原文 ▾');
    const area = el('div', 'evtext');
    area.hidden = true;
    let loaded = false;
    toggle.addEventListener('click', async () => {
      area.hidden = !area.hidden;
      toggle.textContent = area.hidden ? '查看原文 ▾' : '收起原文 ▴';
      if (!area.hidden && !loaded) {
        loaded = true;
        area.textContent = '加载中…';
        try {
          const frags = await api(`/api/fragments/by-evidence/${encodeURIComponent(nd.id)}`);
          area.textContent = '';
          area.append(renderEvidenceText(String(d.content || ''), frags));
        } catch (err) {
          area.textContent = `加载失败：${err.message}`;
        }
      }
    });
    det.append(toggle, area);
    body.append(det);
  }

  // Fragment：内容预览
  if (nd.kind === 'Fragment' && d.content) {
    const box = el('div', 'bi-evtext');
    box.append(el('div', 'bf-title', '片段内容'));
    box.append(el('div', 'fragtext', String(d.content)));
    body.append(box);
  }

  // 关联节点
  const adj = engine.adj.get(nd.id) || [];
  if (adj.length) {
    const rel = el('div', 'bi-related');
    rel.append(el('div', 'bf-title', `关联节点（${adj.length}）`));
    const list = el('div', 'bi-rellist');
    for (const { node, edge } of adj) {
      const item = el('button', 'bi-relitem');
      item.append(
        el('span', `dot ${KIND_BADGE_CLS[node.kind]}`),
        el('span', 'bi-rellabel', node.label || node.id),
        el('span', 'bi-reledge', edge.kind),
      );
      item.addEventListener('click', () => engine.focusNode(node.id));
      list.append(item);
    }
    rel.append(list);
    body.append(rel);
  }

  // 底部操作（同右键菜单，按状态机渲染）
  const actions = el('div', 'bi-actions');
  if (nd.kind === 'Signal') {
    const tb = el('button', 'btn small bi-act', '进入追溯');
    tb.addEventListener('click', () => enterTrace(nd));
    actions.append(tb);
  }
  for (const op of stateOpsFor(nd)) {
    const b = el('button', 'btn small bi-act', op.label);
    b.addEventListener('click', () => doStateOp(nd, op));
    actions.append(b);
  }
  if (actions.childNodes.length) body.append(actions);
}

/** Evidence 原文渲染：各 Fragment 六色高亮 offset 定位（缺失则 indexOf 回退） */
function renderEvidenceText(content, frags) {
  const wrap = el('div', 'evtext-body');
  if (!content) { wrap.textContent = '（无原文）'; return wrap; }
  const ranges = [];
  for (const f of frags || []) {
    let start = typeof f.start_offset === 'number' ? f.start_offset : -1;
    let end = typeof f.end_offset === 'number' ? f.end_offset : -1;
    if (start < 0 || end <= start) {
      start = content.indexOf(f.content || '');
      end = start >= 0 ? start + String(f.content || '').length : -1;
    }
    if (start < 0 || end <= start || start >= content.length) continue;
    end = Math.min(end, content.length);
    ranges.push({ start, end, f });
  }
  ranges.sort((a, b) => a.start - b.start);
  let cur = 0, ci = 0;
  for (const r of ranges) {
    if (r.start < cur) continue; // 重叠跳过
    if (r.start > cur) wrap.append(document.createTextNode(content.slice(cur, r.start)));
    const mark = el('span', `fh fh-${ci % FRAG_COLORS}`, content.slice(r.start, r.end));
    const loc = [];
    loc.push(`${r.f.type || 'Fragment'} · ${r.start}–${r.end}`);
    if (r.f.speaker) loc.push(`说话人 ${r.f.speaker}`);
    if (r.f.page != null) loc.push(`页 ${r.f.page}`);
    if (r.f.section) loc.push(`章节 ${r.f.section}`);
    mark.title = loc.join(' · ');
    wrap.append(mark);
    cur = r.end;
    ci++;
  }
  if (cur < content.length) wrap.append(document.createTextNode(content.slice(cur)));
  return wrap;
}

/* ------------------------------------------------------------
   8. 追溯模式（MVP 核心）
   ------------------------------------------------------------ */

async function enterTrace(nd) {
  if (nd.kind !== 'Signal') return;
  closeMenu();
  showLoading(true);
  try {
    const t = await api(`/api/signals/${encodeURIComponent(nd.id)}/trace`);

    // 确保链上节点边全部入图（缺的用 expand 补；expand 幂等去重）
    const chainNodes = [
      { kind: 'Signal', id: t.signal.id },
      ...t.fragments.map((f) => ({ kind: 'Fragment', id: f.id })),
      ...t.evidences.map((e) => ({ kind: 'Evidence', id: e.id })),
    ];
    for (const ref of chainNodes) {
      try {
        const d = await api(`/api/graph/expand/${ref.kind}/${encodeURIComponent(ref.id)}`);
        addToGraph([d.node, ...d.nodes], d.edges, { fade: false });
      } catch (_) { /* 单个补链失败不阻断 */ }
    }

    // 链集合：节点 + 边（SUPPORTS frag→signal / HAS_FRAGMENT ev→frag）
    const nodeIds = new Set([t.signal.id]);
    for (const c of t.chain) { nodeIds.add(c.fragment.id); nodeIds.add(c.evidence.id); }
    // 研判过滤器可能把链上节点挡在引擎外：追溯聚焦时绕过过滤器直补
    const forceNodes = [];
    for (const id of nodeIds) {
      if (!engine.nodeById.has(id) && state.master.nodes.has(id)) {
        forceNodes.push(state.master.nodes.get(id));
      }
    }
    if (forceNodes.length) {
      const knownE = new Set(engine.edges.map((e) => e.id));
      const inG = new Set([...engine.nodeById.keys(), ...forceNodes.map((n) => n.id)]);
      const forceEdges = [...state.master.edges.values()].filter(
        (e) => !knownE.has(e.id) && inG.has(e.source) && inG.has(e.target));
      engine.addData(forceNodes, forceEdges);
    }

    const edgeIds = new Set();
    const fragPos = new Map();
    for (const c of t.chain) {
      let start = c.position ? c.position.start : -1;
      let end = c.position ? c.position.end : -1;
      if (start < 0 || end <= start) {
        start = String(c.evidence.content || '').indexOf(c.fragment.content || '');
        end = start >= 0 ? start + String(c.fragment.content || '').length : -1;
      }
      fragPos.set(c.fragment.id, { evId: c.evidence.id, start, end, content: c.evidence.content || '' });
      for (const e of engine.edges) {
        if (e.kind === 'SUPPORTS' && e.source === c.fragment.id && e.target === t.signal.id) edgeIds.add(e.id);
        if (e.kind === 'HAS_FRAGMENT' && e.source === c.evidence.id && e.target === c.fragment.id) edgeIds.add(e.id);
      }
    }

    state.trace = { signal: t.signal, chainData: t, nodeIds, fragPos };
    state.traceSel = t.chain.length ? t.chain[0].fragment.id : null;

    engine.highlightPath([...nodeIds], [...edgeIds]);
    engine.dimExcept(nodeIds);
    engine.focusNode(t.signal.id);

    $('traceLabel').textContent = t.signal.id;
    $('traceBar').hidden = false;
    renderTracePanel();
  } catch (err) {
    toast(`追溯失败：${err.message}`);
  } finally {
    showLoading(false);
  }
}

function exitTrace(silent) {
  if (!state.trace) return;
  state.trace = null;
  state.traceSel = null;
  engine.clearHighlight();
  engine.dimExcept(null);
  $('traceBar').hidden = true;
  applyDimIsolated(); // 研判模式下恢复孤立降噪（如有）
  const sel = engine.getSelection();
  if (sel.length === 1) renderInspector(sel[0]);
  else renderInspectorPlaceholder();
  if (!silent) toast('已退出追溯');
}

function renderTracePanel() {
  const body = $('inspectorBody');
  body.textContent = '';
  $('inspectorTitle').textContent = '追溯';
  const t = state.trace;
  if (!t) return;
  const data = t.chainData;

  // Signal 卡（一级）
  body.append(traceCard('Signal', data.signal.id, data.signal.body || data.signal.id,
    data.signal.state, false, () => {
      engine.focusNode(data.signal.id);
    }));

  // 每条链：Fragment → Evidence
  for (const c of data.chain) {
    const fbox = el('div', 'tc-level');
    const fcard = traceCard('Fragment', c.fragment.id,
      String(c.fragment.content || '').slice(0, 60),
      c.fragment.state, c.fragment.id === state.traceSel, () => {
        state.traceSel = c.fragment.id;
        engine.focusNode(c.fragment.id);
        renderTracePanel();
      });
    fbox.append(fcard);

    const ecard = traceCard('Evidence', c.evidence.id,
      `${c.evidence.source || ''} · ${String(c.evidence.content || '').slice(0, 40)}…`,
      c.evidence.state, false, () => {
        state.traceSel = c.fragment.id;
        engine.focusNode(c.evidence.id);
        renderTracePanel();
      });
    ecard.classList.add('tc-ev');
    fbox.append(ecard);
    body.append(fbox);
  }

  // 底部：Evidence 原文区（当前选中 Fragment 陶土高亮）
  const pos = state.traceSel ? t.fragPos.get(state.traceSel) : null;
  const txt = el('div', 'tc-text');
  txt.append(el('div', 'bf-title', 'Evidence 原文'));
  const area = el('div', 'evtext-body');
  if (pos && pos.start >= 0 && pos.end > pos.start) {
    const content = String(pos.content);
    area.append(document.createTextNode(content.slice(0, pos.start)));
    area.append(el('span', 'fh fh-trace', content.slice(pos.start, pos.end)));
    area.append(document.createTextNode(content.slice(pos.end)));
  } else if (pos) {
    area.textContent = String(pos.content || '（无原文）');
  } else {
    area.textContent = '（选择上方 Fragment 查看定位）';
  }
  txt.append(area);
  body.append(txt);
}

function traceCard(kind, id, text, st, active, onClick) {
  const card = el('button', `tc-card tc-${kind}${active ? ' active' : ''}`);
  const head = el('div', 'tc-cardhead');
  head.append(el('span', `badge kind ${KIND_BADGE_CLS[kind]}`, kind));
  if (st) head.append(el('span', `badge state st-${st}`, st));
  card.append(head, el('div', 'tc-cardtext', text), el('div', 'tc-cardid', id));
  card.addEventListener('click', onClick);
  return card;
}

/* ------------------------------------------------------------
   9. 研判模式（过滤器 + 时间直方图滑杆）
   ------------------------------------------------------------ */

function setMode(m) {
  state.mode = m;
  for (const b of $('modeSeg').querySelectorAll('button')) {
    b.classList.toggle('on', b.dataset.mode === m);
  }
  const judge = m === 'judge';
  $('filterPanel').hidden = !judge || !$('reopenFilters').hidden;
  $('timebar').hidden = !judge;
  if (judge) {
    updateFilterCounts();
    rebuildHisto();
    applyDimIsolated();
  } else {
    engine.setTimeWindow(null);
    state.timeWindow = null;
    applyDimIsolated();
  }
}

function updateFilterCounts() {
  const counts = {};
  for (const n of state.master.nodes.values()) counts[n.kind] = (counts[n.kind] || 0) + 1;
  for (const s of document.querySelectorAll('.bf-count')) {
    s.textContent = String(counts[s.dataset.count] || 0);
  }
}

/* ----- 时间直方图 ----- */

function nodeTime(n) {
  return n._time != null ? n._time : null;
}

function rebuildHisto() {
  const bars = $('gtBars');
  bars.textContent = '';
  const times = engine.nodes.map(nodeTime).filter((t) => t != null);
  if (!times.length) {
    state.histo = null;
    $('twLabel').textContent = '（无时间数据）';
    $('t0Label').textContent = '';
    $('t1Label').textContent = '';
    $('twWindow').style.display = 'none';
    return;
  }
  let min = Math.min(...times);
  let max = Math.max(...times);
  if (min === max) { min -= 86400000; max += 86400000; }

  // 跨度 ≤62 天按天聚合，否则按周
  const spanDays = (max - min) / 86400000;
  const unitMs = spanDays <= 62 ? 86400000 : 7 * 86400000;
  const b0 = Math.floor(min / unitMs) * unitMs;
  const b1 = Math.floor(max / unitMs) * unitMs;
  const counts = new Map();
  for (const t of times) {
    const b = Math.floor(t / unitMs) * unitMs;
    counts.set(b, (counts.get(b) || 0) + 1);
  }
  const buckets = [];
  let maxCount = 1;
  for (let b = b0; b <= b1; b += unitMs) {
    const c = counts.get(b) || 0;
    if (c > maxCount) maxCount = c;
    buckets.push({ start: b, end: b + unitMs, count: c });
  }
  state.histo = { min: b0, max: b1 + unitMs, buckets };

  for (const bk of buckets) {
    const bar = el('div', 'gt-bar');
    bar.style.height = `${Math.max(6, Math.round((bk.count / maxCount) * 100))}%`;
    bar.title = `${fmtTime(bk.start)} · ${bk.count} 个节点`;
    bar.dataset.start = String(bk.start);
    bar.dataset.end = String(bk.end);
    bars.append(bar);
  }
  $('t0Label').textContent = fmtTime(state.histo.min);
  $('t1Label').textContent = fmtTime(state.histo.max);
  applyTimeWindow();
}

function sliderToTime(v) {
  const h = state.histo;
  return h.min + ((h.max - h.min) * v) / 1000;
}

function applyTimeWindow(from) {
  if (!state.histo) return;
  const minEl = $('twMin'), maxEl = $('twMax');
  let v0 = Number(minEl.value), v1 = Number(maxEl.value);
  if (v0 > v1) {
    if (from === 'min') { maxEl.value = String(v0); v1 = v0; }
    else { minEl.value = String(v1); v0 = v1; }
  }
  const win = $('twWindow');
  if (v0 === 0 && v1 === 1000) {
    engine.setTimeWindow(null);
    state.timeWindow = null;
    $('twLabel').textContent = '全时段';
    win.style.display = 'none';
  } else {
    const t0 = sliderToTime(v0), t1 = sliderToTime(v1);
    engine.setTimeWindow([t0, t1]);
    state.timeWindow = [t0, t1];
    $('twLabel').textContent = `${fmtTime(t0)} ~ ${fmtTime(t1)}`;
    win.style.display = 'block';
    win.style.left = `${v0 / 10}%`;
    win.style.width = `${(v1 - v0) / 10}%`;
  }
  // 直方图柱着色：窗外灰色
  for (const bar of $('gtBars').children) {
    const bs = Number(bar.dataset.start), be = Number(bar.dataset.end);
    const inWin = !state.timeWindow || (be > state.timeWindow[0] && bs < state.timeWindow[1]);
    bar.classList.toggle('out', !inWin);
  }
}

function resetTimeWindow() {
  $('twMin').value = '0';
  $('twMax').value = '1000';
  applyTimeWindow();
}

/* ------------------------------------------------------------
   10. 场景（保存 / 加载 / 导出 / 导入）
   ------------------------------------------------------------ */

function loadScenes() {
  try { return JSON.parse(localStorage.getItem(SCENE_KEY)) || {}; }
  catch (_) { return {}; }
}

function saveScenes(s) {
  try { localStorage.setItem(SCENE_KEY, JSON.stringify(s)); } catch (_) { /* 容量满忽略 */ }
}

function snapshotScene(name) {
  return {
    name,
    nodeIds: engine.nodes.map((n) => ({ id: n.id, kind: n.kind })),
    camera: { x: engine.cam.x, y: engine.cam.y, z: engine.cam.z },
    filters: JSON.parse(JSON.stringify(state.filters)),
    hidden: [...state.hidden],
    timeWindow: state.timeWindow,
    savedAt: new Date().toISOString(),
  };
}

async function loadSceneData(sc) {
  exitTrace(true);
  engine.setData([]);
  state.master.nodes.clear();   // 清空历史全集：场景加载必须是干净画面
  state.master.edges.clear();
  state.collapsed.clear();
  state.expandedFrom.clear();
  state.hidden = new Set(sc.hidden || []);
  if (sc.filters) {
    state.filters = Object.assign(state.filters, JSON.parse(JSON.stringify(sc.filters)));
    syncFilterUI();
  }

  let missing = 0;
  const refs = sc.nodeIds || [];
  for (const ref of refs) {
    try {
      const d = await api(`/api/graph/expand/${ref.kind}/${encodeURIComponent(ref.id)}`);
      addToGraph([d.node, ...d.nodes], d.edges, { defer: true });
    } catch (_) {
      missing++;
    }
  }
  applyFilters();

  if (sc.camera) {
    engine.cam.x = Number(sc.camera.x) || 0;
    engine.cam.y = Number(sc.camera.y) || 0;
    engine.cam.z = Math.min(4, Math.max(0.15, Number(sc.camera.z) || 1));
  } else {
    engine.zoomToFit(false);
  }

  if (sc.timeWindow && state.histo) {
    const [t0, t1] = sc.timeWindow;
    const h = state.histo;
    $('twMin').value = String(Math.round(((t0 - h.min) / (h.max - h.min)) * 1000));
    $('twMax').value = String(Math.round(((t1 - h.min) / (h.max - h.min)) * 1000));
    applyTimeWindow();
  } else {
    resetTimeWindow();
  }

  state.currentScene = sc.name || null;
  const n = engine.nodes.length;
  toast(missing
    ? `场景「${sc.name}」已加载（${n} 节点，${missing} 个已不存在）`
    : `场景「${sc.name}」已加载（${n} 节点）`);
}

/** 过滤器 UI ↔ state.filters 同步 */
function syncFilterUI() {
  for (const lab of document.querySelectorAll('.bf-check')) {
    const k = lab.dataset.kind;
    lab.querySelector('input').checked = !!state.filters.kinds[k];
  }
  for (const chip of $('sigStateChips').querySelectorAll('.chip')) {
    chip.classList.toggle('on', !!state.filters.sigStates[chip.dataset.state]);
  }
  $('objTypeSel').value = state.filters.objType || '';
  for (const b of $('sizingSeg').querySelectorAll('button')) {
    b.classList.toggle('on', b.dataset.mode === state.filters.sizing);
  }
  engine.setSizing(state.filters.sizing);
  $('dimIsolated').checked = !!state.filters.dimIsolated;
}

function openSceneMenu() {
  const menu = $('sceneMenu');
  if (!menu.hidden) { closeSceneMenu(); return; }
  menu.textContent = '';

  const scenes = loadScenes();
  const names = Object.keys(scenes).sort((a, b) =>
    String(scenes[b].savedAt).localeCompare(String(scenes[a].savedAt)));

  if (names.length) {
    menu.append(el('div', 'dd-title', '已存场景'));
    for (const name of names) {
      const row = el('div', 'dd-scene');
      const load = el('button', 'mi', name);
      load.title = `保存于 ${scenes[name].savedAt || ''}`;
      load.addEventListener('click', async () => {
        closeSceneMenu();
        showLoading(true);
        try { await loadSceneData(scenes[name]); }
        catch (err) { toast(`场景加载失败：${err.message}`); }
        finally { showLoading(false); }
      });
      const del = el('button', 'dd-del', '×');
      del.title = '删除场景';
      del.addEventListener('click', () => {
        const s = loadScenes();
        delete s[name];
        saveScenes(s);
        if (state.currentScene === name) state.currentScene = null;
        closeSceneMenu();
        openSceneMenu();
      });
      row.append(load, del);
      menu.append(row);
    }
    menu.append(el('div', 'sep'));
  }

  const addItem = (label, fn) => {
    const b = el('button', 'mi', label);
    b.addEventListener('click', () => { closeSceneMenu(); fn(); });
    menu.append(b);
  };

  addItem('保存场景', () => {
    if (!engine.nodes.length) { toast('画布为空，无可保存内容'); return; }
    let name = state.currentScene;
    if (!name) name = window.prompt('场景名称：', `场景 ${new Date().toLocaleString()}`);
    if (!name) return;
    const s = loadScenes();
    s[name] = snapshotScene(name);
    saveScenes(s);
    state.currentScene = name;
    toast(`场景「${name}」已保存`);
  });
  addItem('另存为…', () => {
    if (!engine.nodes.length) { toast('画布为空，无可保存内容'); return; }
    const name = window.prompt('另存为场景名称：', state.currentScene ? `${state.currentScene} 副本` : '');
    if (!name) return;
    const s = loadScenes();
    s[name] = snapshotScene(name);
    saveScenes(s);
    state.currentScene = name;
    toast(`场景「${name}」已保存`);
  });
  addItem('导出 JSON', () => {
    const data = snapshotScene(state.currentScene || `BGO 场景 ${new Date().toLocaleString()}`);
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `bgo-scene-${Date.now()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    toast('场景 JSON 已导出');
  });
  addItem('导入 JSON…', () => { $('importFile').click(); });
  menu.append(el('div', 'sep'));
  addItem('清空画布', () => { clearAll(); toast('画布已清空'); });

  menu.hidden = false;
}

function closeSceneMenu() { $('sceneMenu').hidden = true; }

/* ------------------------------------------------------------
   11. 杂项 UI（toast / 空态 / 加载 / 提示 / 折叠 / 键盘）
   ------------------------------------------------------------ */

function toast(msg, type) {
  const box = $('toasts');
  const t = el('div', 'bgo-toast' + (type === 'warn' ? ' warn' : ''), msg);
  box.append(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => {
    t.classList.add('fade');
    setTimeout(() => t.remove(), 400);
  }, type === 'warn' ? 3000 : 1600); // warn 停留更久
}

/** 搜索未命中：搜索框抖动反馈 */
function flashSearchMiss() {
  const box = $('searchInput').closest('.bgo-search');
  if (!box) return;
  box.classList.remove('miss');
  void box.offsetWidth; // 重启动画
  box.classList.add('miss');
  setTimeout(() => box.classList.remove('miss'), 700);
}

function showLoading(on) { $('loading').hidden = !on; }

function updateEmptyState() {
  $('emptyState').hidden = engine.nodes.length !== 0;
}

function renderTip(nd, x, y) {
  const tip = $('tip');
  if (!nd || state.trace) { tip.hidden = true; return; }
  tip.textContent = '';
  tip.append(el('span', `tt-kind ${KIND_BADGE_CLS[nd.kind]}`, nd.kind));
  tip.append(el('div', 'tt-label', nd.label || nd.id));
  const meta = el('div', 'tt-meta');
  const rows = [];
  if (nd.state) rows.push(['状态', nd.state]);
  if (nd.type) rows.push(['类型', nd.type]);
  const ts = nd.captured_at ?? nd.occurred_at ?? nd.created_at;
  if (ts) rows.push(['时间', fmtTime(ts)]);
  if (typeof nd.confidence === 'number') rows.push(['置信度', String(nd.confidence)]);
  rows.push(['连接度', String(nd.degree || 0)]);
  for (const [k, v] of rows) {
    const r = el('div');
    r.append(el('span', 'k', k), document.createTextNode(v));
    meta.append(r);
  }
  tip.append(meta);
  tip.hidden = false;
  const wrap = $('wrap').getBoundingClientRect();
  const tw = tip.offsetWidth, th = tip.offsetHeight;
  tip.style.left = `${Math.max(4, Math.min(x + 14, wrap.width - tw - 4))}px`;
  tip.style.top = `${Math.max(4, Math.min(y + 14, wrap.height - th - 4))}px`;
}

/* ----- 事件绑定 ----- */

function bindEvents() {
  // 搜索
  $('searchInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); doSearch(); }
  });

  // 模式切换
  for (const b of $('modeSeg').querySelectorAll('button')) {
    b.addEventListener('click', () => setMode(b.dataset.mode));
  }

  // 场景
  $('sceneBtn').addEventListener('click', (e) => { e.stopPropagation(); openSceneMenu(); });
  document.addEventListener('click', (e) => {
    if (!$('sceneMenu').hidden && !e.target.closest('.bgo-scenebox')) closeSceneMenu();
    if (!$('menu').hidden && !e.target.closest('#menu')) closeMenu();
  });
  $('importFile').addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const text = await file.text();
      const sc = JSON.parse(text);
      if (!sc || !Array.isArray(sc.nodeIds)) throw new Error('不是有效的场景文件');
      showLoading(true);
      await loadSceneData(sc);
    } catch (err) {
      toast(`导入失败：${err.message}`);
    } finally {
      showLoading(false);
    }
  });

  // 空态示例
  for (const chip of $('emptyExamples').querySelectorAll('.be-chip')) {
    chip.addEventListener('click', () => {
      $('searchInput').value = chip.dataset.q;
      doSearch(chip.dataset.q);
    });
  }

  // 过滤器：类型复选
  for (const lab of document.querySelectorAll('.bf-check')) {
    lab.querySelector('input').addEventListener('change', (e) => {
      state.filters.kinds[lab.dataset.kind] = e.target.checked;
      applyFilters();
      updateEmptyState();
    });
  }
  // Signal 状态 chips
  for (const chip of $('sigStateChips').querySelectorAll('.chip')) {
    chip.addEventListener('click', () => {
      chip.classList.toggle('on');
      state.filters.sigStates[chip.dataset.state] = chip.classList.contains('on');
      applyFilters();
      updateEmptyState();
    });
  }
  // Object 类型下拉
  $('objTypeSel').addEventListener('change', (e) => {
    state.filters.objType = e.target.value;
    applyFilters();
    updateEmptyState();
  });
  // 尺寸分段
  for (const b of $('sizingSeg').querySelectorAll('button')) {
    b.addEventListener('click', () => {
      state.filters.sizing = b.dataset.mode;
      for (const x of $('sizingSeg').querySelectorAll('button')) x.classList.toggle('on', x === b);
      engine.setSizing(b.dataset.mode);
    });
  }
  // 淡出孤立节点
  $('dimIsolated').addEventListener('change', (e) => {
    state.filters.dimIsolated = e.target.checked;
    applyDimIsolated();
  });

  // 时间窗
  $('twMin').addEventListener('input', () => applyTimeWindow('min'));
  $('twMax').addEventListener('input', () => applyTimeWindow('max'));
  $('twReset').addEventListener('click', resetTimeWindow);

  // 追溯退出
  $('traceExit').addEventListener('click', () => exitTrace());

  // 面板折叠
  $('filterCollapse').addEventListener('click', () => {
    $('filterPanel').hidden = true;
    if (state.mode === 'judge') $('reopenFilters').hidden = false;
  });
  $('reopenFilters').addEventListener('click', () => {
    $('reopenFilters').hidden = true;
    if (state.mode === 'judge') $('filterPanel').hidden = false;
  });
  $('inspectorCollapse').addEventListener('click', () => {
    $('inspectorPanel').hidden = true;
    $('reopenInspector').hidden = false;
  });
  $('reopenInspector').addEventListener('click', () => {
    $('reopenInspector').hidden = true;
    $('inspectorPanel').hidden = false;
  });

  // 键盘：Esc 退出追溯 / 关闭浮层（引擎自身 Esc 先执行：清选择/高亮/dim）
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    closeMenu();
    closeSceneMenu();
    if (state.trace) exitTrace();
    else applyDimIsolated(); // 引擎 Esc 清了 dim，按需恢复孤立降噪
  });
}

/* ------------------------------------------------------------
   12. 启动
   ------------------------------------------------------------ */

async function init() {
  bindEvents();
  showLoading(true);
  try {
    const stats = await api('/api/graph/stats');
    const total = Object.values(stats.kind_counts || {}).reduce((a, b) => a + b, 0);

    // Object 类型下拉选项
    const objTypes = (stats.type_counts && stats.type_counts.Object) || {};
    const sel = $('objTypeSel');
    for (const t of Object.keys(objTypes).sort()) {
      const opt = el('option', null, `${t}（${objTypes[t]}）`);
      opt.value = t;
      sel.append(opt);
    }

    if (total > 0 && total <= 1500) {
      const g = await api('/api/graph');
      addToGraph(g.nodes, g.edges, { fade: false });
      engine.zoomToFit();
      if (g.truncated) toast(`图较大，已截断显示 ${g.nodes.length}/${g.total} 节点`);
    } else if (total > 1500) {
      updateEmptyState(); // Bloom 式搜索引导空态
    } else {
      updateEmptyState();
    }
    updateFilterCounts();
  } catch (err) {
    toast(`初始化失败：${err.message}`);
    updateEmptyState();
  } finally {
    showLoading(false);
  }
}

init();
