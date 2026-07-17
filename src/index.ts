/**
 * 事实协议报告 - 数据采集与分析系统
 *
 * 项目入口文件
 */

import { logger } from './utils/logger';
import { DataCollector } from './collectors/collector';
import { DataAnalyzer } from './analyzers/analyzer';
import { ReportGenerator } from './reporters/generator';

export interface AppConfig {
  /** 数据源配置 */
  sources: SourceConfig[];
  /** 输出目录 */
  outputDir: string;
}

export interface SourceConfig {
  /** 数据源名称 */
  name: string;
  /** 数据源类型 */
  type: 'api' | 'web' | 'file';
  /** 数据源地址 */
  url: string;
}

/**
 * 应用主入口
 */
async function main(): Promise<void> {
  logger.info('Fact Protocol Report - Starting...');

  const collector = new DataCollector();
  const analyzer = new DataAnalyzer();
  const reporter = new ReportGenerator();

  try {
    // 1. 数据采集
    logger.info('Phase 1: Data Collection');
    const rawData = await collector.collect();

    // 2. 数据分析
    logger.info('Phase 2: Data Analysis');
    const analyzedData = await analyzer.analyze(rawData);

    // 3. 报告生成
    logger.info('Phase 3: Report Generation');
    await reporter.generate(analyzedData);

    logger.info('Fact Protocol Report - Completed successfully');
  } catch (error) {
    logger.error('Fatal error:', error);
    process.exit(1);
  }
}

main();
