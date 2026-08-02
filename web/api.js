/**
 * BSP Reality Layer — API 封装（共享只读，后续批次工人请勿修改）
 *
 * - 统一 fetch 封装
 * - 统一错误解析：后端错误格式 { error: { code, message, name? } }
 * - 所有方法返回解析后的 JSON，失败抛 ApiError（含 status / code / message）
 */

export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

async function request(path, { method = 'GET', body } = {}) {
  const opts = { method, headers: {} };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }

  let res;
  try {
    res = await fetch(path, opts);
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', '无法连接服务器，请确认 BSP 服务已启动');
  }

  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      throw new ApiError(res.status, 'BAD_RESPONSE', `服务返回了非 JSON 内容（HTTP ${res.status}）`);
    }
  }

  if (!res.ok) {
    const err = (data && data.error) || {};
    throw new ApiError(
      res.status,
      err.code || `HTTP_${res.status}`,
      err.message || `请求失败（HTTP ${res.status}）`,
    );
  }
  return data;
}

const get = (path) => request(path);
const post = (path, body) => request(path, { method: 'POST', body });
const patch = (path, body) => request(path, { method: 'PATCH', body });

/* ---------- Evidence ---------- */
export const evidences = {
  list: () => get('/api/evidences'),
  get: (id) => get(`/api/evidences/${encodeURIComponent(id)}`),
  create: (input) => post('/api/evidences', input),
  verify: (id) => get(`/api/evidences/${encodeURIComponent(id)}/verify`),
  archive: (id) => patch(`/api/evidences/${encodeURIComponent(id)}/archive`),
  updateMetadata: (id, metadata) =>
    patch(`/api/evidences/${encodeURIComponent(id)}/metadata`, metadata),
};

/* ---------- Fragment ---------- */
export const fragments = {
  get: (id) => get(`/api/fragments/${encodeURIComponent(id)}`),
  create: (input) => post('/api/fragments', input),
  byEvidence: (evidenceId) =>
    get(`/api/fragments/by-evidence/${encodeURIComponent(evidenceId)}`),
  location: (id) => get(`/api/fragments/${encodeURIComponent(id)}/location`),
  verify: (id) => get(`/api/fragments/${encodeURIComponent(id)}/verify`),
  archive: (id) => patch(`/api/fragments/${encodeURIComponent(id)}/archive`),
};

/* ---------- Signal ---------- */
export const signals = {
  list: () => get('/api/signals'),
  get: (id) => get(`/api/signals/${encodeURIComponent(id)}`),
  create: (input) => post('/api/signals', input),
  byObject: (objectId) => get(`/api/signals/by-object/${encodeURIComponent(objectId)}`),
  byFragment: (fragmentId) =>
    get(`/api/signals/by-fragment/${encodeURIComponent(fragmentId)}`),
  verify: (id) => post(`/api/signals/${encodeURIComponent(id)}/verify`),
  invalid: (id) => post(`/api/signals/${encodeURIComponent(id)}/invalid`),
  archive: (id) => patch(`/api/signals/${encodeURIComponent(id)}/archive`),
  fragments: (id) => get(`/api/signals/${encodeURIComponent(id)}/fragments`),
  trace: (id) => get(`/api/signals/${encodeURIComponent(id)}/trace`),
};

/* ---------- Object ---------- */
export const objects = {
  list: () => get('/api/objects'),
  get: (id) => get(`/api/objects/${encodeURIComponent(id)}`),
  create: (input) => post('/api/objects', input),
  activate: (id) => patch(`/api/objects/${encodeURIComponent(id)}/activate`),
  archive: (id) => patch(`/api/objects/${encodeURIComponent(id)}/archive`),
  merge: (id, mergeInto) => post(`/api/objects/${encodeURIComponent(id)}/merge`, {
    merge_into: mergeInto,
  }),
  signals: (id) => get(`/api/objects/${encodeURIComponent(id)}/signals`),
  timeline: (id) => get(`/api/objects/${encodeURIComponent(id)}/timeline`),
};

/* ---------- Relation ---------- */
export const relations = {
  list: () => get('/api/relations'),
  get: (id) => get(`/api/relations/${encodeURIComponent(id)}`),
  create: (input) => post('/api/relations', input),
  byObject: (objectId) => get(`/api/relations/by-object/${encodeURIComponent(objectId)}`),
  signal: (id) => get(`/api/relations/${encodeURIComponent(id)}/signal`),
};
