#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createDevServer } from './dev.mjs';
import { readJson, writeJson } from './data-store.mjs';
import { createAlerts } from './alerts.mjs';

const CODE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function serialQueue() {
  let tail = Promise.resolve();
  return (fn) => { const result = tail.then(fn); tail = result.catch(() => {}); return result; };
}

export function scheduleDate(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(now).map((p) => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, due: Number(parts.hour) * 60 + Number(parts.minute) >= 330 };
}

async function main() {
  const root = path.resolve(process.env.TRACKER_ROOT || '/storage');
  const origins = (process.env.PUBLIC_ORIGINS || '').split(',').map((x) => x.trim()).filter(Boolean);
  if (!origins.length) throw new Error('請先設定 PUBLIC_ORIGINS，例如 http://192.168.1.20:5173');
  await fs.mkdir(path.join(root, 'data'), { recursive: true });
  // Seed empty NAS storage once. Never overwrite a saved watchlist or history.
  for (const name of ['watchlist.json', 'japan-sources.json', 'comparison-sources.json', 'aliases.json']) {
    try { await fs.copyFile(path.join(CODE, 'data', name), path.join(root, 'data', name), fs.constants.COPYFILE_EXCL); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
  }
  const statusFile = path.join(root, '.cache/schedule.json');
  let status = await readJson(statusFile, {}), updating = false, retryAt = 0;
  const exclusive = serialQueue();
  const alerts = createAlerts(root);
  const tick = async () => {
    const slot = scheduleDate();
    const latest = await readJson(path.join(root, 'dist/data/latest.json'), null);
    if (updating || Date.now() < retryAt || (latest && (!slot.due || status.successDate === slot.date))) return;
    updating = true;
    try {
      await exclusive(() => new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [path.join(CODE, 'scripts/update.mjs'), '--local'], {
          env: { ...process.env, TRACKER_ROOT: root }, stdio: 'inherit' });
        child.once('error', reject);
        child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`更新程式結束：${code}`)));
      }));
      await exclusive(() => alerts.check());
      status = { successDate: slot.date, finishedAt: new Date().toISOString(), error: null };
    } catch (error) {
      status = { ...status, attemptedAt: new Date().toISOString(), error: error.message };
      retryAt = Date.now() + 3600000;
      console.error(error.message);
    } finally {
      updating = false;
      await writeJson(statusFile, status);
    }
  };
  const server = createDevServer(root, { allowedOrigins: origins, siteRoot: path.join(CODE, 'site'), scheduled: true,
    runExclusive: exclusive, isUpdating: () => updating, updateStatus: () => ({ ...status, updating }) });
  const port = Number(process.env.PORT) || 5173;
  server.listen(port, '0.0.0.0', () => console.log(`NAS 網站已啟動：${origins.join(', ')}；每日台北 05:30 更新`));
  const safeTick = () => tick().catch((error) => console.error('排程：', error.message));
  await safeTick();
  let lastAlertRetry = Date.now();
  setInterval(() => {
    safeTick();
    if (!updating && Date.now() - lastAlertRetry >= 600000) {
      lastAlertRetry = Date.now();
      exclusive(() => alerts.check({ evaluate: false })).catch((error) => console.error('推播重試：', error.message));
    }
  }, 60000);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
