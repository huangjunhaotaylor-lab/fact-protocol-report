/**
 * feishu-bsp-bridge — BSP Reality Layer HTTP 客户端
 *
 * 调用本地 BSP 服务（fact-protocol-report）的 REST API。
 *
 * 环境变量：
 *   BSP_API_BASE  BSP 服务地址，默认 http://localhost:3000
 */

export interface EvidenceInput {
  source: string;
  content: string;
  source_id?: string;
  creator?: string;
  metadata?: Record<string, unknown>;
}

export interface FragmentInput {
  evidence_id: string;
  type: string;
  content: string;
  speaker?: string;
  section?: string;
  metadata?: Record<string, unknown>;
}

export interface ObjectInput {
  type: string;
  name: string;
  namedId?: boolean;
  aliases?: string[];
  metadata?: Record<string, unknown>;
}

export interface SignalInput {
  type: string;
  body: string;
  fragments: string[];
  anchors: string[];
  context?: Record<string, unknown>;
  confidence: number;
  actors?: string[];
  occurred_at?: string;
  attributes?: Record<string, unknown>;
}

export interface TraceChainItem {
  signal: { id: string; body: string; state: string };
  fragment: { id: string; content: string };
  evidence: { id: string; content: string };
  position: { start: number; end: number } | null;
}

export interface SignalTrace {
  signal: { id: string; body: string; state: string };
  fragments: Array<{ id: string; content: string }>;
  evidences: Array<{ id: string; content: string }>;
  chain: TraceChainItem[];
}

export interface BspSignal {
  id: string;
  type: string;
  body: string;
  state: string;
  anchors: string[];
  fragments: string[];
  confidence: number;
  /** G0 自动分类板块（创建 Signal 时服务端写入） */
  domains?: string[];
  /** 主线板块 */
  primary_domain?: string | null;
}

/** POST /api/signals/:id/domains 入参（人工纠正，服务端会置 domain_manual） */
export interface SignalDomainsInput {
  domains: string[];
  primary_domain?: string;
}

export interface BspRelation {
  id: string;
  source: string;
  target: string;
  type: string;
  derived_from: string;
  confidence: number;
}

export interface RelationInput {
  source: string;
  target: string;
  type: string;
  derived_from: string;
  confidence: number;
}

/** BSP 服务基础地址 */
export function bspBase(env: NodeJS.ProcessEnv = process.env): string {
  return env.BSP_API_BASE || 'http://localhost:3000';
}

/** 通用请求封装 */
async function req(base: string, method: string, path: string, body?: unknown): Promise<any> {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    const err = data?.error ?? {};
    throw new Error(`BSP ${method} ${path} 失败（HTTP ${res.status}）：${err.code ?? ''} ${err.message ?? text}`);
  }
  return data;
}

export interface BspClient {
  createEvidence(input: EvidenceInput): Promise<{ id: string }>;
  getEvidence(id: string): Promise<{ id: string; content: string; source: string; metadata?: Record<string, unknown> }>;
  listEvidences(): Promise<Array<{ id: string; source: string; source_id?: string; checksum: string }>>;
  createFragment(input: FragmentInput): Promise<{ id: string; evidence_id: string }>;
  listFragmentsByEvidence(evidenceId: string): Promise<Array<{ id: string; content: string }>>;
  createObject(input: ObjectInput): Promise<{ id: string; name: string; type: string }>;
  listObjects(): Promise<Array<{ id: string; name: string; type: string; state: string }>>;
  createSignal(input: SignalInput): Promise<{ id: string; body: string; state: string; domains?: string[]; primary_domain?: string | null }>;
  /** G4：人工纠正 Signal 板块（POST /api/signals/:id/domains，服务端置 domain_manual） */
  setSignalDomains(id: string, input: SignalDomainsInput): Promise<BspSignal>;
  traceSignal(id: string): Promise<SignalTrace>;
  listSignals(): Promise<BspSignal[]>;
  listRelations(): Promise<BspRelation[]>;
  createRelation(input: RelationInput): Promise<BspRelation>;
}

/** 构造 BSP 客户端 */
export function createBspClient(env: NodeJS.ProcessEnv = process.env): BspClient {
  const base = bspBase(env);
  return {
    createEvidence: (input) => req(base, 'POST', '/api/evidences', input),
    getEvidence: (id) => req(base, 'GET', `/api/evidences/${id}`),
    listEvidences: () => req(base, 'GET', '/api/evidences'),
    createFragment: (input) => req(base, 'POST', '/api/fragments', input),
    listFragmentsByEvidence: (evidenceId) => req(base, 'GET', `/api/fragments/by-evidence/${evidenceId}`),
    createObject: (input) => req(base, 'POST', '/api/objects', input),
    listObjects: () => req(base, 'GET', '/api/objects'),
    createSignal: (input) => req(base, 'POST', '/api/signals', input),
    setSignalDomains: (id, input) => req(base, 'POST', `/api/signals/${id}/domains`, input),
    traceSignal: (id) => req(base, 'GET', `/api/signals/${id}/trace`),
    listSignals: () => req(base, 'GET', '/api/signals'),
    listRelations: () => req(base, 'GET', '/api/relations'),
    createRelation: (input) => req(base, 'POST', '/api/relations', input),
  };
}

/** 健康检查 */
export async function health(env: NodeJS.ProcessEnv = process.env): Promise<boolean> {
  try {
    const res = await fetch(`${bspBase(env)}/health`);
    return res.ok;
  } catch {
    return false;
  }
}
