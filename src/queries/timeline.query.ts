/**
 * Timeline 投影
 *
 * Timeline 表示围绕 Object 的 Signal 时间投影。
 *
 * 规则（文档 6.9）：
 * - Timeline 是 Projection（投影）
 * - Timeline 由 Signal 查询生成
 * - Timeline 不作为独立 Reality Source 写入
 *
 * AC-014: Timeline 只能由 Signal 生成，不能独立写入 Reality Layer
 */

import { Timeline, Signal } from '../types';
import { signalRepository, objectRepository } from '../repositories';
import { NotFoundError, ForbiddenError } from '../utils/errors';

export class TimelineQuery {
  /**
   * 生成 Object 的 Timeline 投影
   *
   * Timeline 由 Signal 查询生成，不是独立写入的
   */
  generate(objectId: string): Timeline {
    const obj = objectRepository.findById(objectId);
    if (!obj) {
      throw new NotFoundError('Object', objectId);
    }

    const signals = signalRepository.find((s) => s.anchors.includes(objectId));

    // 按时间排序
    const sortedSignals = signals.sort((a, b) => {
      const timeA = a.occurred_at || a.captured_at;
      const timeB = b.occurred_at || b.captured_at;
      return timeA.localeCompare(timeB);
    });

    const signalIds = sortedSignals.map((s) => s.id);
    const start = sortedSignals.length > 0
      ? (sortedSignals[0].occurred_at || sortedSignals[0].captured_at)
      : new Date().toISOString();
    const end = sortedSignals.length > 0
      ? (sortedSignals[sortedSignals.length - 1].occurred_at || sortedSignals[sortedSignals.length - 1].captured_at)
      : new Date().toISOString();

    return {
      object: objectId,
      signals: signalIds,
      start,
      end,
    };
  }

  /**
   * AC-014: Timeline 不允许独立写入
   * Timeline 只能由 Signal 查询生成
   */
  write(_timeline: Timeline): never {
    throw new ForbiddenError(
      'Timeline is a projection and cannot be written to Reality Layer independently (AC-014). ' +
        'Timeline can only be generated from Signal queries.',
    );
  }

  /**
   * 获取 Timeline 中按时间排列的 Signal 详情
   */
  getTimelineWithSignals(objectId: string): {
    timeline: Timeline;
    signals: Signal[];
  } {
    const timeline = this.generate(objectId);
    const signals = timeline.signals
      .map((id) => signalRepository.findById(id))
      .filter((s): s is Signal => s !== undefined);

    return { timeline, signals };
  }
}

// 单例
export const timelineQuery = new TimelineQuery();
