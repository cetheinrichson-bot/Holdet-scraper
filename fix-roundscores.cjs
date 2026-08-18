/**
 * fix-roundscores.cjs  (v2)
 *
 * 1. Genberegner roundScores for AFSLUTTEDE runder
 * 2. SLETTER roundScores for igangvaerende/kommende runder, saa
 *    hjemmesiden regner live i stedet for at vise et frosset tal
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
    return { score: s, kilde: "gemt opstilling" };
  }

  const formation = managers[manager]?.lineup?.[rnd]?.formation || "4-3-3";
  const [d, m, a] = FORMATIONS[formation] || FORMATIONS["4-3-3"];
  const need = { "MÅL":1, "FOR":d, "MID":m, "ANG":a };
  const byPos = { "MÅL":[], "FOR":[], "MID":[], "ANG":[] };
  for (const p of Object.values(players)) {
    if (p.owner === manager && byPos[p.position]) byPos[p.position].push(p);
  }
  let s = 0;
  for (const pos of Object.keys(need)) {
    for (const p of byPos[pos].slice(0, need[pos])) s += p.roundGrowth?.[rnd] || 0;
  }
  return { score: s, kilde: "standardopstilling (" + formation + ")" };
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
  const fmt = v => (v >= 0 ? "+" : "") + Math.round(v / 1000) + "k";

  const alle = Object.entries(rounds).sort((a,b) => parseInt(a[0].slice(1)) - parseInt(b[0].slice(1)));
  const afsluttede = alle.filter(([, r]) => new Date(r.end) < now).map(([k]) => k);
  const aabne      = alle.filter(([, r]) => new Date(r.end) >= now).map(([k]) => k);

  console.log("Afsluttede runder (faar fast score): " + (afsluttede.join(", ") || "ingen"));
  console.log("Aabne runder (skal regnes live)    : " + (aabne.join(", ") || "ingen") + "\n");

  const updates = {};
  let rettet = 0, frigivet = 0;

  // 1) Fast score paa afsluttede runder
  for (const rnd of afsluttede) {
    console.log("--- " + rnd + " (afsluttet) ---");
    for (const [mgr, md] of Object.entries(managers)) {
      if (md.isAdmin) continue;
      const gammel = md.roundScores?.[rnd];
      const { score, kilde } = scoreFor(mgr, rnd, players, managers);
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

  // 2) Fjern frosne tal fra aabne runder
  for (const rnd of aabne) {
    for (const [mgr, md] of Object.entries(managers)) {
      if (md.isAdmin) continue;
      if (md.roundScores?.[rnd] !== undefined) {
        updates["managers/" + mgr + "/roundScores/" + rnd] = null;
        frigivet++;
        console.log("FRIGIVET " + rnd + " " + mgr + ": fjerner frosset " +
                    fmt(md.roundScores[rnd]) + " -> regnes nu live");
      }
    }
  }

  if (!rettet && !frigivet) {
    console.log("Ingen aendringer noedvendige.");
  } else {
    await db.ref().update(updates);
    console.log("\nOK - rettede " + rettet + " scorer, frigav " + frigivet + " til live-beregning.");
  }
  process.exit(0);
}

run().catch(e => { console.error(e); process.exit(1); });
