/* G2 板块维度验证：以 DOM stub 驱动 GraphEngine 实例，断言 setDomain 后的 alpha 差异。
   运行：node /tmp/bgo_domain_verify.mjs（在 web/graph 目录上下文引用 engine.js） */

// ----- 最小 DOM/Canvas stub -----
const ctxStub = new Proxy({}, {
  get: (t, p) => {
    if (p === 'measureText') return () => ({ width: 10 });
    return typeof p === 'string' ? (() => {}) : undefined;
  },
  set: () => true,
});
const canvasStub = {
  getContext: () => ctxStub,
  style: {},
  width: 0, height: 0,
  parentElement: { getBoundingClientRect: () => ({ width: 800, height: 600 }) },
  getBoundingClientRect: () => ({ width: 800, height: 600, left: 0, top: 0 }),
  addEventListener: () => {},
  removeEventListener: () => {},
};
globalThis.window = {
  addEventListener: () => {}, removeEventListener: () => {}, devicePixelRatio: 1,
};
globalThis.ResizeObserver = class { observe() {} disconnect() {} };
globalThis.requestAnimationFrame = () => 0;
globalThis.cancelAnimationFrame = () => {};

const { GraphEngine, DOMAIN_COLORS } = await import('/Users/huangjunhao/feishu-bsp/fact-protocol-report/web/graph/engine.js');

const engine = new GraphEngine(canvasStub, {});

// 图构造：
//  sigA（仓储运营）—SUPPORTS— fragA —HAS_FRAGMENT— evA   （fragA 一跳、evA 二跳跟随 sigA）
//  sigB（财务）孤立
//  objC（仓储运营）孤立
//  relAB —RELATION— sigA, relAB —RELATION— sigB          （两端不全显形 → 淡化）
//  fragX 孤立（无任何 Signal 可达）→ 淡化
engine.setData(
  [
    { id: 'sigA', kind: 'Signal', label: 'A', domains: ['仓储运营'], primary_domain: '仓储运营', state: 'Captured' },
    { id: 'sigB', kind: 'Signal', label: 'B', domains: ['财务'], primary_domain: '财务', state: 'Verified' },
    { id: 'sigU', kind: 'Signal', label: 'U', state: 'Captured' }, // 无板块
    { id: 'objC', kind: 'Object', label: 'C', domains: ['仓储运营'], primary_domain: '仓储运营' },
    { id: 'objD', kind: 'Object', label: 'D', domains: ['项目推进'] },
    { id: 'fragA', kind: 'Fragment', label: 'fA' },
    { id: 'evA', kind: 'Evidence', label: 'eA' },
    { id: 'fragX', kind: 'Fragment', label: 'fX' },
    { id: 'relAB', kind: 'Relation', label: 'rAB' },
    { id: 'relIso', kind: 'Relation', label: 'rIso' }, // 孤立 Relation → 保留
  ],
  [
    { id: 'e1', kind: 'SUPPORTS', source: 'fragA', target: 'sigA' },
    { id: 'e2', kind: 'HAS_FRAGMENT', source: 'evA', target: 'fragA' },
    { id: 'e3', kind: 'RELATION', source: 'relAB', target: 'sigA' },
    { id: 'e4', kind: 'RELATION', source: 'relAB', target: 'sigB' },
  ],
);

let pass = 0, fail = 0;
function check(name, actual, expected) {
  const ok = Math.abs(actual - expected) < 1e-9;
  if (ok) pass++;
  else { fail++; console.log(`FAIL ${name}: got ${actual}, want ${expected}`); }
}

// --- 无聚焦：全部 1 ---
for (const n of engine.nodes) check(`init ${n.id}`, n._dAlphaTarget, 1);

// --- 聚焦「仓储运营」---
engine.setDomain('仓储运营');
const t = (id) => engine.nodeById.get(id)._dAlphaTarget;
check('sigA 域内', t('sigA'), 1);
check('objC 域内', t('objC'), 1);
check('sigB 域外', t('sigB'), 0.08);
check('objD 域外', t('objD'), 0.08);
check('sigU 无板块淡化', t('sigU'), 0.08);
check('fragA 一跳跟随', t('fragA'), 1);
check('evA 二跳跟随', t('evA'), 1);
check('fragX 无可达 Signal 淡化', t('fragX'), 0.08);
check('relAB 一端淡化→淡化', t('relAB'), 0.08);
check('relIso 孤立保留', t('relIso'), 1);

// --- 边 alpha：域内边 1，跨界边 0.08（先收敛过渡，_edgeAlpha 读当前值）---
engine._stepDimAlpha(1000);
const edge = (id) => engine.edges.find((e) => e.id === id);
check('边 e1 域内', engine._edgeAlpha(edge('e1')), 1);
check('边 e3 跨界', engine._edgeAlpha(edge('e3')), 0.08);

// --- 与时间窗共存（取最严者）---
engine.setTimeWindow([Date.parse('2024-01-01'), Date.parse('2024-12-31')]);
engine.nodeById.get('sigA')._time = Date.parse('2023-06-01'); // 域内但窗外
engine._applyTimeWindow();
engine._stepDimAlpha(1000); // 收敛过渡后读合成 alpha
check('sigA 窗外', engine.nodeById.get('sigA')._tAlphaTarget, 0.08);
check('sigA 合成最严者', engine._nodeAlpha(engine.nodeById.get('sigA')), 0.08);
check('fragA 跟随窗外信号同样淡化', engine._nodeAlpha(engine.nodeById.get('fragA')), 0.08);

// --- dimExcept 共存 ---
engine.setTimeWindow(null);
engine._stepDimAlpha(1000);
engine.dimExcept(new Set(['sigA']));
check('sigB 域外×dim', engine._nodeAlpha(engine.nodeById.get('sigB')), 0.08 * 0.12);
engine.dimExcept(null);

// --- 过渡：_dAlpha 从 1 渐近 0.08（200ms 插值），非瞬时 ---
engine.setDomain('财务');
const before = engine.nodeById.get('sigA')._dAlpha;
engine._stepDimAlpha(100);
const mid = engine.nodeById.get('sigA')._dAlpha;
engine._stepDimAlpha(200);
const after = engine.nodeById.get('sigA')._dAlpha;
check('过渡起点', before, 1);
if (!(mid < 1 && mid > 0.08)) { fail++; console.log(`FAIL 过渡中间值: ${mid}`); } else pass++;
check('过渡终点', after, 0.08);

// --- 取消聚焦恢复 ---
engine.setDomain(null);
for (const n of engine.nodes) check(`恢复 ${n.id}`, n._dAlphaTarget, 1);

// --- 板块配色完整性 ---
const want = ['仓储运营', '销售与交付', '项目推进', '采购供应', '财务', '人力', '系统与工具'];
for (const d of want) {
  if (!DOMAIN_COLORS[d]) { fail++; console.log(`FAIL 缺少配色 ${d}`); } else pass++;
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
