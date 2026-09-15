/**
 * sync.ts — 增量同步单元测试（纯逻辑部分）
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import { sha256, bucketByDay, loadState, saveState } from '../src/sync';

describe('sha256', () => {
  it('输出 64 位十六进制（与 BSP 一致）', () => {
    expect(sha256('abc')).toMatch(/^[0-9a-f]{64}$/);
    expect(sha256('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});

describe('bucketByDay', () => {
  it('毫秒时间戳按天分桶', () => {
    const items = [
      { create_time: '1700000000000' }, // 2023-11-14
      { create_time: '1700000001000' },
      { create_time: '1700268800000' }, // 2023-11-18
      { create_time: '' },
    ];
    const buckets = bucketByDay(items);
    expect(buckets.get('2023-11-14')).toBe(2);
    expect(buckets.get('2023-11-18')).toBe(1);
    expect(buckets.size).toBe(2);
  });

  it('已格式化时间也支持', () => {
    const buckets = bucketByDay([{ create_time: '2026-06-15 16:09' }]);
    expect([...buckets.keys()][0]).toBe('2026-06-15');
  });
});

describe('loadState / saveState', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = path.join(tmpdir(), `bsp-sync-state-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  });

  afterEach(() => {
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
    try { fs.unlinkSync(`${tmp}.tmp`); } catch { /* ignore */ }
  });

  it('不存在时返回空状态', () => {
    expect(loadState(tmp)).toEqual({});
  });

  it('保存后可读回（含目录自动创建）', () => {
    const deep = path.join(tmpdir(), `bsp-sync-dir-${Date.now()}`, 'state.json');
    saveState(deep, { 'doc:X': { checksum: 'abc', version: 2 } });
    expect(loadState(deep)).toEqual({ 'doc:X': { checksum: 'abc', version: 2 } });
    fs.rmSync(path.dirname(deep), { recursive: true, force: true });
  });
});
