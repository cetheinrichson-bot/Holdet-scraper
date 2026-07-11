/**
 * import-players.cjs
 * Importerer spillere fra latest.json til Firebase
 * - Nye spillere tilføjes med owner=Ledig
 * - Eksisterende spillere beholdes (owner og historik intakt)
 * Kør: node import-players.cjs
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
  const newPlayers = JSON.parse(fs.readFileSync("./latest.json", "utf8"));
  console.log(`Indlæst ${newPlayers.length} spillere fra latest.json`);

  const snap = await db.ref("players").once("value");
  const existing = snap.val() || {};

  // Byg map: fullName -> key
  const nameToKey = {};
  for (const [key, p] of Object.entries(existing)) {
    if (p.fullName) nameToKey[p.fullName] = key;
  }

  const updates = {};
  let added = 0, skipped = 0;

  for (const p of newPlayers) {
    const safeKey = p.fullName.replace(/[.#$\/\[\]]/g, '_');
    if (nameToKey[p.fullName]) {
      // Spiller findes allerede - behold men nulstil growth
      const key = nameToKey[p.fullName];
      updates[`players/${key}/totalGrowth`] = 0;
      updates[`players/${key}/roundGrowth`] = null;
      skipped++;
    } else {
      // Ny spiller - tilføj
      updates[`players/${safeKey}/fullName`]    = p.fullName;
      updates[`players/${safeKey}/owner`]       = "Ledig";
      updates[`players/${safeKey}/totalGrowth`] = 0;
      updates[`players/${safeKey}/position`]    = p.position || null;
      updates[`players/${safeKey}/club`]        = p.club || null;
      added++;
      console.log(`+ Ny spiller: ${p.fullName}`);
    }
  }

  console.log(`\nNye spillere: ${added}`);
  console.log(`Eksisterende (nulstillet): ${skipped}`);
  console.log(`Skriver til Firebase...`);

  await db.ref().update(updates);
  console.log("✓ Færdig!");
  process.exit(0);
}

run().catch(e => { console.error(e); process.exit(1); });
