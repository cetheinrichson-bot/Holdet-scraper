/**
 * firebase-sync.js – Læser data/latest.json og opdaterer KUN vækstdata i Firebase.
 *
 * Dette script:
 *   1. Læser hvilken runde der er aktiv fra Firebase
 *   2. For hver spiller i latest.json opdateres roundGrowth og totalGrowth
 *   3. Rører IKKE ved club, position, owner eller andre felter
 *
 * Din eksisterende scraper og Google Sheets-integration forbliver 100% uændret.
 * Dette script kører som et EKSTRA trin i GitHub Actions efter din normale scrape.
 *
 * Kræver miljøvariabler (sættes som GitHub Secrets):
 *   FIREBASE_DATABASE_URL   – fx "https://dit-projekt-default-rtdb.firebaseio.com"
 *   FIREBASE_SERVICE_ACCOUNT_JSON – hele indholdet af serviceAccountKey.json som string
 */

const admin = require("firebase-admin");
const fs = require("fs");
const path = require("path");

// Initialiser Firebase med service account fra miljøvariabel
const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
if (!serviceAccountJson) {
  console.error("Mangler FIREBASE_SERVICE_ACCOUNT_JSON miljøvariabel");
  process.exit(1);
}

const serviceAccount = JSON.parse(serviceAccountJson);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: process.env.FIREBASE_DATABASE_URL,
});

const db = admin.database();

async function sync() {
  // 1. Læs latest.json fra data/-mappen (din scrapers output)
  const dataPath = path.join(__dirname, "data", "latest.json");
  if (!fs.existsSync(dataPath)) {
    console.log("Ingen latest.json fundet – springer sync over");
    process.exit(0);
  }

  const latest = JSON.parse(fs.readFileSync(dataPath, "utf8"));
  console.log(`Læste ${latest.length} spillere fra latest.json`);

  // 2. Find aktiv runde fra Firebase
  const roundsSnap = await db.ref("rounds").once("value");
  const rounds = roundsSnap.val() || {};
  const activeRound = Object.entries(rounds).find(([, r]) => r.status === "active");

  if (!activeRound) {
    console.log("Ingen aktiv runde fundet i Firebase – springer sync over");
    process.exit(0);
  }

  const [roundKey, roundData] = activeRound;
  console.log(`Aktiv runde: ${roundData.label} (${roundKey})`);

  // 3. Hent nuværende spillerdata fra Firebase
  const playersSnap = await db.ref("players").once("value");
  const players = playersSnap.val() || {};

  // 4. Byg opdateringer – KUN vækstfelter, rører ikke ved club/position/owner
  const updates = {};
  let updated = 0;
  let notFound = 0;

  for (const scraped of latest) {
    const name = scraped.fullName;
    const growth = scraped.growth ?? 0;

    if (!players[name]) {
      // Spiller fra holdet.dk men ikke i vores database – log og fortsæt
      notFound++;
      continue;
    }

    // Opdater rundevækst for aktiv runde
    updates[`players/${name}/roundGrowth/${roundKey}`] = growth;

    // Genberegn totalvækst som sum af alle kendte runder + ny vækst
    const existingGrowth = players[name].roundGrowth || {};
    const total = Object.entries(existingGrowth).reduce((sum, [key, val]) => {
      // Brug ny værdi for aktiv runde, ellers eksisterende
      return sum + (key === roundKey ? growth : (val || 0));
    }, 0);

    // Hvis aktiv runde ikke fandtes i eksisterende data, tilføj den
    const hadRound = roundKey in existingGrowth;
    updates[`players/${name}/totalGrowth`] = hadRound ? total : total + growth;

    updated++;
  }

  // 5. Skriv alle opdateringer til Firebase i ét kald
  if (Object.keys(updates).length > 0) {
    await db.ref().update(updates);
    console.log(`✓ Opdaterede ${updated} spillere for ${roundData.label}`);
  }

  if (notFound > 0) {
    console.log(`  (${notFound} spillere fra holdet.dk ikke fundet i Firebase – ignoreret)`);
  }

  // 6. Opdater tidsstempel for seneste sync
  await db.ref("meta/lastSync").set(new Date().toISOString());
  console.log("✓ Sync færdig");

  process.exit(0);
}

sync().catch((err) => {
  console.error("Fejl under Firebase sync:", err);
  process.exit(1);
});
