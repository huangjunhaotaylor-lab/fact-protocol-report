#!/usr/bin/env node
/**
 * BSP Reality Layer — 演示数据种子脚本
 *
 * 通过 HTTP 调用本地 BSP API，构造一条完整的中文业务演示链路：
 *   Evidence（会议纪要 / PRD / 邮件）→ Fragment → Signal（五种类型 + Captured/Verified/Invalid 状态）
 *   → Object（项目 / 部门 / 客户 / 系统）→ Relation
 *
 * 幂等说明：
 *   本脚本【非幂等】。每次运行都会创建一批全新的 Evidence / Fragment / Signal / Object / Relation，
 *   重复运行会产生重复数据（Object 名称相同但 ID 不同）。
 *   如需干净的演示环境，请先停止服务，删除 data/bsp-store.json（或 BSP_STORE_PATH 指向的文件），
 *   重启服务后再运行本脚本。
 *
 * 用法：
 *   node scripts/seed-demo.mjs
 *
 * 环境变量覆盖：
 *   BSP_API_BASE  完整 API 地址，默认 http://localhost:3000
 *   BSP_HOST      主机名，默认 localhost（BSP_API_BASE 未设置时生效）
 *   BSP_PORT      端口，默认 3000（BSP_API_BASE 未设置时生效）
 *
 * 前置条件：BSP 服务已启动（npm run build && npm start）。
 */

const BASE =
  process.env.BSP_API_BASE ||
  `http://${process.env.BSP_HOST || 'localhost'}:${process.env.BSP_PORT || '3000'}`;

let created = { evidences: 0, fragments: 0, signals: 0, objects: 0, relations: 0 };

async function req(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const err = (data && data.error) || {};
    throw new Error(`${method} ${path} 失败（HTTP ${res.status}）: ${err.code || ''} ${err.message || text}`);
  }
  return data;
}

const post = (path, body) => req('POST', path, body);

