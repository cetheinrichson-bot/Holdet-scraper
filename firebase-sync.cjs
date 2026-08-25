/**
 * firebase-sync.cjs v9
 * 1. Opdater spillervækst fra latest.json (kun inden for aktivt rundevindue)
 * 2. Opdater rundestatusser automatisk
 * 3. Gem rundescores som snapshots når en runde netop er afsluttet
 * 4. Behandl waiver-krav automatisk når runden slutter
 *
 * NYT i v9: Waivers koeres NFL-stil i omgange, praecis som paa hjemmesiden,
 *            med prioritet = omvendt ligastilling.
 * NYT i v8: Samme spiller kan kun smides een gang pr. waiver-koersel.
 * NYT i v7: Bruger standardopstilling hvis manageren ikke har gemt hold.
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
      let kilde = "gemt opstilling";

      if (starters.length > 0) {
        for (const playerName of starters) {
          const safeKey = playerName.replace(/[.#$\/\[\]]/g, "_");
          const playerKey = players[playerName] ? playerName : players[safeKey] ? safeKey : null;
          if (!playerKey) continue;
          score += players[playerKey]?.roundGrowth?.[roundKey] || 0;
        }
      } else {
        // INGEN gemt opstilling: brug standardopstillingen (samme logik som hjemmesiden).
        // Ellers ville manageren faa gemt 0 point permanent.
        const FORMATIONS = {
          "4-3-3":[4,3,3], "4-4-2":[4,4,2], "4-5-1":[4,5,1],
          "3-4-3":[3,4,3], "3-5-2":[3,5,2], "5-4-1":[5,4,1], "5-3-2":[5,3,2],
        };
        const formation = managerData.lineup?.[roundKey]?.formation || "4-3-3";
        const [d, m, a] = FORMATIONS[formation] || FORMATIONS["4-3-3"];
        const need = { "MÅL":1, "FOR":d, "MID":m, "ANG":a };
        const byPos = { "MÅL":[], "FOR":[], "MID":[], "ANG":[] };
        for (const p of Object.values(players)) {
          if (p.owner === managerName && byPos[p.position]) byPos[p.position].push(p);
        }
        let n = 0;
        for (const pos of Object.keys(need)) {
          for (const p of byPos[pos].slice(0, need[pos])) {
            score += p.roundGrowth?.[roundKey] || 0;
            n++;
          }
        }
        kilde = `standardopstilling (${n} spillere, ${formation})`;
      }

      updates[`managers/${managerName}/roundScores/${roundKey}`] = score;
      console.log(`  ✓ ${managerName}: ${roundKey} score = ${score}  [${kilde}]`);
    }

    const pendingWaivers = Object.entries(waivers)
      .filter(([, w]) => w.round === roundKey && w.status === 'pending');

    if (pendingWaivers.length > 0) {
      console.log(`\nBehandler ${pendingWaivers.length} waiver-krav for ${roundKey}...`);

      // ── Prioritet = OMVENDT ligastilling (samme beregning som hjemmesiden) ──
      const mgrs = Object.keys(managers).filter(m => !managers[m].isAdmin);
      const ligaPts = {};
      mgrs.forEach(m => ligaPts[m] = 0);
      Object.keys(rounds)
        .sort((a, b) => parseInt(a.slice(1)) - parseInt(b.slice(1)))
        .forEach(rk => {
          if (rounds[rk].status === 'upcoming') return;
          const sc = mgrs.map(m => ({
            m,
            s: managers[m]?.roundScores?.[rk] !== undefined
                 ? managers[m].roundScores[rk]
                 : 0
          })).sort((a, b) => b.s - a.s);
          sc.forEach(({ m }, i) => { ligaPts[m] += (mgrs.length - i); });
        });
      const totalFor = m => Object.values(players)
        .filter(p => p.owner === m)
        .reduce((a, p) => a + (p.totalGrowth || 0), 0);
      const standing = [...mgrs].sort((a, b) =>
        (ligaPts[b] - ligaPts[a]) || (totalFor(b) - totalFor(a)));
      const priorityOrder = [...standing].reverse();

      console.log(`  Stilling : ${standing.join(' > ')}`);
      console.log(`  Prioritet: ${priorityOrder.join(' > ')}\n`);

      // ── Koe pr. manager, i den raekkefoelge kravene blev indsendt ──
      const byMgr = {};
      for (const [k, w] of pendingWaivers) {
        (byMgr[w.manager] = byMgr[w.manager] || []).push([k, w]);
      }
      for (const m of Object.keys(byMgr)) {
        byMgr[m].sort((a, b) => (a[1].priority || 99) - (b[1].priority || 99));
      }

      const claimedPlayers = new Set();
      const droppedPlayers = new Set();
      const currentOwners = {};
      for (const [key, p] of Object.entries(players)) {
        currentOwners[key] = p.owner || 'Ledig';
      }

      // ── NFL-stil: hver manager faar HOEJST eet krav igennem pr. omgang ──
      for (let omgang = 0; omgang < 10; omgang++) {
        let nogenFik = false;

        for (const manager of priorityOrder) {
          const q = byMgr[manager];
          if (!q || !q.length) continue;

          while (q.length) {
            const [waiverKey, waiver] = q[0];
            const wantPlayer = waiver.wantPlayer || waiver.playerIn;
            const dropPlayer = waiver.dropPlayer || waiver.playerOut;

            const wantSafe = String(wantPlayer).replace(/[.#$\/\[\]]/g, "_");
            const wantKey  = players[wantPlayer] ? wantPlayer : players[wantSafe] ? wantSafe : null;
            const dropSafe = dropPlayer ? String(dropPlayer).replace(/[.#$\/\[\]]/g, "_") : null;
            const dropKey  = dropPlayer
              ? (players[dropPlayer] ? dropPlayer : players[dropSafe] ? dropSafe : null)
              : null;

            if (!wantKey) {
              console.log(`  ✗ ${manager}: ${wantPlayer} findes ikke`);
              updates[`waivers/${waiverKey}/status`] = 'failed';
              q.shift(); continue;
            }
            if (dropKey && droppedPlayers.has(dropKey)) {
              console.log(`  ✗ ${manager}: ${dropPlayer} er allerede smidt`);
              updates[`waivers/${waiverKey}/status`] = 'failed_duplicate_drop';
              q.shift(); continue;
            }
            const owner = currentOwners[wantKey] || 'Ledig';
            if (owner !== 'Ledig' || claimedPlayers.has(wantKey)) {
              console.log(`  ✗ ${manager}: ${wantPlayer} ikke ledig`);
              updates[`waivers/${waiverKey}/status`] = 'failed_unavailable';
              q.shift(); continue;
            }

            claimedPlayers.add(wantKey);
            if (dropKey) droppedPlayers.add(dropKey);
            updates[`players/${wantKey}/owner`] = manager;
            currentOwners[wantKey] = manager;
            if (dropKey) {
              updates[`players/${dropKey}/owner`] = 'Ledig';
              currentOwners[dropKey] = 'Ledig';
            }
            updates[`waivers/${waiverKey}/status`] = 'completed';
            updates[`waivers/${waiverKey}/processedAt`] = now.toISOString();
            console.log(`  ✓ ${manager} (omgang ${omgang + 1}): henter ${wantPlayer}` +
                        (dropPlayer ? `, smider ${dropPlayer}` : ''));
            q.shift(); nogenFik = true;
            break;   // naeste manager faar tur
          }
        }
        if (!nogenFik) break;
      }

      for (const q of Object.values(byMgr)) {
        for (const [waiverKey] of q) {
          if (!updates[`waivers/${waiverKey}/status`]) {
            updates[`waivers/${waiverKey}/status`] = 'cancelled';
          }
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
