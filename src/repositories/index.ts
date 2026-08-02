/**
 * 各协议对象的 Repository 实例
 *
 * 持久化策略（对 service / routes / queries 完全透明，接口签名不变）：
 * - 默认：JSON 文件持久化（data/bsp-store.json，可用 BSP_STORE_PATH 覆盖）
 * - 测试环境（vitest / NODE_ENV=test）且未显式指定 BSP_STORE_PATH：纯内存，
 *   避免测试进程污染真实数据文件
 */

import { createRepositorySet } from './json-file-store';

const isTestEnv = Boolean(process.env.VITEST) || process.env.NODE_ENV === 'test';
const persist = !isTestEnv || Boolean(process.env.BSP_STORE_PATH);

const repos = createRepositorySet({ persist });

export const evidenceRepository = repos.evidences;
export const fragmentRepository = repos.fragments;
export const signalRepository = repos.signals;
export const objectRepository = repos.objects;
export const relationRepository = repos.relations;
export const identityRepository = repos.identities;
