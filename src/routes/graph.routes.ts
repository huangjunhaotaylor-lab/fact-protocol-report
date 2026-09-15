/**
 * Graph Projection API 路由（Business Graph OS — G0 批次）
 *
 * GET /api/graph?limit=500&kinds=Evidence,Object&domain=仓储运营 — 全图投影（kinds/domain 过滤，limit 保护）
 * GET /api/graph/expand/:kind/:id                — 单节点一度邻居展开（节点带 domains/primary_domain）
 * GET /api/graph/search?q=关键词&kind=Signal      — 结构化搜索（类型+属性中文名+值 / 板块短语 / 全文）
 * GET /api/graph/stats?domain=仓储运营            — 直方图数据（时间/类型/状态分桶 + domain_counts）
 *
 * 纯增量路由：只读图投影查询，不改动任何现有路由。
 */

import { Router, Request, Response } from 'express';
import {
  projectGraph,
  expandNode,
  searchGraph,
  graphStats,
  GRAPH_NODE_KINDS,
  GraphNodeKind,
} from '../queries/graph.projection';
import { BSPError } from '../utils/errors';

export const graphRoutes = Router();

const DEFAULT_LIMIT = 500;

function parseLimit(raw: unknown): number {
  if (raw === undefined) return DEFAULT_LIMIT;
  const n = parseInt(String(raw), 10);
  if (Number.isNaN(n) || n <= 0) return DEFAULT_LIMIT;
  return n;
}

function parseKinds(raw: unknown): GraphNodeKind[] | undefined {
  if (raw === undefined) return undefined;
  const kinds = String(raw)
    .split(',')
    .map((k) => k.trim())
    .filter((k) => k.length > 0);
  return kinds.filter((k): k is GraphNodeKind =>
    GRAPH_NODE_KINDS.includes(k as GraphNodeKind),
  );
}

// 全图投影（G0：支持 domain 板块过滤）
graphRoutes.get('/', (req: Request, res: Response) => {
  try {
    const limit = parseLimit(req.query.limit);
    const kinds = parseKinds(req.query.kinds);
    const domain = typeof req.query.domain === 'string' && req.query.domain.length > 0
      ? req.query.domain
      : undefined;
    res.json(projectGraph({ limit, kinds, domain }));
  } catch (error) {
    handleError(error, res);
  }
});

// 直方图数据（须先于 /expand/:kind/:id 注册，避免路径歧义；G0：支持 domain 过滤，输出 domain_counts）
graphRoutes.get('/stats', (req: Request, res: Response) => {
  try {
    const domain = typeof req.query.domain === 'string' && req.query.domain.length > 0
      ? req.query.domain
      : undefined;
    res.json(graphStats(domain));
  } catch (error) {
    handleError(error, res);
  }
});

// 结构化搜索
graphRoutes.get('/search', (req: Request, res: Response) => {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q : '';
    const kind = typeof req.query.kind === 'string' ? req.query.kind : undefined;
    res.json(searchGraph(q, kind));
  } catch (error) {
    handleError(error, res);
  }
});

// 单节点一度邻居展开
graphRoutes.get('/expand/:kind/:id', (req: Request, res: Response) => {
  try {
    res.json(expandNode(req.params.kind, req.params.id));
  } catch (error) {
    handleError(error, res);
  }
});

function handleError(error: unknown, res: Response): void {
  if (error instanceof BSPError) {
    res.status(error.statusCode).json(error.toJSON());
  } else {
    res
      .status(500)
      .json({ error: { code: 'INTERNAL_ERROR', message: (error as Error).message } });
  }
}
