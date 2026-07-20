/**
 * BSP 1.1 集成测试 — 验收标准 AC-001 ~ AC-015
 *
 * 完整覆盖文档第 13 节全部 15 条验收标准
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { evidenceService } from '../services/evidence.service';
import { fragmentService } from '../services/fragment.service';
import { signalService } from '../services/signal.service';
import { objectService } from '../services/object.service';
import { relationService } from '../services/relation.service';
import { traceQuery } from '../queries/trace.query';
import { objectSignalsQuery } from '../queries/object-signals.query';
import { timelineQuery } from '../queries/timeline.query';
import {
  evidenceRepository,
  fragmentRepository,
  signalRepository,
  objectRepository,
  relationRepository,
} from '../repositories';
import {
  ProtocolViolationError,
  ImmutabilityError,
  StateTransitionError,
  ForbiddenError,
} from '../utils/errors';
import { validateNotForbiddenEntity } from '../validators/schema.validator';

// 每个测试前清空存储
beforeEach(() => {
  evidenceRepository.clear();
  fragmentRepository.clear();
  signalRepository.clear();
  objectRepository.clear();
  relationRepository.clear();
});

describe('BSP 1.1 验收标准', () => {
  // AC-001: 用户可以创建 Evidence，并保存原始 content
  it('AC-001: should create Evidence with original content', () => {
    const evidence = evidenceService.create({
      source: 'meeting',
      content: '张三说："仓库目前还是使用 Excel 进行盘点。"',
    });

    expect(evidence).toBeDefined();
    expect(evidence.id).toMatch(/^EV-/);
    expect(evidence.source).toBe('meeting');
    expect(evidence.content).toBe('张三说："仓库目前还是使用 Excel 进行盘点。"');
    expect(evidence.state).toBe('Created');
    expect(evidence.checksum).toBeDefined();
    expect(evidence.created_at).toBeDefined();
  });

  // AC-002: Evidence 创建后，content 不允许被修改
  it('AC-002: should not allow modifying Evidence.content after creation', () => {
    const evidence = evidenceService.create({
      source: 'meeting',
      content: '原始内容',
    });

    expect(() => evidenceService.updateContent(evidence.id, '修改后内容')).toThrow(
      ImmutabilityError,
    );
  });

  // AC-003: 用户可以从 Evidence 创建 Fragment
  it('AC-003: should create Fragment from Evidence', () => {
    const evidence = evidenceService.create({
      source: 'meeting',
      content: '张三说："仓库目前还是使用 Excel 进行盘点。"',
    });

    const fragment = fragmentService.create({
      evidence_id: evidence.id,
      type: 'Speech',
      content: '仓库目前还是使用 Excel 进行盘点。',
      speaker: '张三',
    });

    expect(fragment).toBeDefined();
    expect(fragment.id).toMatch(/^FRG-/);
    expect(fragment.evidence_id).toBe(evidence.id);
    expect(fragment.type).toBe('Speech');
    expect(fragment.state).toBe('Created');
  });

  // AC-004: Fragment 必须引用一个 Evidence
  it('AC-004: Fragment must reference an Evidence', () => {
    expect(() => {
      fragmentService.create({
        evidence_id: 'non-existent-id',
        type: 'Text',
        content: 'some content',
      });
    }).toThrow(ProtocolViolationError);
  });

  // AC-005: 用户可以基于一个或多个 Fragment 创建 Signal
  it('AC-005: should create Signal from one or more Fragments', () => {
    const evidence = evidenceService.create({
      source: 'meeting',
      content: '仓库目前使用 Excel 进行盘点。',
    });

    const fragment = fragmentService.create({
      evidence_id: evidence.id,
      type: 'Text',
      content: '仓库目前使用 Excel 进行盘点。',
    });

    const obj = objectService.create({ type: 'Process', name: '仓库盘点', namedId: true });
    objectService.activate(obj.id);

    const signal = signalService.create({
      type: 'observation',
      body: '仓库目前使用 Excel 进行盘点。',
      fragments: [fragment.id],
      anchors: [obj.id],
      context: { channel: 'meeting' },
      confidence: 0.92,
    });

    expect(signal).toBeDefined();
    expect(signal.id).toMatch(/^SIG-/);
    expect(signal.fragments).toContain(fragment.id);
    expect(signal.anchors).toContain(obj.id);
    expect(signal.state).toBe('Captured');
  });

  // AC-006: 创建无 Fragment 的 Signal 时，系统必须拒绝
  it('AC-006: should reject Signal without Fragment', () => {
    const obj = objectService.create({ type: 'Process', name: '测试流程', namedId: true });
    objectService.activate(obj.id);

    expect(() => {
      signalService.create({
        type: 'observation',
        body: '测试观察。',
        fragments: [],
        anchors: [obj.id],
        context: { channel: 'meeting' },
        confidence: 0.9,
      });
    }).toThrow(ProtocolViolationError);
  });

  // AC-007: Signal 必须至少锚定一个 Object
  it('AC-007: Signal must anchor at least one Object', () => {
    const evidence = evidenceService.create({
      source: 'meeting',
      content: '测试内容。',
    });

    const fragment = fragmentService.create({
      evidence_id: evidence.id,
      type: 'Text',
      content: '测试内容。',
    });

    expect(() => {
      signalService.create({
        type: 'observation',
        body: '测试观察。',
        fragments: [fragment.id],
        anchors: [],
        context: { channel: 'meeting' },
        confidence: 0.9,
      });
    }).toThrow(ProtocolViolationError);
  });

  // AC-008: Signal body 包含明显建议、风险、结论类表达时，系统必须拒绝或标记为待人工确认
  it('AC-008: should reject Signal body with judgmental expressions', () => {
    const evidence = evidenceService.create({
      source: 'meeting',
      content: '仓库库存管理存在严重问题，风险较高，建议立即改进。',
    });

    const fragment = fragmentService.create({
      evidence_id: evidence.id,
      type: 'Text',
      content: '仓库库存管理存在严重问题，风险较高，建议立即改进。',
    });

    const obj = objectService.create({ type: 'Process', name: '库存管理', namedId: true });
    objectService.activate(obj.id);

    expect(() => {
      signalService.create({
        type: 'observation',
        body: '仓库库存管理存在严重问题。',
        fragments: [fragment.id],
        anchors: [obj.id],
        context: { channel: 'meeting' },
        confidence: 0.9,
      });
    }).toThrow(ProtocolViolationError);
  });

  // AC-009: 用户可以从 Signal 查看支撑它的 Fragment
  it('AC-009: should trace Signal to its Fragments', () => {
    const evidence = evidenceService.create({
      source: 'meeting',
      content: '仓库目前使用 Excel 进行盘点。',
    });

    const fragment = fragmentService.create({
      evidence_id: evidence.id,
      type: 'Text',
      content: '仓库目前使用 Excel 进行盘点。',
    });

    const obj = objectService.create({ type: 'Process', name: '盘点', namedId: true });
    objectService.activate(obj.id);

    const signal = signalService.create({
      type: 'observation',
      body: '仓库目前使用 Excel 进行盘点。',
      fragments: [fragment.id],
      anchors: [obj.id],
      context: { channel: 'meeting' },
      confidence: 0.92,
    });

    const fragments = traceQuery.getSignalFragments(signal.id);
    expect(fragments).toHaveLength(1);
    expect(fragments[0].id).toBe(fragment.id);
  });

  // AC-010: 用户可以从 Fragment 查看原始 Evidence
  it('AC-010: should trace Fragment to its Evidence', () => {
    const evidence = evidenceService.create({
      source: 'meeting',
      content: '仓库目前使用 Excel 进行盘点。',
    });

    const fragment = fragmentService.create({
      evidence_id: evidence.id,
      type: 'Text',
      content: '仓库目前使用 Excel 进行盘点。',
    });

    const tracedEvidence = traceQuery.getFragmentEvidence(fragment.id);
    expect(tracedEvidence.id).toBe(evidence.id);
    expect(tracedEvidence.content).toBe(evidence.content);
  });

  // AC-011: Signal 被标记为 Invalid 后不得物理删除
  it('AC-011: should not physically delete Invalid Signal', () => {
    const evidence = evidenceService.create({
      source: 'meeting',
      content: '测试内容。',
    });

    const fragment = fragmentService.create({
      evidence_id: evidence.id,
      type: 'Text',
      content: '测试内容。',
    });

    const obj = objectService.create({ type: 'Process', name: '测试', namedId: true });
    objectService.activate(obj.id);

    const signal = signalService.create({
      type: 'observation',
      body: '测试观察。',
      fragments: [fragment.id],
      anchors: [obj.id],
      context: { channel: 'meeting' },
      confidence: 0.5,
    });

    signalService.markInvalid(signal.id);

    expect(() => signalService.physicalDelete(signal.id)).toThrow(ForbiddenError);

    // 仍然存在
    expect(signalRepository.findById(signal.id)).toBeDefined();
  });

  // AC-012: Object 可以关联多个 Signal
  it('AC-012: Object can have multiple Signals', () => {
    const obj = objectService.create({ type: 'Process', name: '多信号流程', namedId: true });
    objectService.activate(obj.id);

    const evidence = evidenceService.create({
      source: 'meeting',
      content: '观察一。观察二。',
    });

    const frag1 = fragmentService.create({
      evidence_id: evidence.id,
      type: 'Text',
      content: '观察一。',
    });

    const frag2 = fragmentService.create({
      evidence_id: evidence.id,
      type: 'Text',
      content: '观察二。',
    });

    signalService.create({
      type: 'observation',
      body: '观察一。',
      fragments: [frag1.id],
      anchors: [obj.id],
      context: { channel: 'meeting' },
      confidence: 0.9,
    });

    signalService.create({
      type: 'observation',
      body: '观察二。',
      fragments: [frag2.id],
      anchors: [obj.id],
      context: { channel: 'meeting' },
      confidence: 0.9,
    });

    const signals = objectSignalsQuery.getByObject(obj.id);
    expect(signals).toHaveLength(2);
  });

  // AC-013: Relation 必须能追溯到 derived_from Signal
  it('AC-013: Relation must trace to derived_from Signal', () => {
    const evidence = evidenceService.create({
      source: 'meeting',
      content: '系统A依赖系统B。',
    });

    const fragment = fragmentService.create({
      evidence_id: evidence.id,
      type: 'Text',
      content: '系统A依赖系统B。',
    });

    const objA = objectService.create({ type: 'System', name: '系统A', namedId: true });
    objectService.activate(objA.id);
    const objB = objectService.create({ type: 'System', name: '系统B', namedId: true });
    objectService.activate(objB.id);

    const signal = signalService.create({
      type: 'observation',
      body: '系统A依赖系统B。',
      fragments: [fragment.id],
      anchors: [objA.id, objB.id],
      context: { channel: 'meeting' },
      confidence: 0.95,
    });

    const relation = relationService.create({
      source: objA.id,
      target: objB.id,
      type: 'depends_on',
      derived_from: signal.id,
      confidence: 0.95,
    });

    const tracedSignal = relationService.getDerivedFromSignal(relation.id);
    expect(tracedSignal.id).toBe(signal.id);
  });

  // AC-014: Timeline 只能由 Signal 生成，不能独立写入 Reality Layer
  it('AC-014: Timeline can only be generated from Signals, not written', () => {
    const obj = objectService.create({ type: 'Process', name: '时间线测试', namedId: true });
    objectService.activate(obj.id);

    // 可以生成 Timeline
    const result = timelineQuery.getTimelineWithSignals(obj.id);
    expect(result.timeline).toBeDefined();
    expect(result.timeline.object).toBe(obj.id);

    // 不允许写入
    expect(() => {
      timelineQuery.write({
        object: obj.id,
        signals: [],
        start: new Date().toISOString(),
        end: new Date().toISOString(),
      });
    }).toThrow(ForbiddenError);
  });

  // AC-015: 系统不得在 BSP 层创建 Risk、Issue、Decision
  it('AC-015: should not create Risk/Issue/Decision in BSP layer', () => {
    expect(() => validateNotForbiddenEntity('Issue')).toThrow();
    expect(() => validateNotForbiddenEntity('Risk')).toThrow();
    expect(() => validateNotForbiddenEntity('Decision')).toThrow();
    expect(() => validateNotForbiddenEntity('Suggestion')).toThrow();
    expect(() => validateNotForbiddenEntity('KPI')).toThrow();
    expect(() => validateNotForbiddenEntity('Workflow')).toThrow();
  });
});

/**
 * 状态流转测试（文档第 11 节）
 */
