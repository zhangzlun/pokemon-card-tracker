// Public provider charts. Never mix these with our daily listing snapshots.
const DAY = 86400000;
const normalize = (s) => String(s).replace(/<[^>]*>/g, '').replace(/\s|未開封|&nbsp;/g, '');
const yen = (n) => typeof n === 'number' && Number.isFinite(n) && n > 0;

export function recentPoints(points, date) {
  const end = Date.parse(date + 'T00:00:00Z');
  if (!Number.isFinite(end)) throw new Error('無效的歷史日期');
  const start = new Date(end - 29 * DAY).toISOString().slice(0, 10);
  return [...new Map(points.filter(([d, p]) => /^\d{4}-\d{2}-\d{2}$/.test(d) &&
    d >= start && d <= date && yen(p)).map((p) => [p[0], p])).values()].sort((a, b) => a[0].localeCompare(b[0]));
}

export function snkrVariant(data, size) {
  // Condition filters need their own explicit mapping; don't silently mix grades.
  if (!Array.isArray(data?.filters?.conditions?.options) || data.filters.conditions.options.length) {
    throw new Error('此商品需要指定品況，暫不補入成交歷史');
  }
  const variants = data?.filters?.variants?.options?.filter((v) => v.name === size) || [];
  if (variants.length !== 1 || !Number.isSafeInteger(variants[0].id) || variants[0].id <= 0) {
    throw new Error('成交歷史找不到唯一相同規格');
  }
  return variants[0].id;
}

export function parseSnkrHistory(data, size, date) {
  snkrVariant(data, size);
  if (data.trades?.some((t) => t.title !== size)) throw new Error('成交歷史混入其他規格');
  const lines = data?.chart?.lines;
  if (!Array.isArray(lines) || lines.length !== 1 || !Array.isArray(lines[0].points)) throw new Error('成交圖表格式不支援');
  const points = lines[0].points.filter((p) => typeof p.timestamp === 'number' && Number.isFinite(p.timestamp) && yen(p.price))
    .map((p) => [new Date(p.timestamp + 9 * 3600000).toISOString().slice(0, 10), p.price]);
  return recentPoints(points, date);
}

export function parsePriceBaseHistory(html, date) {
  const title = normalize(html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || html.match(/<title>([\s\S]*?)<\/title>/i)?.[1] || '');
  const charts = [];
  // Parse JSON embedded by M-chart; never execute the article's JavaScript.
  for (const match of html.matchAll(/chart_args:\s*(\{[\s\S]*?\}),\s*post_id:/g)) {
    let chart;
    try { chart = JSON.parse(match[1]); } catch { continue; }
    const name = normalize(chart.options?.plugins?.title?.text || '');
    const product = name.replace(/の価格推移$/, '');
    if (name.endsWith('の価格推移') && product && title.includes(product)) charts.push(chart);
  }
  if (charts.length !== 1) throw new Error('文章沒有唯一、與商品相符的歷史圖表');
  const { labels, datasets } = charts[0].data || {};
  if (!Array.isArray(labels) || datasets?.length !== 1 || !Array.isArray(datasets[0].data) || datasets[0].data.length !== labels.length) {
    throw new Error('文章歷史圖表格式不支援');
  }
  const points = labels.flatMap((label, i) => {
    const m = String(label).match(/^(\d{4})年(\d{1,2})月(\d{1,2})日$/);
    if (!m) return []; // A month alone is not a dated daily observation.
    const d = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
    const stamp = Date.parse(d + 'T00:00:00Z');
    if (!Number.isFinite(stamp) || new Date(stamp).toISOString().slice(0, 10) !== d) return [];
    return [[d, datasets[0].data[i]]];
  });
  return recentPoints(points, date);
}

export const historyKey = (source) => `${source.key}:${source.source === 'snkrdunk' ? 'trades' : 'published'}`;

export async function fetchJapanHistory(source, { date, fetchImpl = fetch, userAgent, html }) {
  const get = async (url, json = true) => {
    const response = await fetchImpl(url, { headers: { 'User-Agent': userAgent || 'pokemon-card-tracker',
      Accept: json ? 'application/json' : 'text/html' }, signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return json ? response.json() : response.text();
  };
  let points;
  if (source.source === 'snkrdunk') {
    const product = await get(source.fetchUrl.replace(/\/sizes$/, ''));
    if (!Number.isSafeInteger(product.productCatalogId) || product.productCatalogId <= 0) throw new Error('找不到商品歷史編號');
    const url = `https://snkrdunk.com/v3/products/${product.productCatalogId}/trading-history?range=oneMonth`;
    const variant = snkrVariant(await get(url), source.size);
    const filtered = await get(`${url}&variant_id=${variant}`);
    if (snkrVariant(filtered, source.size) !== variant) throw new Error('歷史規格編號不符');
    points = parseSnkrHistory(filtered, source.size, date);
  } else points = parsePriceBaseHistory(html ?? await get(source.fetchUrl, false), date);
  if (!points.length) throw new Error('來源近 30 天沒有可用的日期價格');
  return { source: source.source, url: source.url, kind: source.source === 'snkrdunk' ? 'trades' : 'published',
    label: source.source === 'snkrdunk' ? `成交相場（${source.size}）` : '文章公布相場', points };
}
