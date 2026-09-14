/**
 * 录入台 · Intake
 *
 * 唯一录入链路：Evidence → Fragment → Signal → Object Anchor
 *
 * - 第一步：录入 Evidence 原文（不可变，自动 checksum）
 * - 第二步：在原文上划选取段创建 Fragment（自动带入 content / start_offset / end_offset）
 * - 第三步：从已选 Fragment 创建 Signal，勾选或就地创建 Object 锚点
 *   · body 违禁判断词即时提示（服务端 AC-008 强制校验）
 * - 当前工作链预览条 + 本次会话录入日志
 */

import { evidences, fragments, signals, objects, ApiError } from './api.js';

/* ---------- 枚举与中文标签 ---------- */
const EVIDENCE_SOURCES = [
  ['meeting', '会议'], ['prd', 'PRD'], ['email', '邮件'], ['erp', 'ERP'],
  ['feishu', '飞书'], ['jira', 'Jira'], ['spreadsheet', '表格'], ['agent', 'Agent 输出'],
  ['ai', 'AI 输出'], ['manual', '人工录入'], ['other', '其他'],
];
const FRAGMENT_TYPES = [
  ['Speech', '发言'], ['Text', '文本'], ['Table', '表格'], ['Image', '图像'],
  ['Document', '文档'], ['Data', '数据'], ['Code', '代码'], ['Other', '其他'],
];
const SIGNAL_TYPES = [
  ['observation', '观察'], ['event', '事件'], ['change', '变更'],
  ['status', '状态'], ['action', '行动'],
];
const OBJECT_TYPES = [
  ['Project', '项目'], ['System', '系统'], ['Department', '部门'], ['Customer', '客户'],
  ['Product', '产品'], ['Document', '文档'], ['Process', '流程'], ['Person', '人员'],
  ['Organization', '组织'], ['Task', '任务'],
];

/** 展示层中文映射：数据值一律保持英文，未命中原样显示 */
const STATE_CN = {
  Captured: '待核', Verified: '已核', Invalid: '无效', Archived: '已归档',
  Created: '已创建', Active: '活跃', Merged: '已合并',
};
const KIND_CN = { Evidence: '证据', Fragment: '片段', Signal: '信号', Object: '对象' };
const zh = (map, v) => map[v] || v;

/** 协议 §10 判断类违禁表达（与服务端 signal-body.validator 对齐，用于即时提示） */
const FORBIDDEN_TERMS = [
  '存在严重问题', '风险较高', '建议', '应该', '需要优化',
  '可能导致', '必须改进', '不合理', '落后', '低效',
];

/* ---------- 状态 ---------- */
let evList = [];          // Evidence 列表（新→旧）
let objList = [];         // Object 列表
let workEvidenceId = null; // 当前工作 Evidence
const frgCache = new Map(); // evidenceId -> Fragment[]
const selectedFrags = new Map(); // fragmentId -> { fragment, evidenceId }
const anchorIds = new Set();     // 已勾选 Object id
const sessionLog = [];           // { kind, id, label }

/* ---------- 工具 ---------- */
function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function $(id) { return document.getElementById(id); }

function showError(e) {
  const errEl = $('error');
  errEl.hidden = false;
  errEl.textContent =
    e instanceof ApiError ? `[${e.code}] ${e.message}` : `请求失败：${e.message}`;
  errEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function clearError() { $('error').hidden = true; }

function fillSelect(el, pairs) {
  el.innerHTML = pairs.map(([v, zh]) => `<option value="${esc(v)}">${esc(v)} · ${esc(zh)}</option>`).join('');
}

function preview(s, n = 42) {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n) + '…' : t;
}

/* ---------- 当前工作链预览 ---------- */
function renderChainStrip() {
  const frgs = workEvidenceId ? frgCache.get(workEvidenceId) || [] : [];
  const nodes = [
    `<div class="cs-node on-evidence"><span class="cs-k">Evidence</span><span class="cs-v mono">${esc(workEvidenceId || '—')}</span></div>`,
    `<div class="cs-node on-fragment"><span class="cs-k">Fragment</span><span class="cs-v num">${frgs.length}</span><span class="cs-k">个</span></div>`,
    `<div class="cs-node on-signal"><span class="cs-k">Signal 草稿</span><span class="cs-v num">${selectedFrags.size}</span><span class="cs-k">片段</span></div>`,
    `<div class="cs-node on-object"><span class="cs-k">Object 锚点</span><span class="cs-v num">${anchorIds.size}</span><span class="cs-k">个</span></div>`,
  ];
  $('chain-strip').innerHTML = nodes.join('<span class="cs-arrow">→</span>');
}

