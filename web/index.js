/**
 * V1 总览 Reality Map
 *
 * - 并行拉取五个 GET /api/* 列表并聚合
 * - 六级核心链路流程图（实时计数 + 状态微条）
 * - 五对象状态分布 hbar 组
 * - 空库引导
 */

import { evidences, fragments, signals, objects, relations, ApiError } from './api.js';

/* Fragment 无独立列表端点：由各 Evidence 的 by-evidence 聚合 */

const STATE_COLORS = {
  Captured: 'var(--st-captured)',
  Verified: 'var(--st-verified)',
  Invalid: 'var(--st-invalid)',
  Archived: 'var(--st-archived)',
  Active: 'var(--st-active)',
  Merged: 'var(--st-merged)',
  Created: 'var(--st-created)',
};

/** 展示层中文映射：数据值 / data-* 一律保持英文，未命中原样显示 */
const STATE_CN = {
  Captured: '待核', Verified: '已核', Invalid: '无效', Archived: '已归档',
  Created: '已创建', Active: '活跃', Merged: '已合并',
};
const zhState = (s) => STATE_CN[s] || s;

const ARROW_SVG = `<svg width="26" height="16" viewBox="0 0 26 16" aria-hidden="true">
  <line x1="0" y1="8" x2="18" y2="8" stroke="var(--muted)" stroke-width="1.5"/>
  <polygon points="18,3 26,8 18,13" fill="var(--muted)"/>
</svg>`;

function countBy(items, key) {
  const m = {};
  for (const it of items) {
    const v = it[key] ?? '—';
    m[v] = (m[v] || 0) + 1;
  }
  return m;
}

function microbar(dist) {
  const total = Object.values(dist).reduce((a, b) => a + b, 0);
  if (!total) return '<div class="microbar"><div class="seg" style="width:100%"></div></div>';
  const segs = Object.entries(dist)
    .map(([state, n]) => {
      const color = STATE_COLORS[state] || 'var(--c-relation)';
      return `<div class="seg" style="width:${(n / total) * 100}%;background:${color}" data-tip="${zhState(state)}: ${n}"></div>`;
    })
    .join('');
  return `<div class="microbar">${segs}</div>`;
}

function flowNode(layer, label, name, count, dist, note) {
  return `<div class="flow-node l-${layer}">
    <div class="fn-label">${label}</div>
    <div class="fn-name">${name}</div>
    <div class="fn-count num">${count}</div>
    ${microbar(dist)}
    <div class="fn-note">${note}</div>
  </div>`;
}

function hbarGroup(title, dist, order, note) {
  const total = Object.values(dist).reduce((a, b) => a + b, 0);
  const keys = order || Object.keys(dist);
  const segs = keys
    .filter((k) => dist[k])
    .map((k) => {
      const color = STATE_COLORS[k] || 'var(--c-relation)';
      const pct = total ? (dist[k] / total) * 100 : 0;
      return `<div class="seg" style="width:${pct}%;background:${color}" data-tip="${zhState(k)}: ${dist[k]}（${pct.toFixed(0)}%）"></div>`;
    })
    .join('');
  const legend = keys
    .filter((k) => dist[k])
    .map((k) => {
      const color = STATE_COLORS[k] || 'var(--c-relation)';
      return `<span><span class="dot" style="background:${color}"></span>${zhState(k)} <span class="num">${dist[k]}</span></span>`;
    })
    .join('');
  return `<div class="hbar-group">
    <div class="hbar-title"><span>${title}</span><span class="total num">共 ${total}${note ? ' · ' + note : ''}</span></div>
    <div class="hbar">${segs || '<div class="seg" style="width:100%"></div>'}</div>
    <div class="hbar-legend">${legend}</div>
  </div>`;
}

async function loadFragmentsAll(evList) {
  const groups = await Promise.all(evList.map((ev) => fragments.byEvidence(ev.id)));
  return groups.flat();
}

async function main() {
  const flowEl = document.getElementById('flow');
  const barsEl = document.getElementById('state-bars');
  const errEl = document.getElementById('error');
  const emptyEl = document.getElementById('empty-guide');

  let evList, sigList, objList, relList, frgList;
  try {
    // 并行拉取列表
    [evList, sigList, objList, relList] = await Promise.all([
      evidences.list(),
      signals.list(),
      objects.list(),
      relations.list(),
    ]);
    frgList = await loadFragmentsAll(evList);
  } catch (e) {
    errEl.hidden = false;
    errEl.textContent =
      e instanceof ApiError ? `数据加载失败：[${e.code}] ${e.message}` : `数据加载失败：${e.message}`;
    return;
  }

  const total = evList.length + frgList.length + sigList.length + objList.length + relList.length;
  emptyEl.hidden = total > 0;

  const evDist = countBy(evList, 'state');
  const frgDist = countBy(frgList, 'state');
  const sigDist = countBy(sigList, 'state');
  const objDist = countBy(objList, 'state');

  // Timeline 投影：被至少一个 Signal 锚定的 Object 数
  const anchoredObjects = new Set(sigList.flatMap((s) => s.anchors || []));
  const timelineDist = {};
  if (anchoredObjects.size) timelineDist['投影'] = anchoredObjects.size;

  const nodes = [
    flowNode('evidence', 'L1 · 原始证据', 'Evidence', evList.length, evDist, '原文不可变 · checksum'),
    flowNode('fragment', 'L2 · 证据片段', 'Fragment', frgList.length, frgDist, '来自原文 · 可定位'),
    flowNode('signal', 'L3 · 业务观察', 'Signal', sigList.length, sigDist, '事实观察 · 非结论'),
    flowNode('object', 'L4 · 对象锚定', 'Object Anchor', objList.length, objDist, `${anchoredObjects.size} 个被锚定`),
    flowNode('relation', 'L5 · 事实关系', 'Relation / State', relList.length, countBy(relList, 'type'), 'derived_from Signal'),
    flowNode('timeline', 'L6 · 时间投影', 'Timeline', anchoredObjects.size, timelineDist, '由 Signal 投影 · 不可写入'),
  ];
  flowEl.innerHTML = nodes.join(`<div class="flow-arrow">${ARROW_SVG}</div>`);

  barsEl.innerHTML = [
    hbarGroup('Evidence', evDist, ['Created', 'Archived']),
    hbarGroup('Fragment', frgDist, ['Created', 'Archived']),
    hbarGroup('Signal', sigDist, ['Captured', 'Verified', 'Invalid', 'Archived']),
    hbarGroup('Object', objDist, ['Created', 'Active', 'Merged', 'Archived']),
    hbarGroup('Relation', relList.length ? { 全部: relList.length } : {}, ['全部'], '无状态机 · 均可追溯 Signal'),
  ].join('');
}

main();
