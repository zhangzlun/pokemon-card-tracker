#!/usr/bin/env node
// 本機開發用的靜態伺服器（不需要任何套件）。
// 網頁檔案直接讀 site/，改了存檔、重新整理就看得到；資料讀 dist/data/。
// 先執行一次 `npm run update:local` 產生資料。

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 5173;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

if (!fs.existsSync(path.join(ROOT, 'dist', 'data', 'latest.json'))) {
  console.warn('還沒有資料。請先執行：npm run update:local');
}

http.createServer((req, res) => {
  let url = decodeURIComponent((req.url || '/').split('?')[0]);
  if (url.endsWith('/')) url += 'index.html';
  const base = url.startsWith('/data/') ? path.join(ROOT, 'dist') : path.join(ROOT, 'site');
  const file = path.normalize(path.join(base, url));
  if (!file.startsWith(base + path.sep)) { res.writeHead(403); res.end('Forbidden'); return; }
  fs.readFile(file, (err, body) => {
    if (err) { res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); res.end('Not found'); return; }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(body);
  });
}).listen(PORT, () => console.log(`本機網站：http://localhost:${PORT}`));
