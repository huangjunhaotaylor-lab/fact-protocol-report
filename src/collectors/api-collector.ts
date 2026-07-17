/**
 * API 数据采集器
 *
 * 通过 HTTP API 采集数据
 */

import axios, { AxiosInstance } from 'axios';
import { RawData, ApiCollectorConfig } from './types';
import { logger } from '../utils/logger';

export class ApiCollector {
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      timeout: 30000,
      headers: {
        'User-Agent': 'FactProtocolReport/0.1.0',
      },
    });
  }

  /**
   * 从 API 采集数据
   */
  async collect(configs?: ApiCollectorConfig[]): Promise<RawData[]> {
    const results: RawData[] = [];

    if (!configs || configs.length === 0) {
      logger.info('No API sources configured, skipping API collection.');
      return results;
    }

    for (const config of configs) {
      try {
        logger.info(`Fetching data from API: ${config.url}`);
        const response = await this.client.request({
          url: config.url,
          method: config.method || 'GET',
          headers: config.headers,
          timeout: config.timeout || 30000,
        });

        results.push({
          id: `api-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
          source: config.url,
          sourceType: 'api',
          collectedAt: new Date(),
          content: response.data,
          metadata: {
            statusCode: response.status,
            headers: response.headers,
          },
        });

        logger.info(`Successfully collected data from: ${config.url}`);
      } catch (error) {
        logger.error(`Failed to collect data from API ${config.url}:`, error);
      }
    }

    return results;
  }
}
