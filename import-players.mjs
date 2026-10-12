/**
 * import-players.mjs  (v3 - samme adresser og hentemetode som den fungerende scraper.js)
 *
 * Aendringer fra v2:
 *  - Bruger SAMME adresseliste som scraper.js. v2 pegede paa den doede
 *    fargate-adresse, saa den fik kun brudstykker og sprang spillere over.
 *  - Henter aktivt fra hver adresse (page.request.get) i stedet for kun at
 *    lytte passivt paa svar.
 *  - Samler data fra ALLE adresser der svarer, saa intet gaar tabt.
 *  - Afslutter med fejl hvis ingen spillere blev fundet, i stedet for at
 *    foretage en halv opdatering i stilhed.
 */

import { chromium } from 'playwright';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const admin = require('firebase-admin');

// Samme lister som scraper.js - hold dem ens hvis holdet.dk flytter igen.
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

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36';

const posMap = {
  // Danske titler som holdet.dk bruger
  'Keeper': 'MÅL', 'Målmand': 'MÅL',
  'Forsvar': 'FOR', 'Midtbane': 'MID', 'Angreb': 'ANG',
  // Engelske fallbacks
  'goalkeeper': 'MÅL', 'keeper': 'MÅL',
  'defense': 'FOR', 'defence': 'FOR',
  'midfield': 'MID',
  'attack': 'ANG', 'forward': 'ANG',
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
  t = t.replace(/\\u00e5/g, 'å').replace(/\\u00c5/g, 'Å');
  t = t.replace(/\\u00e6/g, 'æ').replace(/\\u00c6/g, 'Æ');
  t = t.replace(/\\u00f8/g, 'ø').replace(/\\u00d8/g, 'Ø');
  t = t.replace(/\\u00e9/g, 'é').replace(/\\u00fc/g, 'ü').replace(/\\u00f6/g, 'ö');
  return t;
}

// Finder hver spillers egen datablok og laeser klub + position derfra.
function parseBody(rawBody, players) {
  const s = normalizeRSC(rawBody);
  const nameMatches = [...s.matchAll(/"fullName"\s*:\s*"([^"]+)"/g)];

  for (let i = 0; i < nameMatches.length; i++) {
    const name = nameMatches[i][1].trim();
    const blockStart = nameMatches[i].index;
    // Blokken slutter ved NAESTE fullName, saa positionen ikke smitter
    // fra den foelgende spiller.
    const blockEnd = (i + 1 < nameMatches.length)
      ? nameMatches[i + 1].index
      : Math.min(s.length, blockStart + 3000);
    const block = s.slice(blockStart, blockEnd);

    const teamM = /"team"\s*:\s*\{[^}]*"name"\s*:\s*"([^"]+)"/.exec(block);
    const posTitleM = /"position"\s*:\s*\{[^}]*"title"\s*:\s*"([A-Za-zæøåÆØÅ]+)"/.exec(block);
    const posNameM = /"position"\s*:\s*\{[^}]*"name"\s*:\s*"([A-Za-z]+)"/.exec(block);

    const club = teamM ? teamM[1] : null;
    const position = (posTitleM && posMap[posTitleM[1]]) ||
                     (posNameM && posMap[posNameM[1]]) || null;

    if (!players.has(name)) {
      players.set(name, { club, position });
    } else {
      const p = players.get(name);
      if (!p.club && club) p.club = club;
      if (!p.position && position) p.position = position;
    }
  }
}

