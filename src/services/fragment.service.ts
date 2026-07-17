/**
 * Fragment 服务
 *
 * Fragment 表示 Evidence 中可定位、可引用、可复用的证据片段。
 *
 * 核心规则：
 * - Fragment 必须属于一个 Evidence
 * - Fragment.content 必须来自 Evidence 原文或原始附件
 * - Fragment 不允许保存 AI 改写后的内容
 * - 一个 Evidence 可以生成多个 Fragment
 * - 一个 Fragment 可以支撑多个 Signal
 * - content 不可变
 *
 * 状态：Created → Archived
 *
 * 对应需求：6.2, AC-003, AC-004, 12.3, 12.4
 */

import { Fragment, FragmentType, FragmentState } from '../types';
import { fragmentRepository, evidenceRepository } from '../repositories';
import { generateId, computeChecksum, verifyChecksum, logger, NotFoundError, ImmutabilityError, StateTransitionError, ProtocolViolationError } from '../utils';

export interface CreateFragmentInput {
  evidence_id: string;
  type: FragmentType;
  content: string;
  speaker?: string;
  start_offset?: number;
  end_offset?: number;
  timestamp_start?: string;
  timestamp_end?: string;
  page?: number;
  section?: string;
  row?: number;
  column?: number;
  attachment_id?: string;
  metadata?: Record<string, unknown>;
}

export class FragmentService {
  /**
   * 从 Evidence 创建 Fragment
   * AC-003: 用户可以从 Evidence 创建 Fragment
   * AC-004: Fragment 必须引用一个 Evidence
   * 12.3: 从 Evidence 创建 Fragment
   */
  create(input: CreateFragmentInput): Fragment {
    // 校验：Fragment 必须属于一个 Evidence
    const evidence = evidenceRepository.findById(input.evidence_id);
    if (!evidence) {
      throw new ProtocolViolationError(
        `Cannot create Fragment: Evidence not found: ${input.evidence_id}`,
      );
    }

    // 校验：Fragment.content 必须来自 Evidence 原文或原始附件
    if (!evidence.content.includes(input.content)) {
      throw new ProtocolViolationError(
        `Fragment.content must come from Evidence original text. Content not found in Evidence ${input.evidence_id}`,
      );
    }

    // 校验：Fragment 不允许保存 AI 改写后的内容
    // (通过上面的 includes 校验已确保内容来自原文)

    const fragment: Fragment = {
      id: generateId('Fragment'),
      evidence_id: input.evidence_id,
      type: input.type,
      content: input.content,
      checksum: computeChecksum(input.content),
      state: 'Created',
      ...(input.speaker !== undefined && { speaker: input.speaker }),
      ...(input.start_offset !== undefined && { start_offset: input.start_offset }),
      ...(input.end_offset !== undefined && { end_offset: input.end_offset }),
      ...(input.timestamp_start !== undefined && { timestamp_start: input.timestamp_start }),
      ...(input.timestamp_end !== undefined && { timestamp_end: input.timestamp_end }),
      ...(input.page !== undefined && { page: input.page }),
      ...(input.section !== undefined && { section: input.section }),
      ...(input.row !== undefined && { row: input.row }),
      ...(input.column !== undefined && { column: input.column }),
      ...(input.attachment_id !== undefined && { attachment_id: input.attachment_id }),
      ...(input.metadata !== undefined && { metadata: input.metadata }),
    };

    fragmentRepository.create(fragment);
    logger.info(`Fragment created: ${fragment.id} (from Evidence ${input.evidence_id})`);
    return fragment;
  }

  /**
   * 获取 Fragment
   */
  getById(id: string): Fragment {
    const fragment = fragmentRepository.findById(id);
    if (!fragment) {
      throw new NotFoundError('Fragment', id);
    }
    return fragment;
  }

  /**
   * 获取 Evidence 的所有 Fragment
   * 一个 Evidence 可以生成多个 Fragment
   */
  getByEvidenceId(evidenceId: string): Fragment[] {
    return fragmentRepository.find((f) => f.evidence_id === evidenceId);
  }

  /**
   * 12.4: 查看 Fragment 在 Evidence 中的位置
   */
  getLocation(id: string): {
    fragment: Fragment;
    evidence: import('../types').Evidence;
    position: { start: number; end: number } | null;
  } {
    const fragment = this.getById(id);
    const evidence = evidenceRepository.findById(fragment.evidence_id);
    if (!evidence) {
      throw new NotFoundError('Evidence', fragment.evidence_id);
    }

    // 查找 Fragment 在 Evidence 中的位置
    const start = evidence.content.indexOf(fragment.content);
    const position =
      start >= 0
        ? { start, end: start + fragment.content.length }
        : null;

    return { fragment, evidence, position };
  }

  /**
   * 归档 Fragment
   * Created → Archived
   */
  archive(id: string): Fragment {
    const fragment = this.getById(id);
    if (fragment.state !== 'Created') {
      throw new StateTransitionError(
        `Cannot archive Fragment in state "${fragment.state}"`,
        fragment.state,
        'Archived',
      );
    }
    const updated = fragmentRepository.update(id, {
      state: 'Archived' as FragmentState,
    });
    logger.info(`Fragment archived: ${id}`);
    return updated!;
  }

  /**
   * Fragment.content 不可变
   */
  updateContent(id: string, _newContent: string): never {
    throw new ImmutabilityError(
      `Fragment.content is immutable and cannot be modified after creation (id: ${id})`,
      'content',
    );
  }

  /**
   * 验证 Fragment 内容校验和
   */
  verifyIntegrity(id: string): boolean {
    const fragment = this.getById(id);
    return verifyChecksum(fragment.content, fragment.checksum);
  }
}

// 单例
export const fragmentService = new FragmentService();
