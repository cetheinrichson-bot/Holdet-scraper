/**
 * import-players.mjs  (v2 - fixet position-parsing)
 * Importerer spillere fra holdet.dk til Firebase
 * - Bruger position.name (engelsk ASCII) i stedet for title (dansk med æøå)
 * - Begrænser søgning til spillerens egen datablok
 */

import { chromium } from 'playwright';
import { createRequire } from 'module';
import fs from 'fs';

const require = createRequire(import.meta.url);
const admin = require('firebase-admin');

const START_URL = 'https://www.holdet.dk/da/fantasy/super-manager-fall-2026';
const STATS_URL = 'https://nexus-app-fantasy-fargate.holdet.dk/da/super-manager-fall-2026/soccer/statistics';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36';

// Engelske position-navne (ASCII, ingen unicode-problemer)
const posMap = {
  'goalkeeper': 'MÅL',
  'keeper':     'MÅL',
  'defense':    'FOR',
  'defence':    'FOR',
  'midfield':   'MID',
  'attack':     'ANG',
  'forward':    'ANG',
  // Danske titler (virker nu efter unicode-decode)
  'Målmand':    'MÅL',
  'Keeper':     'MÅL',
  'Forsvar':    'FOR',
  'Midtbane':   'MID',
  'Angreb':     'ANG',
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
  // Decode unicode escapes for danske tegn
  t = t.replace(/\\u00e5/g, 'å').replace(/\\u00c5/g, 'Å');
  t = t.replace(/\\u00e6/g, 'æ').replace(/\\u00c6/g, 'Æ');
  t = t.replace(/\\u00f8/g, 'ø').replace(/\\u00d8/g, 'Ø');
  t = t.replace(/\\u00e9/g, 'é').replace(/\\u00fc/g, 'ü').replace(/\\u00f6/g, 'ö');
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
        console.log(`OK Response: ${url.slice(0,80)} (${body.length} bytes)`);
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

  // Parser: split på fullName så hver blok kun indeholder ÉN spillers data
  const players = new Map();

  for (const rawBody of bodies) {
    const s = normalizeRSC(rawBody);

    // Find alle fullName positioner
    const nameMatches = [...s.matchAll(/"fullName"\s*:\s*"([^"]+)"/g)];

    for (let i = 0; i < nameMatches.length; i++) {
      const name = nameMatches[i][1].trim();
      const blockStart = nameMatches[i].index;
      // Blokken slutter ved NÆSTE fullName (eller +3000 tegn)
      const blockEnd = (i + 1 < nameMatches.length)
        ? nameMatches[i+1].index
        : Math.min(s.length, blockStart + 3000);
      const block = s.slice(blockStart, blockEnd);

      // Klub fra team.name
      const teamM = /"team"\s*:\s*\{[^}]*"name"\s*:\s*"([^"]+)"/.exec(block);
      // Position: title (dansk: Keeper/Forsvar/Midtbane/Angreb) primært, name (engelsk) som fallback
      const posTitleM = /"position"\s*:\s*\{[^}]*"title"\s*:\s*"([A-Za-zæøåÆØÅ]+)"/.exec(block);
      const posNameM  = /"position"\s*:\s*\{[^}]*"name"\s*:\s*"([A-Za-z]+)"/.exec(block);

      const club = teamM ? teamM[1] : null;
      const position = (posTitleM && posMap[posTitleM[1]]) || (posNameM && posMap[posNameM[1]]) || null;

      if (!players.has(name)) {
        players.set(name, { club, position });
      } else {
        const p = players.get(name);
        if (!p.club && club) p.club = club;
        if (!p.position && position) p.position = position;
      }
    }
  }

  console.log(`\nFandt ${players.size} spillere`);
  const byPos = { 'MÅL':0, 'FOR':0, 'MID':0, 'ANG':0, null:0 };
  for (const [,d] of players) byPos[d.position] = (byPos[d.position]||0) + 1;
  console.log('Fordeling:', JSON.stringify(byPos));

  // Vis målmændene specifikt
  console.log('\nMålmænd fundet:');
  for (const [name, d] of players) {
    if (d.position === 'MÅL') console.log(`  ${name} (${d.club})`);
  }

  // Tjek specifikke spillere
  for (const check of ['Andreas Hansen', 'Jesper Hansen', 'Dominik Kotarski', 'Friday Etim']) {
    const p = players.get(check);
    console.log(`\nTjek ${check}: ${p ? p.position + ' / ' + p.club : 'IKKE FUNDET'}`);
  }

  // Opdater Firebase
  const snap = await db.ref('players').once('value');
  const existing = snap.val() || {};
  const nameToKey = {};
  for (const [key, p] of Object.entries(existing)) {
    if (p.fullName) nameToKey[p.fullName] = key;
  }

  const updates = {};
  let added = 0, updated = 0;

  for (const [name, data] of players) {
    const safeKey = name.replace(/[.#$\/\[\]]/g, '_');
    if (nameToKey[name]) {
      const key = nameToKey[name];
      if (data.position) updates[`players/${key}/position`] = data.position;
      if (data.club)     updates[`players/${key}/club`]     = data.club;
      updated++;
    } else {
      updates[`players/${safeKey}/fullName`]    = name;
      updates[`players/${safeKey}/owner`]       = 'Ledig';
      updates[`players/${safeKey}/totalGrowth`] = 0;
      if (data.position) updates[`players/${safeKey}/position`] = data.position;
      if (data.club)     updates[`players/${safeKey}/club`]     = data.club;
      // Log ny spiller til playerlog (vises under Historik paa hjemmesiden)
      updates[`playerlog/${Date.now()}_${safeKey}`] = {
        player: name,
        club: data.club || null,
        position: data.position || null,
        ts: new Date().toISOString()
      };
      added++;
      console.log(`+ Ny spiller: ${name} (${data.position||'?'} / ${data.club||'?'})`);
    }
  }

  console.log(`\nNye: ${added}, Opdaterede: ${updated}`);
  if (Object.keys(updates).length > 0) {
    await db.ref().update(updates);
    console.log('OK Færdig!');
  }
  process.exit(0);
}

run().catch(e => { console.error(e); process.exit(1); });
