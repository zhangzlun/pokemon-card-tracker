import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export async function readJson(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
}

export async function writeJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temp, JSON.stringify(value, null, 2) + '\n');
    await fs.rename(temp, file);
  } finally { await fs.rm(temp, { force: true }); }
}

export function dataDirs(root, local) {
  return local ? [path.join(root, '.cache/local-data'), path.join(root, 'dist/data')] : [path.join(root, 'data')];
}

export async function loadLatest(root, local) {
  const dirs = [path.join(root, 'data'), ...(local ? dataDirs(root, true) : [])];
  const values = await Promise.all(dirs.map((dir) => readJson(path.join(dir, 'latest.json'), {})));
  return values.sort((a, b) => (Date.parse(b.updated) || 0) - (Date.parse(a.updated) || 0))[0];
}

function mergePoints(a = [], b = []) {
  return [...new Map([...a, ...b].map((p) => [p[0], p])).values()].sort((x, y) => x[0].localeCompare(y[0]));
}

export async function loadHistory(root, name, local) {
  const dirs = [path.join(root, 'data'), ...(local ? [path.join(root, 'dist/data'), path.join(root, '.cache/local-data')] : [])];
  let result = {};
  for (const dir of dirs) {
    const next = await readJson(path.join(dir, 'history', name), {});
    const points = mergePoints(result.points, next.points);
    const series = { ...result.series };
    for (const [key, value] of Object.entries(next.series || {})) {
      series[key] = { ...value, points: mergePoints(series[key]?.points, value.points) };
    }
    result = { ...result, ...next };
    if (points.length || result.points) result.points = points;
    if (Object.keys(series).length) result.series = series;
  }
  return result;
}

export function withJapanDefaults(entry, defaults) {
  return Number(entry.cat) === 85 && !Object.hasOwn(entry, 'japan') && defaults[entry.pid]
    ? { ...entry, japan: defaults[entry.pid] } : entry;
}
