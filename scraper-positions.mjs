import { chromium } from 'playwright';
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';

const require = createRequire(import.meta.url);
const admin = require('firebase-admin');

const STATS_URL = 'https://nexus-app-fantasy-fargate.holdet.dk/da/super-manager-fall-2026/soccer/statistics';
const START_URL = 'https://www.holdet.dk/da/fantasy/super-manager-fall-2026';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36';

// Position mapping
const posMap = {
  'Goalkeeper': 'MÅL', 'goalkeeper': 'MÅL',
  'Defender':   'FOR', 'defender':   'FOR',
  'Midfielder': 'MID', 'midfielder': 'MID',
  'Forward':    'ANG', 'forward':    'ANG',
  'MÅL':'MÅL','FOR':'FOR','MID':'MID','ANG':'ANG',
  1:'MÅL', 2:'FOR', 3:'MID', 4:'ANG',
};

function normalizeRSC(s) {
  let t = String(s || '');
  t = t.replace(/&quot;/g, '"');
  t = t.replace(/\\"/g, '"');
  t = t.replace(/\\u0022/g, '"');
  t = t.replace(/\\r/g, '').replace(/\\n/g, '\n');
  return t;
}

function extractPlayersWithDetails(raw) {
  const s = normalizeRSC(raw);
  const players = new Map();
  let m;

  // Prøv at finde spillerblokke med fullName + position + team/club
  // Pattern: "person": { ... "fullName": "..." ... "position": "..." ... } ... "growth": N
  const blockRe = /"person"\s*:\s*\{([^{}]{0,2000})\}/g;
  while ((m = blockRe.exec(s)) !== null) {
    const block = m[1];
    const nameM = /"fullName"\s*:\s*"([^"]+)"/.exec(block);
    const posM  = /"position"\s*:\s*"?([^",}]+)"?/.exec(block);
    const teamM = /"(?:team|club|teamName|teamSlug|slug)"\s*:\s*"([^"]+)"/.exec(block);
    if (nameM) {
      const name = nameM[1].trim();
      if (!players.has(name)) players.set(name, {});
      if (posM) players.get(name).position = posMap[posM[1].trim()] || posM[1].trim();
      if (teamM) players.get(name).club = teamM[1].trim();
    }
  }

  // Prøv bredere: find alle fullName og kig på omgivende kontekst
  const nameRe = /"fullName"\s*:\s*"([^"]+)"/g;
  while ((m = nameRe.exec(s)) !== null) {
    const name = m[1].trim();
    const ctx = s.slice(Math.max(0, m.index - 500), m.index + 500);
    const posM  = /"position"\s*:\s*"?([^",}\s]{2,20})"?/.exec(ctx);
    const teamM = /"(?:team|club|teamName|slug)"\s*:\s*"([^"]{2,50})"/.exec(ctx);
    if (!players.has(name)) players.set(name, {});
    if (posM && !players.get(name).position) {
      const pos = posMap[posM[1].trim()] || posM[1].trim();
      if (['MÅL','FOR','MID','ANG'].includes(pos)) players.get(name).position = pos;
    }
    if (teamM && !players.get(name).club) players.get(name).club = teamM[1].trim();
  }

  // Gem også rå body til debugging
  fs.writeFileSync('data/samples/stats_positions_raw.txt', s.slice(0, 100000));

  return players;
}

async function run() {
  // Init Firebase
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON ||
    fs.readFileSync('./serviceAccountKey.json', 'utf8'));
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: process.env.FIREBASE_DATABASE_URL,
  });
  const db = admin.database();

  if (!fs.existsSync('data')) fs.mkdirSync('data', { recursive: true });
  if (!fs.existsSync('data/samples')) fs.mkdirSync('data/samples', { recursive: true });

  console.log('Starter browser...');
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ userAgent: UA });
  const page = await ctx.newPage();

  try { await page.goto(START_URL, { waitUntil: 'domcontentloaded', timeout: 30000 }); } catch {}

  const headers = {
    'User-Agent': UA,
    'Accept': '*/*',
    'Accept-Language': 'da-DK,da;q=0.9,en-US;q=0.8,en;q=0.7',
    'Referer': START_URL
  };

  let body = '';
  try {
    const resp = await page.request.get(STATS_URL, { headers });
    body = await resp.text();
    console.log(`Hentet ${body.length} bytes (status ${resp.status()})`);
  } catch (e) {
    console.error('Fejl ved hentning:', e.message);
    await browser.close();
    process.exit(1);
  }

  // Prøv med RSC header hvis ingen data
  if (!/"fullName"/.test(body)) {
    try {
      const resp2 = await page.request.get(STATS_URL, { headers: { ...headers, 'Accept': 'text/x-component' } });
      body = await resp2.text();
      console.log(`RSC forsøg: ${body.length} bytes`);
    } catch {}
  }

  await browser.close();

  const players = extractPlayersWithDetails(body);
  console.log(`Fandt ${players.size} spillere i body`);

  // Vis sample
  let shown = 0;
  for (const [name, data] of players) {
    if (shown++ > 5) break;
    console.log(`  ${name}: pos=${data.position||'?'} club=${data.club||'?'}`);
  }

  if (players.size === 0) {
    console.log('Ingen spillere fundet - tjek stats_positions_raw.txt artifact');
    process.exit(1);
  }

  // Hent Firebase spillere
  const snap = await db.ref('players').once('value');
  const existing = snap.val() || {};
  const nameToKey = {};
  for (const [key, p] of Object.entries(existing)) {
    if (p.fullName) nameToKey[p.fullName] = key;
  }

  const updates = {};
  let updated = 0, skipped = 0;

  for (const [name, data] of players) {
    const key = nameToKey[name];
    if (!key) { skipped++; continue; }
    if (data.position) updates[`players/${key}/position`] = data.position;
    if (data.club)     updates[`players/${key}/club`]     = data.club;
    updated++;
  }

  console.log(`\nOpdaterer ${updated} spillere (${skipped} ikke matchet i Firebase)...`);
  if (Object.keys(updates).length > 0) {
    await db.ref().update(updates);
    console.log('✓ Position og klub gemt i Firebase!');
  }

  process.exit(0);
}

run().catch(e => { console.error(e); process.exit(1); });
