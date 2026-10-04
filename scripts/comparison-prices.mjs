// Reference quotes are independent of portfolio valuation and of one another.
import { parseSnkrdunk } from './japan-prices.mjs';
const text = (s) => s.replace(/<[^>]*>/g, '').replace(/&nbsp;|&#160;/g, ' ').trim();
const yen = (v) => Number.isSafeInteger(v) && v > 0;

// Auto-match only a unique printed set code + card number. The catalogue name
// may be English while the Japanese product title uses Japanese characters.
export function findSingleProduct(html, { cat, number, abbr }) {
  if (![3, 85].includes(cat) || !number || typeof number !== 'string') return null;
  const cardNumber = number.trim();
  const setCode = String(abbr || '').trim();
  if (!/^[a-z\d/-]{2,24}$/i.test(cardNumber) || (cardNumber.includes('/') && !/^[a-z\d-]{2,12}$/i.test(setCode))) return null;
  const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const printed = cardNumber.includes('/') ? `${escape(setCode)}\\s+${escape(cardNumber)}` : escape(cardNumber);
  const exact = new RegExp(`\\[\\s*${printed}\\s*\\]`, 'i');
  const ids = new Set();
  for (const match of html.matchAll(/<a\s+href="https:\/\/snkrdunk\.com\/apparels\/([1-9]\d+)"[^>]*\baria-label="([^"]+)"/g)) {
    const label = match[2];
    if (!exact.test(label)) continue;
    if (cat === 3 && !label.includes('【英語版】')) continue;
    if (cat === 85 && /【(?:英語版|中国語版|韓国語版)】/.test(label)) continue;
    ids.add(Number(match[1]));
  }
  return ids.size === 1 ? [...ids][0] : null;
}

export async function discoverSingleProduct(card, { fetchImpl = fetch, userAgent = 'pokemon-card-tracker' } = {}) {
  if (card.sealed || !card.number) return null;
  const query = card.number.includes('/') ? `${card.abbr || ''} ${card.number}`.trim() : card.number;
  if (query.length < 3) return null;
  const url = `https://snkrdunk.com/search?keywords=${encodeURIComponent(query)}`;
  const response = await fetchImpl(url, { headers: { 'User-Agent': userAgent, Accept: 'text/html' }, signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`SNKRDUNK 搜尋 HTTP ${response.status}`);
  const id = findSingleProduct(await response.text(), card);
  return id ? { sources: [{ source: 'snkrdunk-single', apparelId: id, size: '1枚' }] } : null;
}

function sealedPackage(name) {
  if (/Pokemon Center Elite Trainer Box/i.test(name)) return { terms: ['エリートトレーナーボックス', 'ポケモンセンター'] };
  if (/Elite Trainer Box/i.test(name)) return { terms: ['エリートトレーナーボックス'], exclude: ['ポケモンセンター'] };
  if (/Booster Bundle/i.test(name)) return { terms: ['ブースターバンドル', 'ボックス'], exclude: ['パック'] };
  if (/Mini Tin Display/i.test(name)) return { terms: ['ミニティン', 'ディスプレイボックス'] };
  if (/2-Pack Blister/i.test(name)) return { terms: ['2パックブリスター'] };
  return null;
}

export function findSealedProduct(html, card) {
  if (card.cat !== 3 || !card.sealed || !sealedPackage(card.name)) return null;
  const setName = String(card.group || '').split(':').slice(1).join(':').trim().toLowerCase();
  if (setName.length < 8) return null;
  const packageRule = sealedPackage(card.name);
  const ids = new Set();
  for (const match of html.matchAll(/<a\s+href="https:\/\/snkrdunk\.com\/apparels\/([1-9]\d+)"[^>]*\baria-label="([^"]+)"/g)) {
    const label = match[2];
    if (!label.includes('(英語版)') || label.includes('[') || !label.toLowerCase().includes(setName)) continue;
    if (!packageRule.terms.every((term) => label.includes(term)) || packageRule.exclude?.some((term) => label.includes(term))) continue;
    ids.add(Number(match[1]));
  }
  return ids.size === 1 ? [...ids][0] : null;
}

