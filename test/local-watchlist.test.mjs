import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { request } from 'node:http';
import { createDevServer } from '../scripts/dev.mjs';
import { readJson, writeJson, loadLatest, loadHistory, withJapanDefaults } from '../scripts/data-store.mjs';

async function fixture(t, options = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pct-local-test-'));
  const config = { snkrdunk: { apparelId: 881421, size: '1個' } };
  await writeJson(path.join(root, 'data/watchlist.json'), { items: [] });
  await writeJson(path.join(root, 'data/japan-sources.json'), { 718620: config, 709110: config });
  await writeJson(path.join(root, 'data/latest.json'), { date: '2026-10-03', updated: '2026-10-03T01:00:00Z', fx: { TWD: 32, JPY: 160 }, items: {} });
  await writeJson(path.join(root, 'dist/data/catalog-jp.json'), { date: '2026-10-03', cat: 85,
    groups: [[24721, '30th Celebration', 'm6a']], items: [[718620, 0, '30th Box', '', 1, [['Normal', 197, 190]]], [709110, 0, 'Storm Box', '', 1, []]] });
  await writeJson(path.join(root, 'dist/data/catalog-en.json'), { date: '2026-10-03', cat: 3,
    groups: [[24722, '30th Celebration', '30C']], items: [[704148, 0, '30th Celebration 2-Pack Blister', '', 1, []]] });
  let requests = 0;
  const server = createDevServer(root, { now: () => new Date('2026-10-04T05:00:00Z'), fetchImpl: async () => {
    requests++;
    return Response.json({ sizePrices: [{ size: { localizedName: '1個' }, minNewListingPrice: 26000 }] });
  }, ...options });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); await fs.rm(root, { recursive: true, force: true }); });
  const url = `http://127.0.0.1:${server.address().port}`;
  const post = (input, headers = {}) => fetch(`${url}/api/watchlist`, { method: 'POST', headers: { Origin: url, 'Content-Type': 'application/json', ...headers }, body: typeof input === 'string' ? input : JSON.stringify(input) });
  return { root, url, post, requests: () => requests };
}

test('local add repairs a missing USD market price using the original site and persists a dated observation', async (t) => {
  const f = await fixture(t, { fetchImpl: async (url) => {
    assert.equal(url, 'https://mpapi.tcgplayer.com/v2/product/704148/pricepoints');
    return Response.json([{ printingType: 'Normal', marketPrice: 56.74, listedMedianPrice: null }]);
  } });
  const response = await f.post({ action: 'upsert', entry: { pid: 704148, cat: 3 } });
  assert.equal(response.status, 200);
  const { latest } = await response.json();
  assert.equal(latest.items[704148].market, 56.74);
  assert.equal(latest.items[704148].low, null);
  assert.equal(latest.items[704148].date, '2026-10-04');
  assert.equal(latest.items[704148].usdQuote.source, 'tcgplayer');
  assert.deepEqual((await loadHistory(f.root, '704148.json', true)).points, [['2026-10-04', 56.74, null]]);
});

test('comparison refresh persists separate JPY history without changing USD valuation or holdings', async (t) => {
  const f = await fixture(t, { fetchImpl: async (url) => {
    assert.equal(url, 'https://snkrdunk.com/v2/products/146897/size-chips?type=apparel');
    return Response.json({ chips: [
      { conditionCode: 'trading_card_single_nearly_unused', filterConditionId: 'like_new', text: 'A', usedMinPrice: 159999, hasListing: true },
      { conditionCode: 'trading_card_single_psa10', filterConditionId: 'psa_10', text: 'PSA10', usedMinPrice: 432000, hasListing: true }
    ] });
  } });
  await writeJson(path.join(f.root, 'data/comparison-sources.json'), { 518861: { sources: [{ source: 'snkrdunk-single', apparelId: 146897, size: '1枚' }] } });
  await writeJson(path.join(f.root, 'dist/data/catalog-en.json'), { date: '2026-10-04', cat: 3,
    groups: [[1, 'Promo']], items: [[518861, 0, 'Pikachu with Grey Felt Hat', '085', 0, [['Holofoil', 1015.89, 1000]]]] });
  const response = await f.post({ action: 'upsert', entry: { pid: 518861, cat: 3 } });
  assert.equal(response.status, 200);
  const item = (await response.json()).latest.items[518861];
  assert.equal(item.market, 1015.89);
  assert.deepEqual(item.comparisons.quotes.map((q) => [q.metric, q.price]), [['a', 159999], ['psa10', 432000]]);
  assert.equal(item.japan, undefined);
  assert.deepEqual((await loadHistory(f.root, '518861.json', true)).points, [['2026-10-04', 1015.89, 1000]]);
  assert.equal(Object.values((await loadHistory(f.root, '518861-comparisons.json', true)).series)[0].currency, 'JPY');
});

