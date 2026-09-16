/**
 * 对象全景 · Object Panorama
 *
 * - 左栏：Object 列表（类型筛选 / 状态徽标）
 * - 右栏：
 *   · 对象详情（元数据 / 激活 / 归档 / 合并，合并保留 _merged_into）
 *   · Timeline 投影（GET /api/objects/:id/timeline，纯 SVG，点色=Signal 状态）
 *   · 关联 Signal 表（点击行跳追溯页）
 *   · 事实关系 Relation（source →type→ target，derived_from Signal 可跳追溯 · AC-013）
 * - 支持 ?id=OBJ-xxx 深链（供追溯页锚点跳转）
 */

import { objects, relations, ApiError } from './api.js';
import { domainBadges } from './domain-badges.js';
import { expIcon } from './explain.js';

const STATE_COLORS = {
  Captured: '#b7791f',
  Verified: '#2f855a',
  Invalid: '#c53030',
  Archived: '#86868b',
};

/** 展示层中文映射：数据值 / value / data-* 一律保持英文，未命中原样显示 */
const STATE_CN = {
  Captured: '待核', Verified: '已核', Invalid: '无效', Archived: '已归档',
  Created: '已创建', Active: '活跃', Merged: '已合并',
};
const OBJTYPE_CN = {
  Project: '项目', System: '系统', Department: '部门', Customer: '客户',
  Product: '产品', Document: '文档', Process: '流程', Person: '人员',
  Organization: '组织', Task: '任务',
};
const SIGTYPE_CN = {
  observation: '观察', event: '事件', change: '变更', status: '状态', action: '行动',
};
const zh = (map, v) => map[v] || v;

let objList = [];
let selectedId = null;
let typeFilter = '全部';
let domainFilter = '全部';

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

function objName(id) {
  const o = objList.find((x) => x.id === id);
  return o ? o.name : id;
}

/* ---------- 列表 ---------- */
function renderDomainFilter() {
  // 板块选项取自对象自身 domains 的并集（有对象的板块才列出）
  const names = [...new Set(objList.flatMap((o) => o.domains || []))].sort((a, b) =>
    a.localeCompare(b, 'zh-Hans-CN'),
  );
  const sel = document.getElementById('domain-filter');
  sel.innerHTML =
    '<option value="全部">全部</option>' +
    names.map((n) => `<option value="${esc(n)}"${n === domainFilter ? ' selected' : ''}>${esc(n)}</option>`).join('');
  if (domainFilter !== '全部' && !names.includes(domainFilter)) {
    domainFilter = '全部';
    sel.value = '全部';
  }
}

function renderList() {
  const list = objList.filter(
    (o) =>
      (typeFilter === '全部' || o.type === typeFilter) &&
      (domainFilter === '全部' || (o.domains || []).includes(domainFilter)),
  );
  document.getElementById('obj-count').textContent = `共 ${list.length} 个`;
  const listEl = document.getElementById('obj-list');
  if (!list.length) {
    listEl.innerHTML = '<p class="notice">当前筛选下暂无 Object。</p>';
    return;
  }
  listEl.innerHTML = list
    .map(
      (o) => `<div class="ev-item${o.id === selectedId ? ' selected' : ''}" data-id="${esc(o.id)}">
      <div class="ev-head">
        <span class="ev-id mono">${esc(o.id)}</span>
        <span class="badge object">${esc(zh(OBJTYPE_CN, o.type))}</span>
      </div>
      <div class="obj-name">${esc(o.name)}</div>
      ${(o.domains || []).length ? `<div class="obj-domains">${domainBadges(o.domains, o.primary_domain)}</div>` : ''}
      <div class="ev-foot">
        <span>${fmtTime(o.updated_at)}</span>
        <span class="badge st-${esc(o.state)}">${esc(zh(STATE_CN, o.state))}</span>
      </div>
    </div>`,
    )
    .join('');
  listEl.querySelectorAll('.ev-item').forEach((el) => {
    el.addEventListener('click', () => select(el.dataset.id));
  });
}

