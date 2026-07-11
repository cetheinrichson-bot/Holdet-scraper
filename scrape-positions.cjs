/**
 * scrape-positions.cjs
 * Henter position og klub for alle spillere fra holdet.dk
 * og skriver det til Firebase.
 * Kører én gang - rører ikke ved growth/roundGrowth
 */

const { chromium } = require("playwright");
const admin = require("firebase-admin");
const fs = require("fs");

admin.initializeApp({
  credential: admin.credential.cert(
    JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON ||
      fs.readFileSync("./serviceAccountKey.json", "utf8"))
  ),
  databaseURL: "https://superliga-fantasy-14c4e-default-rtdb.europe-west1.firebasedatabase.app",
});

const db = admin.database();

const STATS_URL = "https://nexus-app-fantasy-fargate.holdet.dk/da/super-manager-fall-2026/soccer/statistics";

// Holdet.dk position ID -> vores format
const posMap = { 1:"MÅL", 2:"FOR", 3:"MID", 4:"ANG" };

async function run() {
  console.log("Starter browser...");
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  // Intercepter API-kald for at fange spillerdata
  const players = {};

  page.on("response", async (response) => {
    const url = response.url();
    if (!url.includes("statistics") && !url.includes("players") && !url.includes("roster")) return;
    try {
      const json = await response.json();
      // Søg efter spillere i response
      const items = json?.data || json?.players || json?.rows || json || [];
      if (!Array.isArray(items)) return;
      for (const p of items) {
        const name = p.fullName || p.name || p.playerName;
        if (!name) continue;
        const pos = posMap[p.positionId] || posMap[p.position] || p.position || null;
        const club = p.team?.name || p.teamName || p.club || null;
        if (pos || club) {
          players[name] = { position: pos, club };
          console.log(`  ${name}: ${pos} / ${club}`);
        }
      }
    } catch {}
  });

  console.log(`Henter ${STATS_URL}...`);
  await page.goto(STATS_URL, { waitUntil: "networkidle", timeout: 60000 });

  // Vent lidt ekstra på dynamisk indhold
  await page.waitForTimeout(5000);

  // Prøv også at udtrække fra DOM
  const domPlayers = await page.evaluate(() => {
    const rows = document.querySelectorAll("tr[data-testid], .player-row, [class*='player']");
    const result = [];
    rows.forEach(row => {
      const name = row.querySelector("[class*='name']")?.textContent?.trim();
      const pos = row.querySelector("[class*='position']")?.textContent?.trim();
      const club = row.querySelector("[class*='team'], [class*='club']")?.textContent?.trim();
      if (name) result.push({ name, pos, club });
    });
    return result;
  });

  console.log(`DOM spillere fundet: ${domPlayers.length}`);
  for (const p of domPlayers) {
    if (!players[p.name] && (p.pos || p.club)) {
      players[p.name] = { position: p.pos, club: p.club };
    }
  }

  await browser.close();

  console.log(`\nTotal spillere med data: ${Object.keys(players).length}`);

  if (Object.keys(players).length === 0) {
    console.log("Ingen spillere fundet - check om URL er korrekt");
    process.exit(1);
  }

  // Hent Firebase spillere og match
  const snap = await db.ref("players").once("value");
  const existing = snap.val() || {};
  const nameToKey = {};
  for (const [key, p] of Object.entries(existing)) {
    if (p.fullName) nameToKey[p.fullName] = key;
  }

  const updates = {};
  let updated = 0, skipped = 0;

  for (const [name, data] of Object.entries(players)) {
    const key = nameToKey[name];
    if (!key) { skipped++; continue; }
    if (data.position) updates[`players/${key}/position`] = data.position;
    if (data.club) updates[`players/${key}/club`] = data.club;
    updated++;
  }

  console.log(`Opdaterer ${updated} spillere (${skipped} ikke matchet)...`);
  if (Object.keys(updates).length > 0) {
    await db.ref().update(updates);
    console.log("✓ Færdig! Position og klub gemt for alle spillere.");
  }

  process.exit(0);
}

run().catch(e => { console.error(e); process.exit(1); });
