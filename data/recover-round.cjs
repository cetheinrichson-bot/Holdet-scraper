/**
 * recover-round.cjs
 * Gendanner en rundes resultater fra en gammel latest.json
 *
 * Brug:
 *   1. Laeg den gamle latest.json i repoet som "recovery.json"
 *   2. Saet ROUND nedenfor til den runde der skal gendannes
 *   3. Kor workflowet
 */

const admin = require("firebase-admin");
const fs = require("fs");

const ROUND = process.env.RECOVER_ROUND || "r1";
const FILE  = process.env.RECOVER_FILE  || "./recovery.json";

admin.initializeApp({
  credential: admin.credential.cert(
    JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON ||
      fs.readFileSync("./serviceAccountKey.json", "utf8"))
  ),
  databaseURL: "https://superliga-fantasy-14c4e-default-rtdb.europe-west1.firebasedatabase.app",
});
const db = admin.database();

async function run() {
  if (!fs.existsSync(FILE)) {
    console.error("Filen " + FILE + " findes ikke. Upload den gamle latest.json som recovery.json.");
    process.exit(1);
  }

  const data = JSON.parse(fs.readFileSync(FILE, "utf8"));
  const nonZero = data.filter(p => Number(p.growth) !== 0).length;
  console.log("Indlaest " + data.length + " spillere fra " + FILE);
  console.log("Heraf med vaerdi != 0: " + nonZero);
  if (nonZero === 0) {
    console.error("\nADVARSEL: alle vaerdier er 0 - det er en fil fra EFTER nulstillingen.");
    console.error("Find en aeldre commit hvor vaerdierne stadig var der.");
    process.exit(1);
  }

  const [pSnap, mSnap] = await Promise.all([
    db.ref("players").once("value"),
    db.ref("managers").once("value"),
  ]);
  const players  = pSnap.val() || {};
  const managers = mSnap.val() || {};

  const nameToKey = {};
  for (const [k, p] of Object.entries(players)) if (p.fullName) nameToKey[p.fullName] = k;

  // 1) Skriv rundens vaerdier tilbage
  const updates = {};
  let restored = 0, missing = 0;
  for (const { fullName, growth } of data) {
    const key = nameToKey[fullName];
    if (!key) { missing++; continue; }
    const g = Number(growth) || 0;
    updates["players/" + key + "/roundGrowth/" + ROUND] = g;
    if (!players[key].roundGrowth) players[key].roundGrowth = {};
    players[key].roundGrowth[ROUND] = g;
    restored++;
  }
  console.log("\nGendanner " + ROUND + " for " + restored + " spillere (" + missing + " ikke fundet)");

  // 2) Genberegn totalGrowth for ALLE spillere
  for (const [key, p] of Object.entries(players)) {
    const rg = p.roundGrowth || {};
    updates["players/" + key + "/totalGrowth"] =
      Object.values(rg).reduce((a, b) => a + (Number(b) || 0), 0);
  }

  // 3) Genberegn managernes rundescore
  console.log("\nRundescore for " + ROUND + ":");
  for (const [mgr, md] of Object.entries(managers)) {
    if (md.isAdmin) continue;
    const starters = md.lineup?.[ROUND]?.starters || [];
    if (!starters.length) { console.log("  " + mgr + ": ingen gemt opstilling - springes over"); continue; }
    let score = 0;
    for (const n of starters) {
      const k = nameToKey[n];
      score += (k && players[k]?.roundGrowth?.[ROUND]) || 0;
    }
    updates["managers/" + mgr + "/roundScores/" + ROUND] = score;
    console.log("  " + mgr + ": " + (score >= 0 ? "+" : "") + Math.round(score/1000) + "k");
  }

  await db.ref().update(updates);
  console.log("\nOK - " + ROUND + " gendannet!");
  process.exit(0);
}

run().catch(e => { console.error(e); process.exit(1); });
