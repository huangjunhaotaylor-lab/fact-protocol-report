/**
 * feishu-bsp-bridge — 飞书多来源适配器
 *
 * BSP 协议是来源无关的：Evidence 的合法来源包括 会议 / PRD / 邮件 / ERP / 飞书 / Jira /
 * 表格 / Agent 输出 / AI 输出 / 人工输入（协议 6.1）。飞书上的信息远不止云文档——
 * 群聊消息、妙记（会议纪要）、任务、审批、邮件、多维表格、电子表格都可作为 Evidence。
 *
 * 本模块定义 SourceAdapter 注册表：每个适配器负责把一类飞书信息
 * 归一化为 SourceContent（纯文本 content + 元数据），再交给来源无关的
 * ingestContent 落库管线（Evidence → Fragment → Signal → Object）。
 *
 * 已实现并实测：doc（docx/wiki）、chat（群聊消息）、minutes（妙记）、task（任务）
 * 实验性（需提供 token/id 触发，best-effort）：mail、sheet、bitable、approval
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { larkBin } from './feishu';

const execFileAsync = promisify(execFile);

/* ---------------- 类型 ---------------- */

export interface SourceContent {
  /** 来源引用（token / chat_id / guid ...） */
  ref: string;
  /** 标题（fallback 为 ref） */
  title: string;
  /** 归一化纯文本 —— 作为 Evidence.content 的"原文" */
  content: string;
  /** 可访问 URL（如有） */
  url?: string;
  /** 映射到 BSP EvidenceSource：feishu | meeting | email | spreadsheet | other */
  bspSource: string;
  /** 进入 Evidence.metadata 的附加信息 */
  metadata: Record<string, unknown>;
}

export interface SourceRef {
  type: string;
  ref: string;
  title: string;
}

export interface SourceFetchOptions {
  /** 最大条目数（聊天消息条数、任务条数等） */
  limit?: number;
  /** 时间范围（chat 用 ISO 8601） */
  start?: string;
  end?: string;
}

export interface SourceAdapter {
  type: string;
  label: string;
  bspSource: string;
  /** 按 ref 获取并归一化内容 */
  fetch(ref: string, opts?: SourceFetchOptions): Promise<SourceContent>;
  /** 发现能力（列表/搜索），可选 */
  list?(opts?: SourceFetchOptions): Promise<SourceRef[]>;
}

/* ---------------- lark-cli 执行 ---------------- */

async function runLark(args: string[], env: NodeJS.ProcessEnv = process.env): Promise<any> {
  const { stdout } = await execFileAsync(larkBin(env), args, { env, maxBuffer: 128 * 1024 * 1024 });
  const lines = stdout.split('\n');
  // typed 命令可能带日志/摘要前缀行（如 "[lark-cli] [WARN] ..." / "Found N node(s)"），
  // JSON 正文从第一个以 { 开头的行开始（消息体字符串内的 { 都在 JSON 内部，不受影响）
  const start = lines.findIndex((l) => l.trimStart().startsWith('{'));
  if (start < 0) throw new Error(`lark-cli 输出非 JSON：${stdout.slice(0, 300)}`);
  const json = lines.slice(start).join('\n');
  try {
    return JSON.parse(json);
  } catch (e) {
    throw new Error(`lark-cli 输出解析失败：${(e as Error).message}\n${json.slice(0, 300)}`);
  }
}

function assertOk(res: any, label: string): any {
  if (!res?.ok) {
    throw new Error(`${label}失败：${JSON.stringify(res?.error ?? res)}`);
  }
  return res;
}

/* ---------------- 纯函数：内容归一化（可单测） ---------------- */

/** 解析消息 body.content（JSON 字符串或对象）为纯文本 */
export function extractMessageText(body: { content?: string | Record<string, unknown> }): string {
  let parsed: any = body?.content;
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return parsed; // 非 JSON 的裸文本
    }
  }
  if (!parsed || typeof parsed === 'string') return String(parsed ?? '');

  // text 类型：{"text": "..."}
  if (typeof parsed.text === 'string') return parsed.text;

  // post 类型：{"title": "...", "content": [[{tag:"text",text:"..."},{tag:"a",text:"..."}],...]}
  // interactive/card 类型：{"elements": [[...],...]}
  const segments: string[] = [];
  const walk = (node: any): void => {
    if (!node) return;
    if (typeof node === 'string') {
      segments.push(node);
      return;
    }
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    if (typeof node === 'object') {
      if (typeof node.text === 'string' && (node.tag === 'text' || node.tag === 'a' || node.tag === 'at')) {
        segments.push(node.text);
        return;
      }
      if (typeof node.text === 'string') {
        segments.push(node.text);
        return;
      }
      if (Array.isArray(node.content)) {
        for (const item of node.content) walk(item);
      }
      if (Array.isArray(node.elements)) {
        for (const item of node.elements) walk(item);
      }
      if (node.tag === 'note' || node.tag === 'hr' || node.tag === 'button') {
        // 卡片装饰元素：递归其 elements（如有）
        if (Array.isArray(node.elements)) for (const item of node.elements) walk(item);
      }
    }
  };
  walk(parsed.content ?? parsed.elements ?? parsed);
  return segments.filter(Boolean).join('');
}

