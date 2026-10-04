import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSnkrdunk, parsePriceBase, sourceConfigs, updateJapanPrices } from '../scripts/japan-prices.mjs';

// Minimal fixtures matching the public responses inspected on 2026-10-04.
const sizes = { sizePrices: [
  { size: { id: 5038678, localizedName: '2個', quantity: 1, isDeleted: false }, minNewListingPrice: 19800 },
  { size: { id: 5038677, localizedName: '1個', quantity: 1, isDeleted: false }, minNewListingPrice: 9600,
    minUsedListingPrice: 8000, maxOfferPrice: 9100 },
] };
const widget = `<section class="pb-cph pb-cph--box" data-pb-cph-type="box">
  <p class="pb-cph__price-label" aria-describedby="note">最新取引相場価格*</p>
  <p class="pb-cph__amount"><span class="pb-cph__amount-number">9,700</span><span>円</span></p>
  <p>※2026年10月時点。</p></section>`;
const html = `<p>定価 6,000円</p>${widget}<p>過去 12,000円</p>
  <script type="application/ld+json">{"dateModified":"2026-10-03T00:05:09+0900"}</script>`;
const config = { snkrdunk: { apparelId: 846048, size: '1個' }, pricebase: { url: 'https://price-base.com/useful/stormemeralda-box-market' } };
const run = (options = {}) => updateJapanPrices({ config, date: '2026-10-04', updated: '2026-10-04T04:00:00Z',
  warn: () => {}, fetchImpl: async (url) => url.includes('snkrdunk') ? Response.json(sizes) : new Response(html), ...options });

test('SNKRDUNK selects the exact single-unit new listing, regardless of order or quantity field', () => {
  assert.equal(parseSnkrdunk(sizes).price, 9600);
  assert.equal(parseSnkrdunk(sizes).kind, 'listing');
  assert.equal(parseSnkrdunk(sizes, '2個').price, 19800);
  assert.throws(() => parseSnkrdunk(sizes, '1枚'), /唯一規格/);
});

test('SNKRDUNK never uses sold-out, deleted, duplicate or used-only variants', () => {
  for (const price of [0, null, -1, 'NaN']) {
    assert.throws(() => parseSnkrdunk({ sizePrices: [{ size: { localizedName: '1個' }, minNewListingPrice: price, minUsedListingPrice: 8000 }] }), /新品掛價/);
  }
  assert.throws(() => parseSnkrdunk({ sizePrices: [{ ...sizes.sizePrices[1], size: { localizedName: '1個', isDeleted: true } }] }), /唯一規格/);
  assert.throws(() => parseSnkrdunk({ sizePrices: [sizes.sizePrices[1], sizes.sizePrices[1]] }), /唯一規格/);
  assert.throws(() => parseSnkrdunk({ error: 'blocked' }), /格式/);
});

test('PRICE BASE uses the current widget, preserves the source period and ignores MSRP/history', () => {
  assert.deepEqual(parsePriceBase(html), { price: 9700, kind: 'reference', label: '取引相場參考價', sourceUpdated: '2026-10-03', priceAsOf: '2026-10' });
});

test('PRICE BASE rejects absent, ambiguous, unsupported and invalid prices', () => {
  for (const input of ['<p>価格9,700円</p>', widget + widget, widget.replace('最新取引相場価格', '買取価格'), widget.replace('9,700', '—'), widget.replace('9,700', '0')]) {
    assert.throws(() => parsePriceBase(input));
  }
});

test('PRICE BASE supports the dated, named conclusion in older single-box articles', () => {
  const summary = '<p>結論から言うと、30th CELEBRATION 未開封BOXの現在の最新取引相場価格は<strong>26,000円</strong>です。（※2026年10月時点。）</p>';
  const title = '<title>30th CELEBRATION未開封BOXの買取価格</title>';
  const result = parsePriceBase(title + '<p>定価7,200円</p>' + summary);
  assert.equal(result.price, 26000);
  assert.equal(result.priceAsOf, '2026-10');
  assert.throws(() => parsePriceBase('<title>別の商品</title>' + summary));
  assert.throws(() => parsePriceBase(title + summary + summary));
  assert.throws(() => parsePriceBase(title + summary.replace('2026年10月時点', '発売日')));
});