/* ---------- 会话日志 ---------- */
function pushLog(kind, id, label) {
  sessionLog.unshift({ kind, id, label, time: new Date() });
  renderLog();
}

function renderLog() {
  $('session-card').hidden = sessionLog.length === 0;
  $('log-count').textContent = `共 ${sessionLog.length} 条`;
  const badgeClass = { Evidence: 'evidence', Fragment: 'fragment', Signal: 'signal', Object: 'object' };
  $('log-list').innerHTML = sessionLog
    .map(
      (it) => `<div class="log-row">
      <span class="l-time num">${it.time.toLocaleTimeString('zh-CN', { hour12: false })}</span>
      <span class="badge ${badgeClass[it.kind] || 'relation'}">${esc(zh(KIND_CN, it.kind))}</span>
      <span class="mono">${esc(it.id)}</span>
      <span class="l-label">${esc(it.label)}</span>
    </div>`,
    )
    .join('');
}

/* ---------- 第一步：Evidence ---------- */
function initEvidenceForm() {
  fillSelect($('ev-source'), EVIDENCE_SOURCES);
  $('ev-content').addEventListener('input', () => {
    $('ev-count').textContent = `${$('ev-content').value.length} 字`;
  });

  $('ev-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    clearError();
    const btn = $('ev-submit');
    btn.disabled = true;
    try {
      const input = {
        source: $('ev-source').value,
        content: $('ev-content').value,
      };
      const creator = $('ev-creator').value.trim();
      const sourceId = $('ev-source-id').value.trim();
      const version = $('ev-version').value.trim();
      const chainId = $('ev-chain-id').value.trim();
      if (creator) input.creator = creator;
      if (sourceId) input.source_id = sourceId;
      if (version) input.version = parseInt(version, 10);
      if (chainId) input.chain_id = chainId;

      const ev = await evidences.create(input);
      evList.unshift(ev);
      pushLog('Evidence', ev.id, preview(ev.content, 60));
      $('ev-result').innerHTML = `<div class="ok-box">
        Evidence 已保存：<span class="ok-id mono">${esc(ev.id)}</span>
        · checksum <span class="mono">${esc(ev.checksum.slice(0, 16))}…</span>
        · 状态 <span class="badge st-${esc(ev.state)}">${esc(zh(STATE_CN, ev.state))}</span>
        · 原文已冻结，不可改写
      </div>`;
      $('ev-form').reset();
      $('ev-count').textContent = '0 字';

      // 自动设为当前工作 Evidence 并跳到第二步
      workEvidenceId = ev.id;
      renderEvidencePicker();
      await selectWorkEvidence(ev.id);
      $('step2').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) {
      showError(err);
    } finally {
      btn.disabled = false;
    }
  });
}

/* ---------- 第二步：Fragment ---------- */
function renderEvidencePicker() {
  const sel = $('fr-evidence');
  if (!evList.length) {
    sel.innerHTML = '<option value="">（暂无 Evidence）</option>';
    return;
  }
  sel.innerHTML = evList
    .map((ev) => {
      const src = EVIDENCE_SOURCES.find(([v]) => v === ev.source);
      const label = `${ev.id} · ${src ? src[1] : ev.source} · ${preview(ev.content, 30)}`;
      return `<option value="${esc(ev.id)}"${ev.id === workEvidenceId ? ' selected' : ''}>${esc(label)}</option>`;
    })
    .join('');
}

async function loadFragmentsOf(evidenceId, force = false) {
  if (force || !frgCache.has(evidenceId)) {
    frgCache.set(evidenceId, await fragments.byEvidence(evidenceId));
  }
  return frgCache.get(evidenceId);
}

