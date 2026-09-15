/* 时间轴布局验证：以 DOM stub 驱动 GraphEngine 实例，断言 setLayout('time'|'force') 行为。
   覆盖：力停摆 / x 单调映射时间 / Fragment 跟随 Evidence / Relation 两端均值 /
        切换 300ms 插值非瞬移 / 时间轴下拖动允许 / force 往返归位 / 抖动确定性。
   运行：node web/graph/verify_timelayout.mjs */

// ----- 最小 DOM/Canvas stub（同 verify_g2_domain.mjs 模式） -----
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

const { GraphEngine, GraphMath, TIME_LANES } = await import('./engine.js');

const engine = new GraphEngine(canvasStub, {});

// 图构造（时间横跨 2024-01 ~ 2024-12）：
//  sigA(01-15) sigB(06-15) sigC(12-15) evA(02-01) objA(03-01) 有时间
//  fragA 无时间 —HAS_FRAGMENT→ evA（跟随其 x）；fragX 孤立无时间（落画布中点）
//  relAB 无时间 —RELATION→ sigA & sigB（两端均值）
const T = {
  sigA: Date.parse('2024-01-15'), evA: Date.parse('2024-02-01'),
  objA: Date.parse('2024-03-01'), sigB: Date.parse('2024-06-15'),
  sigC: Date.parse('2024-12-15'),
};
engine.setData(
  [
    { id: 'sigA', kind: 'Signal', label: 'A', captured_at: T.sigA },
    { id: 'sigB', kind: 'Signal', label: 'B', captured_at: T.sigB },
    { id: 'sigC', kind: 'Signal', label: 'C', occurred_at: T.sigC },
    { id: 'evA', kind: 'Evidence', label: 'eA', created_at: T.evA },
    { id: 'objA', kind: 'Object', label: 'oA', created_at: T.objA },
    { id: 'fragA', kind: 'Fragment', label: 'fA' },
    { id: 'fragX', kind: 'Fragment', label: 'fX' },
    { id: 'relAB', kind: 'Relation', label: 'rAB' },
  ],
  [
    { id: 'e1', kind: 'HAS_FRAGMENT', source: 'evA', target: 'fragA' },
    { id: 'e2', kind: 'SUPPORTS', source: 'fragA', target: 'sigA' },
    { id: 'e3', kind: 'RELATION', source: 'relAB', target: 'sigA' },
    { id: 'e4', kind: 'RELATION', source: 'relAB', target: 'sigB' },
  ],
);

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) pass++;
  else { fail++; console.log(`FAIL ${name}`); }
}
function close(name, actual, expected, eps = 1e-6) {
  const good = Math.abs(actual - expected) <= eps;
  if (good) pass++;
  else { fail++; console.log(`FAIL ${name}: got ${actual}, want ${expected}`); }
}
const N = (id) => engine.nodeById.get(id);
const settleAnim = () => engine._stepLayoutAnim(engine._layoutAnim.t0 + 400); // 越过 300ms

// --- 0. 默认力导向 ---
ok('默认 force', engine.layout === 'force');
close('TIME_LANES 五条', TIME_LANES.length, 5, 0);

// --- 1. 切入时间轴：力停摆 + 元数据 ---
engine.setLayout('time');
ok('切到 time', engine.layout === 'time');
close('力停摆 alpha=0', engine.alpha, 0, 0);
ok('timeMeta 已计算', !!engine._timeMeta && engine._timeMeta.tMin != null);
close('tMin = 全图最早', engine._timeMeta.tMin, T.sigA, 0);
close('tMax = 全图最晚', engine._timeMeta.tMax, T.sigC, 0);

// --- 2. 切换动画非瞬移（300ms 插值）---
const fromX = N('sigA').x;
ok('切换非瞬移（初刻未到目标）', Math.abs(fromX - N('sigA')._tgtX) > 1e-9);
engine._stepLayoutAnim(engine._layoutAnim.t0 + 150); // 中途
const midX = N('sigA').x;
const lo = Math.min(fromX, N('sigA')._tgtX), hi = Math.max(fromX, N('sigA')._tgtX);
ok('中途位置在起点与目标之间', midX > lo && midX < hi);
ok('动画仍在进行', !!engine._layoutAnim);
settleAnim();
ok('动画收敛', engine._layoutAnim === null);
close('收敛到目标 x', N('sigA').x, N('sigA')._tgtX, 1e-9);

// --- 3. x 单调映射时间 + 8% 边距映射公式 ---
const m = engine._timeMeta;
const xOf = (t) => m.x0 + ((t - m.tMin) / (m.tMax - m.tMin)) * (m.x1 - m.x0);
ok('x 随时间单调', N('sigA').x < N('sigB').x && N('sigB').x < N('sigC').x);
close('sigA x 映射公式', N('sigA').x, xOf(T.sigA), 1e-9);
close('sigC x 映射公式', N('sigC').x, xOf(T.sigC), 1e-9);
close('evA x 映射公式', N('evA').x, xOf(T.evA), 1e-9);
close('最早落左边界', N('sigA').x, m.x0, 1e-9);
close('最晚落右边界', N('sigC').x, m.x1, 1e-9);

