/**
 * firebase-sync.cjs v5
 * 1. Opdater spillervækst fra latest.json (kun inden for aktivt rundevindue)
 * 2. Opdater rundestatusser automatisk
 * 3. Gem rundescores som snapshots når en runde netop er afsluttet
 * 4. Behandl waiver-krav automatisk når runden slutter
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
    console.log(`Ingen aktiv runde – springer spilleropdatering over`);
  }

  // ── 4. Gem rundescores + behandl waivers for netop afsluttede runder ──
  for (const [roundKey, round] of Object.entries(rounds)) {
    const end = new Date(round.end);
    // Brug waiverEnd til at afgøre hvornår snapshots og waivers behandles
    const waiverEnd = round.waiverEnd ? new Date(round.waiverEnd) : end;
    const msSinceWaiverEnd = now - waiverEnd;
    if (msSinceWaiverEnd < 0 || msSinceWaiverEnd > 2 * 60 * 60 * 1000) continue;

    console.log(`\nRunde ${roundKey} waiver-deadline passeret`);

    // Gem rundescores
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

    // Behandl waiver-krav for denne runde
    const pendingWaivers = Object.entries(waivers)
      .filter(([, w]) => w.round === roundKey && w.status === 'pending')
      .sort((a, b) => a[1].priority - b[1].priority); // Lavest prioritet nummer = højest prioritet

    if (pendingWaivers.length > 0) {
      console.log(`\nBehandler ${pendingWaivers.length} waiver-krav for ${roundKey}...`);

      // Hold styr på hvilke spillere der allerede er tildelt i denne kørsel
      const claimedPlayers = new Set();
      // Hent aktuel player ownership (inkl. ændringer fra updates)
      const currentOwners = {};
      for (const [key, p] of Object.entries(players)) {
        currentOwners[key] = p.owner || 'Ledig';
      }

      for (const [waiverKey, waiver] of pendingWaivers) {
        const { manager, wantPlayer, dropPlayer } = waiver;

        // Find player keys
        const wantSafe = wantPlayer.replace(/[.#$\/\[\]]/g, "_");
        const wantKey  = players[wantPlayer] ? wantPlayer : players[wantSafe] ? wantSafe : null;
        const dropSafe = dropPlayer.replace(/[.#$\/\[\]]/g, "_");
        const dropKey  = players[dropPlayer] ? dropPlayer : players[dropSafe] ? dropSafe : null;

        if (!wantKey) {
          console.log(`  ✗ ${manager}: ${wantPlayer} ikke fundet i databasen`);
          updates[`waivers/${waiverKey}/status`] = 'failed';
          continue;
        }

        // Tjek om spilleren stadig er ledig og ikke allerede clamet
        const currentOwner = currentOwners[wantKey] || 'Ledig';
        if (currentOwner !== 'Ledig' || claimedPlayers.has(wantKey)) {
          console.log(`  ✗ ${manager}: ${wantPlayer} er ikke ledig (ejes af ${currentOwner})`);
          updates[`waivers/${waiverKey}/status`] = 'failed_unavailable';
          continue;
        }

        // Gennemfør waiver
        claimedPlayers.add(wantKey);
        updates[`players/${wantKey}/owner`] = manager;
        currentOwners[wantKey] = manager;

        // Smid drop-spilleren
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

      // Annullér resterende pending waivers for denne runde
      for (const [waiverKey, waiver] of pendingWaivers) {
        if (!updates[`waivers/${waiverKey}/status`]) {
          updates[`waivers/${waiverKey}/status`] = 'cancelled';
        }
      }
    }
  }

  // ── Skriv til Firebase ──
  if (Object.keys(updates).length > 0) {
    await db.ref().update(updates);
    console.log(`\n✓ Skrev ${Object.keys(updates).length} opdateringer til Firebase`);
  }

  await db.ref("meta/lastSync").set(now.toISOString());
  console.log("✓ Sync færdig:", now.toISOString());
  process.exit(0);
}

sync().catch(err => { console.error("Fejl:", err); process.exit(1); });