test('a newly tracked single card accepts its own SNKRDUNK URL mapping and reports no A or PSA10 listings', async (t) => {
  const f = await fixture(t, { fetchImpl: async (url) => {
    assert.equal(url, 'https://snkrdunk.com/v2/products/738210/size-chips?type=apparel');
    return Response.json({ chips: [
      { conditionCode: 'trading_card_single_nearly_unused', filterConditionId: 'like_new', text: 'A', hasListing: false },
      { conditionCode: 'trading_card_single_psa10', filterConditionId: 'psa_10', text: 'PSA10', hasListing: false }
    ] });
  } });
  await writeJson(path.join(f.root, 'dist/data/catalog-en.json'), { date: '2026-10-04', cat: 3,
    groups: [[1, 'SM Promos']], items: [[148151, 0, 'Charizard GX', 'SM60', 0, [['Normal', 52.58, null]]]] });
  const config = { sources: [{ source: 'snkrdunk-single', apparelId: 738210, size: '1枚' }] };
  const response = await f.post({ action: 'upsert', entry: { pid: 148151, cat: 3, comparisons: config } });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.deepEqual(result.watch.items[0].comparisons, config);
  assert.equal(result.latest.items[148151].market, 52.58);
  assert.deepEqual(result.latest.items[148151].comparisons.quotes, []);
  assert.equal(result.latest.items[148151].comparisons.errors[0].message, 'A 與 PSA10 都沒有有效掛價');
  const invalid = await f.post({ action: 'upsert', entry: { pid: 148151, cat: 3,
    comparisons: { sources: [{ source: 'snkrdunk-single', apparelId: 738210, size: 'PSA8' }] } } });
  assert.equal(invalid.status, 400);
  assert.deepEqual((await readJson(path.join(f.root, 'data/watchlist.json'))).items[0].comparisons, config);
});

test('local add uses automatic mapping, immediately fetches JPY and persists without a GitHub token', async (t) => {
  const f = await fixture(t);
  const capability = await (await fetch(`${f.url}/data/config.json`)).json();
  assert.equal(capability.local, true);
  const response = await f.post({ action: 'upsert', entry: { pid: 718620, cat: 85, token: 'should-not-store', holdings: { qty: 99 } } });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.latest.items[718620].japan.quotes.snkrdunk.price, 26000);
  assert.equal(result.latest.items[718620].date, '2026-10-03'); // Cached USD must not look freshly fetched.
  assert.equal(result.latest.items[718620].japan.quotes.snkrdunk.date, '2026-10-04');
  assert.equal(result.watch.items[0].japan.snkrdunk.apparelId, 881421);
  assert.equal(result.watch.items[0].token, undefined);
  assert.equal(result.watch.items[0].holdings, undefined);
  assert.deepEqual(await readJson(path.join(f.root, 'data/watchlist.json')), result.watch);
  assert.equal((await loadLatest(f.root, true)).items[718620].japan.selected, 'snkrdunk');
  assert.equal(await readJson(path.join(f.root, 'data/history/718620-jpy.json'), null), null);
  await fs.rm(path.join(f.root, 'dist'), { recursive: true, force: true });
  assert.equal((await loadLatest(f.root, true)).items[718620].japan.quotes.snkrdunk.price, 26000);
  assert.deepEqual((await loadHistory(f.root, '718620-jpy.json', true)).series['snkrdunk:881421:1個'].points, [['2026-10-04', 26000]]);
});

