/**
 * Object 服务
 *
 * Object 表示企业中的稳定实体。
 *
 * 类型：Project, System, Department, Customer, Product, Document, Process, Person, Organization, Task
 *
 * 核心规则：
 * - Object 是 Reality Network 的组织中心
 * - Object 不由单个 Signal 临时决定
 * - Object 名称变化不等于新 Object
 * - Object 合并后旧 Object 进入 Merged，不得删除
 *
 * 状态：Created → Active, Active → Merged/Archived
 *
 * 对应需求：6.4, AC-012, 12.7, 12.11
 */

import { BSPObject, ObjectType, ObjectState } from '../types';
import { objectRepository, signalRepository } from '../repositories';
import { generateId, generateNamedId, logger, NotFoundError, StateTransitionError } from '../utils';

export interface CreateObjectInput {
  type: ObjectType;
  name: string;
  identity?: string;
  aliases?: string[];
  attributes?: Record<string, unknown>;
  /** 是否使用名称生成 ID（如 OBJ-INVENTORY-PROCESS） */
  namedId?: boolean;
}

export class ObjectService {
  /**
   * 创建 Object
   * 12.7: 创建或选择 Object
   */
  create(input: CreateObjectInput): BSPObject {
    const now = new Date().toISOString();
    const id = input.namedId
      ? generateNamedId('OBJ', input.name)
      : generateId('Object');

    // 如果使用了 namedId，检查是否已存在
    if (input.namedId && objectRepository.findById(id)) {
      // 名称变化不等于新 Object，返回已有对象
      logger.info(`Object already exists with namedId: ${id}`);
      return objectRepository.findById(id)!;
    }

    const obj: BSPObject = {
      id,
      type: input.type,
      name: input.name,
      state: 'Created',
      created_at: now,
      updated_at: now,
      ...(input.identity !== undefined && { identity: input.identity }),
      ...(input.aliases !== undefined && { aliases: input.aliases }),
      ...(input.attributes !== undefined && { attributes: input.attributes }),
    };

    objectRepository.create(obj);
    logger.info(`Object created: ${obj.id} (${obj.type}: ${obj.name})`);
    return obj;
  }

  /**
   * 获取 Object
   */
  getById(id: string): BSPObject {
    const obj = objectRepository.findById(id);
    if (!obj) {
      throw new NotFoundError('Object', id);
    }
    return obj;
  }

  /**
   * 获取所有 Object
   */
  getAll(): BSPObject[] {
    return objectRepository.findAll();
  }

  /**
   * 激活 Object
   * Created → Active
   */
  activate(id: string): BSPObject {
    const obj = this.getById(id);
    if (obj.state !== 'Created') {
      throw new StateTransitionError(
        `Cannot activate Object in state "${obj.state}"`,
        obj.state,
        'Active',
      );
    }
    const updated = objectRepository.update(id, {
      state: 'Active' as ObjectState,
      updated_at: new Date().toISOString(),
    });
    logger.info(`Object activated: ${id}`);
    return updated!;
  }

  /**
   * 归档 Object
   * Active → Archived
   */
  archive(id: string): BSPObject {
    const obj = this.getById(id);
    if (obj.state !== 'Active') {
      throw new StateTransitionError(
        `Cannot archive Object in state "${obj.state}"`,
        obj.state,
        'Archived',
      );
    }
    const updated = objectRepository.update(id, {
      state: 'Archived' as ObjectState,
      updated_at: new Date().toISOString(),
    });
    logger.info(`Object archived: ${id}`);
    return updated!;
  }

  /**
   * 合并 Object
   * Active → Merged
   * 合并后旧 Object 进入 Merged，不得删除
   */
  merge(id: string, mergeIntoId: string): BSPObject {
    const obj = this.getById(id);
    if (obj.state !== 'Active') {
      throw new StateTransitionError(
        `Cannot merge Object in state "${obj.state}"`,
        obj.state,
        'Merged',
      );
    }
    const target = this.getById(mergeIntoId);

    const updated = objectRepository.update(id, {
      state: 'Merged' as ObjectState,
      updated_at: new Date().toISOString(),
      // 保留合并来源信息
      attributes: {
        ...obj.attributes,
        _merged_into: mergeIntoId,
        _merged_at: new Date().toISOString(),
      },
    });

    // 将别名添加到目标对象
    if (target.aliases) {
      const existingAliases = target.aliases || [];
      objectRepository.update(mergeIntoId, {
        aliases: [...existingAliases, obj.name],
      });
    } else {
      objectRepository.update(mergeIntoId, {
        aliases: [obj.name],
      });
    }

    logger.info(`Object merged: ${id} → ${mergeIntoId}`);
    return updated!;
  }

  /**
   * AC-012: Object 可以关联多个 Signal
   * 12.11: 查看 Object 关联的 Signal 列表
   */
  getSignals(objectId: string): import('../types').Signal[] {
    this.getById(objectId); // 确保对象存在
    return signalRepository.find((s) => s.anchors.includes(objectId));
  }
}

// 单例
export const objectService = new ObjectService();
