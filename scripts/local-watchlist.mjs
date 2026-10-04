import path from 'node:path';
import { comparisonConfigs, updateComparisons } from './comparison-prices.mjs';
import { dataDirs, loadLatest, loadHistory, readJson, writeJson, withJapanDefaults } from './data-store.mjs';
import { resolveUsdPrice, recordUsdPrice } from './us-prices.mjs';
import { sourceConfigs, updateJapanPrices } from './japan-prices.mjs';

const today = (now) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(now);

export function createLocalWatchlist(root, { fetchImpl = fetch, now = () => new Date() } = {}) {
  let queue = Promise.resolve();
  async function mutate(input) {
    if (!input || !['upsert', 'remove'].includes(input.action)) throw new Error('不支援的清單操作');
    const pid = input.action === 'remove' ? input.pid : input.entry?.pid;
    if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error('無效的商品編號');
    const watchFile = path.join(root, 'data/watchlist.json');
    const watch = await readJson(watchFile, { items: [] });
    const defaults = await readJson(path.join(root, 'data/japan-sources.json'), {});
    const comparisons = await readJson(path.join(root, 'data/comparison-sources.json'), {});
    const latest = await loadLatest(root, true);
    latest.items ||= {};
    const existing = watch.items.find((w) => Number(w.pid) === pid);
    if (input.action === 'remove') {
      watch.items = watch.items.filter((w) => Number(w.pid) !== pid);
    } else {
      const cat = input.entry.cat;
      if (![3, 85].includes(cat)) throw new Error('不支援的商品分類');
      const catalog = await readJson(path.join(root, `dist/data/catalog-${cat === 85 ? 'jp' : 'en'}.json`), null);
      const item = catalog?.items.find((x) => x[0] === pid);
      if (!item) throw new Error('商品不在本機目錄中，請先更新目錄');
      const entry = { ...existing, pid, cat };
      // Only store watchlist settings. Holdings, tokens and notes never reach disk here.
      if (typeof input.entry.zh === 'string') entry.zh = input.entry.zh.slice(0, 120);
      if (typeof input.entry.sub === 'string') entry.sub = input.entry.sub.slice(0, 80);
      if (Object.hasOwn(input.entry, 'japan')) entry.japan = input.entry.japan;
      if (Object.hasOwn(input.entry, 'comparisons')) entry.comparisons = input.entry.comparisons;
      const resolved = withJapanDefaults(entry, defaults);
      if (resolved.japan) sourceConfigs(resolved.japan);
      const comparisonConfig = Object.hasOwn(resolved, 'comparisons') ? resolved.comparisons : comparisons[pid];
      if (comparisonConfig) comparisonConfigs(comparisonConfig);
      const group = catalog.groups[item[1]] || [];
      const old = latest.items[pid] || {};
      const stamp = now();
      const usdResult = await resolveUsdPrice({ pid, prices: item[5], wanted: resolved.sub, previous: old,
        date: today(stamp), catalogDate: catalog.date, updated: stamp.toISOString(), fetchImpl });
      const { primary, usdQuote } = usdResult;
      const usdHistory = recordUsdPrice({ pid, ...await loadHistory(root, `${pid}.json`, true) }, usdResult,
        usdQuote.date || catalog.date, item[2]);
      for (const dir of dataDirs(root, true)) await writeJson(path.join(dir, 'history', `${pid}.json`), usdHistory);
      const info = { ...old, pid, cat, name: item[2], number: item[3], sealed: item[4], group: group[1] || '', abbr: group[2] || '',
        zh: resolved.zh || '', prices: usdResult.prices, usdQuote, sub: primary?.[0] || '', market: primary?.[1] ?? null, low: primary?.[2] ?? null,
        date: usdQuote.date || catalog.date, missing: false, spark: usdHistory.points.slice(-30).map((p) => p[1]), prev: usdHistory.points.at(-2)?.[1] ?? null };
      if (resolved.japan) {
        const historyName = `${pid}-jpy.json`;
        const stamp = now();
        const result = await updateJapanPrices({ config: resolved.japan, previous: old.japan,
          history: { pid, ...await loadHistory(root, historyName, true) }, date: today(stamp), updated: stamp.toISOString(), fetchImpl });
        info.japan = result.japan;
        for (const dir of dataDirs(root, true)) await writeJson(path.join(dir, 'history', historyName), result.history);
      } else delete info.japan;
      if (comparisonConfig) {
        const result = await updateComparisons({ config: comparisonConfig, previous: old.comparisons,
          history: { pid, ...await loadHistory(root, `${pid}-comparisons.json`, true) }, date: today(stamp), updated: stamp.toISOString(), fetchImpl });
        info.comparisons = result.comparisons;
        for (const dir of dataDirs(root, true)) await writeJson(path.join(dir, 'history', `${pid}-comparisons.json`), result.history);
      } else delete info.comparisons;
      latest.items[pid] = info;
      latest.updated = now().toISOString();
      latest.date ||= catalog.date;
      if (existing) watch.items[watch.items.indexOf(existing)] = resolved;
      else watch.items.push(resolved);
    }
    await writeJson(watchFile, watch);
    await writeJson(path.join(root, 'dist/data/watchlist.json'), watch);
    for (const dir of dataDirs(root, true)) await writeJson(path.join(dir, 'latest.json'), latest);
    return { watch, latest };
  }
  return (input) => {
    const result = queue.then(() => mutate(input));
    queue = result.catch(() => {});
    return result;
  };
}
