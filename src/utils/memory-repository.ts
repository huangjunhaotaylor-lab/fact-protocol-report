/**
 * 内存存储层基类
 *
 * MVP 阶段使用内存存储，后续可替换为数据库实现
 */

import { logger } from './logger';

/**
 * 泛型内存 Repository
 * 提供 CRUD 基础方法
 */
export class MemoryRepository<T extends { id: string }> {
  protected store: Map<string, T> = new Map();

  /**
   * 创建记录
   */
  create(entity: T): T {
    this.store.set(entity.id, entity);
    logger.debug(`Repository: created ${entity.id}`);
    return entity;
  }

  /**
   * 根据 ID 查找
   */
  findById(id: string): T | undefined {
    return this.store.get(id);
  }

  /**
   * 查找所有记录
   */
  findAll(): T[] {
    return Array.from(this.store.values());
  }

  /**
   * 按条件查找
   */
  find(predicate: (entity: T) => boolean): T[] {
    return this.findAll().filter(predicate);
  }

  /**
   * 更新记录（仅允许更新可变字段）
   */
  update(id: string, updates: Partial<T>): T | undefined {
    const existing = this.store.get(id);
    if (!existing) {
      return undefined;
    }
    const updated = { ...existing, ...updates, id: existing.id };
    this.store.set(id, updated);
    logger.debug(`Repository: updated ${id}`);
    return updated;
  }

  /**
   * 软删除（标记状态，不物理删除）
   * 注意：BSP 协议要求不得物理删除 Invalid/Archived 的 Signal
   */
  softDelete(id: string): T | undefined {
    const existing = this.store.get(id);
    if (!existing) {
      return undefined;
    }
    logger.debug(`Repository: soft-deleted ${id} (record preserved)`);
    return existing;
  }

  /**
   * 统计记录数
   */
  count(): number {
    return this.store.size;
  }

  /**
   * 清空存储（仅用于测试）
   */
  clear(): void {
    this.store.clear();
  }
}
