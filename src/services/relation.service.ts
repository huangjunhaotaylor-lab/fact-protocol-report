/**
 * Relation 服务
 *
 * Relation 表示 Object 之间的事实关系。
 *
 * 类型：references, belongs_to, implements, depends_on, causes, blocks, affects, supersedes
 *
 * 核心规则：
 * - source 和 target 必须是 Object
 * - derived_from 必须引用 Signal
 * - Relation 只表达事实关系，不表达建议、优先级或策略
 *
 * 对应需求：6.6, AC-013
 */

import { Relation, RelationType } from '../types';
import { relationRepository, objectRepository, signalRepository } from '../repositories';
import { generateId, logger, NotFoundError, ProtocolViolationError } from '../utils';

export interface CreateRelationInput {
  source: string;
  target: string;
  type: RelationType;
  derived_from: string;
  confidence: number;
}

export class RelationService {
  /**
   * 创建 Relation
   *
   * 校验：
   * - source 和 target 必须是 Object（校验）
   * - derived_from 必须引用 Signal（校验）
   */
  create(input: CreateRelationInput): Relation {
    // 校验 source 是 Object
    const sourceObj = objectRepository.findById(input.source);
    if (!sourceObj) {
      throw new ProtocolViolationError(
        `Cannot create Relation: source Object not found: ${input.source}`,
      );
    }

    // 校验 target 是 Object
    const targetObj = objectRepository.findById(input.target);
    if (!targetObj) {
      throw new ProtocolViolationError(
        `Cannot create Relation: target Object not found: ${input.target}`,
      );
    }

    // 校验 derived_from 引用 Signal
    const signal = signalRepository.findById(input.derived_from);
    if (!signal) {
      throw new ProtocolViolationError(
        `Cannot create Relation: derived_from Signal not found: ${input.derived_from}`,
      );
    }

    const relation: Relation = {
      id: generateId('Relation'),
      source: input.source,
      target: input.target,
      type: input.type,
      derived_from: input.derived_from,
      confidence: input.confidence,
      created_at: new Date().toISOString(),
    };

    relationRepository.create(relation);
    logger.info(`Relation created: ${relation.id} (${sourceObj.name} ${input.type} ${targetObj.name})`);
    return relation;
  }

  /**
   * 获取 Relation
   */
  getById(id: string): Relation {
    const relation = relationRepository.findById(id);
    if (!relation) {
      throw new NotFoundError('Relation', id);
    }
    return relation;
  }

  /**
   * 获取所有 Relation
   */
  getAll(): Relation[] {
    return relationRepository.findAll();
  }

  /**
   * 按 Object 查询关联的 Relation
   */
  getByObject(objectId: string): Relation[] {
    return relationRepository.find(
      (r) => r.source === objectId || r.target === objectId,
    );
  }

  /**
   * AC-013: Relation 必须能追溯到 derived_from Signal
   */
  getDerivedFromSignal(relationId: string): import('../types').Signal {
    const relation = this.getById(relationId);
    const signal = signalRepository.findById(relation.derived_from);
    if (!signal) {
      throw new NotFoundError('Signal', relation.derived_from);
    }
    return signal;
  }
}

// 单例
export const relationService = new RelationService();
