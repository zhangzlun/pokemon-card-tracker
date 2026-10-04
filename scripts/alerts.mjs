import path from 'node:path';
import { randomUUID } from 'node:crypto';
import webpush from 'web-push';
import { readJson, writeJson } from './data-store.mjs';

const validDirection = new Set(['below', 'above']);
const price = (n) => typeof n === 'number' && Number.isFinite(n) && n > 0;
const privateFile = (root, name) => path.join(root, '.cache', name);

export function quoteForAlert(item, sourceKey, date) {
  if (!item || item.missing) return null;
  if (sourceKey === 'market') {
    if (!price(item.market) || item.usdQuote?.stale || item.date !== date) return null;
    return { price: item.market, currency: 'USD', label: 'TCGplayer 市場價' };
  }
  if (sourceKey.startsWith('japan:')) {
    const source = sourceKey.slice(6);
    const quote = item.japan?.quotes?.[source];
    if (!quote || !price(quote.price) || quote.stale || quote.date !== date) return null;
    return { price: quote.price, currency: 'JPY', label: `${source === 'snkrdunk' ? 'SNKRDUNK' : 'PRICE BASE'} ${quote.label || ''}`.trim() };
  }
  if (sourceKey.startsWith('comparison:')) {
    const key = sourceKey.slice(11);
    const quote = item.comparisons?.quotes?.find((q) => q.key === key);
    if (!quote || !price(quote.price) || quote.stale || quote.date !== date) return null;
    return { price: quote.price, currency: quote.currency, label: `${quote.name} ${quote.label} ${quote.condition}`.trim() };
  }
  return null;
}

export function evaluateAlerts(data, latest) {
  const now = new Date().toISOString();
  const events = Array.isArray(data.events) ? data.events : [];
  for (const alert of data.alerts || []) {
    const item = latest.items?.[alert.pid];
    const quote = quoteForAlert(item, alert.sourceKey, latest.date);
    if (!quote) continue; // An old or failed quote cannot trigger or rearm an alert.
    const matched = alert.direction === 'below' ? quote.price <= alert.threshold : quote.price >= alert.threshold;
    if (matched && !alert.active) {
      events.push({ id: randomUUID(), alertId: alert.id, createdAt: now, sentTo: [],
        title: `${item.zh || item.name} 達到關注價`,
        body: `${quote.label} ${quote.currency === 'JPY' ? '¥' : '$'}${quote.price.toLocaleString('en-US')}；設定${alert.direction === 'below' ? '低於' : '高於'} ${quote.currency === 'JPY' ? '¥' : '$'}${alert.threshold.toLocaleString('en-US')}`,
        url: `/?product=${alert.pid}` });
    }
    alert.active = matched;
  }
  data.events = events.slice(-100);
  return data;
}