/** 剥离卡片类消息的 <card> 标记，保留正文文本 */
export function stripCardTags(text: string): string {
  return text.replace(/<card[^>]*>/g, '').replace(/<\/card>/g, '').trim();
}

/** 时间归一化：13 位毫秒时间戳 → ISO；已格式化字符串原样保留 */
export function normalizeTime(time?: string): string {
  if (!time) return '';
  if (/^\d{13}$/.test(time)) return new Date(Number(time)).toISOString();
  return time;
}

/**
 * 群聊消息列表 → 归一化文本（纯函数，可单测）。
 * 兼容两种输出形状：
 * - raw API：msg.body.content 为 JSON 字符串（text/post/interactive）
 * - typed 命令（im +chat-messages-list）：msg.content 为卡片/富文本字符串
 */
export function flattenChatMessages(
  items: Array<{
    message_id?: string;
    msg_type?: string;
    create_time?: string;
    sender?: any;
    body?: any;
    content?: string;
  }>,
  opts: { limit?: number } = {},
): { content: string; count: number; skipped: number } {
  const lines: string[] = [];
  let skipped = 0;
  const list = opts.limit ? items.slice(0, opts.limit) : items;
  for (const msg of list) {
    if (['image', 'file', 'sticker', 'audio', 'video', 'media'].includes(msg.msg_type ?? '')) {
      skipped += 1;
      continue;
    }
    let text = '';
    if (msg.body && typeof msg.body.content !== 'undefined') {
      text = extractMessageText(msg.body);
    } else if (typeof msg.content === 'string') {
      text = stripCardTags(msg.content);
    }
    if (!text.trim()) {
      skipped += 1;
      continue;
    }
    const time = normalizeTime(msg.create_time);
    const sender = msg.sender?.name ? `${msg.sender.name}：` : '';
    lines.push(time ? `[${time}] ${sender}${text}` : `${sender}${text}`);
  }
  return { content: lines.join('\n'), count: list.length, skipped };
}

/** 妙记 detail 组装（纯函数，可单测） */
export function assembleMinutes(detail: any): string {
  const data = detail?.data ?? detail ?? {};
  const parts: string[] = [];
  const title = data.title ?? data.minute?.title ?? '';
  if (title) parts.push(`# ${title}`);
  if (data.summary) parts.push(`【摘要】\n${data.summary}`);
  if (Array.isArray(data.todos) && data.todos.length > 0) {
    parts.push(`【待办】\n${data.todos.map((t: any) => `- ${typeof t === 'string' ? t : JSON.stringify(t)}`).join('\n')}`);
  }
  if (Array.isArray(data.chapters) && data.chapters.length > 0) {
    parts.push(`【章节】\n${data.chapters.map((c: any) => `- ${c.title ?? c}`).join('\n')}`);
  }
  if (data.keywords?.length) parts.push(`【关键词】${data.keywords.join('、')}`);
  return parts.join('\n\n');
}

/* ---------------- 适配器 ---------------- */

const docAdapter: SourceAdapter = {
  type: 'doc',
  label: '云文档 / Wiki（docx）',
  bspSource: 'feishu',
  async fetch(ref) {
    const { readDocument } = await import('./feishu');
    const doc = await readDocument(ref);
    return {
      ref: doc.token,
      title: doc.title,
      content: doc.content,
      url: doc.url,
      bspSource: 'feishu',
      metadata: { source_type: 'doc', feishu_token: doc.token, url: doc.url },
    };
  },
};

