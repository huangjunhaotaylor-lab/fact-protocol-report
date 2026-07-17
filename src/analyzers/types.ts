/**
 * 数据分析类型定义
 */

/** 分析结果 */
export interface AnalysisResult {
  /** 总记录数 */
  totalRecords: number;
  /** 数据来源统计 */
  sources: SourceStats[];
  /** 数据摘要 */
  summary: string;
  /** 提取的事实 */
  facts: ExtractedFact[];
  /** 分析时间 */
  analyzedAt: Date;
}

/** 数据来源统计 */
export interface SourceStats {
  source: string;
  type: string;
  count: number;
}

/** 提取的事实 */
export interface ExtractedFact {
  id: string;
  source: string;
  timestamp: string;
  description: string;
  confidence: number;
}
