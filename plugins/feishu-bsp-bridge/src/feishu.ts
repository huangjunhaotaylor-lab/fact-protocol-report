/**
 * feishu-bsp-bridge — 飞书(lark-cli) 适配层
 *
 * 通过子进程调用 lark-cli 完成飞书文档的发现与读取。
 * lark-cli 是官方 CLI（@larksuite/cli），使用独立的凭证库
 * （~/.lark-cli/），先运行 `lark-cli auth status` 确认有效。
 *
 * 环境变量：
 *   LARK_CLI_BIN  lark-cli 可执行文件路径，默认取 PATH 中的 lark-cli
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface SearchOptions {
  mine?: boolean;
  onlyTitle?: boolean;
  docTypes?: string[];
  pageSize?: number;
}

export interface SearchResult {
  token: string;
  title: string;
  url: string;
  docTypes: string;
  createTimeIso?: string;
}

export interface FeishuDocument {
  token: string;
  title: string;
  content: string;
  url?: string;
}

export interface LarkApiResponse {
  ok: boolean;
  identity?: string;
  data?: any;
  error?: { code?: number | string; message?: string };
}

/** 解析 lark-cli 二进制路径 */
export function larkBin(env: NodeJS.ProcessEnv = process.env): string {
  return env.LARK_CLI_BIN || 'lark-cli';
}

/** 执行 lark-cli 并解析 JSON 输出 */
async function runLark(args: string[], env: NodeJS.ProcessEnv = process.env): Promise<LarkApiResponse> {
  const { stdout } = await execFileAsync(larkBin(env), args, {
    env,
    maxBuffer: 64 * 1024 * 1024,
  });
  return JSON.parse(stdout) as LarkApiResponse;
}

/** 检查 lark-cli 可用性与认证状态 */
export async function checkAuth(env: NodeJS.ProcessEnv = process.env): Promise<{ ok: boolean; detail: string }> {
  try {
    const { stdout } = await execFileAsync(larkBin(env), ['auth', 'status'], { env });
    const raw = JSON.parse(stdout);
    const user = raw?.identities?.user;
    const ok = raw?.identities?.bot?.status === 'ready' && user?.status === 'ready' && user?.tokenStatus === 'valid';
    return {
      ok,
      detail: ok
        ? `认证有效：${user?.userName}（${user?.openId}），token 有效期至 ${user?.expiresAt}`
        : `认证不可用：${JSON.stringify(raw?.identities)}`,
    };
  } catch (e) {
    return { ok: false, detail: `lark-cli 不可用：${(e as Error).message}` };
  }
}

/** drive +search：搜索飞书文档（默认仅标题、仅我的文档） */
export async function searchDocs(
  query: string,
  opts: SearchOptions = {},
  env: NodeJS.ProcessEnv = process.env,
): Promise<SearchResult[]> {
  const args = ['drive', '+search', '--query', query, '--page-size', String(opts.pageSize ?? 10)];
  if (opts.mine !== false) args.push('--mine');
  if (opts.onlyTitle !== false) args.push('--only-title');
  if (opts.docTypes?.length) args.push('--doc-types', opts.docTypes.join(','));

  const res = await runLark(args, env);
  if (!res.ok) {
    throw new Error(`飞书搜索失败：${JSON.stringify(res.error)}`);
  }
  return (res.data?.results ?? []).map((r: any) => {
    const meta = r.result_meta ?? {};
    return {
      token: meta.token ?? meta.obj_token,
      title: (r.title_highlighted ?? '').replace(/<\/?h>/g, ''),
      url: meta.url ?? '',
      docTypes: meta.doc_types ?? '',
      createTimeIso: meta.create_time_iso,
    };
  });
}

/** drive +inspect：解析飞书 URL（wiki 节点 → 底层文档 token） */
export async function inspectUrl(url: string, env: NodeJS.ProcessEnv = process.env): Promise<{ token: string; type?: string; title?: string }> {
  const res = await runLark(['drive', '+inspect', '--url', url], env);
  if (!res.ok) {
    throw new Error(`URL 解析失败：${JSON.stringify(res.error)}`);
  }
  return { token: res.data?.token, type: res.data?.type, title: res.data?.title };
}

/** 读取 docx 文档原文（raw_content） */
export async function readDocxRawContent(token: string, env: NodeJS.ProcessEnv = process.env): Promise<string> {
  const res = await runLark(
    ['--as', 'user', 'api', 'GET', `/open-apis/docx/v1/documents/${token}/raw_content`],
    env,
  );
  if (!res.ok) {
    throw new Error(`读取飞书文档失败（${token}）：${JSON.stringify(res.error)}`);
  }
  return res.data?.content ?? '';
}

/**
 * 读取飞书文档：接受裸 token 或 URL。
 * wiki URL 会自动解包（inspect）到底层 docx token。
 * 注意：raw_content 仅支持 docx 类型文档，旧版 DOC 会报错。
 */
export async function readDocument(input: string, env: NodeJS.ProcessEnv = process.env): Promise<FeishuDocument> {
  let token = input;
  let url: string | undefined;
  let title = '';

  if (input.startsWith('http://') || input.startsWith('https://')) {
    url = input;
    const resolved = await inspectUrl(input, env);
    token = resolved.token;
    title = resolved.title ?? '';
  }

  const content = await readDocxRawContent(token, env);
  if (!content.trim()) {
    throw new Error(`飞书文档为空或无法读取：${token}`);
  }
  if (!title) title = token;
  return { token, title, content, url };
}
