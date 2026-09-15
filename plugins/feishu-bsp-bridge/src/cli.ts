/**
 * feishu-bsp-bridge — CLI 入口
 *
 * 用法（在插件目录下）：
 *   npm run cli -- auth-check
 *   npm run cli -- sources
 *   npm run cli -- search --query "关键词" [--limit 10]
 *   npm run cli -- read --doc <token|URL>
 *   npm run cli -- fetch <type> --ref <id> [--limit N]        # 预览任意飞书信息源
 *   npm run cli -- ingest --doc <token|URL> [--object-name 名称] [--signal-body "..."] [--dry-run]
 *   npm run cli -- ingest-source <type> --ref <id> [--object-name 名称] [--signal-body "..."] [--dry-run]
 *   npm run cli -- batch-ingest --manifest manifest.json [--continue-on-error] [--no-relations]
 *   npm run cli -- gen-relations [--dry-run]
 *   npm run cli -- trace --signal <signal_id>
 *   npm run cli -- objects
 *   npm run cli -- help
 *
 * 环境变量：
 *   LARK_CLI_BIN   lark-cli 路径（默认 PATH）
 *   BSP_API_BASE   BSP 服务地址（默认 http://localhost:3000）
 */

import { searchDocs, readDocument, checkAuth } from './feishu';
import { ingestDocument, ingestSource, attachSignal, IngestOptions } from './ingest';
import { listSources, fetchSource, listCandidates } from './sources';
import { loadSyncConfig, runSync } from './sync';
import { batchIngest } from './batch';
import { generateRelations } from './relations';
import { createBspClient, health } from './bsp';

function print(obj: unknown): void {
  console.log(JSON.stringify(obj, null, 2));
}

function getArg(args: string[], name: string): string | undefined {
  const idx = args.indexOf(`--${name}`);
  return idx >= 0 ? args[idx + 1] : undefined;
}

function hasFlag(args: string[], name: string): boolean {
  return args.includes(`--${name}`);
}

