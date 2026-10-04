import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createIdentifier } from '../scripts/identify.mjs';
import { createDevServer } from '../scripts/dev.mjs';

const fakeClient = (response, calls = []) => ({ beta: { messages: { create: async (params) => { calls.push(params); return response; } } } });
const reply = (value) => ({ stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: JSON.stringify(value) }] });

test('identify sends the image to Claude and returns cleaned search queries', async () => {
  const calls = [];
  const { enabled, identify } = createIdentifier({ client: fakeClient(reply({ language: 'jp', sealed: false,
    queries: [' Charizard ex 201 ', '', 'Charizard ex'], summary: '日版噴火龍 ex' }), calls) });
  assert.equal(enabled, true);
  assert.deepEqual(await identify({ image: 'aGVsbG8=', mediaType: 'image/jpeg' }),
    { language: 'jp', sealed: false, queries: ['Charizard ex 201', 'Charizard ex'], summary: '日版噴火龍 ex' });
  assert.deepEqual(calls[0].messages[0].content[0], { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'aGVsbG8=' } });
});

test('identify rejects bad input, missing key and refusals', async () => {
  const { identify } = createIdentifier({ client: fakeClient({ stop_reason: 'refusal', content: [] }) });
  await assert.rejects(identify({ image: 'aGVsbG8=', mediaType: 'image/svg+xml' }), /格式/);
  await assert.rejects(identify({ image: 'not base64!', mediaType: 'image/png' }), /無效/);
  await assert.rejects(identify({ image: 'aGVsbG8=', mediaType: 'image/png' }), /拒絕/);
  const off = createIdentifier({ apiKey: '' });
  assert.equal(off.enabled, false);
  await assert.rejects(off.identify({ image: 'aGVsbG8=', mediaType: 'image/png' }), /ANTHROPIC_API_KEY/);
});

test('/api/identify accepts photo-sized bodies from the same origin, even during a price update', async (t) => {
  const identifier = { enabled: true, identify: async (input) => ({ language: 'en', sealed: true, queries: [String(input.image.length)], summary: '' }) };
  const server = createDevServer('/unused', { identifier, isUpdating: () => true });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const body = JSON.stringify({ image: 'A'.repeat(200000), mediaType: 'image/jpeg' });
  const ok = await fetch(`${origin}/api/identify`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body });
  assert.equal(ok.status, 200);
  assert.deepEqual((await ok.json()).queries, ['200000']);
  const foreign = await fetch(`${origin}/api/identify`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://evil.example' }, body });
  assert.equal(foreign.status, 403);
});
