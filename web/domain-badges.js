/**
 * 板块徽标共享渲染（G3 批次）
 *
 * - 配色与 Graph OS 板块配色一致（仓储 #b7791f / 销售 #2f855a / 项目 #5a67a8 /
 *   采购 #97516b / 财务 #6b5b8e / 人力 #4a7ba6 / 系统 #718096），浅底深字细边版
 * - 色值以 inline style 输出（板块名为中文，避免中文 CSS 类名），
 *   基础几何样式用 styles.css 的 .dbadge
 * - 各页面 import 使用；数据值英文、展示中文的约定不受影响（板块名本身是中文数据值）
 */

/** 板块名 → 主色（与 Graph OS graph.css 保持一致） */
export const DOMAIN_COLORS = {
  仓储运营: '#b7791f',
  销售与交付: '#2f855a',
  项目推进: '#5a67a8',
  采购供应: '#97516b',
  财务: '#6b5b8e',
  人力: '#4a7ba6',
  系统与工具: '#718096',
};

/** 字典外板块兜底色（与 --muted 同族的中灰） */
const FALLBACK_COLOR = '#86868b';

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** #rrggbb + 透明度 → rgba() 字符串（用于浅底 / 细边） */
function alpha(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

/** 板块主色（未知板块给兜底灰） */
export function domainColor(name) {
  return DOMAIN_COLORS[name] || FALLBACK_COLOR;
}

/**
 * 单个板块徽标 HTML
 * @param name 板块名（数据值）
 * @param opts.primary 是否主线板块（加粗 + ★）
 * @param opts.label 自定义展示文案（默认 = 板块名；如「仓储运营（主线）」）
 */
export function domainBadge(name, { primary = false, label } = {}) {
  const c = domainColor(name);
  const style = `color:${c};background:${alpha(c, 0.1)};border-color:${alpha(c, 0.45)}`;
  const text = label !== undefined ? label : `${name}${primary ? ' ★' : ''}`;
  return `<span class="dbadge${primary ? ' primary' : ''}" style="${style}" data-domain="${esc(name)}">${esc(text)}</span>`;
}

/**
 * 板块徽标行 HTML：domains 全部展示，primary 加粗带 ★
 * @param domains 板块名数组
 * @param primary 主线板块名（可空）
 * @returns 无板块时返回空串
 */
export function domainBadges(domains, primary) {
  const list = domains || [];
  if (!list.length) return '';
  return list.map((d) => domainBadge(d, { primary: d === primary })).join(' ');
}