describe('BSP 1.1 状态流转', () => {
  beforeEach(() => {
    evidenceRepository.clear();
    fragmentRepository.clear();
    signalRepository.clear();
    objectRepository.clear();
    relationRepository.clear();
  });

  it('Evidence: Created → Archived', () => {
    const evidence = evidenceService.create({ source: 'meeting', content: '测试。' });
    expect(evidence.state).toBe('Created');
    const archived = evidenceService.archive(evidence.id);
    expect(archived.state).toBe('Archived');
  });

  it('Fragment: Created → Archived', () => {
    const evidence = evidenceService.create({ source: 'meeting', content: '测试。' });
    const fragment = fragmentService.create({
      evidence_id: evidence.id,
      type: 'Text',
      content: '测试。',
    });
    expect(fragment.state).toBe('Created');
    const archived = fragmentService.archive(fragment.id);
    expect(archived.state).toBe('Archived');
  });

  it('Signal: Captured → Verified', () => {
    const evidence = evidenceService.create({ source: 'meeting', content: '测试。' });
    const fragment = fragmentService.create({
      evidence_id: evidence.id,
      type: 'Text',
      content: '测试。',
    });
    const obj = objectService.create({ type: 'Process', name: '测试', namedId: true });
    objectService.activate(obj.id);

    const signal = signalService.create({
      type: 'observation',
      body: '测试观察。',
      fragments: [fragment.id],
      anchors: [obj.id],
      context: { channel: 'meeting' },
      confidence: 0.9,
    });

    expect(signal.state).toBe('Captured');
    const verified = signalService.verify(signal.id);
    expect(verified.state).toBe('Verified');
  });

  it('Signal: Captured → Invalid', () => {
    const evidence = evidenceService.create({ source: 'meeting', content: '测试。' });
    const fragment = fragmentService.create({
      evidence_id: evidence.id,
      type: 'Text',
      content: '测试。',
    });
    const obj = objectService.create({ type: 'Process', name: '测试', namedId: true });
    objectService.activate(obj.id);

    const signal = signalService.create({
      type: 'observation',
      body: '测试观察。',
      fragments: [fragment.id],
      anchors: [obj.id],
      context: { channel: 'meeting' },
      confidence: 0.3,
    });

    const invalid = signalService.markInvalid(signal.id);
    expect(invalid.state).toBe('Invalid');
  });

  it('Signal: Verified → Archived', () => {
    const evidence = evidenceService.create({ source: 'meeting', content: '测试。' });
    const fragment = fragmentService.create({
      evidence_id: evidence.id,
      type: 'Text',
      content: '测试。',
    });
    const obj = objectService.create({ type: 'Process', name: '测试', namedId: true });
    objectService.activate(obj.id);

    const signal = signalService.create({
      type: 'observation',
      body: '测试观察。',
      fragments: [fragment.id],
      anchors: [obj.id],
      context: { channel: 'meeting' },
      confidence: 0.9,
    });

    signalService.verify(signal.id);
    const archived = signalService.archive(signal.id);
    expect(archived.state).toBe('Archived');
  });

  it('Object: Created → Active → Merged', () => {
    const obj1 = objectService.create({ type: 'System', name: '系统A', namedId: true });
    const obj2 = objectService.create({ type: 'System', name: '系统B', namedId: true });
    objectService.activate(obj1.id);
    objectService.activate(obj2.id);

    const merged = objectService.merge(obj1.id, obj2.id);
    expect(merged.state).toBe('Merged');
  });

  it('Object: Created → Active → Archived', () => {
    const obj = objectService.create({ type: 'System', name: '归档系统', namedId: true });
    objectService.activate(obj.id);
    const archived = objectService.archive(obj.id);
    expect(archived.state).toBe('Archived');
  });

  it('should reject illegal state transitions', () => {
    const evidence = evidenceService.create({ source: 'meeting', content: '测试。' });
    evidenceService.archive(evidence.id);

    // Archived → Archived (not allowed)
    expect(() => evidenceService.archive(evidence.id)).toThrow(StateTransitionError);
  });
});

