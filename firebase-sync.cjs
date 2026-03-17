/**
 * firebase-sync.cjs – Synkroniserer vækstdata fra latest.json til Firebase.
 *
 * Rundelogik er fuldt automatisk – ingen manuel status-opdatering nødvendig.
 * Aktiv runde bestemmes udelukkende af om now >= start && now <= end,
 * præcis som dit Google Sheets AppScript gør.
 */

const admin = require("firebase-admin");
const fs = require("fs");
const path = require("path");

const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
if (!serviceAccountJson) {
  console.error("Mangler FIREBASE_SERVICE_ACCOUNT_JSON miljøvariabel");
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert(JSON.parse(serviceAccountJson)),
  databaseURL: process.env.FIREBASE_DATABASE_URL,
});

const db = admin.database();

async function sync() {
  // 1. Læs latest.json
  const dataPath = path.join(__dirname, "data", "latest.json");
  if (!fs.existsSync(dataPath)) {
    console.log("Ingen latest.json fundet – springer over");
    process.exit(0);
  }
  const latest = JSON.parse(fs.readFileSync(dataPath, "utf8"));
  console.log(`Læste ${latest.length} spillere fra latest.json`);

  // 2. Hent runder fra Firebase
  const roundsSnap = await db.ref("rounds").once("value");
  const rounds = roundsSnap.val() || {};

  // 3. Find aktiv runde udelukkende baseret på tidsvindue – ingen manuel status nødvendig
  const now = new Date();
  let activeRoundKey = null;
  let activeRound = null;

  for (const [key, round] of Object.entries(rounds)) {
    const start = new Date(round.start);
    const end = new Date(round.end);
    if (now >= start && now <= end) {
      activeRoundKey = key;
      activeRound = round;
      break;
    }
  }

  // 4. Udenfor alle vinduer → stop
  if (!activeRoundKey) {
    console.log(`Udenfor rundevindue (nu: ${now.toISOString()}) – springer over`);
    process.exit(0);
  }

  console.log(`Aktiv runde: ${activeRound.label} | Vindue: ${activeRound.start} → ${activeRound.end}`);

  // 5. Hent spillere
  const playersSnap = await db.ref("players").once("value");
  const players = playersSnap.val() || {};

  // 6. Deduplikér latest.json (samme logik som AppScript)
  const dedup = new Map();
  for (const x of latest) {
    const name = String(x.fullName || "").trim();
    const growth = Number(x.growth);
    if (!name || !Number.isFinite(growth)) continue;
    if (!dedup.has(name.toLowerCase())) {
      dedup.set(name.toLowerCase(), { name, growth });
    }
  }

  // 7. Byg opdateringer
  const updates = {};
  let updated = 0;
  let notFound = 0;

  for (const { name, growth } of dedup.values()) {
    const safeKey = name.replace(/[.#$\/\[\]]/g, "_");
    const playerKey = players[name] ? name : players[safeKey] ? safeKey : null;
    if (!playerKey) { notFound++; continue; }

    const playerData = players[playerKey];
    updates[`players/${playerKey}/roundGrowth/${activeRoundKey}`] = growth;

    // Genberegn totalvækst
    const existing = playerData.roundGrowth || {};
    let total = 0;
    for (const [rk, val] of Object.entries(existing)) {
      total += rk === activeRoundKey ? growth : (val || 0);
    }
    if (!(activeRoundKey in existing)) total += growth;
    updates[`players/${playerKey}/totalGrowth`] = total;
    updated++;
  }

  // 8. Skriv til Firebase
  if (Object.keys(updates).length > 0) {
    await db.ref().update(updates);
    console.log(`✓ Opdaterede ${updated} spillere for ${activeRound.label}`);
  }
  if (notFound > 0) console.log(`  (${notFound} spillere ikke fundet i Firebase)`);

  // 9. Opdater rundens status automatisk i Firebase så websitet kan vise det korrekt
  const statusUpdates = {};
  for (const [key, round] of Object.entries(rounds)) {
    const start = new Date(round.start);
    const end = new Date(round.end);
    let newStatus;
    if (now >= start && now <= end) newStatus = "active";
    else if (now > end) newStatus = "done";
    else newStatus = "upcoming";

    if (round.status !== newStatus) {
      statusUpdates[`rounds/${key}/status`] = newStatus;
      console.log(`  Runde ${key}: ${round.status} → ${newStatus}`);
    }
  }
  if (Object.keys(statusUpdates).length > 0) {
    await db.ref().update(statusUpdates);
    console.log(`✓ Opdaterede ${Object.keys(statusUpdates).length} runde-statuser automatisk`);
  }

  await db.ref("meta/lastSync").set(now.toISOString());
  console.log("✓ Sync færdig");
  process.exit(0);
}

sync().catch(err => {
  console.error("Fejl under sync:", err);
  process.exit(1);
});