// --- 4. 泳道 y：同类同泳道，抖动确定性 ---
const laneOf = (kind) => TIME_LANES.indexOf(kind);
const laneY = (kind) => m.yTop + m.laneH * (laneOf(kind) + 0.5);
ok('Signal 在信号泳道内', Math.abs(N('sigA').y - laneY('Signal')) <= m.laneH * 0.3 + 1e-9);
ok('Evidence 在证据泳道内', Math.abs(N('evA').y - laneY('Evidence')) <= m.laneH * 0.3 + 1e-9);
ok('泳道自上而下排序', laneY('Evidence') < laneY('Fragment') && laneY('Fragment') < laneY('Signal')
  && laneY('Signal') < laneY('Object') && laneY('Object') < laneY('Relation'));
const y1 = N('sigA')._tgtY, y2 = N('fragA')._tgtY;
engine._computeTimeTargets();
close('抖动确定性 sigA', N('sigA')._tgtY, y1, 0);
close('抖动确定性 fragA', N('fragA')._tgtY, y2, 0);

// --- 5. 无时间跟随：Fragment←Evidence，Relation←两端均值，孤立落中点 ---
close('fragA 跟随 evA 的 x', N('fragA').x, N('evA').x, 1e-9);
close('fragA 仍在片段泳道', N('fragA').y, laneY('Fragment') + (GraphMath.hash01('fragA') - 0.5) * m.laneH * 0.6, 1e-9);
close('孤立 fragX 落 x 中点', N('fragX').x, (m.x0 + m.x1) / 2, 1e-9);
close('relAB x = 两端均值', N('relAB').x, (N('sigA').x + N('sigB').x) / 2, 1e-9);
close('relAB y = 两端均值', N('relAB').y, (N('sigA').y + N('sigB').y) / 2, 1e-9);

// --- 6. time 模式力完全停摆：唤醒后跑帧位置不变 ---
engine._wake(1); // 模拟拖拽/加数据触发的唤醒
const snap = engine.nodes.map((n) => [n.x, n.y]);
let now = performance.now();
for (let i = 1; i <= 10; i++) engine._frame(now + i * 16);
ok('time 模式跑帧力停摆（位置不变）',
  engine.nodes.every((n, i) => n.x === snap[i][0] && n.y === snap[i][1]));

// --- 7. time 模式拖动仍允许（拖后偏离泳道不纠）---
const dragN = N('sigA');
const sp = GraphMath.worldToScreen(engine.cam, engine.w, engine.h, dragN.x, dragN.y);
engine._onMouseDown({ button: 0, clientX: sp.x, clientY: sp.y, shiftKey: false });
engine._onMouseMove({ clientX: sp.x + 80, clientY: sp.y + 60 });
engine._onMouseUp({ clientX: sp.x + 80, clientY: sp.y + 60 });
close('拖动后 x = 拖动点', dragN.x, GraphMath.screenToWorld(engine.cam, engine.w, engine.h, sp.x + 80, sp.y + 60).x, 1e-9);
close('拖动后 y = 拖动点', dragN.y, GraphMath.screenToWorld(engine.cam, engine.w, engine.h, sp.x + 80, sp.y + 60).y, 1e-9);
ok('拖动后 pinned', dragN.pinned === true);
ok('拖后偏离泳道目标', Math.abs(dragN.x - dragN._tgtX) > 1 || Math.abs(dragN.y - dragN._tgtY) > 1);

// --- 8. force 往返：热启动 → 再切 time 归位（含拖过的节点）---
engine.setLayout('force');
ok('切回 force', engine.layout === 'force');
close('force 热启动 alpha=1', engine.alpha, 1, 0);
ok('force 清 timeMeta', engine._timeMeta === null);
const fx = N('sigB').x;
for (let i = 1; i <= 20; i++) engine._frame(now + 500 + i * 16);
ok('force 力模拟恢复（节点移动）', Math.abs(N('sigB').x - fx) > 1e-9 || engine.alpha < 1);

engine.setLayout('time');
settleAnim();
close('往返后 sigA 归位 x', N('sigA').x, xOf(T.sigA), 1e-9);
close('往返后 fragA 仍跟随 evA', N('fragA').x, N('evA').x, 1e-9);
close('往返后 relAB 仍两端均值', N('relAB').x, (N('sigA').x + N('sigB').x) / 2, 1e-9);
close('往返后 alpha 归零', engine.alpha, 0, 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
