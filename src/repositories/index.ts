/**
 * 各协议对象的 Repository 实例
 *
 * MVP 阶段使用内存存储
 */

import { MemoryRepository } from '../utils/memory-repository';
import { Evidence, Fragment, Signal, BSPObject, Relation, BSPState, Identity } from '../types';

// 单例 Repository 实例
export const evidenceRepository = new MemoryRepository<Evidence>();
export const fragmentRepository = new MemoryRepository<Fragment>();
export const signalRepository = new MemoryRepository<Signal>();
export const objectRepository = new MemoryRepository<BSPObject>();
export const relationRepository = new MemoryRepository<Relation>();
export const stateRepository = new MemoryRepository<BSPState>();
export const identityRepository = new MemoryRepository<Identity>();