export function createAlerts(root) {
  const file = privateFile(root, 'alerts.json');
  const keysFile = privateFile(root, 'push-keys.json');
  const load = async () => {
    const data = await readJson(file, { alerts: [], subscriptions: [], events: [] });
    return { alerts: data.alerts || [], subscriptions: data.subscriptions || [], events: data.events || [] };
  };
  const keys = async () => {
    let value = await readJson(keysFile, null);
    if (!value) {
      value = webpush.generateVAPIDKeys();
      await writeJson(keysFile, value);
    }
    return value;
  };
  const vapid = async () => {
    const k = await keys();
    const origin = (process.env.PUBLIC_ORIGINS || '').split(',').find((value) => value.startsWith('https://'));
    webpush.setVapidDetails(process.env.VAPID_SUBJECT || origin || 'mailto:tracker@example.com', k.publicKey, k.privateKey);
    return k.publicKey;
  };
  const saveAlert = async (input) => {
    const data = await load();
    if (input.action === 'remove') {
      data.alerts = data.alerts.filter((a) => a.id !== input.id);
      data.events = data.events.filter((e) => e.alertId !== input.id);
    } else {
      const pid = Number(input.pid), threshold = Number(input.threshold);
      const sourceKey = String(input.sourceKey || '');
      if (!Number.isSafeInteger(pid) || pid <= 0 || !validDirection.has(input.direction) || !price(threshold) || threshold > 1e9 ||
          !/^(market|japan:(snkrdunk|pricebase)|comparison:[a-z0-9:/._-]{1,200})$/.test(sourceKey)) throw new Error('關注價設定無效');
      const watch = await readJson(path.join(root, 'data/watchlist.json'), { items: [] });
      if (!watch.items?.some((w) => Number(w.pid) === pid)) throw new Error('請先將商品加入每日紀錄');
      const latest = await readJson(path.join(root, 'dist/data/latest.json'), { items: {} });
      const item = latest.items?.[pid];
      const exists = sourceKey === 'market' || (sourceKey.startsWith('japan:') && item?.japan?.quotes?.[sourceKey.slice(6)]) ||
        (sourceKey.startsWith('comparison:') && item?.comparisons?.quotes?.some((q) => q.key === sourceKey.slice(11)));
      if (!exists) throw new Error('找不到這個價格來源');
      if (data.alerts.length >= 200) throw new Error('關注價數量已達上限');
      data.alerts.push({ id: randomUUID(), pid, sourceKey, direction: input.direction, threshold, active: false });
    }
    await writeJson(file, data);
    return { alerts: data.alerts };
  };
  const validSubscription = (sub) => {
    if (!sub || typeof sub.endpoint !== 'string' || sub.endpoint.length > 2048 ||
        typeof sub.keys?.p256dh !== 'string' || typeof sub.keys?.auth !== 'string') throw new Error('推播訂閱資料無效');
    const u = new URL(sub.endpoint);
    if (u.protocol !== 'https:' || u.username || u.password || u.port || !u.hostname.includes('.')) throw new Error('推播網址無效');
    return { endpoint: u.href, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } };
  };
  const subscribe = async (input) => {
    const subscription = validSubscription(input.subscription);
    const data = await load();
    data.subscriptions = data.subscriptions.filter((s) => s.endpoint !== subscription.endpoint);
    data.subscriptions.push(subscription);
    await writeJson(file, data);
    return { subscribed: true };
  };
  const unsubscribe = async (input) => {
    const data = await load();
    data.subscriptions = data.subscriptions.filter((s) => s.endpoint !== input.endpoint);
    await writeJson(file, data);
    return { subscribed: false };
  };
  const send = async (subscription, payload) => {
    await vapid();
    return webpush.sendNotification(subscription, JSON.stringify(payload), { TTL: 86400 });
  };
  const test = async (input) => {
    const data = await load();
    const subscription = data.subscriptions.find((s) => s.endpoint === input.endpoint);
    if (!subscription) throw new Error('這台裝置尚未啟用推播');
    await send(subscription, { title: '卡牌行情推播測試', body: '這台裝置已可收到關注價通知。', url: '/' });
    return { sent: true };
  };
  const check = async ({ evaluate = true } = {}) => {
    const data = await load();
    if (evaluate) {
      const latest = await readJson(path.join(root, 'dist/data/latest.json'), null);
      if (!latest) return;
      evaluateAlerts(data, latest);
    }
    await writeJson(file, data); // Save trigger state before sending; retries use the outbox.
    for (const event of [...data.events]) {
      for (const sub of [...data.subscriptions]) {
        if (event.sentTo.includes(sub.endpoint)) continue;
        try {
          await send(sub, { title: event.title, body: event.body, url: event.url });
          event.sentTo.push(sub.endpoint);
        } catch (error) {
          if ([404, 410].includes(error.statusCode)) data.subscriptions = data.subscriptions.filter((s) => s.endpoint !== sub.endpoint);
          else console.error('推播失敗：', error.message);
        }
        await writeJson(file, data);
      }
    }
    data.events = data.events.filter((e) => !data.subscriptions.length || data.subscriptions.some((s) => !e.sentTo.includes(s.endpoint)));
    await writeJson(file, data);
  };
  return { load, saveAlert, subscribe, unsubscribe, test, check, publicKey: vapid };
}