const chatAdapter: SourceAdapter = {
  type: 'chat',
  label: '群聊消息（IM）',
  bspSource: 'feishu',
  async fetch(ref, opts = {}) {
    const args = ['im', '+chat-messages-list', '--chat-id', ref, '--page-all', '--json'];
    if (opts.start) args.push('--start', opts.start);
    if (opts.end) args.push('--end', opts.end);
    const res = assertOk(await runLark(args), '聊天消息');
    const items = res.data?.messages ?? res.data?.items ?? [];
    const { content, count, skipped } = flattenChatMessages(items, { limit: opts.limit });
    return {
      ref,
      title: `群聊消息 ${ref}`,
      content,
      bspSource: 'feishu',
      metadata: { source_type: 'chat', chat_id: ref, message_count: count, skipped_non_text: skipped },
    };
  },
  async list() {
    const res = assertOk(await runLark(['im', '+chat-list', '--page-all', '--json']), '群聊列表');
    const items = res.data?.items ?? res.data?.chats ?? res.data?.chats_list ?? [];
    return items.map((c: any) => ({ type: 'chat', ref: c.chat_id ?? c.id, title: c.name ?? c.chat_id ?? '' }));
  },
};

const minutesAdapter: SourceAdapter = {
  type: 'minutes',
  label: '妙记（会议纪要）',
  bspSource: 'meeting',
  async fetch(ref, opts = {}) {
    const args = ['minutes', '+detail', '--minute-tokens', ref, '--summary', '--todo', '--chapter', '--keyword', '--json'];
    const res = assertOk(await runLark(args), '妙记');
    const detail = res.data?.minutes?.[0] ?? res.data ?? {};
    const content = assembleMinutes(detail);
    if (!content.trim()) throw new Error(`妙记 ${ref} 无可用文本内容（无摘要/待办/章节）`);
    return {
      ref,
      title: detail.title ?? `妙记 ${ref}`,
      content,
      bspSource: 'meeting',
      metadata: { source_type: 'minutes', minute_token: ref, title: detail.title },
    };
  },
};

const taskAdapter: SourceAdapter = {
  type: 'task',
  label: '任务（Task）',
  bspSource: 'feishu',
  async fetch(ref, opts = {}) {
    const args = ['--as', 'user', 'api', 'GET', `/open-apis/task/v2/tasks/${ref}`];
    const res = assertOk(await runLark(args), '任务');
    const t = res.data?.task ?? {};
    const parts = [t.summary ?? ''];
    if (t.description) parts.push(t.description);
    if (t.due?.timestamp) parts.push(`截止：${new Date(Number(t.due.timestamp)).toISOString()}`);
    const content = parts.filter(Boolean).join('\n');
    if (!content.trim()) throw new Error(`任务 ${ref} 无文本内容`);
    return {
      ref,
      title: t.summary ?? `任务 ${ref}`,
      content,
      bspSource: 'feishu',
      metadata: { source_type: 'task', task_guid: ref, status: t.completed ? 'completed' : 'incomplete' },
    };
  },
  async list(opts = {}) {
    const args = ['task', '+get-my-tasks', '--page-all', '--json'];
    const res = assertOk(await runLark(args), '我的任务');
    const items = res.data?.tasks ?? res.data?.items ?? [];
    return items.map((t: any) => ({
      type: 'task',
      ref: t.guid ?? t.task?.guid,
      title: t.summary ?? t.task?.summary ?? '',
    }));
  },
};

const mailAdapter: SourceAdapter = {
  type: 'mail',
  label: '邮件（Mail，实验性）',
  bspSource: 'email',
  async fetch(ref) {
    const res = assertOk(
      await runLark(['mail', '+message', '--message-id', ref, '--html=false', '--json']),
      '邮件',
    );
    const body = res.data?.body_text ?? res.data?.plain_text ?? res.data?.body ?? '';
    const subject = res.data?.subject ?? res.data?.headers?.subject ?? '';
    return {
      ref,
      title: subject || `邮件 ${ref}`,
      content: `${subject ? `# ${subject}\n` : ''}${body}`,
      bspSource: 'email',
      metadata: { source_type: 'mail', message_id: ref, subject },
    };
  },
};

