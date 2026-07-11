/**
 * reset-season.cjs
 * Nulstiller managers og spillere til ny sæson
 * Kør: node reset-season.cjs
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

async function run() {
  console.log("Henter data fra Firebase...");
  const [pSnap, mSnap] = await Promise.all([
    db.ref("players").once("value"),
    db.ref("managers").once("value"),
  ]);
  const players = pSnap.val() || {};
  const managers = mSnap.val() || {};

  const updates = {};

  // ── Managers: slet roundScores og lineup ──
  for (const [name, m] of Object.entries(managers)) {
    if (m.roundScores) updates[`managers/${name}/roundScores`] = null;
    if (m.lineup)      updates[`managers/${name}/lineup`] = null;
    console.log(`Manager ${name}: nulstiller roundScores + lineup`);
  }

  // ── Spillere: sæt owner=Ledig, slet roundGrowth, nulstil totalGrowth ──
  let count = 0;
  for (const [key, p] of Object.entries(players)) {
    updates[`players/${key}/owner`]       = "Ledig";
    updates[`players/${key}/totalGrowth`] = 0;
    updates[`players/${key}/roundGrowth`] = null;
    count++;
  }
  console.log(`Spillere: nulstiller ${count} spillere`);

  // ── Skriv alle opdateringer ──
  console.log(`\nSkriver ${Object.keys(updates).length} opdateringer til Firebase...`);
  await db.ref().update(updates);

  console.log("\n✓ Færdig! Managers og spillere er nulstillet til ny sæson.");
  console.log("Næste trin: opdater scraperen med ny sæson-slug og kør den.");
  process.exit(0);
}

run().catch(e => { console.error(e); process.exit(1); });
