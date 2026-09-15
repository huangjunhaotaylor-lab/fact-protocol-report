/**
 * feishu-bsp-bridge — 独立插件库入口
 *
 * 将飞书上的任意信息（云文档 / 群聊消息 / 妙记 / 任务 / 邮件 / 表格 / 审批）
 * 按 BSP 1.1 协议写入 Reality Layer：
 *   Feishu Source → Evidence → Fragment → Signal → Object
 *
 * 典型用法：
 *   import { ingestSource, ingestDocument, generateRelations, searchDocs } from 'feishu-bsp-bridge';
 *
 *   // 群聊消息 → BSP
 *   await ingestSource({ type: 'chat', ref: 'oc_xxx', objectName: '项目群', signalBody: '...' });
 *
 *   // 云文档 → BSP
 *   await ingestDocument({ doc: 'https://xxx.feishu.cn/wiki/XXX', objectName: '仓库盘点流程' });
 */

export {
  ingestDocument,
  ingestSource,
  ingestContent,
  attachSignal,
  splitContent,
  checkAuth,
  type IngestOptions,
  type IngestSourceOptions,
  type IngestCoreOptions,
  type IngestResult,
  type AttachSignalOptions,
  type AttachSignalResult,
} from './ingest';

export {
  listSources,
  getAdapter,
  fetchSource,
  listCandidates,
  extractMessageText,
  flattenChatMessages,
  assembleMinutes,
  stripCardTags,
  normalizeTime,
  type SourceAdapter,
  type SourceContent,
  type SourceRef,
  type SourceFetchOptions,
} from './sources';

export {
  searchDocs,
  readDocument,
  inspectUrl,
  readDocxRawContent,
  larkBin,
  type FeishuDocument,
  type SearchResult,
} from './feishu';

export {
  batchIngest,
  loadManifest,
  buildDomainReport,
  type Manifest,
  type ManifestDocument,
  type BatchResult,
  type BatchItemResult,
  type BatchDomainReport,
} from './batch';

export {
  generateRelations,
  computeRelations,
  type ProposedRelation,
  type GenerateRelationsResult,
  type GenerateRelationsOptions,
} from './relations';

export {
  runSync,
  loadSyncConfig,
  loadState,
  saveState,
  sha256,
  bucketByDay,
  type SyncConfig,
  type SyncSourceConfig,
  type SourceState,
  type SyncRunResult,
  type SyncPerSource,
} from './sync';

export {
  createBspClient,
  health,
  bspBase,
  type BspClient,
  type SignalTrace,
  type BspSignal,
  type BspRelation,
  type RelationInput,
  type SignalDomainsInput,
} from './bsp';
