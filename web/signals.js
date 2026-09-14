/**
 * Signal 工作台 · Workbench
 *
 * - 状态四列看板：待核 / 已核 / 无效 / 已归档
 *   · 卡片：类型徽标（五色低饱和）/ body 摘要 / 置信度（等宽数字）/ captured_at / 锚定对象数与片段数
 *   · 列头计数；类型下拉过滤 + 置信度排序切换 + body 关键词搜索
 * - 状态机即 UI（协议 6.3 / 第 11 节）：
 *   · Captured：「核认」「标记无效」
 *   · Verified：「归档」
 *   · Invalid / Archived：无操作仅展示（协议禁止物理删除，AC-011）
 *   · 操作前 confirm，成功后本地更新状态并重排看板（无刷新）
 * - 卡片下钻：
 *   · 「追溯 →」trace.html?id=<signalId>
 *   · 「Fragment」展开区：GET :id/fragments（类型 / offset / 说话人）
 *   · 锚定 Object 徽标点击跳 objects.html?id=<objectId>
 * - Context 七字段（空值不显示）+ occurred_at + actors
 * - 支持 ?id=SIG-xxx 深链：定位并高亮卡片（供录入台回执跳转）
 * - 空库引导：链接 intake.html 录入台
 */

import { signals, ApiError } from './api.js';

const COLUMNS = [
  { state: 'Captured', label: '待核', tip: '新捕获的观察，等待人工或可信规则核认' },
  { state: 'Verified', label: '已核', tip: '已由人工或可信规则确认' },
  { state: 'Invalid', label: '无效', tip: '错误识别。协议禁止物理删除，仅状态留存' },
  { state: 'Archived', label: '已归档', tip: '历史失效。协议禁止物理删除，仅状态留存' },
];

/** 展示层中文映射：数据值 / value / data-* 一律保持英文，未命中原样显示 */
const SIGTYPE_CN = {
  observation: '观察', event: '事件', change: '变更', status: '状态', action: '行动',
};
const FRAGTYPE_CN = {
  Speech: '发言', Text: '文本', Table: '表格', Image: '图像',
  Document: '文档', Data: '数据', Code: '代码', Other: '其他',
};
const CTXKEY_CN = {
  channel: '渠道', source: '来源', organization: '组织', location: '地点',
  meeting: '会议', document: '文档', system: '系统',
};
const zh = (map, v) => map[v] || v;

const CTX_KEYS = ['channel', 'source', 'organization', 'location', 'meeting', 'document', 'system'];

let sigList = [];
let typeFilter = '全部';
let sortMode = 'time';
let keyword = '';
let deepId = null;
const fragCache = new Map(); // signalId -> Fragment[]

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return isNaN(d) ? iso : d.toLocaleString('zh-CN', { hour12: false });
}

function fmtConf(c) {
  return typeof c === 'number' ? c.toFixed(2) : '—';
}

function showError(e) {
  const errEl = document.getElementById('error');
  errEl.hidden = false;
  errEl.textContent =
    e instanceof ApiError ? `[${e.code}] ${e.message}` : `请求失败：${e.message}`;
}

/* ---------- 过滤 + 排序 ---------- */
function visibleList() {
  const kw = keyword.trim().toLowerCase();
  let list = sigList.filter(
    (s) =>
      (typeFilter === '全部' || s.type === typeFilter) &&
      (!kw || String(s.body || '').toLowerCase().includes(kw)),
  );
  list = list.slice();
  if (sortMode === 'conf-desc') {
    list.sort((a, b) => (b.confidence ?? -1) - (a.confidence ?? -1));
  } else if (sortMode === 'conf-asc') {
    list.sort((a, b) => (a.confidence ?? 2) - (b.confidence ?? 2));
  } else {
    list.sort((a, b) => String(b.captured_at).localeCompare(String(a.captured_at)));
  }
  return list;
}

/* ---------- Context 七字段（空值不显示）+ occurred_at + actors ---------- */
function renderContext(s) {
  const ctx = s.context || {};
  const parts = CTX_KEYS.filter((k) => ctx[k]).map(
    (k) => `<span class="ck">${zh(CTXKEY_CN, k)}:</span> <span class="cv">${esc(ctx[k])}</span>`,
  );
  if (s.occurred_at) {
    parts.push(`<span class="ck">发生时间:</span> <span class="cv num">${fmtTime(s.occurred_at)}</span>`);
  }
  if ((s.actors || []).length) {
    parts.push(`<span class="ck">相关者:</span> <span class="cv">${esc(s.actors.join('、'))}</span>`);
  }
  if (!parts.length) return '';
  return `<div class="sc-ctx">${parts.join(' · ')}</div>`;
}