async function selectWorkEvidence(id) {
  workEvidenceId = id || null;
  const ev = evList.find((x) => x.id === id);
  const hasEv = Boolean(ev);
  $('fr-ev-text-wrap').hidden = !hasEv;
  $('fr-form').hidden = !hasEv;
  $('fr-no-ev').hidden = hasEv;
  $('fr-list-wrap').hidden = !hasEv;
  $('fr-result').innerHTML = '';
  if (!hasEv) {
    renderChainStrip();
    return;
  }
  $('fr-ev-text').textContent = ev.content;
  resetFragmentDraft();
  try {
    await loadFragmentsOf(id, true);
    renderFragmentList();
  } catch (err) {
    showError(err);
  }
  renderChainStrip();
}

function resetFragmentDraft() {
  $('fr-content').value = '';
  $('fr-start').value = '';
  $('fr-end').value = '';
  $('fr-speaker').value = '';
  $('fr-ts-start').value = '';
  $('fr-ts-end').value = '';
  $('fr-page').value = '';
  $('fr-section').value = '';
}

/* 划选取段：把 selection 映射为原文字符偏移 */
function captureSelection() {
  const container = $('fr-ev-text');
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return;
  const range = sel.getRangeAt(0);
  if (!container.contains(range.commonAncestorContainer)) return;
  const text = range.toString();
  if (!text.trim()) return;
  const pre = range.cloneRange();
  pre.selectNodeContents(container);
  pre.setEnd(range.startContainer, range.startOffset);
  const start = pre.toString().length;
  $('fr-content').value = text;
  $('fr-start').value = String(start);
  $('fr-end').value = String(start + text.length);
}

function renderFragmentList() {
  const frgs = frgCache.get(workEvidenceId) || [];
  $('fr-list-count').textContent = `共 ${frgs.length} 个`;
  const listEl = $('fr-list');
  if (!frgs.length) {
    listEl.innerHTML = '<p class="notice">该 Evidence 还没有 Fragment，划选原文创建第一个。</p>';
    return;
  }
  listEl.innerHTML = frgs
    .map((f) => {
      const t = FRAGMENT_TYPES.find(([v]) => v === f.type);
      const loc = [];
      if (f.start_offset !== undefined && f.end_offset !== undefined)
        loc.push(`offset <span class="num">${f.start_offset}–${f.end_offset}</span>`);
      if (f.speaker) loc.push(`说话人：${esc(f.speaker)}`);
      if (f.timestamp_start) loc.push(`时间戳：${esc(f.timestamp_start)}`);
      if (f.page !== undefined) loc.push(`页码：<span class="num">${f.page}</span>`);
      if (f.section) loc.push(`章节：${esc(f.section)}`);
      const inTray = selectedFrags.has(f.id);
      return `<div class="frag-row">
        <div class="fr-main">
          <div><span class="fr-id mono">${esc(f.id)}</span>
            <span class="badge fragment">${esc(t ? t[1] : f.type)}</span>
            <span class="badge st-${esc(f.state)}">${esc(zh(STATE_CN, f.state))}</span></div>
          <div class="fr-content">「${esc(preview(f.content, 80))}」</div>
          <div class="fr-meta">${loc.join(' · ') || '无定位信息'}</div>
        </div>
        <button class="btn small" type="button" data-pick="${esc(f.id)}"${inTray ? ' disabled' : ''}>
          ${inTray ? '已选用' : '选用 →'}
        </button>
      </div>`;
    })
    .join('');
  listEl.querySelectorAll('[data-pick]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const f = frgs.find((x) => x.id === btn.dataset.pick);
      if (!f) return;
      selectedFrags.set(f.id, { fragment: f, evidenceId: workEvidenceId });
      renderTray();
      renderFragmentList();
      renderChainStrip();
      $('step3').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
}

function initFragmentForm() {
  fillSelect($('fr-type'), FRAGMENT_TYPES);
  $('fr-ev-text').addEventListener('mouseup', captureSelection);
  $('fr-evidence').addEventListener('change', () => selectWorkEvidence($('fr-evidence').value));

  $('fr-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    clearError();
    if (!workEvidenceId) return;
    const btn = $('fr-submit');
    btn.disabled = true;
    try {
      const input = {
        evidence_id: workEvidenceId,
        type: $('fr-type').value,
        content: $('fr-content').value,
      };
      const start = $('fr-start').value.trim();
      const end = $('fr-end').value.trim();
      const speaker = $('fr-speaker').value.trim();
      const tsStart = $('fr-ts-start').value.trim();
      const tsEnd = $('fr-ts-end').value.trim();
      const page = $('fr-page').value.trim();
      const section = $('fr-section').value.trim();
      if (start !== '') input.start_offset = parseInt(start, 10);
      if (end !== '') input.end_offset = parseInt(end, 10);
      if (speaker) input.speaker = speaker;
      if (tsStart) input.timestamp_start = tsStart;
      if (tsEnd) input.timestamp_end = tsEnd;
      if (page !== '') input.page = parseInt(page, 10);
      if (section) input.section = section;

      const f = await fragments.create(input);
      pushLog('Fragment', f.id, preview(f.content, 60));
      $('fr-result').innerHTML = `<div class="ok-box">
        Fragment 已创建：<span class="ok-id mono">${esc(f.id)}</span>
        · 内容校验通过（来自 ${esc(workEvidenceId)} 原文）
        · checksum <span class="mono">${esc(f.checksum.slice(0, 16))}…</span>
      </div>`;
      resetFragmentDraft();
      await loadFragmentsOf(workEvidenceId, true);
      renderFragmentList();
      renderChainStrip();
    } catch (err) {
      showError(err);
    } finally {
      btn.disabled = false;
    }
  });
}