function showHelp(): void {
  console.log(`
feishu-bsp-bridge — 飞书 → BSP 独立插件

Commands:
  auth-check              检查 lark-cli 认证与 BSP 服务状态
  sources                 列出支持的飞书信息源（doc/chat/minutes/task/mail/sheet/bitable/approval）
  search                  搜索飞书文档
    --query <关键词> [--limit 10] [--no-mine] [--all-types]
  read                    预览飞书文档内容
    --doc <token|URL>
  fetch                    预览任意飞书信息源内容
    <type> --ref <id>      type: doc|chat|minutes|task|mail|sheet|bitable|approval
    [--limit N]            聊天消息条数上限
  ingest                  飞书文档 → Evidence → Fragment → Signal → Object
    --doc <token|URL>
    [--object-id <id>]    锚定已有 Object
    [--object-name 名称]   按名称查找/创建 Object（默认用文档标题）
    [--anchors id1,id2]   直接指定多个锚定 Object（覆盖单一锚点）
    [--signal-body 文本]   Signal body（默认取第一个 Fragment，可能被 AC-008 拒绝）
    [--signal-type type]   observation|event|change|status|action（默认 observation）
    [--confidence 0-1]    默认 0.9
    [--min-len N]         Fragment 最小长度（默认 4）
    [--dry-run]           仅打印计划，不写入
  ingest-source            任意飞书信息源 → Evidence → Fragment → Signal → Object
    <type> --ref <id>      type: doc|chat|minutes|task|mail|sheet|bitable|approval
    [--object-name 名称] [--anchors id1,id2] [--signal-body 文本]
    [--signal-type type] [--confidence 0-1] [--min-len N] [--dry-run]
    [--limit N]            聊天消息条数上限（chat 来源）
  attach-signal            在已有 Evidence 上追加 Signal（复用其 Fragment）
    --evidence <id> --body "事实观察"
    [--anchors id1,id2 | --object-name 名称]
    [--signal-type type] [--confidence 0-1]
  batch-ingest             按 manifest 批量导入
    --manifest <json文件>
    [--continue-on-error]  单条失败继续（默认失败即停）
    [--no-relations]       关闭结尾自动 gen-relations（默认实跑后自动执行）
    [--dry-run]            仅打印计划，不写入（也不生成关系）
  gen-relations            自动生成 references 关系（同一 Evidence 内共现 Object）
    [--dry-run]            仅打印计划，不写入
  sync                     定时增量同步（幂等：只处理新增/变更，支持本机定时任务）
    --config <json文件>     配置（sources + stateFile），见 examples/sync-config.json
  trace                   查看 Signal 证据链
    --signal <id>
  objects                 列出 BSP 中的 Object
  help                    显示帮助

环境变量：LARK_CLI_BIN（lark-cli 路径）、BSP_API_BASE（默认 http://localhost:3000）
`);
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);

  if (!command || command === 'help' || command === '--help') {
    showHelp();
    return;
  }

  switch (command) {
    case 'auth-check': {
      const auth = await checkAuth();
      const bspOk = await health();
      print({ larkCli: auth, bspService: bspOk ? 'ok' : '不可达' });
      break;
    }

    case 'search': {
      const query = getArg(args, 'query');
      if (!query) throw new Error('--query 必填');
      const results = await searchDocs(query, {
        mine: !hasFlag(args, 'no-mine'),
        onlyTitle: !hasFlag(args, 'all-types'),
        pageSize: parseInt(getArg(args, 'limit') ?? '10', 10),
      });
      if (results.length === 0) {
        console.log('未找到匹配文档');
      } else {
        for (const r of results) {
          console.log(`  [${r.docTypes || '?'}] ${r.title}  ${r.url}`);
        }
      }
      break;
    }

    case 'read': {
      const doc = getArg(args, 'doc');
      if (!doc) throw new Error('--doc 必填');
      const d = await readDocument(doc);
      print({ token: d.token, title: d.title, url: d.url, content: d.content });
      break;
    }

    case 'ingest': {
      const doc = getArg(args, 'doc');
      if (!doc) throw new Error('--doc 必填');
      const opts: IngestOptions = {
        doc,
        objectId: getArg(args, 'object-id'),
        objectName: getArg(args, 'object-name'),
        anchors: getArg(args, 'anchors')?.split(',').filter(Boolean),
        signalBody: getArg(args, 'signal-body'),
        signalType: getArg(args, 'signal-type'),
        confidence: getArg(args, 'confidence') ? parseFloat(getArg(args, 'confidence')!) : undefined,
        fragmentMinLen: getArg(args, 'min-len') ? parseInt(getArg(args, 'min-len')!, 10) : undefined,
        dryRun: hasFlag(args, 'dry-run'),
      };
      const result = await ingestDocument(opts);
      print(result);
      break;
    }

    case 'attach-signal': {
      const evidenceId = getArg(args, 'evidence');
      const body = getArg(args, 'body');
      if (!evidenceId) throw new Error('--evidence 必填');
      if (!body) throw new Error('--body 必填');
      const result = await attachSignal({
        evidenceId,
        body,
        anchors: getArg(args, 'anchors')?.split(',').filter(Boolean),
        objectName: getArg(args, 'object-name'),
        type: getArg(args, 'signal-type'),
        confidence: getArg(args, 'confidence') ? parseFloat(getArg(args, 'confidence')!) : undefined,
      });
      print(result);
      break;
    }

    case 'batch-ingest': {
      const manifest = getArg(args, 'manifest');
      if (!manifest) throw new Error('--manifest 必填');
      const result = await batchIngest(manifest, {
        dryRun: hasFlag(args, 'dry-run'),
        // 未显式传 --continue-on-error 时保持 undefined，让 manifest 级 continueOnError 生效
        continueOnError: hasFlag(args, 'continue-on-error') || undefined,
        // G4：默认实跑后自动 gen-relations；--no-relations 关闭（--relations 保留兼容）
        relations: hasFlag(args, 'relations') || !hasFlag(args, 'no-relations'),
      });
      print(result);
      break;
    }

    case 'gen-relations': {
      const result = await generateRelations({ dryRun: hasFlag(args, 'dry-run') });
      print(result);
      break;
    }

    case 'sources': {
      print(listSources().map((s) => ({ type: s.type, label: s.label, bspSource: s.bspSource, listable: Boolean(s.list) })));
      break;
    }

    case 'fetch': {
      const type = args[0];
      const ref = getArg(args, 'ref');
      if (!type) throw new Error('用法：fetch <type> --ref <id>');
      if (!ref) throw new Error('--ref 必填');
      const limit = getArg(args, 'limit') ? parseInt(getArg(args, 'limit')!, 10) : undefined;
      const content = await fetchSource(type, ref, { limit });
      print(content);
      break;
    }

    case 'ingest-source': {
      const type = args[0];
      const ref = getArg(args, 'ref');
      if (!type) throw new Error('用法：ingest-source <type> --ref <id>');
      if (!ref) throw new Error('--ref 必填');
      const result = await ingestSource({
        type,
        ref,
        objectId: getArg(args, 'object-id'),
        objectName: getArg(args, 'object-name'),
        anchors: getArg(args, 'anchors')?.split(',').filter(Boolean),
        signalBody: getArg(args, 'signal-body'),
        signalType: getArg(args, 'signal-type'),
        confidence: getArg(args, 'confidence') ? parseFloat(getArg(args, 'confidence')!) : undefined,
        fragmentMinLen: getArg(args, 'min-len') ? parseInt(getArg(args, 'min-len')!, 10) : undefined,
        dryRun: hasFlag(args, 'dry-run'),
        sourceOpts: { limit: getArg(args, 'limit') ? parseInt(getArg(args, 'limit')!, 10) : undefined },
      });
      print(result);
      break;
    }

    case 'sync': {
      const config = getArg(args, 'config');
      if (!config) throw new Error('--config 必填');
      const cfg = loadSyncConfig(config);
      const result = await runSync(cfg);
      print(result);
      break;
    }

    case 'trace': {
      const id = getArg(args, 'signal');
      if (!id) throw new Error('--signal 必填');
      const bsp = createBspClient();
      print(await bsp.traceSignal(id));
      break;
    }

    case 'objects': {
      const bsp = createBspClient();
      print(await bsp.listObjects());
      break;
    }

    default:
      throw new Error(`未知命令：${command}`);
  }
}

main().catch((err) => {
  console.error(`[feishu-bsp-bridge] 错误：${(err as Error).message}`);
  process.exit(1);
});
