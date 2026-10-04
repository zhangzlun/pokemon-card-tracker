import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createLocalWatchlist } from '../scripts/local-watchlist.mjs';
import { writeJson, readJson } from '../scripts/data-store.mjs';

test('refreshing a tracked card saves independent comparisons and preserves its USD market price', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pct-comparison-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await writeJson(path.join(root, 'data/watchlist.json'), { items: [{ pid: 518861, cat: 3 }] });
  await writeJson(path.join(root, 'data/comparison-sources.json'), { 518861: { sources: [{ source: 'snkrdunk-single', apparelId: 146897, size: '1枚' }] } });
  await writeJson(path.join(root, 'dist/data/catalog-en.json'), { date: '2026-10-04', cat: 3,
    groups: [[1, 'Promo']], items: [[518861, 0, 'Pikachu with Grey Felt Hat', '085', 0, [['Holofoil', 1015.89, 1000]]]] });
  await writeJson(path.join(root, 'data/latest.json'), { date: '2026-10-03', updated: '2026-10-03T00:00:00Z', items: {} });
  const mutate = createLocalWatchlist(root, { now: () => new Date('2026-10-04T05:00:00Z'),
    fetchImpl: async (url) => {
      assert.equal(url, 'https://snkrdunk.com/v2/products/146897/size-chips?type=apparel');
      return Response.json({ chips: [
        { conditionCode: 'trading_card_single_nearly_unused', filterConditionId: 'like_new', text: 'A', usedMinPrice: 159999, hasListing: true },
        { conditionCode: 'trading_card_single_little_scratches', filterConditionId: 'minor_scratches', text: 'B', usedMinPrice: 109000, hasListing: true },
        { conditionCode: 'trading_card_single_psa10', filterConditionId: 'psa_10', text: 'PSA10', usedMinPrice: 432000, hasListing: true }
      ] });
    } });
  const { latest } = await mutate({ action: 'upsert', entry: { pid: 518861, cat: 3 } });
  assert.equal(latest.items[518861].market, 1015.89);
  assert.deepEqual(latest.items[518861].comparisons.quotes.map((q) => [q.metric, q.price]), [['a', 159999], ['psa10', 432000]]);
  assert.equal(latest.items[518861].japan, undefined);
  const history = await readJson(path.join(root, 'dist/data/history/518861-comparisons.json'), null);
  assert.equal(Object.values(history.series)[0].currency, 'JPY');
  assert.deepEqual((await readJson(path.join(root, 'dist/data/history/518861.json'), null)).points, [['2026-10-04', 1015.89, 1000]]);
});
