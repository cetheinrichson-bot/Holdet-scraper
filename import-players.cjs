/**
 * import-players.mjs
 * Importerer spillere fra holdet.dk til Firebase
 * - Henter fullName, growth, position og klub direkte fra siden
 * - Nye spillere tilføjes med owner=Ledig
 * - Eksisterende spillere opdateres med position og klub
 */

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

  const bodies = [];
  page.on('response', async (response) => {
    const url = response.url();
    if (!url.includes('statistics')) return;
    try {
      const body = await response.text();
      if (body.includes('fullName')) {
        bodies.push(body);
        console.log(`✓ Response: ${url.slice(0,80)} (${body.length} bytes)`);
      }
    } catch {}
  });

  try { await page.goto(START_URL, { waitUntil: 'domcontentloaded', timeout: 30000 }); } catch {}

  console.log('Henter statistikside...');
  try {
    await page.goto(STATS_URL, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(3000);
  } catch {}

  const headers = { 'User-Agent': UA, 'Accept': '*/*', 'Accept-Language': 'da-DK,da;q=0.9', 'Referer': START_URL };
  try {
    const resp = await page.request.get(STATS_URL, { headers });
    const body = await resp.text();
    if (body.includes('fullName')) bodies.push(body);
  } catch {}

  await browser.close();

  // Parser alle bodies
  const players = new Map();

  for (const rawBody of bodies) {
    const s = normalizeRSC(rawBody);
    const nameRe = /"fullName"\s*:\s*"([^"]+)"/g;
    let m;
    while ((m = nameRe.exec(s)) !== null) {
      const name = m[1].trim();
      const ctx = s.slice(m.index, m.index + 2000);

      const teamM = /"team"\s*:\s*\{[^}]*"name"\s*:\s*"([^"]+)"/.exec(ctx);
      const posM  = /"position"\s*:\s*\{[^}]*"title"\s*:\s*"(Målmand|Forsvar|Midtbane|Angreb)"/.exec(ctx);
      const growthM = /"growth"\s*:\s*(-?\d+)/.exec(ctx);

      const club     = teamM ? teamM[1] : null;
      const position = posM  ? posMap[posM[1]] : null;
      const growth   = growthM ? parseInt(growthM[1]) : 0;

      if (!players.has(name)) {
        players.set(name, { club, position, growth });
      } else {
        const p = players.get(name);
        if (!p.club && club)         p.club = club;
        if (!p.position && position) p.position = position;
      }
    }
  }

  console.log(`\nFandt ${players.size} spillere`);
  const withPos  = [...players.values()].filter(p => p.position).length;
  const withClub = [...players.values()].filter(p => p.club).length;
  console.log(`Med position: ${withPos}/${players.size}`);
  console.log(`Med klub: ${withClub}/${players.size}`);

  // Hent Firebase spillere
  const snap = await db.ref('players').once('value');
  const existing = snap.val() || {};
  const nameToKey = {};
  for (const [key, p] of Object.entries(existing)) {
    if (p.fullName) nameToKey[p.fullName] = key;
  }

  const updates = {};
  let added = 0, updated = 0, skipped = 0;

  for (const [name, data] of players) {
    const safeKey = name.replace(/[.#$\/\[\]]/g, '_');

    if (nameToKey[name]) {
      // Eksisterende spiller - opdater position og klub
      const key = nameToKey[name];
      if (data.position) updates[`players/${key}/position`] = data.position;
      if (data.club)     updates[`players/${key}/club`]     = data.club;
      updated++;
    } else {
      // Ny spiller - tilføj
      updates[`players/${safeKey}/fullName`]    = name;
      updates[`players/${safeKey}/owner`]       = 'Ledig';
      updates[`players/${safeKey}/totalGrowth`] = 0;
      if (data.position) updates[`players/${safeKey}/position`] = data.position;
      if (data.club)     updates[`players/${safeKey}/club`]     = data.club;
      added++;
      console.log(`+ Ny spiller: ${name} (${data.position||'?'} / ${data.club||'?'})`);
    }
  }

  console.log(`\nNye spillere: ${added}`);
  console.log(`Opdaterede: ${updated}`);
  console.log(`Skriver til Firebase...`);

  if (Object.keys(updates).length > 0) {
    await db.ref().update(updates);
    console.log('✓ Færdig!');
  }

  process.exit(0);
}

run().catch(e => { console.error(e); process.exit(1); });
