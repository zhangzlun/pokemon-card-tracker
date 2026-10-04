import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePricePoints, resolveUsdPrice, recordUsdPrice } from '../scripts/us-prices.mjs';

const payload = [{ printingType: 'Normal', marketPrice: 56.74, buylistMarketPrice: null, listedMedianPrice: null },
  { printingType: 'Foil', marketPrice: null }];
const args = { pid: 704148, date: '2026-10-04', updated: '2026-10-04T05:30:00Z', warn: () => {},
  fetchImpl: async () => Response.json(payload) };

test('original site Market Price remains valid with no listings; other price fields never replace it', () => {
  assert.equal(parsePricePoints(payload, 'Normal'), 56.74);
  assert.throws(() => parsePricePoints(payload, 'Foil'));
  assert.throws(() => parsePricePoints([...payload, payload[0]], 'Normal'));
  for (const marketPrice of [0, null, '56.74', -10, Infinity]) {
    assert.throws(() => parsePricePoints([{ printingType: 'Normal', marketPrice, listedMedianPrice: 57, recentSalePrice: 5 }], 'Normal'));
  }
});

test('missing CSV product gets the correct market price without inventing a lowest listing', async () => {
  const result = await resolveUsdPrice({ ...args, fetchImpl: async (url) => {
    assert.equal(url, 'https://mpapi.tcgplayer.com/v2/product/704148/pricepoints');
    return Response.json(payload);
  } });
  assert.deepEqual(result.primary, ['Normal', 56.74, null]);
  assert.equal(result.usdQuote.source, 'tcgplayer');
  const history = recordUsdPrice({}, result, args.date, '30th Box');
  assert.deepEqual(history.points, [[args.date, 56.74, null]]);
  assert.equal(history.observations[args.date].source, 'tcgplayer');
  assert.deepEqual(recordUsdPrice(history, result, args.date, '30th Box'), history);
});

test('available CSV prices require no fallback and keep the catalog date', async () => {
  const result = await resolveUsdPrice({ ...args, prices: [['Normal', 55, 54]], catalogDate: '2026-10-03',
    fetchImpl: () => { throw new Error('must not fetch'); } });
  assert.equal(result.usdQuote.source, 'tcgcsv');
  assert.equal(result.usdQuote.date, '2026-10-03');
  assert.deepEqual(result.primary, ['Normal', 55, 54]);
});

test('never falls back to another printing, and an old quote retains its date on failure', async () => {
  const first = await resolveUsdPrice(args);
  const failed = await resolveUsdPrice({ ...args, date: '2026-10-05', previous: first,
    fetchImpl: async () => new Response('unavailable', { status: 503 }) });
  assert.equal(failed.usdQuote.stale, true);
  assert.equal(failed.usdQuote.date, args.date);
  assert.equal(failed.primary[1], 56.74);
  const history = recordUsdPrice({}, first, args.date, 'box');
  assert.deepEqual(recordUsdPrice(history, failed, '2026-10-05', 'box'), history);
  const changed = await resolveUsdPrice({ ...args, wanted: 'Foil', previous: first, prices: [['Normal', 99, 90]] });
  assert.equal(changed.primary, undefined);
  assert.equal(changed.usdQuote.price, null);
});