/* ---------- 状态机即 UI：操作按钮按状态动态可用 ---------- */
function renderActions(s) {
  if (s.state === 'Captured') {
    return `<div class="sc-actions">
      <button class="btn small btn-verify" data-act="verify" data-id="${esc(s.id)}" data-tip="待核 → 已核&#10;人工或可信规则确认">核认</button>
      <button class="btn small btn-invalid" data-act="invalid" data-id="${esc(s.id)}" data-tip="待核 → 无效&#10;错误识别标记，协议禁止物理删除">标记无效</button>
    </div>`;
  }
  if (s.state === 'Verified') {
    return `<div class="sc-actions">
      <button class="btn small btn-archive" data-act="archive" data-id="${esc(s.id)}" data-tip="已核 → 已归档&#10;历史失效归档，协议禁止物理删除">归档</button>
    </div>`;
  }
  // Invalid / Archived：无操作仅展示
  return `<div class="sc-actions"><span class="sc-noop">仅展示 · 协议禁止物理删除（AC-011）</span></div>`;
}

/* ---------- 卡片 ---------- */
function renderCard(s) {
  const anchors = (s.anchors || [])
    .map(
      (a) =>
        `<a href="./objects.html?id=${encodeURIComponent(a)}" data-tip="前往对象全景查看 ${esc(a)}"><span class="badge object">${esc(a)}</span></a>`,
    )
    .join(' ');
  const typeCls = ['observation', 'event', 'change', 'status', 'action'].includes(s.type)
    ? `sig-${s.type}`
    : 'signal';

  return `<div class="sig-card${s.id === deepId ? ' hl' : ''}" data-id="${esc(s.id)}">
    <div class="sc-head">
      <span class="sc-id mono">${esc(s.id)}</span>
      <span class="badge ${typeCls}">${esc(zh(SIGTYPE_CN, s.type))}</span>
    </div>
    <div class="sc-body">${esc(s.body)}</div>
    <div class="sc-meta">
      <span>置信度 <span class="num">${fmtConf(s.confidence)}</span></span>
      <span>${fmtTime(s.captured_at)}</span>
    </div>
    <div class="sc-anchors">
      锚定 <span class="num">${(s.anchors || []).length}</span> 个对象 ${anchors}
      · <span class="num">${(s.fragments || []).length}</span> 条片段
    </div>
    ${renderContext(s)}
    ${renderActions(s)}
    <div class="sc-foot">
      <button class="frag-toggle" data-id="${esc(s.id)}">Fragment ▸</button>
      <a href="./trace.html?id=${encodeURIComponent(s.id)}" data-tip="Signal → Fragment → Evidence 全链路追溯">追溯 →</a>
    </div>
    <div class="sc-frags" hidden></div>
  </div>`;
}

