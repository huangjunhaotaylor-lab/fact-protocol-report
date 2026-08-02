/**
 * JSON 文件持久化存储
 *
 * 零依赖持久化方案（产品决策：JSON 文件而非 SQLite）：
 * - 启动时从 JSON 文件加载全部集合（文件不存在 → 空库；文件损坏 → 降级空库 + 告警，
 *   并将损坏文件保留为 *.corrupt.bak 以便排查）
 * - 每次增删改后原子落盘：先写临时文件，再 rename 覆盖，避免半写状态
 * - 对上层完全透明：PersistedRepository 继承 MemoryRepository，接口签名不变，
 *   service / routes / queries 无需任何改动
 *
 * 存储路径：环境变量 BSP_STORE_PATH 覆盖，默认 <repo>/data/bsp-store.json
 */

import * as fs from 'fs';
import * as path from 'path';
import { MemoryRepository } from '../utils/memory-repository';
import { logger } from '../utils/logger';
import { Evidence, Fragment, Signal, BSPObject, Relation, Identity } from '../types';

/** 存储文件格式版本 */
export const STORE_VERSION = 1;

/** 落盘文件结构 */
interface StoreFile {
  version: number;
  saved_at: string;
  collections: Record<string, Array<Record<string, unknown>>>;
}

/** 默认存储路径：<repo>/data/bsp-store.json（src/ 与 dist/ 下均解析到仓库根） */
export function defaultStorePath(): string {
  return path.resolve(__dirname, '..', '..', 'data', 'bsp-store.json');
}

/** 解析存储路径：BSP_STORE_PATH 优先，其次默认路径 */
export function resolveStorePath(env: NodeJS.ProcessEnv = process.env): string {
  return env.BSP_STORE_PATH ? path.resolve(env.BSP_STORE_PATH) : defaultStorePath();
}

/**
 * JSON 文件存储
 * 持有全部集合的内存镜像，负责加载与原子落盘
 */
export class JsonFileStore {
  private readonly filePath: string;
  private readonly collections = new Map<string, Map<string, Record<string, unknown>>>();
  /** 启动时是否检测到损坏文件（已降级为空库） */
  readonly degraded: boolean = false;

  constructor(filePath: string) {
    this.filePath = filePath;
    this.degraded = this.load();
    if (this.degraded) {
      // 保留损坏文件副本以便排查（失败不影响启动）
      try {
        fs.copyFileSync(this.filePath, `${this.filePath}.corrupt.bak`);
      } catch {
        /* ignore */
      }
    }
  }

  /**
   * 启动加载
   * @returns 是否因文件损坏而降级为空库
   */
  private load(): boolean {
    if (!fs.existsSync(this.filePath)) {
      logger.info(`JsonFileStore: no store file at ${this.filePath}, starting empty`);
      return false;
    }
    try {
      const raw = fs.readFileSync(this.filePath, 'utf8');
      const parsed = JSON.parse(raw) as Partial<StoreFile>;
      const collections = parsed.collections ?? {};
      for (const [name, entities] of Object.entries(collections)) {
        if (!Array.isArray(entities)) continue;
        const map = new Map<string, Record<string, unknown>>();
        for (const entity of entities) {
          if (entity && typeof entity.id === 'string') {
            map.set(entity.id, entity);
          }
        }
        this.collections.set(name, map);
      }
      const total = Array.from(this.collections.values()).reduce((n, m) => n + m.size, 0);
      logger.info(`JsonFileStore: loaded ${total} record(s) from ${this.filePath}`);
      return false;
    } catch (err) {
      logger.warn(
        { err },
        `JsonFileStore: store file ${this.filePath} is corrupted, degrading to empty store`,
      );
      return true;
    }
  }

  /** 读取某集合的全部实体（用于 Repository 启动水合） */
  entries(collection: string): Array<Record<string, unknown>> {
    const map = this.collections.get(collection);
    return map ? Array.from(map.values()) : [];
  }

