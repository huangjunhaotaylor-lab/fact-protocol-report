/**
 * Evidence 服务
 *
 * Evidence 表示现实世界中的原始证据。
 *
 * 核心规则：
 * - content 必须保存原文，创建后不可被 AI 或用户改写
 * - checksum 用于校验原始内容是否变化
 * - 状态：Created → Archived
 *
 * 对应需求：6.1, AC-001, AC-002, 12.1, 12.2
 */

import { Evidence, EvidenceSource, EvidenceState } from '../types';
import { evidenceRepository } from '../repositories';
import { generateId, computeChecksum, verifyChecksum, logger, NotFoundError, ImmutabilityError, StateTransitionError } from '../utils';

export interface CreateEvidenceInput {
  source: EvidenceSource;
  content: string;
  source_id?: string;
  version?: number;
  chain_id?: string;
  creator?: string;
  attachments?: string[];
  metadata?: Record<string, unknown>;
}

export class EvidenceService {
  /**
   * 创建 Evidence
   * AC-001: 用户可以创建 Evidence，并保存原始 content
   */
  create(input: CreateEvidenceInput): Evidence {
    if (!input.content || input.content.trim().length === 0) {
      throw new Error('Evidence content is required');
    }

    const evidence: Evidence = {
      id: generateId('Evidence'),
      source: input.source,
      created_at: new Date().toISOString(),
      content: input.content, // 保存原文
      checksum: computeChecksum(input.content),
      state: 'Created',
      ...(input.source_id !== undefined && { source_id: input.source_id }),
      ...(input.version !== undefined && { version: input.version }),
      ...(input.chain_id !== undefined && { chain_id: input.chain_id }),
      ...(input.creator !== undefined && { creator: input.creator }),
      ...(input.attachments !== undefined && { attachments: input.attachments }),
      ...(input.metadata !== undefined && { metadata: input.metadata }),
    };

    evidenceRepository.create(evidence);
    logger.info(`Evidence created: ${evidence.id}`);
    return evidence;
  }

  /**
   * 查看 Evidence 原文
   * 12.2: 查看 Evidence 原文
   */
  getById(id: string): Evidence {
    const evidence = evidenceRepository.findById(id);
    if (!evidence) {
      throw new NotFoundError('Evidence', id);
    }
    return evidence;
  }

  /**
   * 获取所有 Evidence
   */
  getAll(): Evidence[] {
    return evidenceRepository.findAll();
  }

  /**
   * 归档 Evidence
   * 状态流转：Created → Archived
   */
  archive(id: string): Evidence {
    const evidence = this.getById(id);

    if (evidence.state !== 'Created') {
      throw new StateTransitionError(
        `Cannot archive Evidence in state "${evidence.state}"`,
        evidence.state,
        'Archived',
      );
    }

    const updated = evidenceRepository.update(id, { state: 'Archived' as EvidenceState });
    logger.info(`Evidence archived: ${id}`);
    return updated!;
  }

  /**
   * AC-002: Evidence 创建后，content 不允许被修改
   * 此方法始终抛出错误
   */
  updateContent(id: string, _newContent: string): never {
    throw new ImmutabilityError(
      `Evidence.content is immutable and cannot be modified after creation (id: ${id})`,
      'content',
    );
  }

  /**
   * 验证 Evidence 内容校验和
   */
  verifyIntegrity(id: string): boolean {
    const evidence = this.getById(id);
    return verifyChecksum(evidence.content, evidence.checksum);
  }

  /**
   * 更新可选元数据字段（不涉及 content）
   */
  updateMetadata(id: string, metadata: Record<string, unknown>): Evidence {
    const evidence = this.getById(id);
    const updated = evidenceRepository.update(id, {
      ...evidence,
      metadata: { ...evidence.metadata, ...metadata },
    });
    return updated!;
  }
}

// 单例
export const evidenceService = new EvidenceService();
