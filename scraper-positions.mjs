import { chromium } from 'playwright';
import { createRequire } from 'module';
import fs from 'fs';

const require = createRequire(import.meta.url);
const admin = require('firebase-admin');

const START_URL = 'https://www.holdet.dk/da/fantasy/super-manager-fall-2026';
const STATS_URL = 'https://nexus-app-fantasy-fargate.holdet.dk/da/super-manager-fall-2026/soccer/statistics';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36';

const posMap = {
  'Målmand':'MÅL','Forsvar':'FOR','Midtbane':'MID','Angreb':'ANG',
};

admin.initializeApp({
  credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON)),
  databaseURL: process.env.FIREBASE_DATABASE_URL,
});
const db = admin.database();

if (!fs.existsSync('data/samples')) fs.mkdirSync('data/samples', { recursive: true });

function normalizeRSC(s) {
  let t = String(s || '');
  t = t.replace(/&quot;/g, '"');
  t = t.replace(/\\"/g, '"');
  t = t.replace(/\\u0022/g, '"');
  t = t.replace(/\\r/g, '').replace(/\\n/g, '\n');
  return t;
}

async function run() {
  console.log('Starter browser...');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ userAgent: UA });
  const page = await context.newPage();

  // Fang alle responses med spillerdata
  const bodies = [];
  page.on('response', async (response) => {
    const url = response.url();
    if (!url.includes('statistics')) return;
    try {
      const body = await response.text();
      if (body.includes('fullName') || body.includes('fullName')) {
        bodies.push(body);
        console.log(`✓ Response fra ${url.slice(0,80)}: ${body.length} bytes`);
      }
    } catch {}
  });

  try { await page.goto(START_URL, { waitUntil: 'domcontentloaded', timeout: 30000 }); } catch {}

  console.log('Henter statistikside...');
  try {
    await page.goto(STATS_URL, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(3000);
  } catch {}

  // Direkte request
  const headers = { 'User-Agent': UA, 'Accept': '*/*', 'Accept-Language': 'da-DK,da;q=0.9', 'Referer': START_URL };
  try {
    const resp = await page.request.get(STATS_URL, { headers });
    const body = await resp.text();
    if (body.includes('fullName')) {
      bodies.push(body);
      console.log(`✓ Direkte request: ${body.length} bytes`);
    }
  } catch {}

  await browser.close();

  // Parser alle bodies
  const players = new Map();

  for (const rawBody of bodies) {
    // Normaliser escaped JSON
    const s = normalizeRSC(rawBody);

    // Gem sample til debug
    if (!fs.existsSync('data/samples/normalized.txt')) {
      // Find et eksempel med fullName og gem kontekst
      const idx = s.indexOf('"fullName"');
      if (idx !== -1) {
        fs.writeFileSync('data/samples/normalized.txt', s.slice(idx, idx + 2000));
      }
    }

    // Bred regex: find fullName og søg efter position.title inden for 2000 tegn
    const nameRe = /"fullName"\s*:\s*"([^"]+)"/g;
    let m;
    while ((m = nameRe.exec(s)) !== null) {
      const name = m[1].trim();
      const ctx = s.slice(m.index, m.index + 2000);

      // Find team name
      let club = null;
      const teamM = /"team"\s*:\s*\{[^}]*"name"\s*:\s*"([^"]+)"/.exec(ctx);
      if (teamM) club = teamM[1];

      // Find position title (Målmand/Forsvar/Midtbane/Angreb)
      let position = null;
      const posM = /"position"\s*:\s*\{[^}]*"title"\s*:\s*"(Målmand|Forsvar|Midtbane|Angreb)"/.exec(ctx);
      if (posM) position = posMap[posM[1]];

      if (!players.has(name) || (!players.get(name).position && position)) {
        players.set(name, { club, position });
      }
    }
  }

  console.log(`\nFandt ${players.size} spillere`);
  const withPos  = [...players.values()].filter(p => p.position).length;
  const withClub = [...players.values()].filter(p => p.club).length;
  console.log(`Med position: ${withPos}/${players.size}`);
  console.log(`Med klub: ${withClub}/${players.size}`);

  // Vis sample
  let shown = 0;
  for (const [name, d] of players) {
    if (shown++ >= 8) break;
    console.log(`  ${name}: pos=${d.position||'?'} club=${d.club||'?'}`);
  }

  // Opdater Firebase
  const snap = await db.ref('players').once('value');
  const existing = snap.val() || {};
  const nameToKey = {};
  for (const [key, p] of Object.entries(existing)) {
    if (p.fullName) nameToKey[p.fullName] = key;
  }

  const updates = {};
  let updated = 0;
  for (const [name, d] of players) {
    const key = nameToKey[name];
    if (!key) continue;
    if (d.position) updates[`players/${key}/position`] = d.position;
    if (d.club)     updates[`players/${key}/club`]     = d.club;
    if (d.position || d.club) updated++;
  }

  if (Object.keys(updates).length > 0) {
    await db.ref().update(updates);
    console.log(`\n✓ Opdaterede ${updated} spillere i Firebase!`);
  }
  process.exit(0);
}

run().catch(e => { console.error(e); process.exit(1); });
