/**
 * 文件数据采集器
 *
 * 从本地文件（JSON、CSV 等）采集数据
 */

import { promises as fs } from 'fs';
import path from 'path';
import { RawData, FileCollectorConfig } from './types';
import { logger } from '../utils/logger';

export class FileCollector {
  /**
   * 从文件采集数据
   */
  async collect(configs?: FileCollectorConfig[]): Promise<RawData[]> {
    const results: RawData[] = [];

    if (!configs || configs.length === 0) {
      logger.info('No file sources configured, skipping file collection.');
      return results;
    }

    for (const config of configs) {
      try {
        const filePath = path.resolve(config.path);
        logger.info(`Reading data from file: ${filePath}`);

        const rawContent = await fs.readFile(filePath, 'utf-8');
        let parsedContent: unknown;

        switch (config.format || this.detectFormat(filePath)) {
          case 'json':
            parsedContent = JSON.parse(rawContent);
            break;
          case 'csv':
            parsedContent = this.parseCSV(rawContent);
            break;
          default:
            parsedContent = rawContent;
        }

        results.push({
          id: `file-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
          source: filePath,
          sourceType: 'file',
          collectedAt: new Date(),
          content: parsedContent,
          metadata: {
            filePath,
            format: config.format,
          },
        });

        logger.info(`Successfully read data from: ${filePath}`);
      } catch (error) {
        logger.error(`Failed to read data from file ${config.path}:`, error);
      }
    }

    return results;
  }

  /**
   * 根据文件扩展名检测格式
   */
  private detectFormat(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.json') return 'json';
    if (ext === '.csv') return 'csv';
    if (ext === '.xml') return 'xml';
    return 'text';
  }

  /**
   * 简易 CSV 解析
   */
  private parseCSV(content: string): Record<string, string>[] {
    const lines = content.trim().split('\n');
    if (lines.length < 2) return [];

    const headers = lines[0].split(',').map((h) => h.trim());
    return lines.slice(1).map((line) => {
      const values = line.split(',').map((v) => v.trim());
      const row: Record<string, string> = {};
      headers.forEach((header, index) => {
        row[header] = values[index] || '';
      });
      return row;
    });
  }
}