async function main() {
  // 健康检查
  await req('GET', '/health');
  console.log(`[seed] 目标服务: ${BASE}`);

  /* ---------- 1. Evidence ×3：会议纪要 / PRD / 邮件 ---------- */
  const evMeeting = await post('/api/evidences', {
    source: 'meeting',
    creator: '仓储运营部-陈明',
    metadata: { meeting: '华南仓盘点与恒晟交付对齐会', date: '2025-03-10' },
    content:
      '华南仓盘点与恒晟交付对齐会议纪要（2025-03-10）：一、华南仓 A 区实际库存 12,480 件，与 WMS 账面 12,516 件差异 36 件，差异集中在 SKU-8821 批次，本周五前完成复盘并锁定该批次出库。' +
      '二、恒晟电子 3 月订单交付日期由 3 月 15 日调整为 3 月 22 日，由客户经理王莉在 3 月 8 日邮件中确认。' +
      '三、WMS 仓储管理系统盘点模块当前处于灰度运行状态，仅覆盖 A 区。',
  });
  const evPrd = await post('/api/evidences', {
    source: 'prd',
    creator: '产品部-赵倩',
    metadata: { document: '智慧仓储二期 PRD v1.3', section: '3.2 盘点模块' },
    content:
      '智慧仓储二期项目 PRD（节选）：盘点模块二期范围覆盖华南仓全部库区；系统上线后由华南仓运营部负责日常盘点作业；' +
      '复盘报告需在盘点结束后 48 小时内提交至项目周会。2025 年 3 月 12 日，仓储运营部已将 SKU-8821 批次复盘报告提交至智慧仓储二期项目周会。',
  });
  const evEmail = await post('/api/evidences', {
    source: 'email',
    creator: '客户经理-王莉',
    metadata: { subject: 'RE: 恒晟电子 3 月订单交付时间确认', date: '2025-03-08' },
    content:
      '王莉您好：经我司生产计划部确认，3 月订单（PO-2025-0317）交付日期调整为 3 月 22 日，首批 8,000 件随原车发运。' +
      '另请知悉：贵司系统中我司名称已更新为"深圳市恒晟电子有限公司"。——恒晟电子供应链部 李涛',
  });
  created.evidences = 3;
  console.log(`[seed] Evidence ×3: ${evMeeting.id}, ${evPrd.id}, ${evEmail.id}`);

  /* ---------- 2. Fragment ×7 ---------- */
  const mkFrag = (evidence_id, content, extra = {}) =>
    post('/api/fragments', { evidence_id, type: 'Text', content, ...extra });

  const frgStockDiff = await mkFrag(
    evMeeting.id,
    '华南仓 A 区实际库存 12,480 件，与 WMS 账面 12,516 件差异 36 件，差异集中在 SKU-8821 批次',
    { speaker: '仓储运营部-陈明' },
  );
  const frgLock = await mkFrag(evMeeting.id, '本周五前完成复盘并锁定该批次出库', {
    speaker: '仓储运营部-陈明',
  });
  const frgGray = await mkFrag(evMeeting.id, 'WMS 仓储管理系统盘点模块当前处于灰度运行状态，仅覆盖 A 区', {
    speaker: '系统组-郑凯',
  });
  const frgScope = await mkFrag(evPrd.id, '盘点模块二期范围覆盖华南仓全部库区', { section: '3.2' });
  const frgReport = await mkFrag(
    evPrd.id,
    '2025 年 3 月 12 日，仓储运营部已将 SKU-8821 批次复盘报告提交至智慧仓储二期项目周会',
    { section: '3.2' },
  );
  const frgDelay = await mkFrag(evEmail.id, '3 月订单（PO-2025-0317）交付日期调整为 3 月 22 日，首批 8,000 件随原车发运', {
    speaker: '恒晟电子-李涛',
  });
  const frgRename = await mkFrag(evEmail.id, '贵司系统中我司名称已更新为"深圳市恒晟电子有限公司"', {
    speaker: '恒晟电子-李涛',
  });
  created.fragments = 7;
  console.log(`[seed] Fragment ×7 完成`);

  /* ---------- 3. Object ×4：项目 / 部门 / 客户 / 系统 ---------- */
  const objProject = await post('/api/objects', {
    type: 'Project',
    name: '智慧仓储二期项目',
    aliases: ['智慧仓储二期', 'WMS 二期'],
  });
  const objDept = await post('/api/objects', {
    type: 'Department',
    name: '华南仓运营部',
    aliases: ['华南仓', '华南仓 A 区'],
  });
  const objCustomer = await post('/api/objects', {
    type: 'Customer',
    name: '深圳市恒晟电子有限公司',
    aliases: ['恒晟电子', '恒晟'],
  });
  const objSystem = await post('/api/objects', {
    type: 'System',
    name: 'WMS 仓储管理系统',
    aliases: ['WMS'],
  });
  created.objects = 4;
  console.log(`[seed] Object ×4: ${objProject.id}, ${objDept.id}, ${objCustomer.id}, ${objSystem.id}`);

  /* ---------- 4. Signal ×6：五种类型 + Captured/Verified/Invalid ---------- */
  const ctx = { channel: 'meeting', organization: '仓储运营部' };

  // observation（将 Verify，并作为 Relation 的 derived_from）
  const sigObs = await post('/api/signals', {
    type: 'observation',
    body: '华南仓 A 区实际库存与 WMS 账面存在 36 件差异，差异集中在 SKU-8821 批次',
    fragments: [frgStockDiff.id],
    anchors: [objDept.id],
    context: ctx,
    confidence: 0.92,
  });
  // event（保持 Captured）
  const sigEvent = await post('/api/signals', {
    type: 'event',
    body: 'SKU-8821 批次出库被锁定，直至复盘完成',
    fragments: [frgLock.id],
    anchors: [objDept.id, objSystem.id],
    context: ctx,
    confidence: 0.85,
  });
  // change（将 Verify，并作为 Relation 的 derived_from）
  const sigChange = await post('/api/signals', {
    type: 'change',
    body: '恒晟电子 3 月订单交付日期由 3 月 15 日调整为 3 月 22 日',
    fragments: [frgDelay.id],
    anchors: [objCustomer.id],
    context: { channel: 'email', organization: '销售部' },
    confidence: 0.9,
  });
  // status（保持 Captured）
  const sigStatus = await post('/api/signals', {
    type: 'status',
    body: 'WMS 仓储管理系统盘点模块处于灰度运行状态，仅覆盖华南仓 A 区',
    fragments: [frgGray.id, frgScope.id],
    anchors: [objSystem.id, objProject.id],
    context: ctx,
    confidence: 0.88,
  });
  // action（保持 Captured）
  const sigAction = await post('/api/signals', {
    type: 'action',
    body: '仓储运营部于 2025 年 3 月 12 日将 SKU-8821 批次复盘报告提交至智慧仓储二期项目周会',
    fragments: [frgReport.id],
    anchors: [objProject.id, objDept.id],
    context: { channel: 'meeting', organization: '仓储运营部', meeting: '智慧仓储二期项目周会' },
    confidence: 0.8,
  });
  // observation（错误识别示例，将标记 Invalid 演示协议约束：Invalid 不得物理删除）
  const sigBad = await post('/api/signals', {
    type: 'observation',
    body: '华南仓 B 区夜班拣货错误率为 0.8%',
    fragments: [frgStockDiff.id],
    anchors: [objDept.id],
    context: ctx,
    confidence: 0.41,
  });
  created.signals = 6;
  console.log(`[seed] Signal ×6 完成（observation/event/change/status/action + Invalid 示例）`);

  // 状态流转：verify 两条，invalid 一条
  await post(`/api/signals/${sigObs.id}/verify`);
  await post(`/api/signals/${sigChange.id}/verify`);
  await post(`/api/signals/${sigBad.id}/invalid`);
  console.log(`[seed] 状态流转: ${sigObs.id} Verified, ${sigChange.id} Verified, ${sigBad.id} Invalid`);

  /* ---------- 5. Relation ×2（derived_from 必须引用 Signal） ---------- */
  const rel1 = await post('/api/relations', {
    source: objDept.id,
    target: objSystem.id,
    type: 'depends_on',
    derived_from: sigObs.id,
    confidence: 0.9,
  });
  const rel2 = await post('/api/relations', {
    source: objProject.id,
    target: objCustomer.id,
    type: 'affects',
    derived_from: sigChange.id,
    confidence: 0.85,
  });
  created.relations = 2;
  console.log(`[seed] Relation ×2: ${rel1.id}, ${rel2.id}`);

  /* ---------- 汇总 ---------- */
  console.log('\n[seed] 演示数据构造完成：');
  console.log(`  Evidence ×${created.evidences}  Fragment ×${created.fragments}  Signal ×${created.signals}  Object ×${created.objects}  Relation ×${created.relations}`);
  console.log(`  打开 ${BASE}/ 查看总览，或进入证据库 / Signal 工作台 / 追溯 / 对象全景。`);
  console.log('  提示：本脚本非幂等，重复运行会产生重复数据；重跑前请清空 data/bsp-store.json。');
}

main().catch((err) => {
  console.error(`[seed] 失败: ${err.message}`);
  console.error('[seed] 请确认 BSP 服务已启动（npm run build && npm start），或用 BSP_API_BASE / BSP_PORT 指定地址。');
  process.exit(1);
});
