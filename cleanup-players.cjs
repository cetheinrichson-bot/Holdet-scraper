/**
 * cleanup-players.cjs
 * Sletter spillere i Firebase som ikke findes i data/latest.json
 * (dvs. spillere der ikke er med i den nye saeson paa holdet.dk)
 * Kør via GitHub Actions
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
  // Læs den aktuelle spillerliste fra scraperen
  const latest = JSON.parse(fs.readFileSync("./data/latest.json", "utf8"));
  const validNames = new Set(latest.map(p => p.fullName));
  console.log(`Gyldige spillere i latest.json: ${validNames.size}`);

  // Hent alle spillere fra Firebase
  const snap = await db.ref("players").once("value");
  const existing = snap.val() || {};
  console.log(`Spillere i Firebase: ${Object.keys(existing).length}`);

  // Find spillere der IKKE er i den nye sæson
  const updates = {};
  let deleted = 0;
  const deletedNames = [];

  for (const [key, p] of Object.entries(existing)) {
    if (!validNames.has(p.fullName)) {
      updates[`players/${key}`] = null;
      deletedNames.push(`${p.fullName} (${p.club || "ukendt klub"})`);
      deleted++;
    }
  }

  if (deleted === 0) {
    console.log("Ingen spillere at slette - alle er med i den nye sæson.");
    process.exit(0);
  }

  console.log(`\nSletter ${deleted} spillere der ikke er i den nye sæson:`);
  deletedNames.sort().forEach(n => console.log(`  - ${n}`));

  await db.ref().update(updates);
  console.log(`\n✓ Færdig! ${deleted} spillere slettet.`);
  console.log(`Tilbage i Firebase: ${Object.keys(existing).length - deleted} spillere`);
  process.exit(0);
}

run().catch(e => { console.error(e); process.exit(1); });
