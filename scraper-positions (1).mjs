import { chromium } from 'playwright';
import { createRequire } from 'module';
import fs from 'fs';

const require = createRequire(import.meta.url);
const admin = require('firebase-admin');

const START_URL = 'https://www.holdet.dk/da/fantasy/super-manager-fall-2026';
const STATS_URL = 'https://nexus-app-fantasy-fargate.holdet.dk/da/super-manager-fall-2026/soccer/statistics';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36';

const posMap = {
  'Goalkeeper':'MÅL','goalkeeper':'MÅL',
  'Defender':'FOR','defender':'FOR',
  'Midfielder':'MID','midfielder':'MID',
  'Forward':'ANG','forward':'ANG',
  1:'MÅL', 2:'FOR', 3:'MID', 4:'ANG',
};

admin.initializeApp({
  credential: admin.credential.cert(
    JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON)
  ),
  databaseURL: process.env.FIREBASE_DATABASE_URL,
});
const db = admin.database();

if (!fs.existsSync('data/samples')) fs.mkdirSync('data/samples', { recursive: true });

async function run() {
  console.log('Starter browser...');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ userAgent: UA });
  const page = await context.newPage();

  // Intercepter ALLE responses og gem dem der indeholder spillerdata
  const capturedBodies = [];
  page.on('response', async (response) => {
    const url = response.url();
    // Fang RSC/API responses der kan indeholde spillerdata
    if (url.includes('statistics') || url.includes('players') || url.includes('elements')) {
      try {
        const body = await response.text();
        if (body.includes('fullName') || body.includes('growth')) {
          capturedBodies.push({ url, body });
          console.log(`✓ Fangede response med spillerdata fra: ${url.slice(0, 80)}`);
        }
      } catch {}
    }
  });

  // Gå til startsiden først for at sætte cookies
  try {
    await page.goto(START_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);
  } catch {}

  // Gå til statistiksiden og vent på at data loader
  console.log('Henter statistikside...');
  try {
    await page.goto(STATS_URL, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(5000);
  } catch (e) {
    console.log('Timeout ved networkidle, fortsætter...');
  }

  // Prøv også direkte request med RSC header
  const headers = {
    'User-Agent': UA,
    'Accept': 'text/x-component',
    'Accept-Language': 'da-DK,da;q=0.9',
    'Referer': START_URL,
    'RSC': '1',
    'Next-Router-State-Tree': '%5B%22%22%2C%7B%22children%22%3A%5B%22__PAGE__%22%2C%7B%7D%5D%7D%2Cnull%2Cnull%2Ctrue%5D',
  };
  try {
    const resp = await page.request.get(STATS_URL, { headers });
    const body = await resp.text();
    console.log(`Direkte RSC request: ${body.length} bytes`);
    if (body.includes('fullName') || body.includes('growth')) {
      capturedBodies.push({ url: STATS_URL + '?rsc', body });
      console.log('✓ RSC response indeholder spillerdata!');
    }
    fs.writeFileSync('data/samples/rsc_response.txt', body.slice(0, 200000));
  } catch (e) {
    console.log('RSC request fejlede:', e.message);
  }

  // Prøv standard request
  try {
    const resp2 = await page.request.get(STATS_URL, {
      headers: { ...headers, 'Accept': '*/*' }
    });
    const body2 = await resp2.text();
    console.log(`Standard request: ${body2.length} bytes`);
    if (body2.includes('fullName') || body2.includes('growth')) {
      capturedBodies.push({ url: STATS_URL + '?std', body: body2 });
      console.log('✓ Standard response indeholder spillerdata!');
    }
    fs.writeFileSync('data/samples/std_response.txt', body2.slice(0, 200000));
  } catch {}

  await browser.close();

  console.log(`\nTotal responses med spillerdata: ${capturedBodies.length}`);

  if (capturedBodies.length === 0) {
    console.log('Ingen spillerdata fundet i nogen responses');
    process.exit(1);
  }

  // Parse spillere fra alle responses
  const players = new Map();

  for (const { url, body } of capturedBodies) {
    console.log(`\nParser: ${url.slice(0, 80)}`);

    // Normaliser escaped JSON
    let s = body
      .replace(/&quot;/g, '"')
      .replace(/\\"/g, '"')
      .replace(/\\u0022/g, '"')
      .replace(/\\r/g, '')
      .replace(/\\n/g, '\n');

    // Find spillerblokke med fullName og context
    const nameRe = /"fullName"\s*:\s*"([^"]+)"/g;
    let m;
    let found = 0;
    while ((m = nameRe.exec(s)) !== null) {
      const name = m[1].trim();
      const ctx = s.slice(Math.max(0, m.index - 800), m.index + 800);

      // Find position
      let pos = null;
      const posPatterns = [
        /"position"\s*:\s*"([^"]+)"/,
        /"positionId"\s*:\s*(\d+)/,
        /"positionType"\s*:\s*"([^"]+)"/,
        /"playerType"\s*:\s*"([^"]+)"/,
        /"type"\s*:\s*"(Goalkeeper|Defender|Midfielder|Forward)"/i,
      ];
      for (const pat of posPatterns) {
        const pm = pat.exec(ctx);
        if (pm) {
          pos = posMap[pm[1]] || posMap[parseInt(pm[1])] || null;
          if (pos) break;
        }
      }

      // Find klub
      let club = null;
      const clubPatterns = [
        /"(?:teamSlug|team_slug|slug)"\s*:\s*"((?:agf|ob|brondby|fc-koebenhavn|fc-midtjylland|viborg|silkeborg|randers|lyngby|soenderjyske|ac-horsens|fc-nordsjaelland)[^"]+)"/i,
        /"teamName"\s*:\s*"([^"]+)"/,
        /"teamShortName"\s*:\s*"([^"]+)"/,
        /"club"\s*:\s*"([^"]+)"/,
        /"team"\s*:\s*\{[^}]*"name"\s*:\s*"([^"]+)"/,
        /"team"\s*:\s*\{[^}]*"slug"\s*:\s*"([^"]+)"/,
      ];
      for (const pat of clubPatterns) {
        const cm = pat.exec(ctx);
        if (cm) { club = cm[1]; break; }
      }

      // Brug også slug fra URL-pattern
      if (!club) {
        const slugM = /"slug"\s*:\s*"([a-z_-]{3,30})"/.exec(ctx);
        if (slugM && !slugM[1].includes('statistics') && !slugM[1].includes('soccer')) {
          club = slugM[1];
        }
      }

      if (!players.has(name)) players.set(name, { position: null, club: null });
      if (pos && !players.get(name).position) players.get(name).position = pos;
      if (club && !players.get(name).club) players.get(name).club = club;
      found++;
    }
    console.log(`  Fandt ${found} navne, ${[...players.values()].filter(p=>p.position).length} med position`);
  }

  // Vis sample
  console.log('\nSample spillere:');
  let i = 0;
  for (const [name, data] of players) {
    if (i++ > 10) break;
    console.log(`  ${name}: pos=${data.position||'?'} club=${data.club||'?'}`);
  }

  const withPos = [...players.values()].filter(p => p.position).length;
  const withClub = [...players.values()].filter(p => p.club).length;
  console.log(`\nMed position: ${withPos}/${players.size}`);
  console.log(`Med klub: ${withClub}/${players.size}`);

  // Opdater Firebase
  const snap = await db.ref('players').once('value');
  const existing = snap.val() || {};
  const nameToKey = {};
  for (const [key, p] of Object.entries(existing)) {
    if (p.fullName) nameToKey[p.fullName] = key;
  }

  const updates = {};
  let updated = 0;
  for (const [name, data] of players) {
    const key = nameToKey[name];
    if (!key) continue;
    if (data.position) updates[`players/${key}/position`] = data.position;
    if (data.club) updates[`players/${key}/club`] = data.club;
    if (data.position || data.club) updated++;
  }

  if (Object.keys(updates).length > 0) {
    await db.ref().update(updates);
    console.log(`\n✓ Opdaterede ${updated} spillere i Firebase!`);
  } else {
    console.log('\nIngen opdateringer at skrive');
  }

  process.exit(0);
}

run().catch(e => { console.error(e); process.exit(1); });
