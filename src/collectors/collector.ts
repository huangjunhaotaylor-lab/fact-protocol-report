/**
 * 数据采集核心模块
 *
 * 负责从多种数据源采集原始数据
 */

import { RawData, SourceType } from './types';
import { ApiCollector } from './api-collector';
import { WebCollector } from './web-collector';
import { FileCollector } from './file-collector';
import { logger } from '../utils/logger';

export class DataCollector {
  private apiCollector: ApiCollector;
  private webCollector: WebCollector;
  private fileCollector: FileCollector;

  constructor() {
    this.apiCollector = new ApiCollector();
    this.webCollector = new WebCollector();
    this.fileCollector = new FileCollector();
  }

  /**
   * 从所有已配置的数据源采集数据
   */
  async collect(): Promise<RawData[]> {
    logger.info('Starting data collection...');
    const results: RawData[] = [];

    // TODO: 从配置中读取数据源列表
    // 当前使用默认数据源作为示例

    try {
      // API 数据源
      const apiData = await this.collectFromSource('api');
      results.push(...apiData);

      // Web 数据源
      const webData = await this.collectFromSource('web');
      results.push(...webData);

      // 文件数据源
      const fileData = await this.collectFromSource('file');
      results.push(...fileData);
    } catch (error) {
      logger.error('Data collection failed:', error);
      throw error;
    }

    logger.info(`Data collection completed. Total records: ${results.length}`);
    return results;
  }

  /**
   * 从指定类型的数据源采集数据
   */
  private async collectFromSource(type: SourceType): Promise<RawData[]> {
    switch (type) {
      case 'api':
        return this.apiCollector.collect();
      case 'web':
        return this.webCollector.collect();
      case 'file':
        return this.fileCollector.collect();
      default:
        logger.warn(`Unknown source type: ${type}`);
        return [];
    }
  }
}
