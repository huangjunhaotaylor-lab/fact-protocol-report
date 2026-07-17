/**
 * 报告生成器
 *
 * 将分析结果生成格式化的报告
 */

import { promises as fs } from 'fs';
import path from 'path';
import { AnalysisResult } from '../analyzers/types';
import { logger } from '../utils/logger';
import dayjs from 'dayjs';

export class ReportGenerator {
  private outputDir: string;

  constructor(outputDir?: string) {
    this.outputDir = outputDir || path.resolve(process.cwd(), 'reports');
  }

  /**
   * 生成报告
   */
  async generate(analysisResult: AnalysisResult): Promise<string> {
    logger.info('Generating report...');

    await fs.mkdir(this.outputDir, { recursive: true });

    const timestamp = dayjs().format('YYYYMMDD-HHmmss');
    const reportPath = path.join(this.outputDir, `report-${timestamp}.json`);

    const report = {
      title: 'Fact Protocol Report',
      generatedAt: new Date().toISOString(),
      version: '0.1.0',
      analysis: {
        totalRecords: analysisResult.totalRecords,
        sources: analysisResult.sources,
        summary: analysisResult.summary,
      },
      facts: analysisResult.facts,
    };

    await fs.writeFile(reportPath, JSON.stringify(report, null, 2), 'utf-8');
    logger.info(`Report generated: ${reportPath}`);

    // 同时输出到控制台
    console.log('\n========================================');
    console.log('      Fact Protocol Report');
    console.log('========================================\n');
    console.log(analysisResult.summary);
    console.log('\n数据来源分布:');
    analysisResult.sources.forEach((s) => {
      console.log(`  [${s.type}] ${s.source}: ${s.count} 条记录`);
    });
    console.log(`\n提取事实: ${analysisResult.facts.length} 条`);
    console.log('\n========================================\n');

    return reportPath;
  }
}