  /**
   * 用某集合的当前全量内容替换内存镜像并原子落盘
   * （增删改后由 PersistedRepository 调用）
   */
  replaceCollection<T extends { id: string }>(collection: string, entities: T[]): void {
    const map = new Map<string, Record<string, unknown>>();
    for (const entity of entities) {
      map.set(entity.id, entity as unknown as Record<string, unknown>);
    }
    this.collections.set(collection, map);
    this.save();
  }

  /** 原子落盘：写临时文件 + rename */
  private save(): void {
    const payload: StoreFile = {
      version: STORE_VERSION,
      saved_at: new Date().toISOString(),
      collections: Object.fromEntries(
        Array.from(this.collections.entries()).map(([name, map]) => [
          name,
          Array.from(map.values()),
        ]),
      ),
    };
    const dir = path.dirname(this.filePath);
    fs.mkdirSync(dir, { recursive: true });
    const tmpPath = `${this.filePath}.tmp-${process.pid}`;
    fs.writeFileSync(tmpPath, JSON.stringify(payload, null, 2), 'utf8');
    fs.renameSync(tmpPath, this.filePath);
  }
}

/**
 * 持久化内存 Repository
 * 继承 MemoryRepository，接口签名不变；在增删改清空后触发落盘
 */
export class PersistedRepository<T extends { id: string }> extends MemoryRepository<T> {
  constructor(
    private readonly fileStore: JsonFileStore,
    private readonly collectionName: string,
  ) {
    super();
    // 启动水合：从文件镜像恢复数据
    for (const entity of fileStore.entries(collectionName)) {
      this.store.set(entity.id as string, entity as unknown as T);
    }
  }

  override create(entity: T): T {
    const result = super.create(entity);
    this.persist();
    return result;
  }

  override update(id: string, updates: Partial<T>): T | undefined {
    const result = super.update(id, updates);
    if (result) this.persist();
    return result;
  }

  override clear(): void {
    super.clear();
    this.persist();
  }

  private persist(): void {
    try {
      this.fileStore.replaceCollection(this.collectionName, this.findAll());
    } catch (err) {
      // 落盘失败不影响内存操作，但必须告警（下次启动将丢失该变更）
      logger.error({ err }, `PersistedRepository: failed to persist ${this.collectionName}`);
    }
  }
}

/** 六个协议对象的 Repository 集合 */
export interface BSPRepositories {
  evidences: MemoryRepository<Evidence>;
  fragments: MemoryRepository<Fragment>;
  signals: MemoryRepository<Signal>;
  objects: MemoryRepository<BSPObject>;
  relations: MemoryRepository<Relation>;
  identities: MemoryRepository<Identity>;
}

/**
 * 构建 Repository 集合
 * - persist: true → 全部集合挂载到同一个 JSON 文件（共享一个 JsonFileStore，整文件原子写）
 * - persist: false → 纯内存（测试环境）
 */
export function createRepositorySet(
  opts: { persist?: boolean; storePath?: string } = {},
): BSPRepositories {
  const persist = opts.persist ?? true;
  if (!persist) {
    return {
      evidences: new MemoryRepository<Evidence>(),
      fragments: new MemoryRepository<Fragment>(),
      signals: new MemoryRepository<Signal>(),
      objects: new MemoryRepository<BSPObject>(),
      relations: new MemoryRepository<Relation>(),
      identities: new MemoryRepository<Identity>(),
    };
  }
  const store = new JsonFileStore(opts.storePath ?? resolveStorePath());
  return {
    evidences: new PersistedRepository<Evidence>(store, 'evidences'),
    fragments: new PersistedRepository<Fragment>(store, 'fragments'),
    signals: new PersistedRepository<Signal>(store, 'signals'),
    objects: new PersistedRepository<BSPObject>(store, 'objects'),
    relations: new PersistedRepository<Relation>(store, 'relations'),
    identities: new PersistedRepository<Identity>(store, 'identities'),
  };
}
