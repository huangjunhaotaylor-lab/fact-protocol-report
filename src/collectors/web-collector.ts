/**
 * Web 页面数据采集器
 *
 * 通过网页抓取采集数据
 */

import * as cheerio from 'cheerio';
import axios from 'axios';
import { RawData, WebCollectorConfig } from './types';
import { logger } from '../utils/logger';

export class WebCollector {
  /**
   * 从网页采集数据
   */
  async collect(configs?: WebCollectorConfig[]): Promise<RawData[]> {
    const results: RawData[] = [];

    if (!configs || configs.length === 0) {
      logger.info('No web sources configured, skipping web collection.');
      return results;
    }

    for (const config of configs) {
      try {
        logger.info(`Scraping data from: ${config.url}`);
        const response = await axios.get(config.url, {
          headers: {
            'User-Agent': 'FactProtocolReport/0.1.0',
          },
          timeout: 30000,
        });

        const $ = cheerio.load(response.data);
        let extractedContent: unknown;

        if (config.selector) {
          extractedContent = $(config.selector)
            .map((_, el) => $(el).text().trim())
            .get();
        } else {
          extractedContent = $('body').text().trim();
        }

        results.push({
          id: `web-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
          source: config.url,
          sourceType: 'web',
          collectedAt: new Date(),
          content: extractedContent,
          metadata: {
            url: config.url,
            selector: config.selector,
          },
        });

        logger.info(`Successfully scraped data from: ${config.url}`);
      } catch (error) {
        logger.error(`Failed to scrape data from ${config.url}:`, error);
      }
    }

    return results;
  }
}
