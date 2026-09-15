/**
 * sources.ts — 多来源归一化单元测试
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { extractMessageText, flattenChatMessages, assembleMinutes } from '../src/sources';

/* ---------------- extractMessageText ---------------- */

describe('extractMessageText', () => {
  it('text 类型', () => {
    expect(extractMessageText({ content: '{"text":"仓库目前使用 Excel 盘点。"}' })).toBe('仓库目前使用 Excel 盘点。');
  });

  it('post 富文本（嵌套 tag）', () => {
    const body = {
      content: JSON.stringify({
        title: '公告',
        content: [
          [{ tag: 'text', text: '张三说：' }, { tag: 'at', text: '李四' }, { tag: 'text', text: '，下午开会。' }],
        ],
      }),
    };
    expect(extractMessageText(body)).toContain('张三说：');
    expect(extractMessageText(body)).toContain('李四');
    expect(extractMessageText(body)).toContain('下午开会。');
  });

  it('非 JSON 裸文本原样返回', () => {
    expect(extractMessageText({ content: '纯文本消息' })).toBe('纯文本消息');
  });

  it('无文本内容返回空串', () => {
    expect(extractMessageText({ content: '{"image_key":"img_xxx"}' })).toBe('');
    expect(extractMessageText({})).toBe('');
  });
});

/* ---------------- flattenChatMessages ---------------- */

describe('flattenChatMessages', () => {
  const items = [
    { message_id: 'm1', msg_type: 'text', create_time: '1700000000000', sender: { id: 'u1' }, body: { content: '{"text":"第一条消息。"}' } },
    { message_id: 'm2', msg_type: 'image', create_time: '1700000001000', body: { content: '{"image_key":"x"}' } },
    { message_id: 'm3', msg_type: 'post', create_time: '1700000002000', body: { content: JSON.stringify({ title: 't', content: [[{ tag: 'text', text: '第二条消息。' }]] }) } },
  ];

  it('归一化为带时间戳的文本行，跳过图片', () => {
    const { content, count, skipped } = flattenChatMessages(items);
    expect(count).toBe(3);
    expect(skipped).toBe(1); // image 被跳过
    expect(content).toContain('[2023-11-14T22:13:20.000Z] 第一条消息。');
    expect(content).toContain('第二条消息。');
    expect(content).not.toContain('image');
  });

  it('limit 截断', () => {
    const { content, count } = flattenChatMessages(items, { limit: 1 });
    expect(count).toBe(1);
    expect(content).toContain('第一条消息。');
    expect(content).not.toContain('第二条消息。');
  });
});

/* ---------------- assembleMinutes ---------------- */

describe('assembleMinutes', () => {
  it('组装摘要/待办/章节/关键词', () => {
    const content = assembleMinutes({
      data: {
        title: '周会',
        summary: '本周完成仓库盘点模块联调。',
        todos: ['张三：周五前提交复盘报告', '李四：更新 PRD'],
        chapters: [{ title: '盘点进度' }, { title: '风险项' }],
        keywords: ['盘点', 'PRD'],
      },
    });
    expect(content).toContain('# 周会');
    expect(content).toContain('【摘要】');
    expect(content).toContain('本周完成仓库盘点模块联调。');
    expect(content).toContain('张三：周五前提交复盘报告');
    expect(content).toContain('【章节】');
    expect(content).toContain('盘点进度');
    expect(content).toContain('【关键词】盘点、PRD');
  });

  it('空详情返回空串', () => {
    expect(assembleMinutes({})).toBe('');
  });
});