export async function discoverSealedProduct(card, { fetchImpl = fetch, userAgent = 'pokemon-card-tracker' } = {}) {
  if (card.cat !== 3 || !card.sealed || !sealedPackage(card.name)) return null;
  const url = `https://snkrdunk.com/search?keywords=${encodeURIComponent(card.name)}`;
  const response = await fetchImpl(url, { headers: { 'User-Agent': userAgent, Accept: 'text/html' }, signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`SNKRDUNK 搜尋 HTTP ${response.status}`);
  const id = findSealedProduct(await response.text(), card);
  return id ? { sources: [{ source: 'snkrdunk-sealed', apparelId: id, size: '1個' }] } : null;
}

export function comparisonConfigs(config = {}) {
  if (!config || typeof config !== 'object' || Array.isArray(config) || (config.sources !== undefined && !Array.isArray(config.sources))) {
    throw new Error('比價來源設定無效');
  }
  return (config.sources || []).map((s) => {
    if (s.source === 'snkrdunk-single' || s.source === 'snkrdunk-used') {
      if (!Number.isSafeInteger(s.apparelId) || s.apparelId <= 0 || s.size !== '1枚') throw new Error('SNKRDUNK 單卡規格必須是 1枚');
      return { ...s, key: `snkrdunk:${s.apparelId}:condition`, name: 'SNKRDUNK',
        url: `https://snkrdunk.com/apparels/${s.apparelId}`, fetchUrl: `https://snkrdunk.com/v2/products/${s.apparelId}/size-chips?type=apparel` };
    }
    if (s.source === 'snkrdunk-sealed') {
      if (!Number.isSafeInteger(s.apparelId) || s.apparelId <= 0 || s.size !== '1個') throw new Error('SNKRDUNK 盒裝規格必須是 1個');
      return { ...s, key: `snkrdunk:${s.apparelId}:sealed:1個`, name: 'SNKRDUNK',
        url: `https://snkrdunk.com/apparels/${s.apparelId}`, fetchUrl: `https://snkrdunk.com/v1/apparels/${s.apparelId}/sizes` };
    }
    if (s.source === 'pricebase-buyback') {
      const url = new URL(s.url);
      if (url.origin !== 'https://price-base.com' || url.username || url.password || url.search || url.hash ||
        !/^\/useful\/[a-z0-9-]+$/.test(url.pathname) || !s.cardName || !s.cardNumber) throw new Error('買取比較來源無效');
      return { ...s, key: `pricebase:${url.pathname}:buyback`, name: 'PRICE BASE', fetchUrl: url.href };
    }
    throw new Error('不支援的比價來源');
  });
}

export function parseSingleConditions(data) {
  if (!Array.isArray(data?.chips)) throw new Error('找不到 SNKRDUNK 單卡品相');
  const choices = [
    ['a', 'trading_card_single_nearly_unused', 'like_new', 'A', 'A 等級最低掛價', '未鑑定單卡・A'],
    ['psa10', 'trading_card_single_psa10', 'psa_10', 'PSA10', 'PSA10 最低掛價', 'PSA10 鑑定卡']
  ];
  const quotes = [];
  for (const [metric, code, filter, text, label, condition] of choices) {
    const rows = data.chips.filter((r) => r.conditionCode === code || r.filterConditionId === filter || r.text === text);
    if (rows.length > 1) throw new Error(`${text} 品相資料不唯一`);
    const row = rows[0];
    if (!row || row.conditionCode !== code || row.filterConditionId !== filter || row.text !== text ||
        row.hasListing !== true || !yen(row.usedMinPrice)) continue;
    quotes.push({ metric, price: row.usedMinPrice, kind: 'listing', label, condition });
  }
  if (!quotes.length) throw new Error('A 與 PSA10 都沒有有效掛價');
  return quotes;
}

export function parseBuyback(html, config) {
  const rows = [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map((m) =>
    [...m[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) => text(c[1])));
  const identity = (label, value) => rows.filter((r) => r[0] === label && r[1]?.toLowerCase() === value.toLowerCase()).length === 1;
  if (!identity('カード名', config.cardName) || !identity('カードID', config.cardNumber)) throw new Error('文章卡名或卡號不符，未採用價格');
  const tables = [...html.matchAll(/<figure\b[^>]*>([\s\S]*?)<\/figure>/gi)].map((m) => m[1])
    .filter((s) => /買取価格\(未開封\)/.test(s) && /買取価格\(開封済み\)/.test(s));
  if (tables.length !== 1) throw new Error('找不到唯一的未拆／已拆買取表');
  const table = tables[0];
  const period = text(table).match(/買取価格は(\d{4})年(\d{1,2})月時点のPRICE BASE買取目安価格/);
  if (!period || Number(period[2]) < 1 || Number(period[2]) > 12) throw new Error('買取表沒有明確相場年月');
  const sourceUpdated = html.match(/"dateModified"\s*:\s*"(\d{4}-\d{2}-\d{2})/)?.[1] || null;
  const tableRows = [...table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map((m) =>
    [...m[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((c) => text(c[1])));
  return [['未開封', 'sealed', '未拆封'], ['開封済み', 'opened', '已拆、美品']].map(([jp, metric, condition]) => {
    const found = tableRows.filter((r) => r[0] === `買取価格(${jp})`);
    const match = found.length === 1 && found[0][1]?.match(/^([\d,]+)円$/);
    const price = match ? Number(match[1].replace(/,/g, '')) : null;
    if (!yen(price)) throw new Error(`沒有有效的${condition}買取目安`);
    return { metric, price, kind: 'buyback', label: '買取參考上限', condition,
      priceAsOf: `${period[1]}-${period[2].padStart(2, '0')}`, sourceUpdated };
  });
}

export async function updateComparisons({ config, previous = {}, history = {}, date, updated,
  fetchImpl = fetch, userAgent = 'pokemon-card-tracker', warn = console.warn }) {
  const quotes = [], errors = [], series = { ...history.series };
  for (const source of comparisonConfigs(config)) {
    try {
      const response = await fetchImpl(source.fetchUrl, { headers: { 'User-Agent': userAgent,
        Accept: source.name === 'SNKRDUNK' ? 'application/json' : 'text/html' }, signal: AbortSignal.timeout(30000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const parsed = source.source === 'snkrdunk-sealed'
        ? [{ metric: 'sealed', ...parseSnkrdunk(await response.json(), '1個'), condition: '未拆封・1個' }]
        : source.name === 'SNKRDUNK' ? parseSingleConditions(await response.json()) : parseBuyback(await response.text(), source);
      for (const item of parsed) {
        const key = `${source.key}:${item.metric}`;
        const quote = { ...item, key, sourceKey: source.key, name: source.name, url: source.url, currency: 'JPY',
          date, fetchedAt: updated, stale: false };
        quotes.push(quote);
        series[key] = { name: source.name, currency: 'JPY', kind: item.kind, label: item.label, condition: item.condition,
          points: [...new Map([...(series[key]?.points || []), [date, item.price]].map((p) => [p[0], p])).values()].sort((a, b) => a[0].localeCompare(b[0])) };
      }
    } catch (error) {
      errors.push({ name: source.name, url: source.url, message: error.message });
      warn(`比價 ${source.name}：${error.message}`);
      quotes.push(...(previous.quotes || []).filter((q) => q.sourceKey === source.key).map((q) => ({ ...q, stale: true, error: error.message })));
    }
  }
  return { comparisons: { quotes, errors, links: config.links || [] }, history: { ...history, series } };
}
