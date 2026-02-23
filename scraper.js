import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

// OPDATER HER hvis du skifter sæson:
const STATS_URL = 'https://nexus-app-fantasy-fargate.holdet.dk/da/super-manager-fall-2025/soccer/statistics';
const START_URL = 'https://www.holdet.dk/da/fantasy/super-manager-fall-2025';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36';

function ensureDir(p) { if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true }); }
function ensureDataDirs() {
  const dataDir = path.join('data');
  const sampDir = path.join(dataDir, 'samples');
  ensureDir(dataDir); ensureDir(sampDir);
  return { dataDir, sampDir };
}

// ——— ROBUST PARSER (som ovenfor) ———
function extractPlayersFromText(s) {
  const out = [];
  const push = (n, g) => {
    const name = (n || '').trim();
    const gr = Number(g);
    if (name && Number.isFinite(gr)) out.push({ fullName: name, growth: gr });
  };
  let m;
  {
    const re = /"person"\s*:\s*\{[^}]*?"fullName"\s*:\s*"([^"]+)"[\s\S]{1,20000}?"growth"\s*:\s*(-?\d+)/g;
    while ((m = re.exec(s)) !== null) push(m[1], m[2]);
  }
  {
    const re = /"growth"\s*:\s*(-?\d+)[\s\S]{1,20000}?"person"\s*:\s*\{[^}]*?"fullName"\s*:\s*"([^"]+)"/g;
    while ((m = re.exec(s)) !== null) push(m[2], m[1]);
  }
  {
    const re = /"fullName"\s*:\s*"([^"]+)"[\s\S]{1,20000}?"growth"\s*:\s*(-?\d+)/g;
    while ((m = re.exec(s)) !== null) push(m[1], m[2]);
  }
  {
    const rowRe = /"rows"\s*:\s*\[([\s\S]*?)\]/g;
    while ((m = rowRe.exec(s)) !== null) {
      const rowsBlock = m[1];
      const itemRe = /"person"\s*:\s*\{[^}]*?"fullName"\s*:\s*"([^"]+)"[\s\S]*?"growth"\s*:\s*(-?\d+)/g;
      let mi;
      while ((mi = itemRe.exec(rowsBlock)) !== null) push(mi[1], mi[2]);
    }
  }
  const seen = new Map();
  for (const p of out) {
    const key = p.fullName.toLowerCase();
    if (!seen.has(key)) seen.set(key, p);
  }
  return Array.from(seen.values());
}

async function run() {
  const { dataDir, sampDir } = ensureDataDirs();
  const latestPath = path.join(dataDir, 'latest.json');
  const debugPath  = path.join(dataDir, 'debug_info.txt');

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ userAgent: UA });
  const page = await ctx.newPage();

  try { await page.goto(START_URL, { waitUntil: 'domcontentloaded', timeout: 30000 }); } catch {}

  // 1) Hent statistik-endpointet direkte
  const headers = {
    'User-Agent': UA,
    'Accept': '*/*',
    'Accept-Language': 'da-DK,da;q=0.9,en-US;q=0.8,en;q=0.7',
    'Referer': START_URL
  };

  let status = -1, ct = '', body = '';
  try {
    const resp = await page.request.get(STATS_URL, { headers });
    status = resp.status();
    const hs = resp.headers();
    ct = (hs['content-type'] || hs['Content-Type'] || '').toLowerCase();
    body = await resp.text();
  } catch (e) {
    fs.writeFileSync(debugPath, `ERROR=request_failed\nurl=${STATS_URL}\nmsg=${String(e)}\nts=${new Date().toISOString()}`);
    fs.writeFileSync(path.join(dataDir, 'changed.flag'), '0');
    await browser.close();
    process.exit(1);
  }

  // 2) Ekstra forsøg hvis første svar ikke afslører growth
  if (!/"growth":-?\d+/.test(body)) {
    try {
      const u = new URL(STATS_URL);
      u.searchParams.set('_', Date.now().toString());
      const resp2 = await page.request.get(u.toString(), { headers });
      status = resp2.status();
      const hs2 = resp2.headers();
      ct = (hs2['content-type'] || hs2['Content-Type'] || '').toLowerCase();
      body = await resp2.text();
    } catch {}
  }
  if (!/"growth":-?\d+/.test(body)) {
    try {
      const rscHeaders = { ...headers, 'Accept': 'text/x-component' };
      const resp3 = await page.request.get(STATS_URL, { headers: rscHeaders });
      status = resp3.status();
      const hs3 = resp3.headers();
      ct = (hs3['content-type'] || hs3['Content-Type'] || '').toLowerCase();
      body = await resp3.text();
    } catch {}
  }

  // 3) Gem sample
  try {
    const samplePath = path.join(sampDir, 'stats_raw.txt');
    fs.writeFileSync(samplePath, body.slice(0, 150_000));
  } catch {}

  // 4) Parse
  const players = body ? extractPlayersFromText(body) : [];

  // 5) Skriv output
  const payload = JSON.stringify(players, null, 2);
  let changed = true;
  if (fs.existsSync(latestPath)) {
    const prev = fs.readFileSync(latestPath, 'utf8');
    changed = prev !== payload;
  }
  fs.writeFileSync(latestPath, payload);

  const debug = [
    `foundPlayers=${players.length}`,
    `status=${status}`,
    `contentType=${ct || '-'}`,
    `bodyLen=${body ? body.length : 0}`,
    `statsUrl=${STATS_URL}`,
    `ts=${new Date().toISOString()}`
  ].join('\n');
  fs.writeFileSync(debugPath, debug);
  fs.writeFileSync(path.join(dataDir, 'changed.flag'), changed ? '1' : '0');

  await browser.close();
}

run().catch(err => {
  console.error(err);
  try {
    const { dataDir } = ensureDataDirs();
    fs.writeFileSync(path.join(dataDir, 'changed.flag'), '0');
    fs.writeFileSync(path.join(dataDir, 'debug_info.txt'), `ERROR=${String(err)}\nts=${new Date().toISOString()}`);
  } catch {}
  process.exit(1);
});
