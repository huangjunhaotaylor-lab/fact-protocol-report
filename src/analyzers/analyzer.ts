/**
 * 数据分析核心模块
 *
 * 对采集到的原始数据进行分析处理
 */

import { RawData } from '../collectors/types';
import { AnalysisResult } from './types';
import { logger } from '../utils/logger';

export class DataAnalyzer {
  /**
   * 分析采集到的原始数据
   */
  async analyze(rawData: RawData[]): Promise<AnalysisResult> {
    logger.info(`Analyzing ${rawData.length} data records...`);

    const result: AnalysisResult = {
      totalRecords: rawData.length,
      sources: this.analyzeSources(rawData),
      summary: this.generateSummary(rawData),
      facts: this.extractFacts(rawData),
      analyzedAt: new Date(),
    };

    logger.info('Data analysis completed.');
    return result;
  }

  /**
   * 按数据来源分析统计
   */
  private analyzeSources(
    rawData: RawData[],
  ): AnalysisResult['sources'] {
    const sourceMap = new Map<string, { type: string; count: number }>();

    for (const record of rawData) {
      const existing = sourceMap.get(record.source);
      if (existing) {
        existing.count++;
      } else {
        sourceMap.set(record.source, {
          type: record.sourceType,
          count: 1,
        });
      }
    }

    return Array.from(sourceMap.entries()).map(([source, info]) => ({
      source,
      type: info.type,
      count: info.count,
    }));
  }

  /**
   * 生成数据摘要
   */
  private generateSummary(rawData: RawData[]): string {
    const sourceTypes = new Set(rawData.map((d) => d.sourceType));
    const oldestRecord = rawData.reduce(
      (min, d) => (d.collectedAt < min ? d.collectedAt : min),
      rawData[0]?.collectedAt || new Date(),
    );
    const newestRecord = rawData.reduce(
      (max, d) => (d.collectedAt > max ? d.collectedAt : max),
      rawData[0]?.collectedAt || new Date(),
    );

    return [
      `数据采集概况:`,
      `  - 总记录数: ${rawData.length}`,
      `  - 数据源类型: ${[...sourceTypes].join(', ')}`,
      `  - 时间范围: ${oldestRecord.toISOString()} ~ ${newestRecord.toISOString()}`,
    ].join('\n');
  }

  /**
   * 从数据中提取事实
   */
  private extractFacts(rawData: RawData[]): AnalysisResult['facts'] {
    // TODO: 实现事实提取逻辑
    // 当前返回示例数据
    return rawData.map((record) => ({
      id: record.id,
      source: record.source,
      timestamp: record.collectedAt.toISOString(),
      description: `Data collected from ${record.sourceType} source: ${record.source}`,
      confidence: 1.0,
    }));
  }
}
