/**
 * 板块管理 · Domains（G3 批次）
 *
 * - 板块卡片列表：色点 + 名称 + 信号/对象计数 + 关键词 chips（× 删除 / 回车添加）+ 保存（PUT）
 * - 「重新分类」：POST /api/admin/reclassify（confirm 后执行），展示 distribution 与跳过人工条数
 * - 未分类信号队列：primary_domain 为空的信号，多选板块 + 保存（POST /api/signals/:id/domains）
 *
 * 数据流：GET /api/domains（字典 + 计数）+ GET /api/signals（未分类队列）
 * api.js 为共享只读，本页自带轻量请求封装（复用其 ApiError）
 */

import { ApiError } from './api.js';
import { domainBadge, domainBadges, domainColor } from './domain-badges.js';

/* ---------- 轻量请求封装（与 api.js 同一错误约定） ---------- */
async function request(path, { method = 'GET', body } = {}) {
  const opts = { method, headers: {} };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(path, opts);
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', '无法连接服务器，请确认 BSP 服务已启动');
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = (data && data.error) || {};
    throw new ApiError(res.status, err.code || `HTTP_${res.status}`, err.message || `请求失败（HTTP ${res.status}）`);
  }
  return data;
}

/* ---------- 状态 ---------- */
let domainList = []; // GET /api/domains 的 domains 数组
let sigList = [];    // GET /api/signals
const kwDraft = new Map();   // name -> 编辑中的关键词数组（working copy）
const kwSaved = new Map();   // name -> 服务端已保存的关键词数组

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
  errEl.textContent = e instanceof ApiError ? `[${e.code}] ${e.message}` : `请求失败：${e.message}`;
  errEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function clearError() { $('error').hidden = true; }

function isDirty(name) {
  const a = kwDraft.get(name) || [];
  const b = kwSaved.get(name) || [];
  return a.length !== b.length || a.some((k, i) => k !== b[i]);
}

/* ---------- 板块卡片 ---------- */
function renderDomainCards() {
  const wrap = $('domain-cards');
  if (!domainList.length) {
    wrap.innerHTML = '<p class="notice">暂无板块数据。</p>';
    return;
  }
  wrap.innerHTML = domainList
    .map((d) => {
      const kws = kwDraft.get(d.name) || [];
      const dirty = isDirty(d.name);
      const chips = kws
        .map(
          (k) => `<span class="kw-chip">${esc(k)}<button class="kw-x" data-domain="${esc(d.name)}" data-kw="${esc(k)}" aria-label="删除关键词 ${esc(k)}">×</button></span>`,
        )
        .join('');
      return `<div class="dcard" data-domain="${esc(d.name)}">
        <div class="dc-head">
          <span class="dc-dot" style="background:${domainColor(d.name)}"></span>
          <span class="dc-name">${esc(d.name)}</span>
          <span class="dc-counts">信号 <span class="num">${d.signal_count}</span> · 对象 <span class="num">${d.object_count}</span></span>
          <button class="btn small dc-save" data-domain="${esc(d.name)}" ${dirty ? '' : 'disabled'}>保存</button>
        </div>
        <div class="dc-kws">
          ${chips || '<span class="notice">暂无关键词（字典外板块可在此建档）</span>'}
          <input class="kw-input" data-domain="${esc(d.name)}" placeholder="回车添加关键词" />
        </div>
        <div class="dc-state${dirty ? ' dirty' : ''}" data-state="${esc(d.name)}">${dirty ? '未保存修改' : ''}</div>
      </div>`;
    })
    .join('');

  // 删除关键词
  wrap.querySelectorAll('.kw-x').forEach((btn) => {
    btn.addEventListener('click', () => {
      const name = btn.dataset.domain;
      kwDraft.set(name, (kwDraft.get(name) || []).filter((k) => k !== btn.dataset.kw));
      renderDomainCards();
      refocusInput(name);
    });
  });

  // 回车添加关键词
  wrap.querySelectorAll('.kw-input').forEach((input) => {
    input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const name = input.dataset.domain;
      const kw = input.value.trim();
      if (!kw) return;
      const cur = kwDraft.get(name) || [];
      if (!cur.includes(kw)) kwDraft.set(name, [...cur, kw]);
      renderDomainCards();
      refocusInput(name);
    });
  });

  // 保存
  wrap.querySelectorAll('.dc-save').forEach((btn) => {
    btn.addEventListener('click', () => saveKeywords(btn.dataset.domain));
  });
}

/** 重渲染后把焦点还给该板块的输入框（连续添加体验） */
function refocusInput(name) {
  const input = document.querySelector(`.kw-input[data-domain="${CSS.escape(name)}"]`);
  if (input) input.focus();
}

async function saveKeywords(name) {
  clearError();
  const kws = kwDraft.get(name) || [];
  const stateEl = document.querySelector(`[data-state="${CSS.escape(name)}"]`);
  try {
    const saved = await request(`/api/domains/${encodeURIComponent(name)}/keywords`, {
      method: 'PUT',
      body: { keywords: kws },
    });
    kwSaved.set(name, [...saved.keywords]);
    kwDraft.set(name, [...saved.keywords]);
    renderDomainCards();
    const el = document.querySelector(`[data-state="${CSS.escape(name)}"]`);
    if (el) {
      el.textContent = '✓ 已保存，分类器立即生效';
      el.className = 'dc-state saved';
    }
  } catch (e) {
    if (stateEl) {
      stateEl.textContent = '保存失败';
      stateEl.className = 'dc-state dirty';
    }
    showError(e);
  }
}

