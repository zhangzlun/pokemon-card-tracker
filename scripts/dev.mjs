#!/usr/bin/env node
// 本機網站、追蹤清單與推播 API；直接啟動時只監聽 loopback。
// 網頁檔案直接讀 site/，改了存檔、重新整理就看得到；資料讀 dist/data/。
// 先執行一次 `npm run update:local` 產生資料。

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJson } from './data-store.mjs';
import { createLocalWatchlist } from './local-watchlist.mjs';
import { createAlerts } from './alerts.mjs';
import { createIdentifier } from './identify.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 5173;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

function json(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(value));
}

export function createDevServer(root = ROOT, options = {}) {
  const mutate = createLocalWatchlist(root, options);
  const alerts = createAlerts(root);
  const identifier = options.identifier || createIdentifier();
  let tail = Promise.resolve();
  const runExclusive = options.runExclusive || ((fn) => {
    const result = tail.then(fn);
    tail = result.catch(() => {});
    return result;
  });
  const allowedOrigins = (options.allowedOrigins || []).map((value) => {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.origin !== value || url.username || url.password) throw new Error('PUBLIC_ORIGINS 必須是完整 origin，不可含路徑');
    return url;
  });
  const server = http.createServer(async (req, res) => {
    const port = server.address().port;
    const host = req.headers.host;
    const permittedOrigins = [`http://localhost:${port}`, `http://127.0.0.1:${port}`, `http://[::1]:${port}`, ...allowedOrigins.map((u) => u.origin)];
    if (![ `localhost:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`, ...allowedOrigins.map((u) => u.host) ].includes(host)) return json(res, 403, { error: '只接受本機來源' });
    let url;
    try { url = decodeURIComponent((req.url || '/').split('?')[0]); }
    catch { return json(res, 400, { error: '無效的網址' }); }
    if (url === '/api/alerts' && req.method === 'GET') {
      try { const data = await alerts.load(); return json(res, 200, { alerts: data.alerts }); }
      catch { return json(res, 500, { error: '無法讀取關注價' }); }
    }
    if (url === '/api/push/public-key' && req.method === 'GET') {
      try { return json(res, 200, { publicKey: await runExclusive(() => alerts.publicKey()) }); }
      catch { return json(res, 500, { error: '無法啟用推播' }); }
    }
    if (['/api/watchlist', '/api/alerts', '/api/push/subscribe', '/api/push/unsubscribe', '/api/push/test', '/api/identify'].includes(url)) {
      if (req.method !== 'POST') return json(res, 405, { error: '需要 POST' });
      // JSON + exact origin check prevents other websites from changing local files.
      if ((!permittedOrigins.includes(req.headers.origin) || new URL(req.headers.origin).host !== host) || req.headers['content-type']?.split(';')[0].trim() !== 'application/json') {
        return json(res, 403, { error: '只接受本機網站送出的 JSON 請求' });
      }
      try {
        const chunks = []; let size = 0;
        for await (const chunk of req) {
          size += chunk.length;
          if (size > (url === '/api/identify' ? 7000000 : 16384)) return json(res, 413, { error: url === '/api/identify' ? '圖片過大' : '設定內容過大' });
          chunks.push(chunk);
        }
        const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        // 辨識不寫入任何檔案，不必排隊，也不受行情更新影響。
        if (url === '/api/identify') return json(res, 200, await identifier.identify(input));
        if (options.isUpdating?.()) return json(res, 503, { error: '行情更新中，請稍後再儲存清單' });
        const actions = {
          '/api/watchlist': () => mutate(input),
          '/api/alerts': () => alerts.saveAlert(input),
          '/api/push/subscribe': () => alerts.subscribe(input),
          '/api/push/unsubscribe': () => alerts.unsubscribe(input),
          '/api/push/test': () => alerts.test(input)
        };
        const result = await runExclusive(actions[url]);
        return json(res, 200, result);
      } catch (error) { return json(res, error.code ? 500 : 400, { error: error.message }); }
    }
    if (!['GET', 'HEAD'].includes(req.method)) return json(res, 405, { error: '不支援的操作' });
    if (url === '/data/config.json') {
      try { return json(res, 200, { ...await readJson(path.join(root, 'dist/data/config.json'), {}), local: true, identify: identifier.enabled, scheduled: !!options.scheduled, updateStatus: options.updateStatus?.() || null }); }
      catch { return json(res, 500, { error: '無法讀取本機設定' }); }
    }
    if (url.endsWith('/')) url += 'index.html';
    const configFile = ['/data/watchlist.json', '/data/japan-sources.json', '/data/comparison-sources.json'].includes(url);
    const base = configFile ? root : url.startsWith('/data/') ? path.join(root, 'dist') : (options.siteRoot || path.join(root, 'site'));
    const file = path.normalize(path.join(base, url));
    if (!file.startsWith(base + path.sep)) { res.writeHead(403); res.end('Forbidden'); return; }
    fs.readFile(file, (err, body) => {
      if (err) { res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); res.end('Not found'); return; }
      res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
      res.end(body);
    });
  });
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!fs.existsSync(path.join(ROOT, 'dist/data/latest.json'))) console.warn('還沒有資料。請先執行：npm run update:local');
  createDevServer().listen(PORT, '127.0.0.1', () => console.log(`本機網站：http://localhost:${PORT}（清單直接儲存在本機，不需要 GitHub token）`));
}
