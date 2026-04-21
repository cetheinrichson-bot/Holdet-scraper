/**
 * recover-r9.cjs
 * Gendanner roundGrowth/r9 for alle spillere fra latest.json
 * og beregner roundScores/r9 for alle managers
 * Kør: node recover-r9.cjs
 */

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

// R9 growth data fra artifact (383 spillere)
const r9Data = JSON.parse(fs.readFileSync("./latest.json", "utf8"));

async function run() {
  console.log(`Indlæst ${r9Data.length} spillere fra latest.json`);
  console.log("Henter Firebase data...");

  const [pSnap, mSnap] = await Promise.all([
    db.ref("players").once("value"),
    db.ref("managers").once("value"),
  ]);
  const players = pSnap.val() || {};
  const managers = mSnap.val() || {};

  // Byg map: fullName -> firebaseKey
  const nameToKey = {};
  for (const [key, p] of Object.entries(players)) {
    if (p.fullName) nameToKey[p.fullName] = key;
  }
  console.log(`${Object.keys(players).length} spillere i Firebase`);

  // Skriv roundGrowth/r9 for alle spillere
  const updates = {};
  let updated = 0, skipped = 0;

  for (const { fullName, growth } of r9Data) {
    const key = nameToKey[fullName];
    if (!key) {
      console.log(`  MANGLER i Firebase: ${fullName}`);
      skipped++;
      continue;
    }
    updates[`players/${key}/roundGrowth/r9`] = growth;
    // Opdater lokalt til score-beregning
    if (!players[key].roundGrowth) players[key].roundGrowth = {};
    players[key].roundGrowth.r9 = growth;
    updated++;
  }

  console.log(`\nOpdaterer ${updated} spillere (${skipped} ikke fundet i Firebase)...`);
  await db.ref().update(updates);
  console.log("✓ roundGrowth/r9 gemt for alle spillere!\n");

  // Beregn roundScores/r9 for managers baseret på lineup/r9/starters
  const scoreUpdates = {};
  for (const [mgr, mgrData] of Object.entries(managers)) {
    if (mgrData.isAdmin) continue;
    const starters = mgrData.lineup?.r9?.starters || [];
    if (!starters.length) {
      console.log(`${mgr}: Ingen r9 lineup gemt – spring over`);
      continue;
    }
    let score = 0;
    for (const name of starters) {
      const key = nameToKey[name];
      score += (key && players[key]?.roundGrowth?.r9) || 0;
    }
    scoreUpdates[`managers/${mgr}/roundScores/r9`] = score;
    const fmt = n => n >= 0 ? `+${(n/1000).toFixed(0)}k` : `${(n/1000).toFixed(0)}k`;
    console.log(`${mgr}: r9 = ${fmt(score)} (${starters.length} startere)`);
  }

  if (Object.keys(scoreUpdates).length) {
    await db.ref().update(scoreUpdates);
    console.log("\n✓ roundScores/r9 gemt for alle managers!");
  } else {
    console.log("\nIngen lineups fundet for r9.");
    console.log("Brug Admin → Opstillinger til at sætte r9 lineups manuelt,");
    console.log("og kør derefter scriptet igen.");
  }

  console.log("\nFærdig!");
  process.exit(0);
}

run().catch(e => { console.error(e); process.exit(1); });