/**
 * 不可变性测试
 */
describe('BSP 1.1 不可变性', () => {
  it('Fragment.content is immutable', () => {
    const evidence = evidenceService.create({ source: 'meeting', content: '测试。' });
    const fragment = fragmentService.create({
      evidence_id: evidence.id,
      type: 'Text',
      content: '测试。',
    });

    expect(() => fragmentService.updateContent(fragment.id, '修改')).toThrow(ImmutabilityError);
  });
});

/**
 * 标准示例端到端测试（文档第 14 节）
 */
describe('BSP 1.1 标准示例 (Section 14)', () => {
  beforeEach(() => {
    evidenceRepository.clear();
    fragmentRepository.clear();
    signalRepository.clear();
    objectRepository.clear();
    relationRepository.clear();
  });

  it('should run the standard example end-to-end', () => {
    // 1. Evidence
    const evidence = evidenceService.create({
      source: 'meeting',
      content: '张三说："仓库目前还是使用 Excel 进行盘点。"',
    });
    expect(evidence.id).toMatch(/^EV-/);
    expect(evidence.state).toBe('Created');

    // 2. Fragment
    const fragment = fragmentService.create({
      evidence_id: evidence.id,
      type: 'Speech',
      content: '仓库目前还是使用 Excel 进行盘点。',
      speaker: '张三',
      timestamp_start: '00:15:32',
    });
    expect(fragment.id).toMatch(/^FRG-/);
    expect(fragment.speaker).toBe('张三');

    // 3. Object
    const obj = objectService.create({
      type: 'Process',
      name: '仓库盘点流程',
      namedId: true,
    });
    const activated = objectService.activate(obj.id);
    expect(obj.id).toBe('OBJ-仓库盘点流程');
    expect(activated.state).toBe('Active');

    // 4. Signal
    const signal = signalService.create({
      type: 'observation',
      body: '仓库目前使用 Excel 进行盘点。',
      fragments: [fragment.id],
      anchors: [obj.id],
      context: { channel: 'meeting' },
      confidence: 0.92,
      actors: ['张三'],
    });
    expect(signal.id).toMatch(/^SIG-/);
    expect(signal.state).toBe('Captured');
    expect(signal.confidence).toBe(0.92);

    // 5. Trace: Signal → Fragment → Evidence
    const trace = traceQuery.traceSignal(signal.id);
    expect(trace.signal.id).toBe(signal.id);
    expect(trace.fragments).toHaveLength(1);
    expect(trace.fragments[0].id).toBe(fragment.id);
    expect(trace.evidences).toHaveLength(1);
    expect(trace.evidences[0].id).toBe(evidence.id);
    expect(trace.chain).toHaveLength(1);

    // 6. Object → Signals
    const objSignals = objectSignalsQuery.getByObject(obj.id);
    expect(objSignals).toHaveLength(1);
    expect(objSignals[0].id).toBe(signal.id);

    // 7. 验证不允许在 BSP 层创建 Issue/Risk/Decision
    expect(() => validateNotForbiddenEntity('Issue')).toThrow();
    expect(() => validateNotForbiddenEntity('Risk')).toThrow();
    expect(() => validateNotForbiddenEntity('Decision')).toThrow();
  });
});