/* ---------- 详情头部与元数据 ---------- */
function renderDetail(o) {
  const attrs = o.attributes || {};
  const mergedInto = attrs._merged_into;
  const attrEntries = Object.entries(attrs).filter(([k]) => !k.startsWith('_'));

  const metaRows = [
    ['创建时间', fmtTime(o.created_at)],
    ['更新时间', fmtTime(o.updated_at)],
    ['身份标识' + expIcon('object'), o.identity ? `<span class="mono">${esc(o.identity)}</span>` : '—'],
    ['别名', (o.aliases || []).length ? esc(o.aliases.join('、')) : '—'],
    [
      '属性',
      attrEntries.length
        ? `<span class="attrs-json">${esc(JSON.stringify(Object.fromEntries(attrEntries), null, 1))}</span>`
        : '—',
    ],
    [
      '合并去向',
      mergedInto
        ? `<a href="./objects.html?id=${encodeURIComponent(mergedInto)}"><span class="badge object">${esc(mergedInto)}</span></a> <span class="notice">${fmtTime(attrs._merged_at)}</span>`
        : '—',
    ],
  ]
    .map(([k, v]) => `<div><span class="mk">${k}：</span><span class="mv">${v}</span></div>`)
    .join('');

  const canActivate = o.state === 'Created';
  const canArchive = o.state === 'Active';
  const canMerge = o.state === 'Active';

  return `
    <div class="detail-head">
      <span class="d-id">${esc(o.name)}</span>
      <span class="d-id mono" style="font-size:12px;color:var(--muted)">${esc(o.id)}</span>
      <span class="badge object">${esc(zh(OBJTYPE_CN, o.type))}</span>
      <span class="badge st-${esc(o.state)}" id="d-state">${esc(zh(STATE_CN, o.state))}</span>
      <div class="detail-actions">
        <button class="btn small" id="btn-activate" ${canActivate ? '' : 'disabled'} data-tip="新建的对象先「激活」，表示正式启用这份档案">激活</button>
        <button class="btn small" id="btn-merge" ${canMerge ? '' : 'disabled'} data-tip="两个对象其实是同一个？合并成一个，原对象保留去向记录、不删除">合并…</button>
        <button class="btn small" id="btn-archive" ${canArchive ? '' : 'disabled'} data-tip="封存这份档案（只改状态，不删除）">归档</button>
      </div>
    </div>
    <div class="meta-grid">${metaRows}</div>`;
}

/* ---------- Timeline 投影（纯 SVG） ---------- */
function sigTime(s) {
  return s.occurred_at || s.captured_at;
}

