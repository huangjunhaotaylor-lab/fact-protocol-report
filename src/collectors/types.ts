/**
 * 数据采集器类型定义
 */

/** 数据源类型 */
export type SourceType = 'api' | 'web' | 'file';

/** 原始数据记录 */
export interface RawData {
  /** 数据唯一标识 */
  id: string;
  /** 数据来源 */
  source: string;
  /** 来源类型 */
  sourceType: SourceType;
  /** 采集时间 */
  collectedAt: Date;
  /** 原始内容 */
  content: unknown;
  /** 元数据 */
  metadata?: Record<string, unknown>;
}

/** API 采集器配置 */
export interface ApiCollectorConfig {
  /** API 地址 */
  url: string;
  /** 请求方法 */
  method?: 'GET' | 'POST';
  /** 请求头 */
  headers?: Record<string, string>;
  /** 超时时间 (ms) */
  timeout?: number;
}

/** Web 采集器配置 */
export interface WebCollectorConfig {
  /** 目标 URL */
  url: string;
  /** CSS 选择器 */
  selector?: string;
}

/** 文件采集器配置 */
export interface FileCollectorConfig {
  /** 文件路径 */
  path: string;
  /** 文件格式 */
  format?: 'json' | 'csv' | 'xml';
}