test('source mappings accept only expected public product URLs', () => {
  assert.equal(sourceConfigs(config).length, 2);
  assert.throws(() => sourceConfigs({ snkrdunk: { apparelId: '../accounts' } }));
  for (const url of ['http://price-base.com/useful/card', 'https://example.com/useful/card', 'https://price-base.com/useful/card?redirect=x', 'https://user:pass@price-base.com/useful/card']) {
    assert.throws(() => sourceConfigs({ pricebase: { url } }));
  }
});

test('records independent JPY series and replaces, rather than duplicates, same-day observations', async () => {
  const first = await run();
  assert.equal(first.japan.selected, 'snkrdunk');
  assert.equal(first.history.currency, 'JPY');
  assert.deepEqual(first.japan.spark, [9600]);
  const second = await run({ previous: first.japan, history: first.history });
  for (const series of Object.values(second.history.series)) assert.equal(series.points.length, 1);
  const next = await run({ date: '2026-10-05', previous: first.japan, history: first.history, config: { ...config, preferred: 'pricebase' } });
  assert.equal(next.japan.selected, 'pricebase');
  assert.equal(next.japan.prev, 9700);
  assert.deepEqual(next.japan.spark, [9700, 9700]);
});

test('one failed source falls back to the fresh alternate and does not write a false observation', async () => {
  const first = await run();
  const next = await run({ date: '2026-10-05', updated: '2026-10-05T04:00:00Z', previous: first.japan, history: first.history,
    fetchImpl: async (url) => url.includes('snkrdunk') ? new Response('unavailable', { status: 503 }) : new Response(html) });
  assert.equal(next.japan.selected, 'pricebase');
  assert.equal(next.japan.quotes.snkrdunk.date, '2026-10-04');
  assert.equal(next.japan.quotes.snkrdunk.stale, true);
  assert.equal(next.japan.quotes.snkrdunk.attemptedAt, '2026-10-05T04:00:00Z');
  assert.equal(next.history.series[first.japan.quotes.snkrdunk.key].points.length, 1);
  assert.equal(next.history.series[first.japan.quotes.pricebase.key].points.length, 2);
});

test('complete failure preserves last success and dates without appending history', async () => {
  const first = await run();
  const next = await run({ date: '2026-10-05', previous: first.japan, history: first.history,
    fetchImpl: async () => { throw new Error('timeout'); } });
  assert.equal(next.japan.selected, 'snkrdunk');
  assert.equal(next.japan.quotes.snkrdunk.price, 9600);
  assert.equal(next.japan.quotes.snkrdunk.fetchedAt, '2026-10-04T04:00:00Z');
  assert.deepEqual(next.history, first.history);
});

test('changing a mapping does not reuse a different product or variant quote', async () => {
  const first = await run();
  const next = await run({ config: { snkrdunk: { apparelId: 846050, size: '1個' } }, previous: first.japan, history: first.history,
    fetchImpl: async () => new Response('blocked', { status: 403 }) });
  assert.equal(next.japan.selected, null);
  assert.equal(next.japan.quotes.snkrdunk.price, null);
  assert.deepEqual(next.japan.spark, []);
  assert.deepEqual(next.history, first.history);
});

test('first-run failure yields an explicit unavailable quote, never a zero price', async () => {
  const next = await run({ config: { snkrdunk: config.snkrdunk }, fetchImpl: async () => Response.json({}) });
  assert.equal(next.japan.selected, null);
  assert.equal(next.japan.quotes.snkrdunk.price, null);
  assert.equal(next.japan.quotes.snkrdunk.date, undefined);
  assert.deepEqual(next.history.series, {});
});
