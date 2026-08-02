/**
 * 追溯 · Trace
 *
 * - 左栏：Signal 列表（状态筛选 / 类型徽标 / confidence / 捕获时间）
 * - 右栏：GET /api/signals/:id/trace 全链路视图
 *   · Signal 根节点（元数据 + 锚定 Object 链接到对象全景）
 *   · 每条链：Fragment 层（定位信息）→ Evidence 层（原文 + 片段高亮）
 * - 支持 ?id=SIG-xxx 深链（供对象全景 / 其他页面跳转）
 */

import { signals, ApiError } from './api.js';

const STATE_FILTERS = ['全部', 'Captured', 'Verified', 'Invalid', 'Archived'];
const HL = { bg: '#f2e0cc', border: '#a67c52' };

let sigList = [];
let selectedId = null;
let stateFilter = '全部';

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

/* ---------- 状态筛选 ---------- */
function renderFilter() {
  const el = document.getElementById('state-filter');
  el.innerHTML = STATE_FILTERS.map(
    (s) =>
      `<span class="f-chip${s === stateFilter ? ' on' : ''}" data-state="${esc(s)}">${esc(s)}</span>`,
  ).join('');
  el.querySelectorAll('.f-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      stateFilter = chip.dataset.state;
      renderFilter();
      renderList();
    });
  });
}

/* ---------- 列表 ---------- */
function filteredList() {
  if (stateFilter === '全部') return sigList;
  return sigList.filter((s) => s.state === stateFilter);
}

function renderList() {
  const list = filteredList();
  document.getElementById('sig-count').textContent = `共 ${list.length} 条`;
  const listEl = document.getElementById('sig-list');
  if (!list.length) {
    listEl.innerHTML = '<p class="notice">当前筛选下暂无 Signal。</p>';
    return;
  }
  listEl.innerHTML = list
    .map(
      (s) => `<div class="ev-item${s.id === selectedId ? ' selected' : ''}" data-id="${esc(s.id)}">
      <div class="ev-head">
        <span class="ev-id mono">${esc(s.id)}</span>
        <span class="badge signal">${esc(s.type)}</span>
      </div>
      <div class="ev-preview">${esc(s.body)}</div>
      <div class="sig-meta">
        <span>${fmtTime(s.captured_at)}</span>
        <span>
          conf <span class="conf">${fmtConf(s.confidence)}</span>
          <span class="badge st-${esc(s.state)}">${esc(s.state)}</span>
        </span>
      </div>
    </div>`,
    )
    .join('');
  listEl.querySelectorAll('.ev-item').forEach((el) => {
    el.addEventListener('click', () => select(el.dataset.id));
  });
}

/* ---------- 证据链渲染 ---------- */
const ARROW_SVG =
  '<svg width="12" height="16" viewBox="0 0 12 16"><path d="M6 1 V12 M2 9 L6 13 L10 9" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';

function connector(text) {
  return `<div class="tier-connector">${ARROW_SVG}<span>${esc(text)}</span></div>`;
}

function fragLocText(f, position) {
  const parts = [];
  if (position) parts.push(`offset ${position.start}–${position.end}`);
  if (f.speaker) parts.push(`说话人：${f.speaker}`);
  if (f.page !== undefined && f.page !== null) parts.push(`页码：${f.page}`);
  if (f.section) parts.push(`章节：${f.section}`);
  if (f.timestamp_start)
    parts.push(`时间戳：${f.timestamp_start}${f.timestamp_end ? '–' + f.timestamp_end : ''}`);
  return parts.join(' · ') || '无定位信息';
}

/* Evidence 原文 + 当前 Fragment 高亮 */
function renderEvidenceText(evidence, fragment, position) {
  const text = evidence.content;
  let start = -1;
  let end = -1;
  if (
    position &&
    Number.isInteger(position.start) &&
    Number.isInteger(position.end) &&
    position.end <= text.length &&
    text.slice(position.start, position.end) === fragment.content
  ) {
    start = position.start;
    end = position.end;
  } else {
    start = text.indexOf(fragment.content);
    if (start >= 0) end = start + fragment.content.length;
  }
  if (start < 0) {
    return `<div class="evidence-text trace-evidence-text">${esc(text)}</div>
      <p class="notice" style="margin-top:4px">Fragment 内容未能在原文中定位（可能来自附件）。</p>`;
  }
  const html =
    esc(text.slice(0, start)) +
    `<mark class="hl" style="background:${HL.bg};border-color:${HL.border}" data-tip="${esc(
      `${fragment.id}\noffset ${start}–${end}`,
    )}">${esc(text.slice(start, end))}</mark>` +
    esc(text.slice(end));
  return `<div class="evidence-text trace-evidence-text">${html}</div>`;
}

