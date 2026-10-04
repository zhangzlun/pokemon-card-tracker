#!/usr/bin/env node
// 每天執行一次：從 tcgcsv 抓 TCGplayer 的寶可夢商品與價格，
// 產生網站用的資料（dist/），並把追蹤清單的當日價格寫進 data/history。
// 不需要任何套件，Node 20 以上即可。

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = (process.env.TCGCSV_BASE || 'https://tcgcsv.com/tcgplayer').replace(/\/$/, '');
const FX_URL = process.env.FX_URL || 'https://open.er-api.com/v6/latest/USD';
const REPO = process.env.GITHUB_REPOSITORY || '';
const UA = `pokemon-card-tracker (${REPO ? 'https://github.com/' + REPO : 'personal project'})`;

// TCGplayer 的分類：3 = Pokémon（英文版），85 = Pokémon Japan（日文版）
const CATS = [{ id: 3, key: 'en' }, { id: 85, key: 'jp' }];
const CONCURRENCY = 4;
const CACHE_DAYS = 14;
const SPARK_POINTS = 30;
const DEFAULT_FX = { TWD: 31.5, JPY: 150 };

// --local：只產生 dist/，不改動儲存庫裡的 data/history 與 data/latest.json（本機開發用）
const LOCAL = process.argv.includes('--local');

const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date());
const p = (...parts) => path.join(ROOT, ...parts);

async function readJson(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { return fallback; }
}
async function writeJson(file, data, pretty = false) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(data, null, pretty ? 2 : 0) + (pretty ? '\n' : ''));
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchJson(url, tries = 3) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(30000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      lastErr = err;
      await sleep(800 * (i + 1));
    }
  }
  throw new Error(`${url}: ${lastErr?.message || lastErr}`);
}

async function pool(items, size, fn) {
  let next = 0;
  const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      await fn(items[i], i);
    }
  });
  await Promise.all(workers);
}

const round2 = (n) => (typeof n === 'number' && isFinite(n) ? Math.round(n * 100) / 100 : null);
const ext = (product, name) => product.extendedData?.find((x) => x.name === name)?.value ?? '';

/** 讀取一個系列的商品清單。商品很少變動，所以用快取，系列有更新或快取太舊才重抓。 */
async function loadProducts(cat, group) {
  const file = p('.cache', 'products', `${group.groupId}.json`);
  const cached = await readJson(file, null);
  const fresh = cached && cached.modifiedOn === group.modifiedOn &&
    Date.now() - new Date(cached.fetchedAt).getTime() < CACHE_DAYS * 864e5;
  if (fresh) return cached.items;
  const data = await fetchJson(`${BASE}/${cat.id}/${group.groupId}/products`);
  const items = (data.results || []).map((x) => {
    const number = String(ext(x, 'Number') || '');
    const sealed = !number && !ext(x, 'Rarity');
    return [x.productId, x.name, number, sealed ? 1 : 0];
  });
  await writeJson(file, { modifiedOn: group.modifiedOn, fetchedAt: new Date().toISOString(), items });
  return items;
}

async function loadPrices(cat, group) {
  const data = await fetchJson(`${BASE}/${cat.id}/${group.groupId}/prices`);
  const byProduct = new Map();
  for (const x of data.results || []) {
    const market = round2(x.marketPrice), low = round2(x.lowPrice);
    if (market == null && low == null) continue;
    if (!byProduct.has(x.productId)) byProduct.set(x.productId, []);
    byProduct.get(x.productId).push([x.subTypeName || 'Normal', market, low]);
  }
  return byProduct;
}

async function buildCatalog(cat) {
  const groupsData = await fetchJson(`${BASE}/${cat.id}/groups`);
  const groups = (groupsData.results || []).slice().sort((a, b) => String(b.publishedOn).localeCompare(String(a.publishedOn)));
  if (!groups.length) throw new Error(`分類 ${cat.id} 沒有任何系列，來源可能有問題`);

  const out = { date: today, cat: cat.id, groups: [], items: [] };
  const index = new Map(); // productId -> 完整資訊，給追蹤清單用
  let failed = 0;

  await pool(groups, CONCURRENCY, async (g) => {
    try {
      const [products, prices] = await Promise.all([loadProducts(cat, g), loadPrices(cat, g)]);
      g._products = products;
      g._prices = prices;
    } catch (err) {
      failed++;
      console.warn(`  略過系列 ${g.groupId} ${g.name}: ${err.message}`);
    }
  });
  if (failed > groups.length * 0.1) throw new Error(`分類 ${cat.id} 有 ${failed}/${groups.length} 個系列抓取失敗，停止更新`);

  for (const g of groups) {
    if (!g._products) continue;
    const gi = out.groups.length;
    out.groups.push([g.groupId, g.name, g.abbreviation || '', String(g.publishedOn || '').slice(0, 10)]);
    for (const [pid, name, number, sealed] of g._products) {
      const prices = g._prices.get(pid) || [];
      index.set(pid, { pid, cat: cat.id, name, number, sealed, prices, group: g.name, abbr: g.abbreviation || '' });
      if (sealed || prices.length) out.items.push([pid, gi, name, number, sealed, prices]);
    }
  }
  console.log(`分類 ${cat.id}（${cat.key}）：${out.groups.length} 個系列，${out.items.length} 項商品${failed ? `，${failed} 個系列失敗` : ''}`);
  return { catalog: out, index };
}

