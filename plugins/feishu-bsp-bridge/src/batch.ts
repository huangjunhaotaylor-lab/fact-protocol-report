/**
 * feishu-bsp-bridge — 批量导入（任意飞书信息源）
 *
 * 通过 manifest（JSON 文件）批量执行录入：
 *
 * ```json
 * {
 *   "documents": [
 *     { "doc": "<token|URL>", "objectName": "仓库盘点流程", "signalBody": "..." },
 *     { "type": "chat", "ref": "oc_xxx", "objectName": "华南仓项目群", "limit": 100 },
 *     { "type": "minutes", "ref": "ob_xxx", "objectName": "周会纪要" },
 *     { "type": "task", "ref": "guid", "objectId": "OBJ-xxx",
 *       "domains": ["采购供应"], "primary_domain": "采购供应" }
 *   ]
 * }
 * ```
 *
 * 每条必须提供 doc（云文档）或 type+ref（任意信息源）。
 * 特性：
 * - 单条失败默认继续（--continue-on-error / manifest 级 continueOnError）
 * - 支持 --dry-run 全量预演
 * - 条目级 domains / primary_domain 覆盖：创建 Signal 后调
 *   POST /api/signals/:id/domains（服务端置 domain_manual，人工纠正语义）
 * - 完成后输出「分类分布」报告：本批创建信号的 domains 分布 +
 *   主线板块计数 + 未归口清单（dry-run 不产出）
 * - CLI 默认在结尾自动 gen-relations（--no-relations 关闭）
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { ingestDocument, ingestSource, IngestCoreOptions, IngestResult } from './ingest';
import { generateRelations, GenerateRelationsResult } from './relations';
import { createBspClient } from './bsp';

export interface ManifestDocument extends Omit<IngestCoreOptions, 'dryRun'> {
  /** 飞书云文档 token 或 URL（doc 来源，与 type+ref 二选一） */
  doc?: string;
  /** 任意信息源类型：doc | chat | minutes | task | mail | sheet | bitable | approval */
  type?: string;
  /** 信息源引用（chat_id / minute_token / guid ...） */
  ref?: string;
  /** 传给适配器的额外选项（如 chat 的 limit/start/end） */
  sourceOpts?: Record<string, unknown>;
  /** 单条失败是否继续（覆盖全局配置） */
  continueOnError?: boolean;
  /** G4：板块覆盖 —— 创建 Signal 后覆盖其 domains（人工纠正，置 domain_manual） */
  domains?: string[];
  /** G4：主线板块覆盖（必须是 domains 之一；缺省取 domains[0]） */
  primary_domain?: string;
}

export interface Manifest {
  documents: ManifestDocument[];
  /** 全局：单条失败是否继续（默认 false） */
  continueOnError?: boolean;
}

export interface BatchItemResult {
  label: string;
  ok: boolean;
  result?: IngestResult;
  error?: string;
}

/** G4：分类分布报告（本批创建信号的板块统计） */
export interface BatchDomainReport {
  /** 本批成功创建的信号总数 */
  total_signals: number;
  /** domains 分布：板块名 → 信号数（一个信号可属多个板块，分别计数） */
  by_domain: Record<string, number>;
  /** 主线板块计数：primary_domain → 信号数 */
  primary_counts: Record<string, number>;
  /** 未归口清单（domains 为空的信号） */
  unclassified: Array<{ signal: string; label: string }>;
}

export interface BatchResult {
  manifest: string;
  total: number;
  succeeded: number;
  failed: number;
  items: BatchItemResult[];
  relations?: GenerateRelationsResult;
  /** G4：分类分布报告（dry-run 或无成功条目时不产出） */
  domainReport?: BatchDomainReport;
  dryRun: boolean;
}

/** 读取并校验 manifest 文件 */
export function loadManifest(manifestPath: string): Manifest {
  const raw = fs.readFileSync(path.resolve(manifestPath), 'utf-8');
  const parsed = JSON.parse(raw) as Manifest;
  if (!Array.isArray(parsed.documents) || parsed.documents.length === 0) {
    throw new Error('manifest 必须包含非空 documents 数组');
  }
  for (const d of parsed.documents) {
    const hasDoc = typeof d.doc === 'string' && d.doc.length > 0;
    const hasSource = typeof d.type === 'string' && typeof d.ref === 'string' && d.ref.length > 0;
    if (!hasDoc && !hasSource) {
      throw new Error('manifest 中每条记录必须提供 doc（云文档）或 type+ref（任意信息源）');
    }
    // G4：板块覆盖字段校验（与服务端 manualCorrect 校验对齐，提前失败）
    if (d.domains !== undefined) {
      if (!Array.isArray(d.domains) || d.domains.some((x) => typeof x !== 'string' || x.length === 0)) {
        throw new Error('manifest 条目的 domains 必须是非空字符串数组');
      }
      if (d.primary_domain !== undefined && !d.domains.includes(d.primary_domain)) {
        throw new Error('manifest 条目的 primary_domain 必须是 domains 之一');
      }
    } else if (d.primary_domain !== undefined) {
      throw new Error('manifest 条目指定 primary_domain 时必须同时提供 domains');
    }
  }
  return parsed;
}

