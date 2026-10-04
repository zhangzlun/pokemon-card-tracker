import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createAlerts, evaluateAlerts, quoteForAlert } from '../scripts/alerts.mjs';
import { createDevServer } from '../scripts/dev.mjs';

const product = { name: 'Test card', market: 100, date: '2026-10-04',
  japan: { quotes: { snkrdunk: { price: 10000, date: '2026-10-04', stale: false, label: '新品' } } },
  comparisons: { quotes: [{ key: 'pricebase:card:sealed', price: 12000, currency: 'JPY', date: '2026-10-04', name: 'PRICE BASE', label: '買取', condition: '未拆', stale: false }] } };
const latest = (item = product) => ({ date: '2026-10-04', items: { 42: item } });

test('fresh source-specific prices trigger once and rearm only after leaving the threshold', () => {
  const data = { alerts: [{ id: 'a', pid: 42, sourceKey: 'comparison:pricebase:card:sealed', direction: 'above', threshold: 11000, active: false }], events: [] };
  evaluateAlerts(data, latest());
  assert.equal(data.events.length, 1);
  assert.match(data.events[0].body, /PRICE BASE/);
  evaluateAlerts(data, latest());
  assert.equal(data.events.length, 1);
  evaluateAlerts(data, latest({ ...product, comparisons: { quotes: [{ ...product.comparisons.quotes[0], price: 9000 }] } }));
  assert.equal(data.alerts[0].active, false);
  evaluateAlerts(data, latest());
  assert.equal(data.events.length, 2);
});

test('failed or old quotes cannot trigger or rearm alerts', () => {
  const alert = { id: 'a', pid: 42, sourceKey: 'japan:snkrdunk', direction: 'below', threshold: 11000, active: false };
  const data = { alerts: [alert], events: [] };
  evaluateAlerts(data, latest({ ...product, japan: { quotes: { snkrdunk: { ...product.japan.quotes.snkrdunk, stale: true } } } }));
  assert.equal(data.events.length, 0);
  evaluateAlerts(data, latest({ ...product, japan: { quotes: { snkrdunk: { ...product.japan.quotes.snkrdunk, date: '2026-10-03' } } } }));
  assert.equal(data.events.length, 0);
  evaluateAlerts(data, latest());
  assert.equal(data.events.length, 1);
  evaluateAlerts(data, latest({ ...product, japan: { quotes: { snkrdunk: { ...product.japan.quotes.snkrdunk, stale: true, price: 15000 } } } }));
  assert.equal(alert.active, true);
  assert.equal(quoteForAlert({ ...product, usdQuote: { stale: true } }, 'market', '2026-10-04'), null);
});

test('alerts, subscriptions and VAPID keys stay outside public data', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tracker-alerts-'));
  try {
    await fs.mkdir(path.join(root, 'data'));
    await fs.mkdir(path.join(root, 'dist/data'), { recursive: true });
    await fs.writeFile(path.join(root, 'data/watchlist.json'), JSON.stringify({ items: [{ pid: 42 }] }));
    await fs.writeFile(path.join(root, 'dist/data/latest.json'), JSON.stringify(latest()));
    const alerts = createAlerts(root);
    await assert.rejects(alerts.saveAlert({ pid: 43, sourceKey: 'market', direction: 'above', threshold: 10 }), /加入每日紀錄/);
    const result = await alerts.saveAlert({ pid: 42, sourceKey: 'market', direction: 'above', threshold: 90 });
    assert.equal(result.alerts.length, 1);
    await alerts.check();
    const stored = await alerts.load();
    assert.equal(stored.events.length, 1);
    await assert.rejects(alerts.subscribe({ subscription: { endpoint: 'http://127.0.0.1/private', keys: { p256dh: 'x', auth: 'y' } } }), /推播網址無效/);
    assert.ok((await alerts.publicKey()).length > 80);
    assert.ok(await fs.stat(path.join(root, '.cache/alerts.json')));
    assert.ok(await fs.stat(path.join(root, '.cache/push-keys.json')));
    assert.deepEqual(await fs.readdir(path.join(root, 'dist/data')), ['latest.json']);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('alert API saves a price target and rejects cross-origin writes', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tracker-alert-api-'));
  const server = createDevServer(root);
  try {
    await fs.mkdir(path.join(root, 'data'));
    await fs.mkdir(path.join(root, 'dist/data'), { recursive: true });
    await fs.writeFile(path.join(root, 'data/watchlist.json'), JSON.stringify({ items: [{ pid: 42 }] }));
    await fs.writeFile(path.join(root, 'dist/data/latest.json'), JSON.stringify(latest()));
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const input = { pid: 42, sourceKey: 'market', direction: 'below', threshold: 95 };
    const blocked = await fetch(`${base}/api/alerts`, { method: 'POST', headers: { origin: 'https://other.example', 'content-type': 'application/json' }, body: JSON.stringify(input) });
    assert.equal(blocked.status, 403);
    const saved = await fetch(`${base}/api/alerts`, { method: 'POST', headers: { origin: base, 'content-type': 'application/json' }, body: JSON.stringify(input) });
    assert.equal(saved.status, 200);
    const result = await (await fetch(`${base}/api/alerts`)).json();
    assert.equal(result.alerts.length, 1);
    assert.equal(result.alerts[0].threshold, 95);
    assert.equal(result.alerts[0].active, false);
  } finally {
    if (server.listening) await new Promise((resolve) => server.close(resolve));
    await fs.rm(root, { recursive: true, force: true });
  }
});