async function loadFx(previous) {
  try {
    const data = await fetchJson(FX_URL, 2);
    const TWD = Number(data?.rates?.TWD), JPY = Number(data?.rates?.JPY);
    if (TWD > 0 && JPY > 0) return { TWD: Math.round(TWD * 1000) / 1000, JPY: Math.round(JPY * 100) / 100 };
    throw new Error('回傳內容沒有匯率');
  } catch (err) {
    console.warn(`匯率抓取失敗，沿用上一次的匯率：${err.message}`);
    return previous || DEFAULT_FX;
  }
}

/** 一個商品可能有多種版本（Normal、Holofoil…），挑一個當作主要價格。 */
function pickPrimary(prices, wanted) {
  if (!prices.length) return null;
  return prices.find((x) => x[0] === wanted) || prices.find((x) => x[1] != null) || prices[0];
}

async function main() {
  console.log(`更新日期（台北）：${today}，來源：${BASE}`);
  const previous = await readJson(p('data', 'latest.json'), {});
  const watchlist = await readJson(p('data', 'watchlist.json'), { items: [] });
  const dist = p('dist');
  await fs.rm(dist, { recursive: true, force: true });
  await fs.mkdir(path.join(dist, 'data'), { recursive: true });

  const index = new Map();
  for (const cat of CATS) {
    const built = await buildCatalog(cat);
    for (const [k, v] of built.index) index.set(k, v);
    await writeJson(path.join(dist, 'data', `catalog-${cat.key}.json`), built.catalog);
  }

  // 先把網頁和既有資料放進 dist，後面再把今天的價格寫進去
  await fs.cp(p('site'), dist, { recursive: true });
  await fs.cp(p('data'), path.join(dist, 'data'), { recursive: true });
  const dataDirs = LOCAL ? [path.join(dist, 'data')] : [p('data'), path.join(dist, 'data')];

  const fx = await loadFx(previous.fx);
  const latest = { date: today, updated: new Date().toISOString(), fx, items: {} };

  for (const w of watchlist.items || []) {
    const pid = Number(w.pid);
    const info = index.get(pid);
    const histFile = p('data', 'history', `${pid}.json`);
    const hist = await readJson(histFile, { pid, points: [] });
    if (!info) {
      latest.items[pid] = { pid, cat: w.cat, name: w.name || `#${pid}`, zh: w.zh || '', missing: true, spark: hist.points.slice(-SPARK_POINTS).map((x) => x[1]) };
      console.warn(`追蹤清單的商品 ${pid} 在來源裡找不到`);
      continue;
    }
    const primary = pickPrimary(info.prices, w.sub);
    if (primary) {
      const point = [today, primary[1], primary[2]];
      if (hist.points.length && hist.points[hist.points.length - 1][0] === today) hist.points[hist.points.length - 1] = point;
      else hist.points.push(point);
      hist.name = info.name;
      hist.sub = primary[0];
      for (const dir of dataDirs) await writeJson(path.join(dir, 'history', `${pid}.json`), hist);
    }
    const pts = hist.points;
    latest.items[pid] = {
      pid, cat: info.cat, name: info.name, zh: w.zh || '', group: info.group, abbr: info.abbr, number: info.number, sealed: info.sealed,
      prices: info.prices, sub: primary ? primary[0] : '', market: primary ? primary[1] : null, low: primary ? primary[2] : null,
      prev: pts.length > 1 ? pts[pts.length - 2][1] : null,
      spark: pts.slice(-SPARK_POINTS).map((x) => x[1]),
    };
  }
  for (const dir of dataDirs) await writeJson(path.join(dir, 'latest.json'), latest, true);
  await writeJson(path.join(dist, 'data', 'config.json'), { repo: REPO });
  console.log(`完成：追蹤 ${Object.keys(latest.items).length} 項，匯率 1 USD = ${fx.TWD} TWD${LOCAL ? '（本機模式，沒有改動 data/）' : ''}`);
}

main().catch((err) => {
  console.error(`更新失敗：${err.message}`);
  process.exit(1);
});
