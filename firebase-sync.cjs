/**
 * firebase-sync.cjs v4
 *
 * Tre opgaver:
 * 1. Opdater spilleres roundGrowth/totalGrowth fra latest.json (kun inden for tidsvindue)
 * 2. Opdater rundestatusser automatisk baseret på tidspunkt
 * 3. Når en runde netop er SLUT: gem rundescores som snapshots for alle managere
 *    Snapshot = sum af roundGrowth[rk] for de 11 spillere i managerens gemte opstilling
 *    Snapshots overskrives ALDRIG – selv hvis spillere skifter trup efterfølgende
 */

const admin = require("firebase-admin");
const fs = require("fs");
const path = require("path");

const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
if (!serviceAccountJson) { console.error("Mangler FIREBASE_SERVICE_ACCOUNT_JSON"); process.exit(1); }

admin.initializeApp({
  credential: admin.credential.cert(JSON.parse(serviceAccountJson)),
  databaseURL: process.env.FIREBASE_DATABASE_URL,
});

const db = admin.database();

async function sync() {
  const now = new Date();

  // ── Hent al data ──
  const [roundsSnap, playersSnap, managersSnap] = await Promise.all([
    db.ref("rounds").once("value"),
    db.ref("players").once("value"),
    db.ref("managers").once("value"),
  ]);
  const rounds   = roundsSnap.val()   || {};
  const players  = playersSnap.val()  || {};
  const managers = managersSnap.val() || {};

  const updates = {};

  // ── 1. Opdater rundestatusser automatisk ──
  for (const [key, round] of Object.entries(rounds)) {
    const start = new Date(round.start);
    const end   = new Date(round.end);
    let newStatus;
    if      (now >= start && now <= end) newStatus = "active";
    else if (now > end)                  newStatus = "done";
    else                                 newStatus = "upcoming";

    if (round.status !== newStatus) {
      updates[`rounds/${key}/status`] = newStatus;
      console.log(`  Runde ${key}: ${round.status} → ${newStatus}`);
    }
  }

  // ── 2. Find aktiv runde (inden for tidsvindue) ──
  let activeRoundKey = null;
  let activeRound    = null;
  for (const [key, round] of Object.entries(rounds)) {
    const start = new Date(round.start);
    const end   = new Date(round.end);
    if (now >= start && now <= end) {
      activeRoundKey = key;
      activeRound    = round;
      break;
    }
  }

  // ── 3. Opdater spillervækst fra latest.json (kun inden for aktivt vindue) ──
  const dataPath = path.join(__dirname, "data", "latest.json");
  if (activeRoundKey && fs.existsSync(dataPath)) {
    const latest = JSON.parse(fs.readFileSync(dataPath, "utf8"));
    console.log(`Aktiv runde: ${activeRound.label} – opdaterer ${latest.length} spillere`);

    const dedup = new Map();
    for (const x of latest) {
      const name   = String(x.fullName || "").trim();
      const growth = Number(x.growth);
      if (!name || !Number.isFinite(growth)) continue;
      if (!dedup.has(name.toLowerCase())) dedup.set(name.toLowerCase(), { name, growth });
    }

    let updated = 0, notFound = 0;
    for (const { name, growth } of dedup.values()) {
      const safeKey  = name.replace(/[.#$\/\[\]]/g, "_");
      const playerKey = players[name] ? name : players[safeKey] ? safeKey : null;
      if (!playerKey) { notFound++; continue; }

      updates[`players/${playerKey}/roundGrowth/${activeRoundKey}`] = growth;

      const existing = players[playerKey].roundGrowth || {};
      let total = 0;
      for (const [rk, val] of Object.entries(existing)) {
        total += rk === activeRoundKey ? growth : (val || 0);
      }
      if (!(activeRoundKey in existing)) total += growth;
      updates[`players/${playerKey}/totalGrowth`] = total;
      updated++;
    }
    console.log(`✓ Opdaterede ${updated} spillere (${notFound} ikke fundet)`);
  } else if (!activeRoundKey) {
    console.log(`Udenfor rundevindue (${now.toISOString()}) – springer spilleropdatering over`);
  }

  // ── 4. Gem rundescores som snapshots for runder der NETOP er afsluttet ──
  // "Netop afsluttet" = runden sluttede inden for de seneste 2 timer
  // og der ikke allerede er et snapshot gemt
  for (const [roundKey, round] of Object.entries(rounds)) {
    const end = new Date(round.end);
    const msSinceEnd = now - end;

    // Kun runder der er slut inden for de seneste 2 timer
    if (msSinceEnd < 0 || msSinceEnd > 2 * 60 * 60 * 1000) continue;

    console.log(`Runde ${roundKey} netop afsluttet – gemmer rundescores som snapshots`);

    for (const [managerName, managerData] of Object.entries(managers)) {
      if (managerData.isAdmin) continue;

      // Tjek om snapshot allerede eksisterer
      if (managerData.roundScores?.[roundKey] !== undefined) {
        console.log(`  ${managerName}: snapshot allerede gemt, springer over`);
        continue;
      }

      // Hent gemt opstilling for denne runde
      const lineupData = managerData.lineup?.[roundKey];
      const starters   = lineupData?.starters || [];

      if (!starters.length) {
        console.log(`  ${managerName}: ingen gemt opstilling for ${roundKey} – bruger trup`);
        // Fallback: brug alle spillere der tilhørte manageren (kan ikke rekonstrueres præcist)
        // Gem 0 som placeholder så vi ikke prøver igen
        updates[`managers/${managerName}/roundScores/${roundKey}`] = 0;
        continue;
      }

      // Beregn score som sum af roundGrowth[roundKey] for de 11 startspillere
      let score = 0;
      for (const playerName of starters) {
        const safeKey   = playerName.replace(/[.#$\/\[\]]/g, "_");
        const playerKey = players[playerName] ? playerName : players[safeKey] ? safeKey : null;
        if (!playerKey) continue;
        score += players[playerKey]?.roundGrowth?.[roundKey] || 0;
      }

      updates[`managers/${managerName}/roundScores/${roundKey}`] = score;
      console.log(`  ✓ ${managerName}: ${roundKey} score = ${score}`);
    }
  }

  // ── Skriv alle opdateringer til Firebase ──
  if (Object.keys(updates).length > 0) {
    await db.ref().update(updates);
    console.log(`✓ Skrev ${Object.keys(updates).length} opdateringer til Firebase`);
  }

  await db.ref("meta/lastSync").set(now.toISOString());
  console.log("✓ Sync færdig");
  process.exit(0);
}

sync().catch(err => { console.error("Fejl:", err); process.exit(1); });