/* ---------- 重新分类 ---------- */
function bindReclassify() {
  $('btn-reclassify').addEventListener('click', async () => {
    if (
      !window.confirm(
        '确认重新分类全部信号？\n将拿当前关键词词表对所有信号重新分一遍板块。\n人工手动纠正过的信号会被跳过、不受影响；重复执行结果一样。',
      )
    ) {
      return;
    }
    clearError();
    const btn = $('btn-reclassify');
    btn.disabled = true;
    try {
      const r = await request('/api/admin/reclassify', { method: 'POST', body: {} });
      const dist = Object.entries(r.distribution)
        .sort((a, b) => b[1] - a[1])
        .map(
          ([name, count]) =>
            `<span class="rc-item">${name === '未分类' ? `<span class="dbadge" style="color:var(--muted);background:#f0f0f2;border-color:#c7c7cc">未分类</span>` : domainBadge(name)}<span class="num">${count}</span></span>`,
        )
        .join('');
      $('reclassify-result').innerHTML = `<div class="rc-row">
        <span>✓ 重跑 <b class="num">${r.reclassified}</b> 条 · 跳过人工纠正 <b class="num">${r.skipped_manual}</b> 条</span>
      </div>
      <div class="rc-dist">分布：${dist}</div>`;
      $('reclassify-result').hidden = false;
      await refresh();
    } catch (e) {
      showError(e);
    } finally {
      btn.disabled = false;
    }
  });
}

/* ---------- 未分类信号队列 ---------- */
function unclassifiedSignals() {
  return sigList.filter((s) => !s.primary_domain);
}

function renderUnclassified() {
  const list = unclassifiedSignals();
  $('unclassified-count').textContent = `共 ${list.length} 条`;
  const wrap = $('unclassified-list');

  if (!list.length) {
    wrap.innerHTML = `<div class="uq-empty">✓ 当前没有未分类信号 —— 全部信号均已归口板块。<br>
      <span class="notice">录入新信号时会自动分类；无法命中的信号会出现在这里，可人工归口。</span></div>`;
    return;
  }

  const options = domainList.map((d) => `<option value="${esc(d.name)}">${esc(d.name)}</option>`).join('');
  wrap.innerHTML = list
    .map((s) => {
      const brief = (s.body || '').length > 48 ? `${s.body.slice(0, 48)}…` : s.body || '';
      const cur = domainBadges(s.domains, s.primary_domain) || '—';
      return `<div class="uq-row" data-id="${esc(s.id)}">
        <span class="uq-id mono">${esc(s.id)}</span>
        <span class="uq-body">「${esc(brief)}」</span>
        <span class="uq-doms">当前板块：${cur}</span>
        <select multiple size="${Math.min(Math.max(domainList.length, 3), 7)}" data-tip="按住 ⌘/Ctrl 可多选；第一个选中的板块作为主线板块">${options}</select>
        <button class="btn small uq-save" data-id="${esc(s.id)}">保存归口</button>
      </div>`;
    })
    .join('');

  wrap.querySelectorAll('.uq-save').forEach((btn) => {
    btn.addEventListener('click', async () => {
      clearError();
      const row = btn.closest('.uq-row');
      const selected = Array.from(row.querySelector('select').selectedOptions).map((o) => o.value);
      if (!selected.length) {
        showError(new Error('请先在下拉中勾选至少一个板块（可多选）'));
        return;
      }
      btn.disabled = true;
      try {
        await request(`/api/signals/${encodeURIComponent(btn.dataset.id)}/domains`, {
          method: 'POST',
          body: { domains: selected, primary_domain: selected[0] },
        });
        await refresh();
      } catch (e) {
        showError(e);
        btn.disabled = false;
      }
    });
  });
}

/* ---------- 数据加载 ---------- */
async function refresh() {
  const [domainsRes, signalsRes] = await Promise.all([
    request('/api/domains'),
    request('/api/signals'),
  ]);
  domainList = domainsRes.domains || [];
  sigList = signalsRes || [];

  // 初始化 / 对齐工作副本（保留未保存的编辑）
  for (const d of domainList) {
    const server = [...(d.keywords || [])];
    kwSaved.set(d.name, server);
    if (!kwDraft.has(d.name) || !isDirty(d.name)) kwDraft.set(d.name, [...server]);
  }

  renderDomainCards();
  renderUnclassified();
}

/* ---------- 入口 ---------- */
async function main() {
  bindReclassify();
  try {
    await refresh();
  } catch (e) {
    $('domain-cards').innerHTML = '<p class="notice">板块数据加载失败。</p>';
    $('unclassified-list').innerHTML = '<p class="notice">信号数据加载失败。</p>';
    showError(e);
  }
}

main();
