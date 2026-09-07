import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

// Holdet.dk har flyttet statistiksiden mindst een gang.
// Vi proever derfor flere adresser og bruger den foerste der giver data.
const STATS_URLS = [
  'https://www.holdet.dk/da/season/super-manager-fall-2026/soccer/statistics',
  'https://nexus-app-fantasy.holdet.dk/da/super-manager-fall-2026/soccer/statistics',
  'https://nexus-app-fantasy-fargate.holdet.dk/da/super-manager-fall-2026/soccer/statistics',
  'https://www.holdet.dk/da/super-manager-fall-2026/soccer/statistics',
];
const START_URLS = [
  'https://www.holdet.dk/da/season/super-manager-fall-2026',
  'https://www.holdet.dk/da/fantasy/super-manager-fall-2026',
];

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36';

function ensureDir(p) { if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true }); }
function ensureDataDirs() {
  const dataDir = path.join('data');
  const sampDir = path.join(dataDir, 'samples');
  ensureDir(dataDir); ensureDir(sampDir);
  return { dataDir, sampDir };
}

function normalizeRSC(s) {
  let t = String(s || '');
  t = t.replace(/&quot;/g, '"');
  t = t.replace(/\\"/g, '"');
  t = t.replace(/\\u0022/g, '"');
  t = t.replace(/\\r/g, '').replace(/\\n/g, '\n');
  return t;
}

function extractPlayersFromText(raw) {
  const s = normalizeRSC(raw);
  const out = [];
  const push = (n, g) => {
    const name = (n || '').trim();
    const gr = Number(g);
    if (name && Number.isFinite(gr)) out.push({ fullName: name, growth: gr });
  };
  let m;

  {
    const re = /"person"\s*:\s*\{[\s\S]*?"fullName"\s*:\s*"([^"]+)"[\s\S]{1,50000}?"growth"\s*:\s*(-?\d+)/g;
    while ((m = re.exec(s)) !== null) push(m[1], m[2]);
  }
  {
    const re = /"growth"\s*:\s*(-?\d+)[\s\S]{1,50000}?"person"\s*:\s*\{[\s\S]*?"fullName"\s*:\s*"([^"]+)"/g;
    while ((m = re.exec(s)) !== null) push(m[2], m[1]);
  }
  {
    const re = /"fullName"\s*:\s*"([^"]+)"[\s\S]{1,50000}?"growth"\s*:\s*(-?\d+)/g;
    while ((m = re.exec(s)) !== null) push(m[1], m[2]);
  }
  {
    const re = /"growth"\s*:\s*(-?\d+)[\s\S]{1,50000}?"fullName"\s*:\s*"([^"]+)"/g;
    while ((m = re.exec(s)) !== null) push(m[2], m[1]);
  }
  {
    const rowsMatch = /"rows"\s*:\s*\[([\s\S]*?)\]/.exec(s);
    if (rowsMatch && rowsMatch[1]) {
      const itemRe = /"fullName"\s*:\s*"([^"]+)"[\s\S]{1,2000}?"growth"\s*:\s*(-?\d+)/g;
      while ((m = itemRe.exec(rowsMatch[1])) !== null) push(m[1], m[2]);
    }
  }

  const seen = new Map();
  for (const p of out) {
    const k = p.fullName.toLowerCase();
    if (!seen.has(k)) seen.set(k, p);
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

  // Besoeg startsiden for at faa cookies
  let startOk = null;
  for (const u of START_URLS) {
    try {
      const r = await page.goto(u, { waitUntil: 'domcontentloaded', timeout: 30000 });
      if (r && r.status() < 400) { startOk = u; break; }
    } catch {}
  }
  console.log('Startside: ' + (startOk || 'ingen svarede'));

  const headers = {
    'User-Agent': UA,
    'Accept': '*/*',
    'Accept-Language': 'da-DK,da;q=0.9,en-US;q=0.8,en;q=0.7',
    'Referer': startOk || START_URLS[0],
  };

  // Proev hver adresse indtil vi faar spillerdata
  let players = [], brugtUrl = null, sidsteStatus = -1, sidsteCt = '', body = '';
  const forsog = [];

  for (const url of STATS_URLS) {
    for (const accept of ['*/*', 'text/x-component']) {
      try {
        const resp = await page.request.get(url, { headers: { ...headers, Accept: accept } });
        const st = resp.status();
        const b  = await resp.text();
        const found = b ? extractPlayersFromText(b) : [];
        forsog.push(`${url} [${accept}] -> status=${st} bytes=${b.length} spillere=${found.length}`);
        console.log(`  ${st}  ${found.length.toString().padStart(4)} spillere  ${url}`);
        if (found.length > players.length) {
          players = found; brugtUrl = url; sidsteStatus = st;
          sidsteCt = (resp.headers()['content-type'] || '').toLowerCase();
          body = b;
        }
        if (players.length > 0) break;
      } catch (e) {
        forsog.push(`${url} [${accept}] -> FEJL ${String(e).slice(0, 120)}`);
      }
    }
    if (players.length > 0) break;
  }

  await browser.close();

  try {
    fs.writeFileSync(path.join(sampDir, 'stats_raw.txt'), String(body).slice(0, 150_000));
  } catch {}

  const debug = [
    `foundPlayers=${players.length}`,
    `usedUrl=${brugtUrl || '-'}`,
    `status=${sidsteStatus}`,
    `contentType=${sidsteCt || '-'}`,
    `bodyLen=${body ? body.length : 0}`,
    `ts=${new Date().toISOString()}`,
    ``,
    `Forsoeg:`,
    ...forsog.map(f => '  ' + f),
  ].join('\n');
  fs.writeFileSync(debugPath, debug);

  // VIGTIGT: overskriv ALDRIG latest.json med en tom liste.
  // Ellers slettes den sidste gode scrape, og synkroniseringen faar intet at arbejde med.
  if (players.length === 0) {
    console.error('\nFEJL: ingen spillere fundet paa nogen adresse.');
    console.error('latest.json er IKKE overskrevet - tidligere data er bevaret.');
    console.error('Holdet.dk har sandsynligvis flyttet siden igen. Se data/debug_info.txt.');
    fs.writeFileSync(path.join(dataDir, 'changed.flag'), '0');
    process.exit(1);
  }

  const payload = JSON.stringify(players, null, 2);
  let changed = true;
  if (fs.existsSync(latestPath)) {
    changed = fs.readFileSync(latestPath, 'utf8') !== payload;
  }
  fs.writeFileSync(latestPath, payload);
  fs.writeFileSync(path.join(dataDir, 'changed.flag'), changed ? '1' : '0');

  const nz = players.filter(p => p.growth !== 0).length;
  console.log(`\nOK: ${players.length} spillere (${nz} med vaerdi != 0) fra ${brugtUrl}`);
}

run().catch(err => {
  console.error(err);
  try {
    const { dataDir } = ensureDataDirs();
    fs.writeFileSync(path.join(dataDir, 'changed.flag'), '0');
    fs.writeFileSync(path.join(dataDir, 'debug_info.txt'),
      `ERROR=${String(err)}\nts=${new Date().toISOString()}`);
  } catch {}
  process.exit(1);
});
