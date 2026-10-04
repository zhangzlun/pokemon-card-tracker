import test from 'node:test';
import assert from 'node:assert/strict';
import { recentPoints, snkrVariant, parseSnkrHistory, parsePriceBaseHistory } from '../scripts/japan-history.mjs';
import { updateJapanPrices } from '../scripts/japan-prices.mjs';

const date = '2026-10-04';
const stamp = (d) => Date.parse(d + 'T00:00:00+09:00');
const history = { filters: { variants: { options: [{ id: 123, name: '1個' }, { id: 124, name: '2個' }] }, conditions: { options: [] } },
  trades: [{ title: '1個', price: 9600 }], chart: { lines: [{ points: [
    { timestamp: stamp('2026-09-04'), price: 13000 }, { timestamp: stamp('2026-09-05'), price: 12500 },
    { timestamp: stamp('2026-10-02'), price: null }, { timestamp: stamp('2026-10-03'), price: 9700 },
    { timestamp: stamp(date), price: 9617 }, { timestamp: stamp('2026-10-05'), price: 9500 },
  ] }] } };
const article = (labels = ['2026年9月5日', '2026年9月', '2026年9月31日', '2026年10月2日'], values = [32000, 30000, 27000, 26000]) =>
  '<h1>30th CELEBRATION未開封BOXの相場</h1><script>var chart = {chart_args: ' + JSON.stringify({
    options: { plugins: { title: { text: '30th CELEBRATION BOXの価格推移' } } }, data: { labels, datasets: [{ data: values }] }
  }) + ', post_id: 1};</script>';

test('30 calendar days include both boundaries; Tokyo midnight and gaps are preserved', () => {
  assert.deepEqual(parseSnkrHistory(history, '1個', date), [['2026-09-05', 12500], ['2026-10-03', 9700], [date, 9617]]);
  assert.deepEqual(recentPoints([[date, 0], [date, null], [date, 5], [date, 6]], date), [[date, 6]]);
});

test('rejects mixed pack sizes, ambiguous variants and unsupported condition filters', () => {
  assert.throws(() => parseSnkrHistory({ ...history, trades: [{ title: '2個' }] }, '1個', date), /其他規格/);
  assert.throws(() => snkrVariant(history, '1枚'), /唯一/);
  assert.throws(() => snkrVariant({ ...history, filters: { ...history.filters, conditions: { options: [{ id: 'used' }] } } }, '1個'), /品況/);
  assert.throws(() => parseSnkrHistory({ ...history, chart: { lines: [{ points: [] }, { points: [] }] } }, '1個', date), /格式/);
});

test('PRICE BASE matches product chart, requires exact valid dates and never executes scripts', () => {
  assert.deepEqual(parsePriceBaseHistory(article(), date), [['2026-09-05', 32000], ['2026-10-02', 26000]]);
  assert.throws(() => parsePriceBaseHistory(article().replace('30th CELEBRATION未開封BOXの相場', 'Other Box'), date), /唯一/);
  assert.throws(() => parsePriceBaseHistory(article() + article(), date), /唯一/);
  assert.throws(() => parsePriceBaseHistory(article(['2026年10月2日'], []), date), /格式/);
  assert.throws(() => parsePriceBaseHistory(article().replace('26000', '(globalThis.executed=true)'), date), /唯一/);
  assert.equal(globalThis.executed, undefined);
});

test('backfill uses filtered endpoint, separates trades from listings, merges corrections and retains older days', async () => {
  const requests = [];
  const fetchImpl = async (url) => {
    requests.push(url);
    if (url.endsWith('/sizes')) return Response.json({ sizePrices: [{ size: { localizedName: '1個' }, minNewListingPrice: 9600 }] });
    if (!url.includes('trading-history')) return Response.json({ productCatalogId: 456 });
    if (!url.includes('variant_id')) return Response.json({ ...history, chart: { lines: [{ points: [{ timestamp: stamp(date), price: 999999 }] }] } });
    assert.ok(url.endsWith('&variant_id=123'));
    return Response.json(history);
  };
  const key = 'snkrdunk:881421:1個:trades';
  const args = { config: { snkrdunk: { apparelId: 881421 } }, date, updated: date + 'T05:00:00Z', fetchImpl, warn: () => {} };
  const result = await updateJapanPrices({ ...args, history: { series: { [key]: { points: [['2026-08-01', 30000], ['2026-10-03', 9800]] } } } });
  assert.deepEqual(result.history.series[key].points, [['2026-08-01', 30000], ['2026-09-05', 12500], ['2026-10-03', 9700], [date, 9617]]);
  assert.deepEqual(result.history.series['snkrdunk:881421:1個'].points, [[date, 9600]]);
  assert.equal(result.japan.chartKey, key);
  assert.equal(result.japan.prev, null); // Don't compare a listing with a past transaction.
  assert.equal(requests.length, 4);
  requests.length = 0;
  const again = await updateJapanPrices({ ...args, previous: result.japan, history: result.history });
  assert.equal(requests.length, 1); // Successful backfill at most once per date.
  assert.deepEqual(again.history, result.history);
  const failed = await updateJapanPrices({ ...args, date: '2026-10-05', previous: result.japan, history: result.history,
    fetchImpl: async () => { throw new Error('offline'); } });
  assert.deepEqual(failed.history, result.history);
  assert.match(failed.japan.historyErrors.snkrdunk, /offline/);
});
