import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request } from 'node:http';
import { scheduleDate, serialQueue } from '../scripts/nas.mjs';
import { createDevServer } from '../scripts/dev.mjs';

test('NAS daily boundary uses Taipei time, including UTC date rollover', () => {
  assert.deepEqual(scheduleDate(new Date('2026-10-03T21:29:00Z')), { date: '2026-10-04', due: false });
  assert.deepEqual(scheduleDate(new Date('2026-10-03T21:30:00Z')), { date: '2026-10-04', due: true });
  assert.deepEqual(scheduleDate(new Date('2026-10-04T16:00:00Z')), { date: '2026-10-05', due: false });
});

test('daily builds and mutations never overlap, including after a failed operation', async () => {
  const run = serialQueue(), order = [];
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const first = run(async () => { order.push('build'); await pending; order.push('finished'); throw new Error('failed'); });
  const second = run(async () => { order.push('save'); });
  await Promise.resolve();
  assert.deepEqual(order, ['build']);
  release();
  await assert.rejects(first, /failed/);
  await second;
  assert.deepEqual(order, ['build', 'finished', 'save']);
});

test('NAS accepts only configured hosts and same origins, and blocks writes during builds', async (t) => {
  const server = createDevServer('/unused', { allowedOrigins: ['http://nas.lan:5173'], scheduled: true, isUpdating: () => true });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const post = (host, origin) => new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port: server.address().port, path: '/api/watchlist', method: 'POST',
      headers: { Host: host, Origin: origin, 'Content-Type': 'application/json' } }, (res) => { res.resume(); resolve(res.statusCode); });
    req.on('error', reject); req.end('{}');
  });
  assert.equal(await post('nas.lan:5173', 'http://nas.lan:5173'), 503);
  assert.equal(await post('nas.lan:5173', 'http://evil.example'), 403);
  assert.equal(await post('evil.example', 'http://evil.example'), 403);
  assert.throws(() => createDevServer('/unused', { allowedOrigins: ['http://nas.lan:5173/path'] }), /origin/);
});