function renderTimeline(data) {
  const body = document.getElementById('timeline-body');
  const sigs = (data.signals || []).slice();
  if (!sigs.length) {
    body.innerHTML = '<p class="notice">这个对象还没有挂上任何信号，暂无时间线可看。去录入台提炼信号并挂到它上面。</p>';
    return;
  }
  sigs.sort((a, b) => String(sigTime(a)).localeCompare(String(sigTime(b))));

  const W = 920;
  const H = 130;
  const PAD = 24;
  const AXIS_Y = 88;
  const times = sigs.map((s) => new Date(sigTime(s)).getTime());
  const min = Math.min(...times);
  const max = Math.max(...times);
  const span = max - min;

  const xOf = (i, t) =>
    span > 0 ? PAD + ((t - min) / span) * (W - PAD * 2) : PAD + (i / Math.max(sigs.length - 1, 1)) * (W - PAD * 2);

  const dots = sigs
    .map((s, i) => {
      const t = new Date(sigTime(s)).getTime();
      const x = xOf(i, t);
      const color = STATE_COLORS[s.state] || '#86868b';
      // 上下交替排布，避免拥挤
      const up = i % 2 === 0;
      const cy = up ? AXIS_Y - 26 : AXIS_Y - 14;
      const tip = `${s.id} · ${zh(STATE_CN, s.state)}\n${fmtTime(sigTime(s))}\n${s.body}`;
      return `<g class="tl-dot" data-id="${esc(s.id)}">
        <title>${esc(tip)}</title>
        <line x1="${x}" y1="${cy}" x2="${x}" y2="${AXIS_Y}" stroke="${color}" stroke-width="1" stroke-dasharray="2 2"/>
        <circle cx="${x}" cy="${cy}" r="6" fill="${color}" stroke="#ffffff" stroke-width="1.5"/>
      </g>`;
    })
    .join('');

  const legend = Object.entries(STATE_COLORS)
    .map(
      ([st, c]) =>
        `<span><span class="dot" style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${c};margin-right:4px"></span>${zh(STATE_CN, st)}</span>`,
    )
    .join(' · ');

  body.innerHTML = `
    <div class="tl-wrap">
      <svg class="tl-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Timeline 投影">
        <line x1="${PAD}" y1="${AXIS_Y}" x2="${W - PAD}" y2="${AXIS_Y}" stroke="var(--line)" stroke-width="2"/>
        ${dots}
        <text x="${PAD}" y="${AXIS_Y + 18}" font-size="11" fill="var(--muted)" class="mono">${esc(fmtTime(data.timeline.start))}</text>
        <text x="${W - PAD}" y="${AXIS_Y + 18}" font-size="11" fill="var(--muted)" text-anchor="end" class="mono">${esc(fmtTime(data.timeline.end))}</text>
      </svg>
    </div>
    <div class="tl-range"><span>${sigs.length} 条信号 · 圆点颜色 = 核对状态（点击圆点跳转追溯出处）</span><span>${legend}</span></div>`;

  body.querySelectorAll('.tl-dot').forEach((g) => {
    g.addEventListener('click', () => {
      window.location.href = `./trace.html?id=${encodeURIComponent(g.dataset.id)}`;
    });
  });
}

/* ---------- 关联 Signal 表 ---------- */
function renderSignals(sigs) {
  document.getElementById('sig-count').textContent = `共 ${sigs.length} 条`;
  const body = document.getElementById('signals-body');
  if (!sigs.length) {
    body.innerHTML = '<p class="notice">这个对象还没有挂上任何信号。</p>';
    return;
  }
  const sorted = sigs
    .slice()
    .sort((a, b) => String(b.captured_at).localeCompare(String(a.captured_at)));
  body.innerHTML = `<table class="tbl">
    <thead><tr><th>ID</th><th>观察内容</th><th>类型${expIcon('signal-type')}</th><th>板块${expIcon('domain')}</th><th>状态${expIcon('state-machine')}</th><th>置信度${expIcon('confidence')}</th><th>捕获时间</th></tr></thead>
    <tbody>${sorted
      .map(
        (s) => `<tr class="row-link" data-id="${esc(s.id)}" data-tip="点击前往追溯页，看这条信号的完整出处">
        <td class="mono">${esc(s.id)}</td>
        <td>${esc(s.body.length > 40 ? s.body.slice(0, 40) + '…' : s.body)}</td>
        <td><span class="badge signal">${esc(zh(SIGTYPE_CN, s.type))}</span></td>
        <td>${domainBadges(s.domains, s.primary_domain) || '<span class="notice">—</span>'}</td>
        <td><span class="badge st-${esc(s.state)}">${esc(zh(STATE_CN, s.state))}</span></td>
        <td class="num">${fmtConf(s.confidence)}</td>
        <td>${fmtTime(s.captured_at)}</td>
      </tr>`,
      )
      .join('')}</tbody>
  </table>`;
  body.querySelectorAll('tr.row-link').forEach((tr) => {
    tr.addEventListener('click', () => {
      window.location.href = `./trace.html?id=${encodeURIComponent(tr.dataset.id)}`;
    });
  });
}

