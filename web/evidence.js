/**
 * V3 证据库
 *
 * - 左栏：Evidence 列表（来源徽标 / 时间 / checksum 状态 / 状态徽标）
 * - 右栏：详情视图
 *   · 元数据栅格
 *   · 原文 + Fragment 高亮叠加（每片一色，hover 显示 offset / 说话人 / 页码）
 *   · 校验 checksum（GET :id/verify）
 *   · 归档（PATCH :id/archive，确认后更新徽标）
 */

import { evidences, fragments, ApiError } from './api.js';

/* Fragment 高亮配色（每片一色，低饱和冷色 tint） */
const HL_PALETTE = [
  { bg: '#dde4ee', border: '#64748b' },
  { bg: '#f4ecd8', border: '#b7791f' },
  { bg: '#e0e8f1', border: '#4a5568' },
  { bg: '#dcebe4', border: '#52796f' },
  { bg: '#e6e6ea', border: '#718096' },
  { bg: '#e4e9f2', border: '#5d6d7e' },
];

/** 展示层中文映射：数据值 / data-* 一律保持英文，未命中原样显示 */
const STATE_CN = {
  Captured: '待核', Verified: '已核', Invalid: '无效', Archived: '已归档',
  Created: '已创建', Active: '活跃', Merged: '已合并',
};
const SOURCE_CN = {
  feishu: '飞书', meeting: '会议', prd: 'PRD', email: '邮件', erp: 'ERP',
  jira: 'Jira', spreadsheet: '表格', agent: 'Agent 输出', ai: 'AI 输出',
  manual: '人工录入', other: '其他',
};
const FRAGTYPE_CN = {
  Speech: '发言', Text: '文本', Table: '表格', Image: '图像',
  Document: '文档', Data: '数据', Code: '代码', Other: '其他',
};
const zh = (map, v) => map[v] || v;

let evList = [];
let selectedId = null;

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

function showError(e) {
  const errEl = document.getElementById('error');
  errEl.hidden = false;
  errEl.textContent =
    e instanceof ApiError ? `[${e.code}] ${e.message}` : `请求失败：${e.message}`;
}

/* ---------- 列表 ---------- */
function renderList() {
  document.getElementById('ev-count').textContent = `共 ${evList.length} 条`;
  const listEl = document.getElementById('ev-list');
  if (!evList.length) {
    listEl.innerHTML = '<p class="notice">暂无 Evidence。可通过 POST /api/evidences 录入第一条原始证据。</p>';
    return;
  }
  listEl.innerHTML = evList
    .map(
      (ev) => `<div class="ev-item${ev.id === selectedId ? ' selected' : ''}" data-id="${esc(ev.id)}">
      <div class="ev-head">
        <span class="ev-id mono">${esc(ev.id)}</span>
        <span class="badge evidence">${esc(zh(SOURCE_CN, ev.source))}</span>
      </div>
      <div class="ev-preview">${esc(ev.content)}</div>
      <div class="ev-foot">
        <span>${fmtTime(ev.created_at)}</span>
        <span>
          <span class="ck-dot" data-tip="checksum: ${esc(ev.checksum)}"></span>
          <span class="badge st-${esc(ev.state)}">${esc(zh(STATE_CN, ev.state))}</span>
        </span>
      </div>
    </div>`,
    )
    .join('');
  listEl.querySelectorAll('.ev-item').forEach((el) => {
    el.addEventListener('click', () => select(el.dataset.id));
  });
}

/* ---------- Fragment 定位 ---------- */
function locateFragments(evidence, frags) {
  const text = evidence.content;
  return frags
    .map((f, i) => {
      let start = -1;
      let end = -1;
      if (
        Number.isInteger(f.start_offset) &&
        Number.isInteger(f.end_offset) &&
        f.start_offset >= 0 &&
        f.end_offset > f.start_offset &&
        f.end_offset <= text.length &&
        text.slice(f.start_offset, f.end_offset) === f.content
      ) {
        start = f.start_offset;
        end = f.end_offset;
      } else {
        start = text.indexOf(f.content);
        if (start >= 0) end = start + f.content.length;
      }
      return { f, start, end, color: HL_PALETTE[i % HL_PALETTE.length] };
    })
    .filter((x) => x.start >= 0)
    .sort((a, b) => a.start - b.start);
}

function fragTip({ f, start, end }) {
  const parts = [`${f.id} · ${zh(FRAGTYPE_CN, f.type)}`, `offset ${start}–${end}`];
  if (f.speaker) parts.push(`说话人：${f.speaker}`);
  if (f.page !== undefined) parts.push(`页码：${f.page}`);
  if (f.timestamp_start) parts.push(`时间戳：${f.timestamp_start}${f.timestamp_end ? '–' + f.timestamp_end : ''}`);
  return parts.join('\n');
}

