// 看圖辨識商品：把照片交給 Claude，取回可在本機目錄搜尋的關鍵字。
// AI 只產生搜尋條件；實際商品仍由網頁從目錄比對，不會加入目錄沒有的商品。

import Anthropic from '@anthropic-ai/sdk';

const MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const MAX_BASE64 = 5 * 1024 * 1024;

const SCHEMA = {
  type: 'object',
  properties: {
    language: { type: 'string', enum: ['en', 'jp', 'other'], description: 'Print language of the product: en (English), jp (Japanese), other' },
    sealed: { type: 'boolean', description: 'true for sealed products (booster box, ETB, tin, pack), false for a single card' },
    queries: { type: 'array', items: { type: 'string' }, description: 'One to four English search queries, most specific first' },
    summary: { type: 'string', description: 'One short sentence in Traditional Chinese (Taiwan) saying what the product is' }
  },
  required: ['language', 'sealed', 'queries', 'summary'],
  additionalProperties: false
};

const SYSTEM = `You identify Pokémon TCG products from a photo so they can be looked up in a TCGplayer-based catalog.

The catalog search splits a query on spaces and keeps products where every word appears (case-insensitive substring) in the text "<product name> <card number> <set name> <set abbreviation>". All catalog text is in English, including the Japanese-print catalog. Examples of catalog entries:
- single card: name "Charizard ex", number "199/165", set "SV: Scarlet & Violet 151"
- sealed: name "Prismatic Evolutions Elite Trainer Box", number "", set "SV: Prismatic Evolutions"

Write queries that will match under that rule:
- Use the English name as TCGplayer lists it, even when the card is printed in Japanese or Chinese.
- First query: the most specific one, e.g. the Pokémon name plus the collector number before the slash ("Charizard ex 199"). Leave out punctuation and words you are unsure about, because one wrong word means zero results.
- Following queries: progressively broader (name only, or name plus one set keyword), so a later query still finds candidates when the first one misses.
- For sealed products use the set keyword plus the product type ("Prismatic Evolutions Elite Trainer Box", then "Prismatic Evolutions").

Set language to the print language of the item. Traditional Chinese, Korean and other prints are "other"; they are not in the catalog, so say so in the summary. If the photo does not show a Pokémon TCG product, return an empty queries array and explain in the summary.`;

function upstream(message) {
  return Object.assign(new Error(message), { code: 'IDENTIFY_UPSTREAM' });
}

export function createIdentifier({ client, apiKey = process.env.ANTHROPIC_API_KEY } = {}) {
  const enabled = !!(client || apiKey);
  async function identify(input) {
    if (!enabled) throw new Error('尚未設定 ANTHROPIC_API_KEY，無法使用圖片辨識');
    if (!input || !MEDIA_TYPES.includes(input.mediaType)) throw new Error('不支援的圖片格式');
    if (typeof input.image !== 'string' || !input.image || input.image.length > MAX_BASE64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(input.image)) {
      throw new Error('圖片內容無效或過大');
    }
    client ||= new Anthropic({ apiKey });
    let response;
    try {
      response = await client.beta.messages.create({
        model: 'claude-opus-5-5',
        max_tokens: 16000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        system: SYSTEM,
        output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
        messages: [{ role: 'user', content: [
          { type: 'image', source: { type: 'base64', media_type: input.mediaType, data: input.image } },
          { type: 'text', text: 'Identify this product.' }
        ] }]
      });
    } catch (error) {
      if (error instanceof Anthropic.AuthenticationError) throw upstream('ANTHROPIC_API_KEY 無效，請檢查設定');
      if (error instanceof Anthropic.RateLimitError) throw upstream('AI 服務忙碌中，請稍後再試');
      if (error instanceof Anthropic.APIError) throw upstream(`AI 服務錯誤（${error.status || '連線失敗'}）`);
      throw error;
    }
    if (response.stop_reason === 'refusal') throw upstream('AI 拒絕辨識這張圖片');
    if (response.stop_reason === 'max_tokens') throw upstream('AI 回應不完整，請再試一次');
    const text = response.content.find((block) => block.type === 'text')?.text;
    let result;
    try { result = JSON.parse(text); }
    catch { throw upstream('AI 回應格式錯誤，請再試一次'); }
    return {
      language: ['en', 'jp'].includes(result.language) ? result.language : 'other',
      sealed: !!result.sealed,
      queries: (Array.isArray(result.queries) ? result.queries : []).filter((q) => typeof q === 'string' && q.trim()).slice(0, 4).map((q) => q.trim().slice(0, 120)),
      summary: String(result.summary || '').slice(0, 200)
    };
  }
  return { enabled, identify };
}
