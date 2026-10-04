// Public SNKRDUNK size prices and PRICE BASE's single-product price widget.
// Keep source identities and histories separate: listing prices are not trade prices.
import { fetchJapanHistory, historyKey } from './japan-history.mjs';

export const SOURCE_NAMES = { snkrdunk: 'SNKRDUNK', pricebase: 'PRICE BASE' };

function positiveYen(value) {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  const n = Number(String(value).replace(/,/g, '').trim());
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

export function sourceConfigs(japan = {}) {
  if (japan.preferred && !['snkrdunk', 'pricebase'].includes(japan.preferred)) throw new Error('不支援的優先來源');
  const out = [];
  if (japan.snkrdunk) {
    const { apparelId, size = '1個' } = japan.snkrdunk;
    if (!/^[1-9]\d*$/.test(String(apparelId)) || typeof size !== 'string' || !size.trim()) {
      throw new Error('SNKRDUNK 必須設定有效 apparelId 與規格 size');
    }
    out.push({ source: 'snkrdunk', key: `snkrdunk:${apparelId}:${size.trim()}`, size: size.trim(),
      url: `https://snkrdunk.com/apparels/${apparelId}`, fetchUrl: `https://snkrdunk.com/v1/apparels/${apparelId}/sizes` });
  }
  if (japan.pricebase) {
    const url = new URL(japan.pricebase.url);
    if (url.protocol !== 'https:' || url.hostname !== 'price-base.com' || url.port || url.username || url.password ||
        !/^\/useful\/[a-z0-9-]+\/?$/.test(url.pathname) || url.search || url.hash) {
      throw new Error('PRICE BASE 必須使用 https://price-base.com/useful/ 下的單一商品文章網址');
    }
    url.pathname = url.pathname.replace(/\/$/, '');
    out.push({ source: 'pricebase', key: `pricebase:${url.pathname}`, url: url.href, fetchUrl: url.href });
  }
  return out;
}

export function parseSnkrdunk(data, size = '1個') {
  if (!Array.isArray(data?.sizePrices)) throw new Error('SNKRDUNK 回傳格式已變更');
  // size.quantity is NOT pack count (even the 2個 variant reports quantity: 1).
  const matches = data.sizePrices.filter((x) => !x.size?.isDeleted && x.size?.localizedName === size);
  if (matches.length !== 1) throw new Error(`SNKRDUNK 找不到唯一規格「${size}」`);
  const price = positiveYen(matches[0].minNewListingPrice);
  if (price == null) throw new Error(`SNKRDUNK「${size}」目前沒有新品掛價`);
  return { price, kind: 'listing', label: `新品最低掛價（${size}）`, variant: size };
}

function textOnly(html) {
  return html.replace(/<[^>]*>/g, ' ').replace(/&nbsp;|&#160;/g, ' ').replace(/\s+/g, ' ').trim();
}

export function parsePriceBase(html) {
  // Do not scrape arbitrary yen amounts: articles contain MSRP, ads and old tables.
  const widgets = [...html.matchAll(/<section\b[^>]*class=["'][^"']*\bpb-cph\b[^"']*["'][^>]*>([\s\S]*?)<\/section>/gi)];
  if (!widgets.length) {
    // Older single-box articles have a named current-price conclusion, not a widget.
    const title = textOnly(html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || html.match(/<title>([\s\S]*?)<\/title>/i)?.[1] || '').replace(/\s/g, '');
    const summaries = [...html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].map((m) => textOnly(m[1]))
      .filter((text) => /^結論から言うと、/.test(text));
    if (summaries.length !== 1) throw new Error('PRICE BASE 找不到唯一商品價格區塊，請使用單一商品文章');
    const match = summaries[0].match(/^結論から言うと、(.+?)の現在の最新取引相場価格は\s*([\d,]+)\s*円[！!]?\s*です/);
    if (!match || !title.includes(match[1].replace(/\s/g, '')) || !/\d{4}年\d{1,2}月(?:\d{1,2}日)?時点/.test(summaries[0])) {
      throw new Error('PRICE BASE 找不到與文章標題相符的當期相場');
    }
    return priceBaseQuote(positiveYen(match[2]), summaries[0], html);
  }
  if (widgets.length !== 1) throw new Error('PRICE BASE 找不到唯一商品價格區塊，請使用單一商品文章');
  const widget = widgets[0][1];
  const labels = [...widget.matchAll(/class=["']pb-cph__price-label["'][^>]*>([\s\S]*?)<\//gi)];
  const amounts = [...widget.matchAll(/class=["']pb-cph__amount-number["'][^>]*>([\s\S]*?)<\//gi)];
  if (labels.length !== 1 || amounts.length !== 1 || !/最新取引相場価格/.test(textOnly(labels[0][1]))) {
    throw new Error('PRICE BASE 不是支援的單一取引相場價格格式');
  }
  const price = positiveYen(textOnly(amounts[0][1]));
  return priceBaseQuote(price, textOnly(widget), html);
}

function priceBaseQuote(price, text, html) {
  if (price == null) throw new Error('PRICE BASE 沒有有效日圓相場');
  const period = text.match(/(\d{4})年(\d{1,2})月(?:([0-3]?\d)日)?時点/);
  const sourceUpdated = html.match(/"dateModified"\s*:\s*"(\d{4}-\d{2}-\d{2})[^"']*"/)?.[1] || null;
  return { price, kind: 'reference', label: '取引相場參考價', sourceUpdated,
    priceAsOf: period ? `${period[1]}-${period[2].padStart(2, '0')}${period[3] ? '-' + period[3].padStart(2, '0') : ''}` : null };
}

async function fetchSource(config, fetchImpl, userAgent, documents) {
  let lastError;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetchImpl(config.fetchUrl, { headers: { 'User-Agent': userAgent,
        Accept: config.source === 'snkrdunk' ? 'application/json' : 'text/html' }, signal: AbortSignal.timeout(30000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      if (config.source === 'snkrdunk') return parseSnkrdunk(await response.json(), config.size);
      documents[config.key] = await response.text();
      return parsePriceBase(documents[config.key]);
    } catch (error) {
      lastError = error;
      if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 800));
    }
  }
  throw lastError;
}

export async function updateJapanPrices({ config, previous = {}, history = {}, date, updated,
  fetchImpl = fetch, userAgent = 'pokemon-card-tracker', warn = console.warn }) {
  const sources = sourceConfigs(config);
  const quotes = {}, documents = {}, historyErrors = {};
  const series = { ...(history.series || {}) };
  // Keep requests sequential to limit provider load.
  for (const source of sources) {
    try {
      const parsed = await fetchSource(source, fetchImpl, userAgent, documents);
      const quote = { source: source.source, key: source.key, url: source.url, currency: 'JPY',
        ...parsed, fetchedAt: updated, date, stale: false };
      quotes[source.source] = quote;
      const points = [...(series[source.key]?.points || [])];
      const point = [date, quote.price];
      if (points.at(-1)?.[0] === date) points[points.length - 1] = point;
      else points.push(point);
      series[source.key] = { source: source.source, url: source.url, label: quote.label, points };
    } catch (error) {
      warn(`${SOURCE_NAMES[source.source]}: ${error.message}`);
      const old = previous.quotes?.[source.source];
      const reusable = old?.key === source.key && positiveYen(old.price) != null;
      quotes[source.source] = { ...(reusable ? old : { source: source.source, key: source.key, url: source.url, currency: 'JPY', price: null }),
        stale: true, error: error.message, attemptedAt: updated };
      // Never append yesterday's value as a successful new observation.
    }
  }
  for (const source of sources) {
    const key = historyKey(source);
    if (series[key]?.fetchedDate === date) continue;
    try {
      const found = await fetchJapanHistory(source, { date, fetchImpl, userAgent, html: documents[source.key] });
      const points = [...new Map([...(series[key]?.points || []), ...found.points].map((p) => [p[0], p])).values()]
        .sort((a, b) => a[0].localeCompare(b[0]));
      series[key] = { ...found, points, fetchedDate: date, fetchedAt: updated };
    } catch (error) {
      historyErrors[source.source] = error.message;
      warn(`${SOURCE_NAMES[source.source]} 歷史：${error.message}`);
    }
  }
  const historyChoices = sources.flatMap((s) => [historyKey(s), s.key].filter((key) => series[key]?.points?.length)
    .map((key) => ({ key, source: s.source, label: series[key].label, kind: series[key].kind || 'snapshot',
      fetchedDate: series[key].fetchedDate, error: historyErrors[s.source] || null })));
  const order = config?.preferred === 'pricebase' ? ['pricebase', 'snkrdunk'] : ['snkrdunk', 'pricebase'];
  const selected = order.find((s) => quotes[s]?.price > 0 && !quotes[s].stale) || order.find((s) => quotes[s]?.price > 0) || null;
  const current = quotes[selected];
  const points = current ? series[current.key]?.points || [] : [];
  const chart = historyChoices.find((c) => c.source === selected && c.kind !== 'snapshot') || historyChoices.find((c) => c.kind !== 'snapshot');
  return { japan: { preferred: config?.preferred || 'snkrdunk', selected, quotes, historyChoices, historyErrors, chartKey: chart?.key || current?.key,
    prev: points.length > 1 ? points.at(-2)[1] : null, spark: points.slice(-30).map((x) => x[1]) },
    history: { ...history, currency: 'JPY', series } };
}