/* ---------- 第三步：Signal + Object 锚定 ---------- */
function renderTray() {
  const tray = $('sig-tray');
  if (!selectedFrags.size) {
    tray.innerHTML = '<span class="notice" id="tray-empty">尚未选用 Fragment。</span>';
    return;
  }
  tray.innerHTML = [...selectedFrags.values()]
    .map(
      ({ fragment }) => `<span class="tray-chip" data-tip="${esc(fragment.id)}">
        <span class="tc-text">「${esc(preview(fragment.content, 46))}」</span>
        <button class="tc-x" type="button" data-drop="${esc(fragment.id)}" aria-label="移除">×</button>
      </span>`,
    )
    .join('');
  tray.querySelectorAll('[data-drop]').forEach((btn) => {
    btn.addEventListener('click', () => {
      selectedFrags.delete(btn.dataset.drop);
      renderTray();
      renderFragmentList();
      renderChainStrip();
    });
  });
}

function renderAnchorBox() {
  const box = $('anchor-box');
  if (!objList.length) {
    box.innerHTML = '<p class="notice" style="margin:4px 0">尚无 Object。请在下方就地创建第一个对象（Signal 必须至少锚定一个）。</p>';
    return;
  }
  box.innerHTML = objList
    .map((o) => {
      const t = OBJECT_TYPES.find(([v]) => v === o.type);
      return `<label class="anchor-item">
        <input type="checkbox" data-anchor="${esc(o.id)}"${anchorIds.has(o.id) ? ' checked' : ''} />
        <span class="badge object">${esc(t ? t[1] : o.type)}</span>
        <span class="a-name">${esc(o.name)}</span>
        <span class="a-id mono">${esc(o.id)}</span>
        <span class="badge st-${esc(o.state)}" style="margin-left:auto">${esc(zh(STATE_CN, o.state))}</span>
      </label>`;
    })
    .join('');
  box.querySelectorAll('[data-anchor]').forEach((cb) => {
    cb.addEventListener('change', () => {
      if (cb.checked) anchorIds.add(cb.dataset.anchor);
      else anchorIds.delete(cb.dataset.anchor);
      renderChainStrip();
    });
  });
}

/* body 违禁判断词即时提示（服务端仍做强制校验） */
function checkBody() {
  const body = $('sig-body').value;
  const warn = $('sig-body-warn');
  const hits = FORBIDDEN_TERMS.filter((t) => body.includes(t));
  if (!body.trim()) {
    warn.textContent = '';
    warn.classList.remove('body-ok');
  } else if (hits.length) {
    warn.classList.remove('body-ok');
    warn.textContent = `⚠ 检测到判断类表达：${hits.join('、')} —— Signal 只表达现实，服务端将拒绝创建（AC-008）`;
  } else {
    warn.classList.add('body-ok');
    warn.textContent = '✓ 事实观察格式：主体 + 当前行为 / 状态 / 已发生事实';
  }
}

