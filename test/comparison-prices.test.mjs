import test from 'node:test';
import assert from 'node:assert/strict';
import { comparisonConfigs, findSealedProduct, findSingleProduct, parseSingleConditions, parseBuyback, updateComparisons } from '../scripts/comparison-prices.mjs';

const config = { sources: [{ source: 'snkrdunk-single', apparelId: 146897, size: '1枚' },
  { source: 'pricebase-buyback', url: 'https://price-base.com/useful/gogh-pikachu', cardName: 'pikachu with grey felt hat', cardNumber: '085' }] };
const conditions = { chips: [
  { conditionCode: 'trading_card_single_nearly_unused', filterConditionId: 'like_new', text: 'A', usedMinPrice: 159999, hasListing: true },
  { conditionCode: 'trading_card_single_little_scratches', filterConditionId: 'minor_scratches', text: 'B', usedMinPrice: 109000, hasListing: true },
  { conditionCode: 'trading_card_single_psa8_under', filterConditionId: 'psa_8_below', text: 'PSA8以下', usedMinPrice: 85500, hasListing: true },
  { conditionCode: 'trading_card_single_psa10', filterConditionId: 'psa_10', text: 'PSA10', usedMinPrice: 432000, hasListing: true }
] };
const html = '<table><tr><td>カード名</td><td>pikachu with grey felt hat</td></tr><tr><td>カードID</td><td>085</td></tr></table>' +
  '<figure><table><tr><td>買取価格(未開封)</td><td>130,000円</td></tr><tr><td>買取価格(開封済み)</td><td>95,000円</td></tr>' +
  '<tr><td>販売価格（PSA10）</td><td>440,000円〜</td></tr></table><figcaption>※買取価格は2026年10月時点のPRICE BASE買取目安価格</figcaption></figure>' +
  '<script type="application/ld+json">{"dateModified":"2026-10-01T00:00:00+09:00"}</script>';
const args = { config, date: '2026-10-04', updated: '2026-10-04T05:00:00Z', warn: () => {},
  fetchImpl: async (url) => url.includes('snkrdunk') ? Response.json(conditions) : new Response(html) };

test('single cards use only exact A and PSA10 conditions, never cheaper B or PSA8', () => {
  assert.deepEqual(parseSingleConditions(conditions).map((q) => [q.metric, q.price]), [['a', 159999], ['psa10', 432000]]);
  assert.deepEqual(parseSingleConditions({ chips: conditions.chips.filter((q) => q.text !== 'A') }).map((q) => q.metric), ['psa10']);
  assert.throws(() => parseSingleConditions({ chips: conditions.chips.filter((q) => !['A', 'PSA10'].includes(q.text)) }));
  assert.throws(() => parseSingleConditions({ chips: [conditions.chips[0], conditions.chips[0]] }));
  assert.deepEqual(parseSingleConditions({ chips: [{ ...conditions.chips[0], hasListing: false }, conditions.chips[3]] }).map((q) => q.metric), ['psa10']);
  assert.throws(() => comparisonConfigs({ sources: [{ ...config.sources[0], size: '2枚' }] }));
});

test('single-card search requires one exact set, number and language match', () => {
  const tile = (id, label) => `<a href="https://snkrdunk.com/apparels/${id}" class="tile" aria-label="${label} - ¥42,000">`;
  const html = tile(455596, 'ブラッキーex SAR [SV8a 217/187]') + tile(455596, 'ブラッキーex SAR [SV8a 217/187]') +
    tile(999111, 'ブラッキーex SAR [SV8aF 217/187]【中国語版】') + tile(999222, '別のカード [SV8a 217/187]【英語版】');
  assert.equal(findSingleProduct(html, { cat: 85, number: '217/187', abbr: 'SV8a' }), 455596);
  assert.equal(findSingleProduct(html + tile(999333, '別の商品 [SV8a 217/187]'), { cat: 85, number: '217/187', abbr: 'SV8a' }), null);
  assert.equal(findSingleProduct(tile(738210, 'リザードンGX P [SM60]【英語版】'), { cat: 3, number: 'SM60', abbr: 'SMP' }), 738210);
  assert.equal(findSingleProduct(tile(738210, 'リザードンGX P [SM60]'), { cat: 3, number: 'SM60', abbr: 'SMP' }), null);
});

