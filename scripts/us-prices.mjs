// TCGCSV can omit products with no active listings even when TCGplayer has a market price.
const money = (n) => typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
export const pickPrimary = (prices, wanted) => wanted ? prices.find((p) => p[0] === wanted) :
  prices.find((p) => money(p[1]) != null) || prices[0];

export function parsePricePoints(data, printing) {
  if (!Array.isArray(data)) throw new Error('TCGplayer 市價格式已變更');
  const rows = data.filter((row) => row.printingType === printing);
  if (rows.length !== 1 || money(rows[0].marketPrice) == null) throw new Error(`TCGplayer 沒有「${printing}」的有效市價`);
  // Never substitute latest sale, buylist price or listed median for Market Price.
  return money(rows[0].marketPrice);
}

export async function resolveUsdPrice({ pid, prices = [], wanted, previous = {}, date, catalogDate = date,
  updated, fetchImpl = fetch, userAgent = 'pokemon-card-tracker', warn = console.warn }) {
  if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error('無效的商品編號');
  let primary = pickPrimary(prices, wanted);
  if (money(primary?.[1]) != null) return { prices, primary, usdQuote: { source: 'tcgcsv', date: catalogDate, stale: false } };
  const printing = wanted || primary?.[0] || 'Normal';
  const url = `https://www.tcgplayer.com/product/${pid}`;
  let quote;
  try {
    const response = await fetchImpl(`https://mpapi.tcgplayer.com/v2/product/${pid}/pricepoints`, {
      headers: { 'User-Agent': userAgent, Accept: 'application/json' }, signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    quote = { source: 'tcgplayer', printing, price: parsePricePoints(await response.json(), printing),
      url, date, fetchedAt: updated, stale: false };
  } catch (error) {
    warn(`TCGplayer ${pid}：${error.message}`);
    const old = previous.usdQuote;
    quote = { ...(old?.source === 'tcgplayer' && old.printing === printing && money(old.price) != null ? old :
      { source: 'tcgplayer', printing, url, price: null }), stale: true, error: error.message, attemptedAt: updated };
  }
  if (quote.price != null) {
    primary = [printing, quote.price, primary?.[2] ?? null];
    prices = [...prices.filter((p) => p[0] !== printing), primary];
  }
  return { prices, primary, usdQuote: quote };
}

export function recordUsdPrice(history, result, date, name) {
  const hist = { ...history, points: [...(history.points || [])] };
  // A reused quote must keep its old date, not create a false daily observation.
  if (result.primary && !result.usdQuote.stale) {
    const point = [date, result.primary[1], result.primary[2]];
    hist.points = [...new Map([...hist.points, point].map((p) => [p[0], p])).values()].sort((a, b) => a[0].localeCompare(b[0]));
    hist.name = name;
    hist.sub = result.primary[0];
    hist.observations = { ...hist.observations, [date]: { source: result.usdQuote.source, fetchedAt: result.usdQuote.fetchedAt || null } };
  }
  return hist;
}