test('cross-origin, invalid-host and non-JSON writes cannot alter local data or fetch sources', async (t) => {
  const f = await fixture(t);
  const input = { action: 'upsert', entry: { pid: 718620, cat: 85 } };
  for (const headers of [{ Origin: 'https://example.com' }, { Origin: '' }, { 'Content-Type': 'text/plain' }]) {
    assert.equal((await f.post(input, headers)).status, 403, JSON.stringify(headers));
  }
  // Fetch normalizes Host; use an actual HTTP request to exercise rebinding protection.
  const wrongHostStatus = await new Promise((resolve, reject) => {
    const req = request(f.url + '/api/watchlist', { method: 'POST', headers: { Host: 'evil.example:1234', Origin: 'http://evil.example:1234', 'Content-Type': 'application/json' } }, (res) => { res.resume(); resolve(res.statusCode); });
    req.on('error', reject); req.end(JSON.stringify(input));
  });
  assert.equal(wrongHostStatus, 403);
  assert.deepEqual((await readJson(path.join(f.root, 'data/watchlist.json'))).items, []);
  assert.equal(f.requests(), 0);
});

test('bad input is rejected before any configuration is written', async (t) => {
  const f = await fixture(t);
  for (const input of ['{', { action: 'delete-all' }, { action: 'upsert', entry: { pid: '../secret', cat: 85 } },
    { action: 'upsert', entry: { pid: 1234, cat: 85 } },
    { action: 'upsert', entry: { pid: 718620, cat: 85, japan: { pricebase: { url: 'http://localhost/secrets' } } } }]) {
    assert.equal((await f.post(input)).status, 400);
  }
  assert.equal((await f.post('x'.repeat(17000))).status, 413);
  assert.deepEqual((await readJson(path.join(f.root, 'data/watchlist.json'))).items, []);
  assert.equal(f.requests(), 0);
});

test('concurrent additions are serialized, re-saving does not duplicate, and removal preserves history', async (t) => {
  const f = await fixture(t);
  const responses = await Promise.all([718620, 709110].map((pid) => f.post({ action: 'upsert', entry: { pid, cat: 85 } })));
  assert.deepEqual(responses.map((r) => r.status), [200, 200]);
  assert.equal((await readJson(path.join(f.root, 'data/watchlist.json'))).items.length, 2);
  const again = await f.post({ action: 'upsert', entry: { pid: 718620, cat: 85, zh: '30週年' } });
  assert.equal((await again.json()).watch.items.length, 2);
  const removed = await (await f.post({ action: 'remove', pid: 718620 })).json();
  assert.deepEqual(removed.watch.items.map((w) => w.pid), [709110]);
  assert.equal((await loadHistory(f.root, '718620-jpy.json', true)).series['snkrdunk:881421:1個'].points.length, 1);
});

test('explicitly disabled sources stay disabled and custom sources override defaults', () => {
  const defaults = { 718620: { snkrdunk: { apparelId: 881421 } } };
  assert.equal(withJapanDefaults({ pid: 718620, cat: 85, japan: null }, defaults).japan, null);
  assert.equal(withJapanDefaults({ pid: 718620, cat: 85, japan: { preferred: 'pricebase' } }, defaults).japan.preferred, 'pricebase');
  assert.equal(withJapanDefaults({ pid: 718620, cat: 3 }, defaults).japan, undefined);
});

test('local histories merge with committed history without losing past days or mixing source identities', async (t) => {
  const f = await fixture(t);
  const base = { pid: 718620, currency: 'JPY', series: { a: { points: [['2026-10-01', 24000], ['2026-10-03', 25000]] } } };
  await writeJson(path.join(f.root, 'data/history/718620-jpy.json'), base);
  await writeJson(path.join(f.root, '.cache/local-data/history/718620-jpy.json'), { series: { a: { points: [['2026-10-03', 25500], ['2026-10-04', 26000]] }, b: { points: [['2026-10-04', 26100]] } } });
  const result = await loadHistory(f.root, '718620-jpy.json', true);
  assert.deepEqual(result.series.a.points, [['2026-10-01', 24000], ['2026-10-03', 25500], ['2026-10-04', 26000]]);
  assert.deepEqual(result.series.b.points, [['2026-10-04', 26100]]);
});