async function run() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ userAgent: UA });
  const page = await ctx.newPage();

  const bodies = [];

  // Passiv lytter: fanger ogsaa data der hentes efterfoelgende af siden.
  page.on('response', async (response) => {
    if (!response.url().includes('statistics')) return;
    try {
      const b = await response.text();
      if (b && b.includes('fullName')) bodies.push(b);
    } catch {}
  });

  // Startside for cookies
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

  // Hent aktivt fra HVER adresse og saml alt der svarer.
  for (const url of STATS_URLS) {
    for (const accept of ['*/*', 'text/x-component']) {
      try {
        const resp = await page.request.get(url, { headers: { ...headers, Accept: accept } });
        const st = resp.status();
        const b = await resp.text();
        const hit = b && b.includes('fullName');
        console.log(`  ${st}  ${hit ? 'DATA' : 'tom '}  ${String(b ? b.length : 0).padStart(8)} bytes  ${url}`);
        if (hit) bodies.push(b);
      } catch (e) {
        console.log(`  FEJL  ${url} - ${String(e).slice(0, 100)}`);
      }
    }
  }

  // Lad siden selv indlaese statistiksiden, saa lytteren faar sit.
  for (const url of STATS_URLS) {
    try {
      const r = await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 });
      if (r && r.status() < 400) { await page.waitForTimeout(3000); break; }
    } catch {}
  }

  await browser.close();

  console.log(`\nHentede ${bodies.length} svar med spillerdata`);

  const players = new Map();
  for (const b of bodies) parseBody(b, players);

  // Spillere uden baade klub og position er naesten altid ikke-spillere
  // (fx navne i andre dele af siden). Dem skriver vi ikke til Firebase.
  const kasseret = [];
  for (const [name, d] of [...players]) {
    if (!d.club && !d.position) { kasseret.push(name); players.delete(name); }
  }

  console.log(`Fandt ${players.size} spillere`);
  if (kasseret.length) {
    console.log(`Kasseret ${kasseret.length} navne uden klub og position: ${kasseret.slice(0, 10).join(', ')}${kasseret.length > 10 ? ' ...' : ''}`);
  }

  const byPos = { 'MÅL': 0, 'FOR': 0, 'MID': 0, 'ANG': 0, 'ukendt': 0 };
  for (const [, d] of players) byPos[d.position || 'ukendt']++;
  console.log('Fordeling:', JSON.stringify(byPos));

  if (players.size === 0) {
    console.error('\nFEJL: ingen spillere fundet paa nogen adresse.');
    console.error('Firebase er IKKE aendret. Holdet.dk har sandsynligvis flyttet siden igen.');
    process.exit(1);
  }

  // Stikproeve, saa loggen selv svarer paa "er spiller X med?"
  for (const check of ['Andreas Maxsø', 'Dominik Kotarski', 'Friday Etim']) {
    const p = players.get(check);
    console.log(`Tjek ${check}: ${p ? (p.position || '?') + ' / ' + (p.club || '?') : 'IKKE FUNDET'}`);
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
  const nye = [];

  for (const [name, data] of players) {
    const safeKey = name.replace(/[.#$\/\[\]]/g, '_');
    if (nameToKey[name]) {
      const key = nameToKey[name];
      if (data.position) updates[`players/${key}/position`] = data.position;
      if (data.club) updates[`players/${key}/club`] = data.club;
      updated++;
    } else {
      updates[`players/${safeKey}/fullName`] = name;
      updates[`players/${safeKey}/owner`] = 'Ledig';
      updates[`players/${safeKey}/totalGrowth`] = 0;
      if (data.position) updates[`players/${safeKey}/position`] = data.position;
      if (data.club) updates[`players/${safeKey}/club`] = data.club;
      // Logges til playerlog, som vises under Transfers -> Historik
      updates[`playerlog/${Date.now()}_${safeKey}`] = {
        player: name,
        club: data.club || null,
        position: data.position || null,
        ts: new Date().toISOString(),
      };
      added++;
      nye.push(`${name} (${data.position || '?'} / ${data.club || '?'})`);
    }
  }

  if (nye.length) {
    console.log('\nNye spillere:');
    nye.forEach(n => console.log('  + ' + n));
  }

  console.log(`\nNye: ${added}, Opdaterede: ${updated}`);
  await db.ref().update(updates);
  console.log('OK - faerdig!');
  process.exit(0);
}

run().catch(e => { console.error(e); process.exit(1); });