/**
 * Fragment 内容来源校验
 */
describe('BSP 1.1 Fragment 内容来源校验', () => {
  it('should reject Fragment content not from Evidence', () => {
    const evidence = evidenceService.create({
      source: 'meeting',
      content: '原文内容。',
    });

    expect(() => {
      fragmentService.create({
        evidence_id: evidence.id,
        type: 'Text',
        content: '这是不在原文中的内容。',
      });
    }).toThrow(ProtocolViolationError);
  });
});

/**
 * 协议违规场景测试（文档第 10 节）
 */
describe('BSP 1.1 协议违规拒绝 (Section 10)', () => {
  beforeEach(() => {
    evidenceRepository.clear();
    fragmentRepository.clear();
    signalRepository.clear();
    objectRepository.clear();
    relationRepository.clear();
  });

  it('should reject Fragment without Evidence', () => {
    expect(() => {
      fragmentService.create({
        evidence_id: 'non-existent',
        type: 'Text',
        content: '测试。',
      });
    }).toThrow(ProtocolViolationError);
  });

  it('should reject Signal without Fragment', () => {
    const obj = objectService.create({ type: 'Process', name: '测试', namedId: true });
    objectService.activate(obj.id);

    expect(() => {
      signalService.create({
        type: 'observation',
        body: '测试。',
        fragments: [],
        anchors: [obj.id],
        context: {},
        confidence: 0.9,
      });
    }).toThrow(ProtocolViolationError);
  });

  it('should reject Signal without Object anchor', () => {
    const evidence = evidenceService.create({ source: 'meeting', content: '测试。' });
    const fragment = fragmentService.create({
      evidence_id: evidence.id,
      type: 'Text',
      content: '测试。',
    });

    expect(() => {
      signalService.create({
        type: 'observation',
        body: '测试。',
        fragments: [fragment.id],
        anchors: [],
        context: {},
        confidence: 0.9,
      });
    }).toThrow(ProtocolViolationError);
  });

  it('should reject Relation without traceable Signal', () => {
    const objA = objectService.create({ type: 'System', name: 'A', namedId: true });
    objectService.activate(objA.id);
    const objB = objectService.create({ type: 'System', name: 'B', namedId: true });
    objectService.activate(objB.id);

    expect(() => {
      relationService.create({
        source: objA.id,
        target: objB.id,
        type: 'depends_on',
        derived_from: 'non-existent-signal',
        confidence: 0.9,
      });
    }).toThrow(ProtocolViolationError);
  });
});