/** 执行单条录入（doc 或 任意信息源） */
async function runEntry(
  entry: ManifestDocument,
  dryRun: boolean,
  env: NodeJS.ProcessEnv,
): Promise<IngestResult> {
  // domains / primary_domain 由 batch 层在创建 Signal 后处理，不透传给 ingest 选项
  const { continueOnError: _c, domains: _d, primary_domain: _p, ...core } = entry;
  const withDryRun = { ...core, dryRun };
  if (core.type && core.ref) {
    const { type, ref, sourceOpts, ...rest } = withDryRun;
    return ingestSource(
      { type, ref, sourceOpts, ...(rest as object) } as never,
      env,
    );
  }
  return ingestDocument({ doc: core.doc!, ...(withDryRun as object) } as never, env);
}

/** G4：汇总本批创建信号的分类分布报告 */
export function buildDomainReport(items: BatchItemResult[]): BatchDomainReport {
  const report: BatchDomainReport = {
    total_signals: 0,
    by_domain: {},
    primary_counts: {},
    unclassified: [],
  };
  for (const item of items) {
    if (!item.ok || !item.result?.signal) continue;
    const sig = item.result.signal;
    // dry-run 占位信号不计入
    if (item.result.dryRun || sig.id === '(dry-run)') continue;
    report.total_signals += 1;
    const domains = sig.domains ?? [];
    if (domains.length === 0) {
      report.unclassified.push({ signal: sig.id, label: item.label });
      continue;
    }
    for (const d of domains) {
      report.by_domain[d] = (report.by_domain[d] ?? 0) + 1;
    }
    const primary = sig.primary_domain ?? null;
    if (primary) {
      report.primary_counts[primary] = (report.primary_counts[primary] ?? 0) + 1;
    }
  }
  return report;
}

/** 批量导入 */
export async function batchIngest(
  manifestPath: string,
  opts: { dryRun?: boolean; continueOnError?: boolean; relations?: boolean } = {},
  env: NodeJS.ProcessEnv = process.env,
): Promise<BatchResult> {
  const manifest = loadManifest(manifestPath);
  const globalContinue = opts.continueOnError ?? manifest.continueOnError ?? false;
  const bsp = createBspClient(env);

  const items: BatchItemResult[] = [];
  let succeeded = 0;
  let failed = 0;

  for (const entry of manifest.documents) {
    const label = entry.doc ?? `${entry.type}:${entry.ref}`;
    try {
      const result = await runEntry(entry, Boolean(opts.dryRun), env);

      // G4：条目级板块覆盖（仅实跑；服务端置 domain_manual，视为人工纠正）
      if (!opts.dryRun && entry.domains) {
        try {
          const corrected = await bsp.setSignalDomains(result.signal.id, {
            domains: entry.domains,
            ...(entry.primary_domain !== undefined && { primary_domain: entry.primary_domain }),
          });
          result.signal = {
            ...result.signal,
            domains: corrected.domains ?? [...entry.domains],
            primary_domain: corrected.primary_domain ?? entry.primary_domain ?? entry.domains[0] ?? null,
          };
        } catch (e) {
          throw new Error(`信号 ${result.signal.id} 已创建，但板块覆盖失败：${(e as Error).message}`);
        }
      }

      succeeded += 1;
      items.push({ label, ok: true, result });
    } catch (e) {
      failed += 1;
      items.push({ label, ok: false, error: (e as Error).message });
      if (!globalContinue && !entry.continueOnError) break;
    }
  }

  let relations: GenerateRelationsResult | undefined;
  if (opts.relations && !opts.dryRun) {
    relations = await generateRelations({ dryRun: opts.dryRun }, env);
  }

  // G4：分类分布报告（dry-run 无真实信号，不产出）
  const domainReport = opts.dryRun ? undefined : buildDomainReport(items);

  return {
    manifest: manifestPath,
    total: manifest.documents.length,
    succeeded,
    failed,
    items,
    relations,
    domainReport,
    dryRun: Boolean(opts.dryRun),
  };
}
