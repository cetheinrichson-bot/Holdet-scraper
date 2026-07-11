import { chromium } from 'playwright';
import { createRequire } from 'module';
import fs from 'fs';

const require = createRequire(import.meta.url);
const admin = require('firebase-admin');

const START_URL = 'https://www.holdet.dk/da/fantasy/super-manager-fall-2026';
const STATS_URL = 'https://nexus-app-fantasy-fargate.holdet.dk/da/super-manager-fall-2026/soccer/statistics';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36';

// Position title -> vores format
const posMap = {
  'Målmand':'MÅL', 'Forsvar':'FOR', 'Midtbane':'MID', 'Angreb':'ANG',
  'Goalkeeper':'MÅL', 'Defense':'FOR', 'defense':'FOR', 'Midfield':'MID', 'Attack':'ANG',
  'goalkeeper':'MÅL', 'midfield':'MID', 'attack':'ANG',
  1:'MÅL', 2:'FOR', 3:'MID', 4:'ANG',
};

admin.initializeApp({
  credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON)),
  databaseURL: process.env.FIREBASE_DATABASE_URL,
});
const db = admin.database();

if (!fs.existsSync('data/samples')) fs.mkdirSync('data/samples', { recursive: true });

async function run() {
  console.log('Starter browser...');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ userAgent: UA });
  const page = await context.newPage();

  // Gå til startsiden for cookies
  try { await page.goto(START_URL, { waitUntil: 'domcontentloaded', timeout: 30000 }); } catch {}

  // Hent statistiksiden med samme metode som den eksisterende scraper
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
    console.error('Fejl:', e.message);
    await browser.close();
    process.exit(1);
  }

  // Gem HELE body til debugging (ikke kun 100KB)
  fs.writeFileSync('data/samples/full_body.txt', body);
  console.log(`Gemt full_body.txt (${body.length} bytes)`);

  await browser.close();

  // Normaliser escaped JSON
  let s = body
    .replace(/&quot;/g, '"')
    .replace(/\\"/g, '"')
    .replace(/\\u0022/g, '"')
    .replace(/\\r/g, '')
    .replace(/\\n/g, '\n');

  // Parser baseret på den kendte struktur:
  // "fullName":"Felix Beijmo",...,"team":{"id":575,"slug":"fc_koebenhavn","name":"FC København"},"position":{"id":269,"name":"defense","title":"Forsvar"}
  const players = new Map();

  const re = /"fullName"\s*:\s*"([^"]+)"(?:[^{}]|\{[^{}]*\}){0,20}"team"\s*:\s*\{[^}]*"name"\s*:\s*"([^"]+)"[^}]*\}(?:[^{}]|\{[^{}]*\}){0,10}"position"\s*:\s*\{[^}]*"title"\s*:\s*"([^"]+)"/g;
  let m;
  while ((m = re.exec(s)) !== null) {
    const name = m[1].trim();
    const club = m[2].trim();
    const posTitle = m[3].trim();
    const pos = posMap[posTitle] || null;
    players.set(name, { club, position: pos, posTitle });
  }

  console.log(`\nParser med præcis regex: ${players.size} spillere`);

  // Hvis ingen fundet, prøv omvendt rækkefølge (position før team)
  if (players.size === 0) {
    const re2 = /"fullName"\s*:\s*"([^"]+)"(?:[^{}]|\{[^{}]*\}){0,20}"position"\s*:\s*\{[^}]*"title"\s*:\s*"([^"]+)"[^}]*\}(?:[^{}]|\{[^{}]*\}){0,10}"team"\s*:\s*\{[^}]*"name"\s*:\s*"([^"]+)"/g;
    while ((m = re2.exec(s)) !== null) {
      const name = m[1].trim();
      const posTitle = m[2].trim();
      const club = m[3].trim();
      const pos = posMap[posTitle] || null;
      players.set(name, { club, position: pos, posTitle });
    }
    console.log(`Parser 2 (omvendt): ${players.size} spillere`);
  }

  // Prøv bredere søgning hvis stadig ingen
  if (players.size === 0) {
    console.log('Prøver bredere søgning...');
    const nameRe = /"fullName"\s*:\s*"([^"]+)"/g;
    while ((m = nameRe.exec(s)) !== null) {
      const name = m[1].trim();
      const ctx = s.slice(m.index, m.index + 2000);
      const teamM = /"name"\s*:\s*"((?:FC|AGF|OB|Brøndby|Viborg|Silkeborg|Randers|Lyngby|Sønderjyske|AC Horsens)[^"]+)"/.exec(ctx);
      const posM = /"title"\s*:\s*"(Målmand|Forsvar|Midtbane|Angreb)"/.exec(ctx);
      if (teamM || posM) {
        players.set(name, {
          club: teamM ? teamM[1] : null,
          position: posM ? (posMap[posM[1]] || posM[1]) : null,
          posTitle: posM ? posM[1] : null
        });
      }
    }
    console.log(`Bred søgning: ${players.size} spillere`);
  }

  // Vis sample
  let shown = 0;
  for (const [name, d] of players) {
    if (shown++ >= 10) break;
    console.log(`  ${name}: pos=${d.position||'?'} (${d.posTitle||'?'}) club=${d.club||'?'}`);
  }

  const withPos  = [...players.values()].filter(p => p.position).length;
  const withClub = [...players.values()].filter(p => p.club).length;
  console.log(`\nMed position: ${withPos}/${players.size}`);
  console.log(`Med klub: ${withClub}/${players.size}`);

  if (players.size === 0) {
    console.log('FEJL: Ingen spillere fundet. Tjek full_body.txt artifact.');
    process.exit(1);
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
  } else {
    console.log('\nIngen opdateringer');
  }

  process.exit(0);
}

run().catch(e => { console.error(e); process.exit(1); });