test('sealed search distinguishes standard box, bundle box, display and individual pack', () => {
  const tile = (id, label) => `<a href="https://snkrdunk.com/apparels/${id}" class="tile" aria-label="${label} - ¥20,000">`;
  const html = tile(882798, 'ポケモンカードゲームMEGA(英語版) エリートトレーナーボックス「30th CELEBRATION」') +
    tile(999000, 'ポケモンカードゲームMEGA(英語版) ポケモンセンター エリートトレーナーボックス「30th CELEBRATION」') +
    tile(893600, 'ポケモンカードゲームMEGA(英語版) ブースターバンドル「30th CELEBRATION」ボックス') +
    tile(893601, 'ポケモンカードゲームMEGA(英語版) ブースターバンドル「30th CELEBRATION」パック') +
    tile(903937, 'ポケモンカードゲームMEGA(英語版) ミニティン ディスプレイボックス「30th CELEBRATION」') +
    tile(883008, 'ポケモンカードゲームMEGA(英語版) 2パックブリスター「30th CELEBRATION」') +
    tile(998000, 'イーブイ C [30th EN 116/128]【英語版】(2パックブリスター「30th CELEBRATION」)');
  const card = (name) => ({ cat: 3, sealed: 1, name, group: 'ME: 30th Celebration' });
  assert.equal(findSealedProduct(html, card('30th Celebration Elite Trainer Box')), 882798);
  assert.equal(findSealedProduct(html, card('30th Celebration Booster Bundle')), 893600);
  assert.equal(findSealedProduct(html, card('30th Celebration Mini Tin Display')), 903937);
  assert.equal(findSealedProduct(html, card('30th Celebration 2-Pack Blister')), 883008);
  assert.equal(findSealedProduct(html + tile(777777, 'ポケモンカードゲームMEGA(英語版) 2パックブリスター「30th CELEBRATION」'), card('30th Celebration 2-Pack Blister')), null);
});

test('sealed SNKRDUNK comparison uses only one unopened unit and keeps A/PSA quotes separate', async () => {
  const config = { sources: [{ source: 'snkrdunk-sealed', apparelId: 893600, size: '1個' }] };
  const result = await updateComparisons({ config, date: '2026-10-04', updated: '2026-10-04T05:00:00Z', warn: () => {},
    fetchImpl: async (url) => {
      assert.equal(url, 'https://snkrdunk.com/v1/apparels/893600/sizes');
      return Response.json({ sizePrices: [
        { size: { localizedName: '1個', isDeleted: false }, minNewListingPrice: 22000 },
        { size: { localizedName: '2個', isDeleted: false }, minNewListingPrice: 44000 }
      ] });
    } });
  assert.deepEqual(result.comparisons.quotes.map((q) => [q.metric, q.price, q.condition]), [['sealed', 22000, '未拆封・1個']]);
  assert.throws(() => comparisonConfigs({ sources: [{ ...config.sources[0], size: '2個' }] }));
});

test('buyback references require exact card identity and dated table; sealed, opened and PSA are never mixed', () => {
  const parsed = parseBuyback(html, config.sources[1]);
  assert.deepEqual(parsed.map((q) => q.price), [130000, 95000]);
  assert.deepEqual(parsed.map((q) => q.condition), ['未拆封', '已拆、美品']);
  assert.equal(parsed[0].kind, 'buyback');
  assert.equal(parsed[0].priceAsOf, '2026-10');
  assert.equal(parsed[0].sourceUpdated, '2026-10-01');
  for (const broken of [html.replace('085', '086'), html.replace('2026年10月', '先月'), html.replace('130,000円', '未定'), html + html]) {
    assert.throws(() => parseBuyback(broken, config.sources[1]));
  }
});

test('comparison source URLs cannot point to arbitrary hosts or ambiguous articles', () => {
  assert.equal(comparisonConfigs(config).length, 2);
  for (const url of ['http://localhost/article', 'https://price-base.com/useful/gogh-pikachu?next=x', 'https://user@price-base.com/useful/gogh-pikachu']) {
    assert.throws(() => comparisonConfigs({ sources: [{ ...config.sources[1], url }] }));
  }
});

test('independent series replace same-day values; provider failures keep dated quotes without false history', async () => {
  const first = await updateComparisons(args);
  assert.equal(first.comparisons.quotes.length, 4);
  assert.equal(Object.keys(first.history.series).length, 4);
  const again = await updateComparisons({ ...args, previous: first.comparisons, history: first.history });
  assert.deepEqual(again.history, first.history);
  const failed = await updateComparisons({ ...args, date: '2026-10-05', previous: first.comparisons, history: first.history,
    fetchImpl: async (url) => url.includes('snkrdunk') ? new Response('blocked', { status: 403 }) : new Response(html) });
  assert.equal(failed.comparisons.errors.length, 1);
  const reused = failed.comparisons.quotes.filter((q) => q.name === 'SNKRDUNK');
  assert.deepEqual(reused.map((q) => q.metric), ['a', 'psa10']);
  for (const quote of reused) {
    assert.equal(quote.stale, true);
    assert.equal(quote.date, args.date);
    assert.equal(failed.history.series[quote.key].points.length, 1);
  }
  const pb = failed.comparisons.quotes.find((q) => q.name === 'PRICE BASE');
  assert.equal(failed.history.series[pb.key].points.length, 2);
  const changed = await updateComparisons({ ...args, config: { sources: [{ ...config.sources[0], apparelId: 146898 }] },
    previous: first.comparisons, history: first.history, fetchImpl: async () => { throw new Error('offline'); } });
  assert.deepEqual(changed.comparisons.quotes, []);
  const legacy = await updateComparisons({ ...args, config: { sources: [{ source: 'snkrdunk-used', apparelId: 146897, size: '1枚' }] },
    previous: { quotes: [{ ...first.comparisons.quotes[0], sourceKey: 'snkrdunk:146897:1枚:used' }] },
    fetchImpl: async () => { throw new Error('offline'); } });
  assert.deepEqual(legacy.comparisons.quotes, []); // Old unqualified minimum must never survive as A.
});
