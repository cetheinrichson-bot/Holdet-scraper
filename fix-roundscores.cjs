/**
 * fix-roundscores.cjs
 * Genberegner roundScores for alle managers og alle afsluttede runder.
 *
 * Retter fejlen hvor en manager uden gemt opstilling fik gemt 0 point,
 * i stedet for point fra standardopstillingen.
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

const FORMATIONS = {
  "4-3-3":[4,3,3], "4-4-2":[4,4,2], "4-5-1":[4,5,1],
  "3-4-3":[3,4,3], "3-5-2":[3,5,2], "5-4-1":[5,4,1], "5-3-2":[5,3,2],
};

// Samme logik som hjemmesiden: gemt opstilling, ellers foerste spillere pr. position
function scoreFor(manager, rnd, players, managers) {
  const saved = managers[manager]?.lineup?.[rnd]?.starters;
  const nameToKey = {};
  for (const [k, p] of Object.entries(players)) if (p.fullName) nameToKey[p.fullName] = k;

  if (saved && saved.length) {
    let s = 0;
    for (const n of saved) {
      const k = nameToKey[n];
      s += (k && players[k]?.roundGrowth?.[rnd]) || 0;
    }
    return { score: s, kilde: "gemt opstilling (" + saved.length + " spillere)" };
  }

  const formation = managers[manager]?.lineup?.[rnd]?.formation || "4-3-3";
  const [d, m, a] = FORMATIONS[formation] || FORMATIONS["4-3-3"];
  const need = { "MÅL":1, "FOR":d, "MID":m, "ANG":a };
  const byPos = { "MÅL":[], "FOR":[], "MID":[], "ANG":[] };
  for (const p of Object.values(players)) {
    if (p.owner === manager && byPos[p.position]) byPos[p.position].push(p);
  }
  let s = 0, n = 0;
  for (const pos of Object.keys(need)) {
    for (const p of byPos[pos].slice(0, need[pos])) {
      s += p.roundGrowth?.[rnd] || 0;
      n++;
    }
  }
  return { score: s, kilde: "standardopstilling (" + n + " spillere, " + formation + ")" };
}

async function run() {
  const [pSnap, mSnap, rSnap] = await Promise.all([
    db.ref("players").once("value"),
    db.ref("managers").once("value"),
    db.ref("rounds").once("value"),
  ]);
  const players  = pSnap.val() || {};
  const managers = mSnap.val() || {};
  const rounds   = rSnap.val() || {};

  const now = new Date();
  const relevante = Object.entries(rounds)
    .filter(([, r]) => new Date(r.start) <= now)
    .sort((a, b) => parseInt(a[0].slice(1)) - parseInt(b[0].slice(1)))
    .map(([k]) => k);

  console.log("Runder der genberegnes: " + relevante.join(", ") + "\n");

  const updates = {};
  let rettet = 0;

  for (const rnd of relevante) {
    console.log("--- " + rnd + " ---");
    for (const [mgr, md] of Object.entries(managers)) {
      if (md.isAdmin) continue;
      const gammel = md.roundScores?.[rnd];
      const { score, kilde } = scoreFor(mgr, rnd, players, managers);
      const fmt = v => (v >= 0 ? "+" : "") + Math.round(v / 1000) + "k";

      if (gammel === score) {
        console.log("  " + mgr + ": " + fmt(score) + " (uaendret)");
      } else {
        updates["managers/" + mgr + "/roundScores/" + rnd] = score;
        rettet++;
        console.log("  " + mgr + ": " + (gammel === undefined ? "(ingen)" : fmt(gammel)) +
                    " -> " + fmt(score) + "   [" + kilde + "]");
      }
    }
    console.log("");
  }

  if (rettet === 0) {
    console.log("Ingen aendringer noedvendige.");
  } else {
    await db.ref().update(updates);
    console.log("OK - rettede " + rettet + " rundescorer.");
  }
  process.exit(0);
}

run().catch(e => { console.error(e); process.exit(1); });
