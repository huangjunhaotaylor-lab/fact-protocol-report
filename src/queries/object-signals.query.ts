/**
 * Object → Signal 查询
 *
 * 12.11: 查看 Object 关联的 Signal 列表
 * AC-012: Object 可以关联多个 Signal
 */

import { Signal } from '../types';
import { signalRepository, objectRepository } from '../repositories';
import { NotFoundError } from '../utils/errors';

export class ObjectSignalsQuery {
  /**
   * 查询 Object 关联的所有 Signal
   */
  getByObject(objectId: string): Signal[] {
    const obj = objectRepository.findById(objectId);
    if (!obj) {
      throw new NotFoundError('Object', objectId);
    }
    return signalRepository.find((s) => s.anchors.includes(objectId));
  }

  /**
   * 查询 Object 关联的已验证 Signal
   */
  getVerifiedSignals(objectId: string): Signal[] {
    return this.getByObject(objectId).filter((s) => s.state === 'Verified');
  }

  /**
   * 查询 Object 关联的活跃 Signal（非 Archived、非 Invalid）
   */
  getActiveSignals(objectId: string): Signal[] {
    return this.getByObject(objectId).filter(
      (s) => s.state === 'Captured' || s.state === 'Verified',
    );
  }
}

// 单例
export const objectSignalsQuery = new ObjectSignalsQuery();