function renderChain(trace) {
  const sig = trace.signal;

  const anchors = (sig.anchors || [])
    .map(
      (a) =>
        `<a class="anchor-link" href="./objects.html?id=${encodeURIComponent(a)}" data-tip="前往对象全景查看 ${esc(a)}"><span class="badge object">${esc(a)}</span></a>`,
    )
    .join(' ');

  const ctx = sig.context || {};
  const ctxText = ['channel', 'source', 'organization', 'location', 'meeting', 'document', 'system']
    .filter((k) => ctx[k])
    .map((k) => `${k}: ${ctx[k]}`)
    .join(' · ');

  const metaRows = [
    ['类型', `<span class="badge signal">${esc(sig.type)}</span>`],
    ['状态', `<span class="badge st-${esc(sig.state)}">${esc(sig.state)}</span>`],
    ['confidence', `<span class="num">${fmtConf(sig.confidence)}</span>`],
    ['捕获时间', fmtTime(sig.captured_at)],
    ['发生时间', sig.occurred_at ? fmtTime(sig.occurred_at) : '—'],
    ['相关者', (sig.actors || []).join('、') || '—'],
    ['锚定 Object', anchors || '—'],
    ['Context', esc(ctxText) || '—'],
  ]
    .map(([k, v]) => `<div><span class="mk">${k}：</span><span class="mv">${v}</span></div>`)
    .join('');

  if (!trace.chain.length) {
    return `
      <div class="detail-head"><span class="d-id mono">${esc(sig.id)}</span></div>
      <div class="meta-grid">${metaRows}</div>
      <p class="notice">该 Signal 的 Fragment 引用均无法解析（数据可能不完整）。</p>`;
  }

  const branches = trace.chain
    .map(({ fragment, evidence, position }) => {
      return `<div class="chain-branch">
        <div class="tier t-fragment">
          <div class="tier-label">
            <span>FRAGMENT · <span class="tier-id mono">${esc(fragment.id)}</span></span>
            <span><span class="badge fragment">${esc(fragment.type)}</span> <span class="badge st-${esc(fragment.state)}">${esc(fragment.state)}</span></span>
          </div>
          <div class="tier-body">「${esc(fragment.content)}」</div>
          <div class="tier-label" style="margin-top:4px"><span>${esc(fragLocText(fragment, position))}</span><span class="mono">checksum ${esc(fragment.checksum).slice(0, 12)}…</span></div>
        </div>
        ${connector(`来自 Evidence ${evidence.id}`)}
        <div class="tier t-evidence">
          <div class="tier-label">
            <span>EVIDENCE · <span class="tier-id mono">${esc(evidence.id)}</span></span>
            <span><span class="badge evidence">${esc(evidence.source)}</span> <span class="badge st-${esc(evidence.state)}">${esc(evidence.state)}</span></span>
          </div>
          <div class="tier-label" style="margin-top:2px"><span>${fmtTime(evidence.created_at)}</span><span class="mono" data-tip="${esc(evidence.checksum)}">checksum ${esc(evidence.checksum).slice(0, 12)}…</span></div>
          ${renderEvidenceText(evidence, fragment, position)}
        </div>
      </div>`;
    })
    .join('');

  return `
    <div class="detail-head">
      <span class="d-id mono">${esc(sig.id)}</span>
      <span class="badge signal">${esc(sig.type)}</span>
      <span class="badge st-${esc(sig.state)}">${esc(sig.state)}</span>
    </div>
    <div class="meta-grid">${metaRows}</div>

    <div class="chain-root">
      <div class="tier t-signal">
        <div class="tier-label"><span>SIGNAL · 业务观察（${trace.chain.length} 条证据链）</span></div>
        <div class="tier-body">「${esc(sig.body)}」</div>
      </div>
    </div>
    ${connector('支撑 Fragment ↓')}
    ${branches}
    <p class="notice">链路完整性：Signal ← ${trace.fragments.length} Fragment ← ${trace.evidences.length} Evidence。Evidence / Fragment 原文不可变，checksum 可在证据库页校验。</p>`;
}

/* ---------- 详情 ---------- */
async function select(id) {
  selectedId = id;
  renderList();
  const placeholder = document.getElementById('detail-placeholder');
  const body = document.getElementById('detail-body');
  placeholder.hidden = false;
  placeholder.textContent = '加载中…';
  body.hidden = true;

  try {
    const trace = await signals.trace(id);
    body.innerHTML = renderChain(trace);
    placeholder.hidden = true;
    body.hidden = false;
  } catch (e) {
    placeholder.textContent = '追溯加载失败。';
    showError(e);
  }
}

/* ---------- 入口 ---------- */
async function main() {
  try {
    sigList = await signals.list();
    sigList.sort((a, b) => String(b.captured_at).localeCompare(String(a.captured_at)));
    renderFilter();
    renderList();

    const params = new URLSearchParams(window.location.search);
    const deepId = params.get('id');
    if (deepId && sigList.some((s) => s.id === deepId)) {
      select(deepId);
    } else if (deepId) {
      // 深链指向的 Signal 不在列表中（可能被筛选排除），仍尝试直接追溯
      select(deepId);
    } else if (sigList.length) {
      select(sigList[0].id);
    }
  } catch (e) {
    showError(e);
  }
}

main();
