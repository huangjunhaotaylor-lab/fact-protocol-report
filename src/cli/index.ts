/**
 * BSP 1.1 CLI 交互层
 *
 * 支持核心用户动作的命令行操作：
 * - 创建 Evidence
 * - 查看 Evidence 原文
 * - 从 Evidence 创建 Fragment
 * - 查看 Fragment 在 Evidence 中的位置
 * - 从 Fragment 创建 Signal
 * - 将 Signal 锚定到 Object
 * - 创建或选择 Object
 * - 查看 Signal 的证据链
 * - 标记 Signal 为 Verified
 * - 标记 Signal 为 Invalid
 * - 查看 Object 关联的 Signal 列表
 *
 * 用法：
 *   tsx src/cli/index.ts <command> [options]
 */

import { evidenceService } from '../services/evidence.service';
import { fragmentService } from '../services/fragment.service';
import { signalService } from '../services/signal.service';
import { objectService } from '../services/object.service';
import { relationService } from '../services/relation.service';
import { traceQuery } from '../queries/trace.query';
import { objectSignalsQuery } from '../queries/object-signals.query';
import { timelineQuery } from '../queries/timeline.query';

const command = process.argv[2];
const args = process.argv.slice(3);

function print(obj: unknown): void {
  console.log(JSON.stringify(obj, null, 2));
}

function getArg(name: string): string | undefined {
  const idx = args.indexOf(`--${name}`);
  return idx >= 0 ? args[idx + 1] : undefined;
}

function showHelp(): void {
  console.log(`
BSP 1.1 Reality Layer CLI

Commands:
  create-evidence     Create Evidence
    --source <source> --content <content> [--creator <creator>]

  get-evidence        View Evidence original content
    --id <evidence_id>

  create-fragment     Create Fragment from Evidence
    --evidence <id> --type <type> --content <content> [--speaker <speaker>]

  get-fragment-location  View Fragment position in Evidence
    --id <fragment_id>

  create-object       Create Object
    --type <type> --name <name> [--named-id]

  activate-object     Activate Object
    --id <object_id>

  create-signal       Create Signal from Fragment(s)
    --type <type> --body <body> --fragments <id1,id2> --anchors <objId>
    --channel <channel> --confidence <0-1> [--actors <name1,name2>]

  verify-signal       Mark Signal as Verified
    --id <signal_id>

  invalid-signal      Mark Signal as Invalid
    --id <signal_id>

  trace-signal        View Signal evidence chain
    --id <signal_id>

  object-signals      View Object's Signal list
    --id <object_id>

  object-timeline     View Object's Timeline
    --id <object_id>

  create-relation     Create Relation between Objects
    --source <objId> --target <objId> --type <type> --signal <signalId> --confidence <0-1>

  demo                Run the standard example (Section 14)

  help                Show this help
`);
}

async function main(): Promise<void> {
  if (!command || command === 'help' || command === '--help') {
    showHelp();
    return;
  }

  switch (command) {
    case 'create-evidence': {
      const source = getArg('source') as never;
      const content = getArg('content')!;
      const creator = getArg('creator');
      const evidence = evidenceService.create({ source, content, creator });
      print(evidence);
      break;
    }

    case 'get-evidence': {
      const evidence = evidenceService.getById(getArg('id')!);
      print(evidence);
      break;
    }

    case 'create-fragment': {
      const fragment = fragmentService.create({
        evidence_id: getArg('evidence')!,
        type: getArg('type') as never,
        content: getArg('content')!,
        speaker: getArg('speaker'),
      });
      print(fragment);
      break;
    }

    case 'get-fragment-location': {
      const location = fragmentService.getLocation(getArg('id')!);
      print(location);
      break;
    }

    case 'create-object': {
      const obj = objectService.create({
        type: getArg('type') as never,
        name: getArg('name')!,
        namedId: args.includes('--named-id'),
      });
      print(obj);
      break;
    }

    case 'activate-object': {
      const obj = objectService.activate(getArg('id')!);
      print(obj);
      break;
    }

    case 'create-signal': {
      const signal = signalService.create({
        type: getArg('type') as never,
        body: getArg('body')!,
        fragments: getArg('fragments')!.split(','),
        anchors: getArg('anchors')!.split(','),
        context: { channel: getArg('channel') },
        confidence: parseFloat(getArg('confidence') || '0.9'),
        actors: getArg('actors')?.split(','),
      });
      print(signal);
      break;
    }

    case 'verify-signal': {
      print(signalService.verify(getArg('id')!));
      break;
    }

    case 'invalid-signal': {
      print(signalService.markInvalid(getArg('id')!));
      break;
    }

    case 'trace-signal': {
      print(traceQuery.traceSignal(getArg('id')!));
      break;
    }

    case 'object-signals': {
      print(objectSignalsQuery.getByObject(getArg('id')!));
      break;
    }

    case 'object-timeline': {
      print(timelineQuery.getTimelineWithSignals(getArg('id')!));
      break;
    }

    case 'create-relation': {
      const relation = relationService.create({
        source: getArg('source')!,
        target: getArg('target')!,
        type: getArg('type') as never,
        derived_from: getArg('signal')!,
        confidence: parseFloat(getArg('confidence') || '0.9'),
      });
      print(relation);
      break;
    }

    case 'demo': {
      runDemo();
      break;
    }

    default:
      console.error(`Unknown command: ${command}`);
      showHelp();
      process.exit(1);
  }
}

/**
 * 运行标准示例（文档第 14 节）
 */
function runDemo(): void {
  console.log('\n========================================');
  console.log('  BSP 1.1 Standard Example (Section 14)');
  console.log('========================================\n');

  // 1. 创建 Evidence
  console.log('1. Creating Evidence...');
  const evidence = evidenceService.create({
    source: 'meeting',
    content: '张三说："仓库目前还是使用 Excel 进行盘点。"',
  });
  print(evidence);

  // 2. 创建 Fragment
  console.log('\n2. Creating Fragment from Evidence...');
  const fragment = fragmentService.create({
    evidence_id: evidence.id,
    type: 'Speech',
    content: '仓库目前还是使用 Excel 进行盘点。',
    speaker: '张三',
    timestamp_start: '00:15:32',
  });
  print(fragment);

  // 3. 创建 Object
  console.log('\n3. Creating Object...');
  const obj = objectService.create({
    type: 'Process',
    name: '仓库盘点流程',
    namedId: true,
  });
  objectService.activate(obj.id);
  print(obj);

  // 4. 创建 Signal
  console.log('\n4. Creating Signal...');
  const signal = signalService.create({
    type: 'observation',
    body: '仓库目前使用 Excel 进行盘点。',
    fragments: [fragment.id],
    anchors: [obj.id],
    context: { channel: 'meeting' },
    confidence: 0.92,
    actors: ['张三'],
  });
  print(signal);

  // 5. 追溯
  console.log('\n5. Tracing Signal evidence chain...');
  const trace = traceQuery.traceSignal(signal.id);
  print(trace);

  // 6. 查看 Object 的 Signal 列表
  console.log('\n6. Object signals...');
  print(objectSignalsQuery.getByObject(obj.id));

  console.log('\n========================================');
  console.log('  Demo completed successfully!');
  console.log('========================================\n');
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