/* ---------- 事实关系 ---------- */
async function renderRelations(rels) {
  document.getElementById('rel-count').textContent = `共 ${rels.length} 条`;
  const body = document.getElementById('relations-body');
  if (!rels.length) {
    body.innerHTML = '<p class="notice">这个对象和其他对象之间还没有建立事实关系。</p>';
    return;
  }
  // 逐条取关系来源信号的摘要（每条关系都必须出自某条信号）
  const rows = await Promise.all(
    rels.map(async (r) => {
      let sigText = r.derived_from;
      try {
        const sig = await relations.signal(r.id);
        sigText = `${sig.id}：${sig.body.length > 24 ? sig.body.slice(0, 24) + '…' : sig.body}`;
      } catch {
        /* 保留原始 ID */
      }
      const src = objName(r.source);
      const tgt = objName(r.target);
      return `<div class="rel-row">
        <span class="mono">${esc(r.id)}</span>
        <span><span class="badge object">${esc(src)}</span></span>
        <span class="rel-type">${esc(r.type)}</span>
        <span class="rel-arrow">→</span>
        <span><span class="badge object">${esc(tgt)}</span></span>
        <span class="rel-src">出自 <a href="./trace.html?id=${encodeURIComponent(r.derived_from)}" data-tip="追溯到这条关系的来源信号：看它出自哪句话、哪份原文">${esc(sigText)}</a> · 置信度${expIcon('confidence')} <span class="num">${fmtConf(r.confidence)}</span></span>
      </div>`;
    }),
  );
  body.innerHTML = rows.join('');
}

/* ---------- 状态操作 ---------- */
async function doAction(fn, confirmText) {
  if (confirmText && !window.confirm(confirmText)) return;
  try {
    await fn();
    await select(selectedId);
    objList = await objects.list();
    renderDomainFilter();
    renderList();
  } catch (e) {
    showError(e);
  }
}

/* ---------- 选择对象 ---------- */
async function select(id) {
  selectedId = id;
  renderList();
  const placeholder = document.getElementById('detail-placeholder');
  const body = document.getElementById('detail-body');
  placeholder.hidden = false;
  placeholder.textContent = '加载中…';
  body.hidden = true;
  ['obj-timeline', 'obj-signals', 'obj-relations'].forEach((cid) => {
    document.getElementById(cid).hidden = true;
  });

  try {
    const [obj, sigs, timeline, rels] = await Promise.all([
      objects.get(id),
      objects.signals(id),
      objects.timeline(id),
      relations.byObject(id),
    ]);

    body.innerHTML = renderDetail(obj);
    placeholder.hidden = true;
    body.hidden = false;

    document.getElementById('btn-activate').addEventListener('click', () =>
      doAction(() => objects.activate(id), null),
    );
    document.getElementById('btn-archive').addEventListener('click', () =>
      doAction(
        () => objects.archive(id),
        `确认归档 ${id}？\n归档只是把这份档案标记为「已归档」封存起来（活跃 → 已归档），记录本身不会删除。`,
      ),
    );
    document.getElementById('btn-merge').addEventListener('click', () => {
      const target = window.prompt(
        `将 ${id} 合并到哪个对象？\n请输入目标对象 ID（合并后本对象标记为「已合并」，名称并入目标对象的别名）：`,
      );
      if (!target) return;
      doAction(
        () => objects.merge(id, target.trim()),
        `确认将 ${id} 合并到 ${target.trim()}？\n合并不可逆：本对象状态变为「已合并」，系统会保留它合并去了哪里的记录。`,
      );
    });

    document.getElementById('obj-timeline').hidden = false;
    renderTimeline(timeline);

    document.getElementById('obj-signals').hidden = false;
    renderSignals(sigs);

    document.getElementById('obj-relations').hidden = false;
    await renderRelations(rels);
  } catch (e) {
    placeholder.textContent = '对象详情加载失败。';
    showError(e);
  }
}

/* ---------- 入口 ---------- */
async function main() {
  document.getElementById('type-filter').addEventListener('change', (e) => {
    typeFilter = e.target.value;
    renderList();
  });
  document.getElementById('domain-filter').addEventListener('change', (e) => {
    domainFilter = e.target.value;
    renderList();
  });

  try {
    objList = await objects.list();
    objList.sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
    renderDomainFilter();
    renderList();

    const params = new URLSearchParams(window.location.search);
    const deepId = params.get('id');
    if (deepId) {
      select(deepId);
    } else if (objList.length) {
      select(objList[0].id);
    }
  } catch (e) {
    showError(e);
  }
}

main();
