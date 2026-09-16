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
import { domainBadges } from './domain-badges.js';
import { expIcon } from './explain.js';

/* chip 显示中文、data-state 保持英文（数据值不动） */
const STATE_FILTERS = [
  { v: '全部', zh: '全部' },
  { v: 'Captured', zh: '待核' },
  { v: 'Verified', zh: '已核' },
  { v: 'Invalid', zh: '无效' },
  { v: 'Archived', zh: '已归档' },
];
const HL = { bg: '#dde3ec', border: '#4a5568' };

/** 展示层中文映射：数据值 / data-* 一律保持英文，未命中原样显示 */
const STATE_CN = {
  Captured: '待核', Verified: '已核', Invalid: '无效', Archived: '已归档',
  Created: '已创建', Active: '活跃', Merged: '已合并',
};
const SIGTYPE_CN = {
  observation: '观察', event: '事件', change: '变更', status: '状态', action: '行动',
};
const FRAGTYPE_CN = {
  Speech: '发言', Text: '文本', Table: '表格', Image: '图像',
  Document: '文档', Data: '数据', Code: '代码', Other: '其他',
};
const SOURCE_CN = {
  feishu: '飞书', meeting: '会议', prd: 'PRD', email: '邮件', erp: 'ERP',
  jira: 'Jira', spreadsheet: '表格', agent: 'Agent 输出', ai: 'AI 输出',
  manual: '人工录入', other: '其他',
};
const CTXKEY_CN = {
  channel: '渠道', source: '来源', organization: '组织', location: '地点',
  meeting: '会议', document: '文档', system: '系统',
};
const zh = (map, v) => map[v] || v;

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
    (f) =>
      `<span class="f-chip${f.v === stateFilter ? ' on' : ''}" data-state="${esc(f.v)}">${esc(f.zh)}</span>`,
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
        <span class="badge signal">${esc(zh(SIGTYPE_CN, s.type))}</span>
      </div>
      <div class="ev-preview">${esc(s.body)}</div>
      <div class="sig-meta">
        <span>${fmtTime(s.captured_at)}</span>
        <span>
          置信度${expIcon('confidence')} <span class="conf">${fmtConf(s.confidence)}</span>
          <span class="badge st-${esc(s.state)}">${esc(zh(STATE_CN, s.state))}</span>
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
    .map((k) => `${zh(CTXKEY_CN, k)}: ${ctx[k]}`)
    .join(' · ');

  const metaRows = [
    ['类型' + expIcon('signal-type'), `<span class="badge signal">${esc(zh(SIGTYPE_CN, sig.type))}</span>`],
    ['状态' + expIcon('state-machine'), `<span class="badge st-${esc(sig.state)}">${esc(zh(STATE_CN, sig.state))}</span>`],
    ['板块' + expIcon('domain'), domainBadges(sig.domains, sig.primary_domain) || '—'],
    ['置信度' + expIcon('confidence'), `<span class="num">${fmtConf(sig.confidence)}</span>`],
    ['捕获时间', fmtTime(sig.captured_at)],
    ['发生时间', sig.occurred_at ? fmtTime(sig.occurred_at) : '—'],
    ['相关者', (sig.actors || []).join('、') || '—'],
    ['锚定对象' + expIcon('anchor'), anchors || '—'],
    ['上下文' + expIcon('signal-context'), esc(ctxText) || '—'],
  ]
    .map(([k, v]) => `<div><span class="mk">${k}：</span><span class="mv">${v}</span></div>`)
    .join('');

  if (!trace.chain.length) {
    return `
      <div class="detail-head"><span class="d-id mono">${esc(sig.id)}</span></div>
      <div class="meta-grid">${metaRows}</div>
      <p class="notice">这条信号引用的关键句找不到了（数据可能不完整）。</p>`;
  }

  const branches = trace.chain
    .map(({ fragment, evidence, position }) => {
      return `<div class="chain-branch">
        <div class="tier t-fragment">
          <div class="tier-label">
            <span>关键句 FRAGMENT${expIcon('fragment')} · <span class="tier-id mono">${esc(fragment.id)}</span></span>
            <span><span class="badge fragment">${esc(zh(FRAGTYPE_CN, fragment.type))}</span> <span class="badge st-${esc(fragment.state)}">${esc(zh(STATE_CN, fragment.state))}</span></span>
          </div>
          <div class="tier-body">「${esc(fragment.content)}」</div>
          <div class="tier-label" style="margin-top:4px"><span>${esc(fragLocText(fragment, position))}</span><span class="mono">防伪指纹 ${esc(fragment.checksum).slice(0, 12)}…${expIcon('checksum')}</span></div>
        </div>
        ${connector(`来自原文 ${evidence.id}`)}
        <div class="tier t-evidence">
          <div class="tier-label">
            <span>原文 EVIDENCE${expIcon('evidence')} · <span class="tier-id mono">${esc(evidence.id)}</span></span>
            <span><span class="badge evidence">${esc(zh(SOURCE_CN, evidence.source))}</span> <span class="badge st-${esc(evidence.state)}">${esc(zh(STATE_CN, evidence.state))}</span></span>
          </div>
          <div class="tier-label" style="margin-top:2px"><span>${fmtTime(evidence.created_at)}</span><span class="mono" data-tip="${esc(evidence.checksum)}">防伪指纹 ${esc(evidence.checksum).slice(0, 12)}…</span></div>
          ${renderEvidenceText(evidence, fragment, position)}
        </div>
      </div>`;
    })
    .join('');

  return `
    <div class="detail-head">
      <span class="d-id mono">${esc(sig.id)}</span>
      <span class="badge signal">${esc(zh(SIGTYPE_CN, sig.type))}</span>
      <span class="badge st-${esc(sig.state)}">${esc(zh(STATE_CN, sig.state))}</span>
    </div>
    <div class="meta-grid">${metaRows}</div>

    <div class="chain-root">
      <div class="tier t-signal">
        <div class="tier-label"><span>信号 SIGNAL · 一条事实（${trace.chain.length} 条出处链）</span></div>
        <div class="tier-body">「${esc(sig.body)}」</div>
        ${(sig.domains || []).length ? `<div class="tier-doms">${domainBadges(sig.domains, sig.primary_domain)}</div>` : ''}
      </div>
    </div>
    ${connector('支撑它的关键句 ↓')}
    ${branches}
    <p class="notice">链路完整：1 条信号 ← ${trace.fragments.length} 句关键句 ← ${trace.evidences.length} 份原文。原文和关键句一经录入不可修改，防伪指纹可在「证据库」页随时校验。</p>`;
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