/* ---------- 看板 ---------- */
function renderBoard() {
  const list = visibleList();
  document.getElementById('total-count').textContent =
    `共 ${list.length} / ${sigList.length} 条`;
  const board = document.getElementById('board');

  board.innerHTML = COLUMNS.map((col) => {
    const cards = list.filter((s) => s.state === col.state);
    return `<div class="board-col col-${col.state}">
      <div class="col-head" data-tip="${esc(col.tip)}">
        <span class="col-name">${col.label}</span>
        <span class="col-count num">${cards.length}</span>
      </div>
      ${
        cards.length
          ? cards.map(renderCard).join('')
          : '<div class="col-empty">本列暂无 Signal</div>'
      }
    </div>`;
  }).join('');

  // 状态操作
  board.querySelectorAll('button[data-act]').forEach((btn) => {
    btn.addEventListener('click', () => doTransition(btn.dataset.id, btn.dataset.act));
  });
  // Fragment 展开
  board.querySelectorAll('.frag-toggle').forEach((btn) => {
    btn.addEventListener('click', () => toggleFragments(btn));
  });

  // 深链卡片滚动到可视区域
  if (deepId) {
    const hl = board.querySelector(`.sig-card[data-id="${CSS.escape(deepId)}"]`);
    if (hl) hl.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
}

/* ---------- 状态流转（confirm + 无刷新更新） ---------- */
async function doTransition(id, act) {
  const confirms = {
    verify: `确认核认 ${id}？\n状态流转 待核 → 已核（人工或可信规则确认）。记录完整保留，不涉及删除。`,
    invalid: `确认标记 ${id} 为无效？\n「无效」表示错误识别。协议禁止物理删除 Signal（AC-011），本操作仅为状态流转 待核 → 无效。`,
    archive: `确认归档 ${id}？\n「已归档」表示历史失效，不再作为当前有效现实。协议禁止物理删除 Signal（AC-011），本操作仅为状态流转 已核 → 已归档。`,
  };
  if (!window.confirm(confirms[act])) return;

  try {
    let updated;
    if (act === 'verify') updated = await signals.verify(id);
    else if (act === 'invalid') updated = await signals.invalid(id);
    else updated = await signals.archive(id);

    const idx = sigList.findIndex((s) => s.id === id);
    if (idx >= 0) sigList[idx] = updated;
    renderBoard();
  } catch (e) {
    showError(e);
  }
}

/* ---------- Fragment 展开区 ---------- */
function fragLocText(f) {
  const parts = [];
  if (f.start_offset !== undefined && f.start_offset !== null) {
    parts.push(`offset ${f.start_offset}–${f.end_offset ?? '?'}`);
  }
  if (f.speaker) parts.push(`说话人：${f.speaker}`);
  if (f.page !== undefined && f.page !== null) parts.push(`页码：${f.page}`);
  if (f.section) parts.push(`章节：${f.section}`);
  if (f.timestamp_start) {
    parts.push(`时间戳：${f.timestamp_start}${f.timestamp_end ? '–' + f.timestamp_end : ''}`);
  }
  return parts.join(' · ') || '无定位信息';
}

function renderFragRows(frags) {
  if (!frags.length) return '<p class="frag-loading">该 Signal 的 Fragment 引用均无法解析。</p>';
  return frags
    .map(
      (f) => `<div class="frag-row">
      <div class="fr-main">
        <span class="fr-id mono">${esc(f.id)}</span>
        <span class="badge fragment">${esc(zh(FRAGTYPE_CN, f.type))}</span>
        <div class="fr-content">「${esc(f.content)}」</div>
        <div class="fr-meta">${esc(fragLocText(f))} · Evidence <span class="mono">${esc(f.evidence_id)}</span></div>
      </div>
    </div>`,
    )
    .join('');
}

async function toggleFragments(btn) {
  const id = btn.dataset.id;
  const card = btn.closest('.sig-card');
  const box = card.querySelector('.sc-frags');
  const opening = box.hidden;
  box.hidden = !opening;
  btn.textContent = opening ? 'Fragment ▾' : 'Fragment ▸';
  if (!opening) return;

  if (fragCache.has(id)) {
    box.innerHTML = renderFragRows(fragCache.get(id));
    return;
  }
  box.innerHTML = '<p class="frag-loading">加载 Fragment…</p>';
  try {
    const frags = await signals.fragments(id);
    fragCache.set(id, frags);
    box.innerHTML = renderFragRows(frags);
  } catch (e) {
    box.innerHTML = '<p class="frag-loading">Fragment 加载失败。</p>';
    showError(e);
  }
}

/* ---------- 工具条 ---------- */
function bindToolbar() {
  document.getElementById('type-filter').addEventListener('change', (e) => {
    typeFilter = e.target.value;
    renderBoard();
  });
  document.getElementById('sort-mode').addEventListener('change', (e) => {
    sortMode = e.target.value;
    renderBoard();
  });
  document.getElementById('kw').addEventListener('input', (e) => {
    keyword = e.target.value;
    renderBoard();
  });
}

/* ---------- 入口 ---------- */
async function main() {
  deepId = new URLSearchParams(window.location.search).get('id');
  bindToolbar();

  try {
    sigList = await signals.list();
  } catch (e) {
    showError(e);
    return;
  }

  if (!sigList.length) {
    document.getElementById('empty-guide').hidden = false;
    return;
  }

  document.getElementById('toolbar').hidden = false;
  document.getElementById('board-wrap').hidden = false;

  if (deepId && !sigList.some((s) => s.id === deepId)) {
    const errEl = document.getElementById('error');
    errEl.hidden = false;
    errEl.textContent = `深链定位失败：找不到 Signal ${deepId}（数据可能不完整）。`;
    deepId = null;
  }

  renderBoard();
}

main();
