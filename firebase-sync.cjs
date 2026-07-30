/**
 * firebase-sync.cjs v6
 * 1. Opdater spillervækst fra latest.json (kun inden for aktivt rundevindue)
 * 2. Opdater rundestatusser automatisk
 * 3. Gem rundescores som snapshots når en runde netop er afsluttet
 * 4. Behandl waiver-krav automatisk når runden slutter
 *
 * NYT i v6: Overskriver ALDRIG en registreret værdi med 0.
 * Holdet.dk nulstiller væksten når deres runde slutter. Hvis vores rundevindue
 * stadig er åbent, ville vi ellers slette hele rundens resultater.
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
  const [roundsSnap, playersSnap, managersSnap, waiversSnap] = await Promise.all([
    db.ref("rounds").once("value"),
    db.ref("players").once("value"),
    db.ref("managers").once("value"),
    db.ref("waivers").once("value"),
  ]);
  const rounds   = roundsSnap.val()   || {};
  const players  = playersSnap.val()  || {};
  const managers = managersSnap.val() || {};
  const waivers  = waiversSnap.val()  || {};

  const updates = {};

  // ── 1. Opdater rundestatusser ──
  for (const [key, round] of Object.entries(rounds)) {
    const start = new Date(round.start);
    const end   = new Date(round.end);
    let newStatus = now >= start && now <= end ? "active" : now > end ? "done" : "upcoming";
    if (round.status !== newStatus) {
      updates[`rounds/${key}/status`] = newStatus;
      console.log(`  Runde ${key}: ${round.status} → ${newStatus}`);
    }
  }

  // ── 2. Find aktiv runde ──
  let activeRoundKey = null;
  for (const [key, round] of Object.entries(rounds)) {
    const start = new Date(round.start);
    const end   = new Date(round.end);
    if (now >= start && now <= end) { activeRoundKey = key; break; }
  }

  // ── 3. Opdater spillervækst ──
  const dataPath = path.join(__dirname, "data", "latest.json");
  if (activeRoundKey && fs.existsSync(dataPath)) {
    const latest = JSON.parse(fs.readFileSync(dataPath, "utf8"));
    console.log(`Aktiv runde: ${rounds[activeRoundKey].label} – opdaterer ${latest.length} spillere`);

    const dedup = new Map();
    for (const x of latest) {
      const name = String(x.fullName || "").trim();
      const growth = Number(x.growth);
      if (!name || !Number.isFinite(growth)) continue;
      if (!dedup.has(name.toLowerCase())) dedup.set(name.toLowerCase(), { name, growth });
    }

    // Sikkerhedstjek: er ALT nul, mens vi allerede har registreret vaerdier?
    // Saa har holdet.dk nulstillet - spring hele opdateringen over.
    const allZero = [...dedup.values()].every(p => p.growth === 0);
    let hadValues = false;
    for (const p of Object.values(players)) {
      if (p.roundGrowth && p.roundGrowth[activeRoundKey]) { hadValues = true; break; }
    }
    if (allZero && hadValues) {
      console.log(`⚠ Alle vaerdier er 0, men ${activeRoundKey} har allerede data.`);
      console.log(`  Holdet.dk har nulstillet - springer spilleropdatering over for at beskytte data.`);
    } else {
      let updated = 0, notFound = 0, protectedCount = 0;
      for (const { name, growth } of dedup.values()) {
        const safeKey  = name.replace(/[.#$\/\[\]]/g, "_");
        const playerKey = players[name] ? name : players[safeKey] ? safeKey : null;
        if (!playerKey) { notFound++; continue; }

        const existing = players[playerKey].roundGrowth || {};
        const prev = existing[activeRoundKey];

        // BESKYTTELSE: overskriv aldrig en registreret vaerdi med 0
        if (growth === 0 && prev !== undefined && prev !== 0) {
          protectedCount++;
          continue;
        }

        updates[`players/${playerKey}/roundGrowth/${activeRoundKey}`] = growth;

        let total = 0;
        for (const [rk, val] of Object.entries(existing)) {
          total += rk === activeRoundKey ? growth : (val || 0);
        }
        if (!(activeRoundKey in existing)) total += growth;
        updates[`players/${playerKey}/totalGrowth`] = total;
        updated++;
      }
      console.log(`✓ Opdaterede ${updated} spillere (${notFound} ikke fundet, ${protectedCount} beskyttet mod nulstilling)`);
    }
  } else if (!activeRoundKey) {
    console.log(`Ingen aktiv runde – springer spilleropdatering over`);
  }

  // ── 4. Gem rundescores + behandl waivers for netop afsluttede runder ──
  for (const [roundKey, round] of Object.entries(rounds)) {
    const end = new Date(round.end);
    const waiverEnd = round.waiverEnd ? new Date(round.waiverEnd) : end;
    const msSinceWaiverEnd = now - waiverEnd;
    if (msSinceWaiverEnd < 0 || msSinceWaiverEnd > 2 * 60 * 60 * 1000) continue;

    console.log(`\nRunde ${roundKey} waiver-deadline passeret`);

    for (const [managerName, managerData] of Object.entries(managers)) {
      if (managerData.isAdmin) continue;
      if (managerData.roundScores?.[roundKey] !== undefined) continue;
      const starters = managerData.lineup?.[roundKey]?.starters || [];
      let score = 0;
      for (const playerName of starters) {
        const safeKey = playerName.replace(/[.#$\/\[\]]/g, "_");
        const playerKey = players[playerName] ? playerName : players[safeKey] ? safeKey : null;
        if (!playerKey) continue;
        score += players[playerKey]?.roundGrowth?.[roundKey] || 0;
      }
      updates[`managers/${managerName}/roundScores/${roundKey}`] = score;
      console.log(`  ✓ ${managerName}: ${roundKey} score = ${score}`);
    }

    const pendingWaivers = Object.entries(waivers)
      .filter(([, w]) => w.round === roundKey && w.status === 'pending')
      .sort((a, b) => a[1].priority - b[1].priority);

    if (pendingWaivers.length > 0) {
      console.log(`\nBehandler ${pendingWaivers.length} waiver-krav for ${roundKey}...`);
      const claimedPlayers = new Set();
      const currentOwners = {};
      for (const [key, p] of Object.entries(players)) {
        currentOwners[key] = p.owner || 'Ledig';
      }

      for (const [waiverKey, waiver] of pendingWaivers) {
        const { manager, wantPlayer, dropPlayer } = waiver;
        const wantSafe = wantPlayer.replace(/[.#$\/\[\]]/g, "_");
        const wantKey  = players[wantPlayer] ? wantPlayer : players[wantSafe] ? wantSafe : null;
        const dropSafe = dropPlayer.replace(/[.#$\/\[\]]/g, "_");
        const dropKey  = players[dropPlayer] ? dropPlayer : players[dropSafe] ? dropSafe : null;

        if (!wantKey) {
          console.log(`  ✗ ${manager}: ${wantPlayer} ikke fundet i databasen`);
          updates[`waivers/${waiverKey}/status`] = 'failed';
          continue;
        }

        const currentOwner = currentOwners[wantKey] || 'Ledig';
        if (currentOwner !== 'Ledig' || claimedPlayers.has(wantKey)) {
          console.log(`  ✗ ${manager}: ${wantPlayer} er ikke ledig (ejes af ${currentOwner})`);
          updates[`waivers/${waiverKey}/status`] = 'failed_unavailable';
          continue;
        }

        claimedPlayers.add(wantKey);
        updates[`players/${wantKey}/owner`] = manager;
        currentOwners[wantKey] = manager;

        if (dropKey) {
          updates[`players/${dropKey}/owner`] = 'Ledig';
          currentOwners[dropKey] = 'Ledig';
          console.log(`  ✓ ${manager}: henter ${wantPlayer}, smider ${dropPlayer}`);
        } else {
          console.log(`  ✓ ${manager}: henter ${wantPlayer} (drop-spiller ikke fundet)`);
        }

        updates[`waivers/${waiverKey}/status`] = 'completed';
        updates[`waivers/${waiverKey}/processedAt`] = now.toISOString();
      }

      for (const [waiverKey] of pendingWaivers) {
        if (!updates[`waivers/${waiverKey}/status`]) {
          updates[`waivers/${waiverKey}/status`] = 'cancelled';
        }
      }
    }
  }

  if (Object.keys(updates).length > 0) {
    await db.ref().update(updates);
    console.log(`\n✓ Skrev ${Object.keys(updates).length} opdateringer til Firebase`);
  }

  await db.ref("meta/lastSync").set(now.toISOString());
  console.log("✓ Sync færdig:", now.toISOString());
  process.exit(0);
}

sync().catch(err => { console.error("Fejl:", err); process.exit(1); });