/* 原文 + 高亮叠加渲染（重叠片段取先出现者） */
function renderHighlightedText(evidence, located) {
  const text = evidence.content;
  let cursor = 0;
  let html = '';
  for (const loc of located) {
    if (loc.start < cursor) continue; // 跳过重叠
    html += esc(text.slice(cursor, loc.start));
    html += `<mark class="hl" style="background:${loc.color.bg};border-color:${loc.color.border}" data-tip="${esc(fragTip(loc))}">${esc(
      text.slice(loc.start, loc.end),
    )}</mark>`;
    cursor = loc.end;
  }
  html += esc(text.slice(cursor));
  return html;
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
    const [ev, frags] = await Promise.all([evidences.get(id), fragments.byEvidence(id)]);
    const located = locateFragments(ev, frags);
    const unlocated = frags.filter((f) => !located.some((l) => l.f.id === f.id));

    const metaRows = [
      ['来源', `<span class="badge evidence">${esc(zh(SOURCE_CN, ev.source))}</span>`],
      ['创建时间', fmtTime(ev.created_at)],
      ['checksum', `<span class="mono">${esc(ev.checksum)}</span>`],
      ['版本', ev.version ?? '—'],
      ['证据链', ev.chain_id ?? '—'],
      ['来源系统 ID', ev.source_id ?? '—'],
      ['创建者', ev.creator ?? '—'],
    ]
      .map(([k, v]) => `<div><span class="mk">${k}：</span><span class="mv">${v}</span></div>`)
      .join('');

    const chips = located
      .map(
        (l) => `<div class="frag-chip">
        <span class="chip-dot" style="background:${l.color.border}"></span>
        <span class="chip-id mono">${esc(l.f.id)}</span>
        <span class="badge fragment">${esc(zh(FRAGTYPE_CN, l.f.type))}</span>
        <span class="chip-meta">offset ${l.start}–${l.end}${l.f.speaker ? ' · ' + esc(l.f.speaker) : ''}${
          l.f.page !== undefined ? ' · p.' + l.f.page : ''
        }</span>
        <span class="badge st-${esc(l.f.state)}">${esc(zh(STATE_CN, l.f.state))}</span>
      </div>`,
      )
      .join('');

    body.innerHTML = `
      <div class="detail-head">
        <span class="d-id mono">${esc(ev.id)}</span>
        <span class="badge evidence">${esc(zh(SOURCE_CN, ev.source))}</span>
        <span class="badge st-${esc(ev.state)}" id="d-state">${esc(zh(STATE_CN, ev.state))}</span>
        <span class="verify-result" id="verify-result"></span>
        <div class="detail-actions">
          <button class="btn small" id="btn-verify">校验 checksum</button>
          <button class="btn small" id="btn-archive" ${ev.state === 'Archived' ? 'disabled' : ''}>归档</button>
        </div>
      </div>
      <div class="meta-grid">${metaRows}</div>
      <h3 style="margin:14px 0 6px">原文（${frags.length} 个 Fragment 定位叠加）</h3>
      <div class="evidence-text">${renderHighlightedText(ev, located)}</div>
      ${
        unlocated.length
          ? `<p class="notice" style="margin-top:6px">${unlocated.length} 个 Fragment 未能在原文中定位：${unlocated
              .map((f) => esc(f.id))
              .join('、')}</p>`
          : ''
      }
      <h3 style="margin:14px 0 4px">Fragment 清单</h3>
      ${chips || '<p class="notice">该 Evidence 尚未切分 Fragment。</p>'}
    `;

    placeholder.hidden = true;
    body.hidden = false;

    document.getElementById('btn-verify').addEventListener('click', () => verifyChecksum(ev.id));
    document.getElementById('btn-archive').addEventListener('click', () => archiveEvidence(ev.id));
  } catch (e) {
    placeholder.textContent = '详情加载失败。';
    showError(e);
  }
}

async function verifyChecksum(id) {
  const resultEl = document.getElementById('verify-result');
  resultEl.textContent = '校验中…';
  resultEl.className = 'verify-result';
  try {
    const res = await evidences.verify(id);
    if (res.integrity) {
      resultEl.textContent = '✓ checksum 校验通过，原文完整';
      resultEl.classList.add('ok');
    } else {
      resultEl.textContent = '✗ checksum 校验失败，原文可能被篡改';
      resultEl.classList.add('bad');
    }
  } catch (e) {
    resultEl.textContent = '';
    showError(e);
  }
}

async function archiveEvidence(id) {
  if (!window.confirm(`确认归档 ${id}？\n归档为状态流转（已创建 → 已归档），记录不会物理删除。`)) return;
  try {
    const updated = await evidences.archive(id);
    const item = evList.find((e) => e.id === id);
    if (item) item.state = updated.state;
    renderList();
    const stateEl = document.getElementById('d-state');
    stateEl.textContent = zh(STATE_CN, updated.state);
    stateEl.className = `badge st-${updated.state}`;
    document.getElementById('btn-archive').disabled = true;
  } catch (e) {
    showError(e);
  }
}

/* ---------- 入口 ---------- */
async function main() {
  try {
    evList = await evidences.list();
    evList.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    renderList();
    if (evList.length) select(evList[0].id);
  } catch (e) {
    showError(e);
  }
}

main();