const sheetAdapter: SourceAdapter = {
  type: 'sheet',
  label: '电子表格（Sheets，实验性）',
  bspSource: 'spreadsheet',
  async fetch(ref) {
    const res = assertOk(
      await runLark(['--as', 'user', 'api', 'GET', `/open-apis/sheets/v3/spreadsheets/${ref}/sheets/query`]),
      '电子表格',
    );
    const sheets = res.data?.sheets ?? [];
    const meta = res.data?.spreadsheet ?? {};
    const lines = [`# ${meta.title ?? ref}`];
    for (const s of sheets.slice(0, 5)) {
      lines.push(`## ${s.title ?? s.sheet_id}`);
      const vals = await runLark([
        '--as', 'user', 'api', 'GET',
        `/open-apis/sheets/v2/spreadsheets/${ref}/values/${encodeURIComponent(s.sheet_id + '!A1:Z50')}`,
      ]);
      const rows: string[][] = vals.data?.valueRange?.values ?? [];
      for (const row of rows.slice(0, 30)) {
        lines.push(row.map((c: any) => String(c ?? '')).join(' | '));
      }
    }
    return {
      ref,
      title: meta.title ?? `表格 ${ref}`,
      content: lines.join('\n'),
      bspSource: 'spreadsheet',
      metadata: { source_type: 'sheet', spreadsheet_token: ref },
    };
  },
};

const bitableAdapter: SourceAdapter = {
  type: 'bitable',
  label: '多维表格（Bitable，实验性）',
  bspSource: 'spreadsheet',
  async fetch(ref) {
    const app = assertOk(
      await runLark(['base', '+app-get', '--app-token', ref, '--json']).catch(() =>
        runLark(['--as', 'user', 'api', 'GET', `/open-apis/bitable/v1/apps/${ref}`]),
      ),
      '多维表格',
    );
    const tables = await runLark(['--as', 'user', 'api', 'GET', `/open-apis/bitable/v1/apps/${ref}/tables`]);
    const lines: string[] = [];
    for (const t of (tables.data?.items ?? []).slice(0, 5)) {
      lines.push(`## ${t.name ?? t.table_id}`);
      const recs = await runLark([
        '--as', 'user', 'api', 'GET',
        `/open-apis/bitable/v1/apps/${ref}/tables/${t.table_id}/records?page_size=20`,
      ]);
      for (const r of (recs.data?.items ?? []).slice(0, 20)) {
        lines.push(JSON.stringify(r.fields ?? {}));
      }
    }
    return {
      ref,
      title: app.data?.app?.name ?? `多维表格 ${ref}`,
      content: lines.join('\n'),
      bspSource: 'spreadsheet',
      metadata: { source_type: 'bitable', app_token: ref },
    };
  },
};

const approvalAdapter: SourceAdapter = {
  type: 'approval',
  label: '审批（Approval，实验性）',
  bspSource: 'other',
  async fetch(ref) {
    const res = assertOk(
      await runLark(['--as', 'user', 'api', 'GET', `/open-apis/approval/v4/instances/${ref}`]),
      '审批',
    );
    const inst = res.data?.instance ?? res.data ?? {};
    const name = inst.name ?? inst.instance_name ?? '';
    const status = inst.status_text ?? inst.status ?? '';
    const form = Array.isArray(inst.form) ? inst.form.map((f: any) => `${f.name ?? ''}: ${f.value ?? ''}`).join('\n') : '';
    return {
      ref,
      title: name || `审批 ${ref}`,
      content: [name, `状态：${status}`, form].filter(Boolean).join('\n'),
      bspSource: 'other',
      metadata: { source_type: 'approval', instance_id: ref, status },
    };
  },
};

/* ---------------- 注册表 ---------------- */

const REGISTRY: Record<string, SourceAdapter> = {
  doc: docAdapter,
  chat: chatAdapter,
  minutes: minutesAdapter,
  task: taskAdapter,
  mail: mailAdapter,
  sheet: sheetAdapter,
  bitable: bitableAdapter,
  approval: approvalAdapter,
};

/** 列出全部支持的信息源 */
export function listSources(): SourceAdapter[] {
  return Object.values(REGISTRY);
}

export function getAdapter(type: string): SourceAdapter {
  const adapter = REGISTRY[type];
  if (!adapter) {
    throw new Error(
      `未知信息源类型：${type}。支持：${Object.keys(REGISTRY).join(', ')}（sources 命令查看详情）`,
    );
  }
  return adapter;
}

/** 按类型 + ref 获取归一化内容 */
export function fetchSource(
  type: string,
  ref: string,
  opts?: SourceFetchOptions,
): Promise<SourceContent> {
  return getAdapter(type).fetch(ref, opts);
}

/** 发现候选（适配器支持 list 时） */
export async function listCandidates(
  type: string,
  opts?: SourceFetchOptions,
): Promise<SourceRef[]> {
  const adapter = getAdapter(type);
  if (!adapter.list) throw new Error(`信息源 ${type} 不支持列表发现`);
  return adapter.list(opts);
}
