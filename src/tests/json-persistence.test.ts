/**
 * JSON 文件持久化测试
 *
 * 覆盖：
 * - 写数据 → 模拟重启（重建 Repository 实例）→ 数据仍在
 * - update / clear 后落盘内容同步
 * - 损坏 JSON 文件启动不崩溃（降级空库 + 保留 .corrupt.bak）
 * - 原子落盘（无残留临时文件，文件为合法 JSON）
 * - createRepositorySet(persist:false) 返回纯内存 Repository
 * - BSP_STORE_PATH 环境变量覆盖默认路径
 *
 * 所有用例使用独立临时目录，不触碰真实 data/bsp-store.json
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  JsonFileStore,
  PersistedRepository,
  createRepositorySet,
  resolveStorePath,
  defaultStorePath,
  STORE_VERSION,
} from '../repositories/json-file-store';
import { MemoryRepository } from '../utils/memory-repository';
import { Evidence } from '../types';

function tmpStorePath(): { dir: string; file: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bsp-store-test-'));
  return { dir, file: path.join(dir, 'bsp-store.json') };
}

function sampleEvidence(id: string, content = '张三说："仓库目前还是使用 Excel 进行盘点。"'): Evidence {
  return {
    id,
    source: 'meeting',
    content,
    checksum: 'checksum-' + id,
    state: 'Created',
    created_at: new Date().toISOString(),
  };
}

describe('JSON 文件持久化', () => {
  it('写数据后模拟重启（重建实例），数据仍在', () => {
    const { file } = tmpStorePath();

    // 第一次"进程"：写入两条 Evidence
    const store1 = new JsonFileStore(file);
    const repo1 = new PersistedRepository<Evidence>(store1, 'evidences');
    repo1.create(sampleEvidence('EV-001'));
    repo1.create(sampleEvidence('EV-002', '李四说："盘点每周进行一次。"'));
    expect(repo1.count()).toBe(2);
    expect(fs.existsSync(file)).toBe(true);

    // 模拟重启：全新 JsonFileStore + PersistedRepository 实例
    const store2 = new JsonFileStore(file);
    const repo2 = new PersistedRepository<Evidence>(store2, 'evidences');
    expect(repo2.count()).toBe(2);
    const ev = repo2.findById('EV-001');
    expect(ev).toBeDefined();
    expect(ev!.content).toBe('张三说："仓库目前还是使用 Excel 进行盘点。"');
    expect(ev!.state).toBe('Created');
  });

  it('update 与 clear 后的变更同样落盘', () => {
    const { file } = tmpStorePath();
    const store1 = new JsonFileStore(file);
    const repo1 = new PersistedRepository<Evidence>(store1, 'evidences');
    repo1.create(sampleEvidence('EV-010'));
    repo1.update('EV-010', { state: 'Archived' });

    // 重启后状态变更仍在
    const repo2 = new PersistedRepository<Evidence>(new JsonFileStore(file), 'evidences');
    expect(repo2.findById('EV-010')!.state).toBe('Archived');

    // clear 也落盘
    repo2.clear();
    const repo3 = new PersistedRepository<Evidence>(new JsonFileStore(file), 'evidences');
    expect(repo3.count()).toBe(0);
  });

  it('多个集合共享同一文件，互不干扰', () => {
    const { file } = tmpStorePath();
    const store1 = new JsonFileStore(file);
    const evRepo = new PersistedRepository<Evidence>(store1, 'evidences');
    const frgRepo = new PersistedRepository<Evidence>(store1, 'fragments');
    evRepo.create(sampleEvidence('EV-100'));
    frgRepo.create(sampleEvidence('FRG-100'));

    const store2 = new JsonFileStore(file);
    expect(new PersistedRepository<Evidence>(store2, 'evidences').count()).toBe(1);
    expect(new PersistedRepository<Evidence>(store2, 'fragments').count()).toBe(1);
  });

  it('损坏的 JSON 文件启动不崩溃，降级为空库并保留 .corrupt.bak', () => {
    const { file } = tmpStorePath();
    fs.writeFileSync(file, '{ this is not valid json !!!', 'utf8');

    let store: JsonFileStore | undefined;
    expect(() => {
      store = new JsonFileStore(file);
    }).not.toThrow();
    expect(store!.degraded).toBe(true);

    const repo = new PersistedRepository<Evidence>(store!, 'evidences');
    expect(repo.count()).toBe(0);
    // 损坏文件已保留副本
    expect(fs.existsSync(`${file}.corrupt.bak`)).toBe(true);

    // 降级后仍可正常写入（覆盖损坏文件）
    repo.create(sampleEvidence('EV-200'));
    const repo2 = new PersistedRepository<Evidence>(new JsonFileStore(file), 'evidences');
    expect(repo2.count()).toBe(1);
  });

  it('落盘是原子的：无残留临时文件，文件为合法 JSON 且带版本号', () => {
    const { dir, file } = tmpStorePath();
    const store = new JsonFileStore(file);
    const repo = new PersistedRepository<Evidence>(store, 'evidences');
    repo.create(sampleEvidence('EV-300'));
    repo.update('EV-300', { state: 'Archived' });

    const leftovers = fs.readdirSync(dir).filter((f) => f.includes('.tmp'));
    expect(leftovers).toHaveLength(0);

    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    expect(parsed.version).toBe(STORE_VERSION);
    expect(parsed.saved_at).toBeDefined();
    expect(parsed.collections.evidences).toHaveLength(1);
    expect(parsed.collections.evidences[0].id).toBe('EV-300');
  });

  it('createRepositorySet(persist:false) 返回纯内存 Repository，不落盘', () => {
    const { dir, file } = tmpStorePath();
    const repos = createRepositorySet({ persist: false, storePath: file });
    expect(repos.evidences).toBeInstanceOf(MemoryRepository);
    expect(repos.evidences).not.toBeInstanceOf(PersistedRepository);
    repos.evidences.create(sampleEvidence('EV-400'));
    expect(fs.existsSync(file)).toBe(false);
    expect(fs.readdirSync(dir)).toHaveLength(0);
  });

  it('createRepositorySet(persist:true) 六个集合全部持久化', () => {
    const { file } = tmpStorePath();
    const repos = createRepositorySet({ persist: true, storePath: file });
    expect(repos.evidences).toBeInstanceOf(PersistedRepository);
    expect(repos.fragments).toBeInstanceOf(PersistedRepository);
    expect(repos.signals).toBeInstanceOf(PersistedRepository);
    expect(repos.objects).toBeInstanceOf(PersistedRepository);
    expect(repos.relations).toBeInstanceOf(PersistedRepository);
    expect(repos.identities).toBeInstanceOf(PersistedRepository);

    repos.evidences.create(sampleEvidence('EV-500'));
    const repos2 = createRepositorySet({ persist: true, storePath: file });
    expect(repos2.evidences.findById('EV-500')).toBeDefined();
  });

  it('BSP_STORE_PATH 环境变量覆盖默认存储路径', () => {
    expect(resolveStorePath({ BSP_STORE_PATH: '/tmp/custom-store.json' } as NodeJS.ProcessEnv)).toBe(
      '/tmp/custom-store.json',
    );
    expect(resolveStorePath({} as NodeJS.ProcessEnv)).toBe(defaultStorePath());
  });
});
