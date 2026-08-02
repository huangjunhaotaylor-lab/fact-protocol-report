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

const STATE_COLORS = {
  Captured: '#c2a15a',
  Verified: '#7d8471',
  Invalid: '#b06a4a',
  Archived: '#c9c2b4',
};

let objList = [];
let selectedId = null;
let typeFilter = '全部';

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
function renderList() {
  const list = typeFilter === '全部' ? objList : objList.filter((o) => o.type === typeFilter);
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
        <span class="badge object">${esc(o.type)}</span>
      </div>
      <div class="obj-name">${esc(o.name)}</div>
      <div class="ev-foot">
        <span>${fmtTime(o.updated_at)}</span>
        <span class="badge st-${esc(o.state)}">${esc(o.state)}</span>
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
    ['Identity', o.identity ? `<span class="mono">${esc(o.identity)}</span>` : '—'],
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
      <span class="badge object">${esc(o.type)}</span>
      <span class="badge st-${esc(o.state)}" id="d-state">${esc(o.state)}</span>
      <div class="detail-actions">
        <button class="btn small" id="btn-activate" ${canActivate ? '' : 'disabled'} data-tip="Created → Active">激活</button>
        <button class="btn small" id="btn-merge" ${canMerge ? '' : 'disabled'} data-tip="Active → Merged&#10;合并来源保留在 attributes._merged_into">合并…</button>
        <button class="btn small" id="btn-archive" ${canArchive ? '' : 'disabled'} data-tip="Active → Archived&#10;归档不等于删除">归档</button>
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
    body.innerHTML = '<p class="notice">该 Object 尚无 Signal，无法生成 Timeline 投影。</p>';
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
      const color = STATE_COLORS[s.state] || '#c9c2b4';
      // 上下交替排布，避免拥挤
      const up = i % 2 === 0;
      const cy = up ? AXIS_Y - 26 : AXIS_Y - 14;
      const tip = `${s.id} · ${s.state}\n${fmtTime(sigTime(s))}\n${s.body}`;
      return `<g class="tl-dot" data-id="${esc(s.id)}">
        <title>${esc(tip)}</title>
        <line x1="${x}" y1="${cy}" x2="${x}" y2="${AXIS_Y}" stroke="${color}" stroke-width="1" stroke-dasharray="2 2"/>
        <circle cx="${x}" cy="${cy}" r="6" fill="${color}" stroke="#fffdf9" stroke-width="1.5"/>
      </g>`;
    })
    .join('');

  const legend = Object.entries(STATE_COLORS)
    .map(
      ([st, c]) =>
        `<span><span class="dot" style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${c};margin-right:4px"></span>${st}</span>`,
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
    <div class="tl-range"><span>${sigs.length} 个 Signal · 点色 = Signal 状态（点击圆点跳转追溯）</span><span>${legend}</span></div>`;

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
    body.innerHTML = '<p class="notice">该 Object 尚未锚定任何 Signal。</p>';
    return;
  }
  const sorted = sigs
    .slice()
    .sort((a, b) => String(b.captured_at).localeCompare(String(a.captured_at)));
  body.innerHTML = `<table class="tbl">
    <thead><tr><th>ID</th><th>观察内容</th><th>类型</th><th>状态</th><th>conf</th><th>捕获时间</th></tr></thead>
    <tbody>${sorted
      .map(
        (s) => `<tr class="row-link" data-id="${esc(s.id)}" data-tip="点击前往追溯页查看证据链">
        <td class="mono">${esc(s.id)}</td>
        <td>${esc(s.body.length > 40 ? s.body.slice(0, 40) + '…' : s.body)}</td>
        <td><span class="badge signal">${esc(s.type)}</span></td>
        <td><span class="badge st-${esc(s.state)}">${esc(s.state)}</span></td>
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
    body.innerHTML = '<p class="notice">该 Object 暂无事实关系记录。</p>';
    return;
  }
  // AC-013：逐条取 derived_from Signal 摘要
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
        <span class="rel-src">derived_from <a href="./trace.html?id=${encodeURIComponent(r.derived_from)}" data-tip="AC-013：追溯到来源 Signal">${esc(sigText)}</a> · conf <span class="num">${fmtConf(r.confidence)}</span></span>
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
        `确认归档 ${id}？\n归档为状态流转（Active → Archived），记录不会物理删除。`,
      ),
    );
    document.getElementById('btn-merge').addEventListener('click', () => {
      const target = window.prompt(
        `将 ${id} 合并到哪个 Object？\n请输入目标 Object ID（合并后本对象进入 Merged，名称并入目标别名）：`,
      );
      if (!target) return;
      doAction(
        () => objects.merge(id, target.trim()),
        `确认将 ${id} 合并到 ${target.trim()}？\n合并不可逆：本对象状态变为 Merged，合并来源保留在 attributes._merged_into。`,
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

  try {
    objList = await objects.list();
    objList.sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
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