function initObjectCreate() {
  fillSelect($('obj-type'), OBJECT_TYPES);
  $('obj-create').addEventListener('click', async () => {
    clearError();
    const name = $('obj-name').value.trim();
    if (!name) {
      showError(new Error('请先输入新 Object 的名称'));
      return;
    }
    const btn = $('obj-create');
    btn.disabled = true;
    try {
      const obj = await objects.create({ type: $('obj-type').value, name });
      if (!objList.some((o) => o.id === obj.id)) objList.unshift(obj);
      anchorIds.add(obj.id);
      pushLog('Object', obj.id, obj.name);
      $('obj-name').value = '';
      renderAnchorBox();
      renderChainStrip();
    } catch (err) {
      showError(err);
    } finally {
      btn.disabled = false;
    }
  });
}

function initSignalForm() {
  fillSelect($('sig-type'), SIGNAL_TYPES);
  $('sig-body').addEventListener('input', checkBody);
  $('sig-conf').addEventListener('input', () => {
    $('sig-conf-val').textContent = Number($('sig-conf').value).toFixed(2);
  });

  $('sig-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    clearError();
    if (!selectedFrags.size) {
      showError(new Error('Signal 必须引用至少一个 Fragment（AC-006）——请在第二步列表中点「选用」'));
      return;
    }
    if (!anchorIds.size) {
      showError(new Error('Signal 必须锚定至少一个 Object（AC-007）——请勾选或创建对象'));
      return;
    }
    const btn = $('sig-submit');
    btn.disabled = true;
    try {
      const context = {};
      for (const [id, key] of [
        ['ctx-channel', 'channel'], ['ctx-source', 'source'], ['ctx-org', 'organization'],
        ['ctx-location', 'location'], ['ctx-meeting', 'meeting'],
        ['ctx-document', 'document'], ['ctx-system', 'system'],
      ]) {
        const v = $(id).value.trim();
        if (v) context[key] = v;
      }
      const actors = $('sig-actors').value
        .split(/[,，、]/)
        .map((s) => s.trim())
        .filter(Boolean);
      const occurred = $('sig-occurred').value;

      const input = {
        type: $('sig-type').value,
        body: $('sig-body').value,
        fragments: [...selectedFrags.keys()],
        anchors: [...anchorIds],
        context,
        confidence: Number($('sig-conf').value),
      };
      if (actors.length) input.actors = actors;
      if (occurred) input.occurred_at = new Date(occurred).toISOString();

      const sig = await signals.create(input);
      pushLog('Signal', sig.id, preview(sig.body, 60));
      $('sig-result').innerHTML = `<div class="ok-box">
        Signal 已创建：<span class="ok-id mono">${esc(sig.id)}</span>
        · 状态 <span class="badge st-${esc(sig.state)}">${esc(zh(STATE_CN, sig.state))}</span>
        · 引用 <span class="num">${sig.fragments.length}</span> 个 Fragment
        · 锚定 <span class="num">${sig.anchors.length}</span> 个 Object
        <div style="margin-top:6px">
          <a href="./trace.html?id=${encodeURIComponent(sig.id)}">前往追溯查看完整证据链 →</a>
          &nbsp;&nbsp;<a href="./signals.html?id=${encodeURIComponent(sig.id)}">前往 Signal 工作台确认 →</a>
        </div>
      </div>`;

      // 重置 Signal 草稿（保留 Evidence / Fragment 工作区，便于连续录入）
      selectedFrags.clear();
      anchorIds.clear();
      $('sig-body').value = '';
      checkBody();
      $('sig-actors').value = '';
      $('sig-occurred').value = '';
      renderTray();
      renderFragmentList();
      renderAnchorBox();
      renderChainStrip();
      $('sig-result').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch (err) {
      showError(err);
    } finally {
      btn.disabled = false;
    }
  });
}

/* ---------- 入口 ---------- */
async function main() {
  initEvidenceForm();
  initFragmentForm();
  initSignalForm();
  initObjectCreate();
  renderTray();

  try {
    [evList, objList] = await Promise.all([evidences.list(), objects.list()]);
    evList.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    renderEvidencePicker();
    renderAnchorBox();
    if (evList.length) {
      // 默认工作 Evidence 取最新一条，方便连续录入
      workEvidenceId = evList[0].id;
      renderEvidencePicker();
      await selectWorkEvidence(workEvidenceId);
    } else {
      renderChainStrip();
    }
  } catch (err) {
    showError(err);
    renderChainStrip();
  }
}

main();
