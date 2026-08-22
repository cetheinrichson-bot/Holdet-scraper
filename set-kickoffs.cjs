/**
 * set-kickoffs.cjs
 * Opretter clubKickoffs - bruges til at laase spillere naar klubbens kamp er startet.
 * r1-r9 er officielle tider. r10-r17 er skoen indtil de offentliggoeres.
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

function tz(ts) {
  return ts + (new Date(ts + "+02:00") < new Date("2026-10-25T03:00:00+02:00") ? "+02:00" : "+01:00");
}

const KEYS = {
  viborg:      ["viborg"],
  ob:          ["ob", "odense"],
  agf:         ["agf"],
  brondby:     ["brøndby", "brondby"],
  sonderjyske: ["sønderjyske", "sonderjyske", "syske"],
  midtjylland: ["midtjylland"],
  kobenhavn:   ["københav", "koebenhavn", "kobenhavn", "f.c. k", "fck"],
  lyngby:      ["lyngby"],
  horsens:     ["horsens"],
  nordsjalland:["nordsjælland", "nordsjaelland"],
  randers:     ["randers"],
  silkeborg:   ["silkeborg"],
};

const SCHEDULE = {
  r1: [
    ["2026-07-24T19:00:00","viborg","ob"],
    ["2026-07-25T18:00:00","agf","brondby"],
    ["2026-07-26T14:00:00","sonderjyske","midtjylland"],
    ["2026-07-26T16:00:00","kobenhavn","lyngby"],
    ["2026-07-26T18:00:00","horsens","nordsjalland"],
    ["2026-07-27T19:00:00","randers","silkeborg"],
  ],
  r2: [
    ["2026-08-01T18:00:00","lyngby","agf"],
    ["2026-08-02T14:00:00","midtjylland","horsens"],
    ["2026-08-02T14:00:00","nordsjalland","randers"],
    ["2026-08-02T16:00:00","brondby","viborg"],
    ["2026-08-02T18:00:00","silkeborg","kobenhavn"],
    ["2026-08-03T19:00:00","ob","sonderjyske"],
  ],
  r3: [
    ["2026-08-07T19:00:00","sonderjyske","viborg"],
    ["2026-08-09T16:00:00","randers","lyngby"],
    ["2026-08-09T18:00:00","horsens","brondby"],
    ["2026-08-10T19:00:00","silkeborg","ob"],
  ],
  r4: [
    ["2026-08-14T19:00:00","viborg","agf"],
    ["2026-08-16T14:00:00","ob","horsens"],
    ["2026-08-16T14:00:00","nordsjalland","silkeborg"],
    ["2026-08-16T16:00:00","lyngby","midtjylland"],
    ["2026-08-16T18:00:00","randers","kobenhavn"],
    ["2026-08-17T19:00:00","brondby","sonderjyske"],
  ],
  r5: [
    ["2026-08-23T12:00:00","sonderjyske","nordsjalland"],
    ["2026-08-23T14:00:00","agf","ob"],
    ["2026-08-23T14:05:00","midtjylland","randers"],
    ["2026-08-23T16:00:00","horsens","lyngby"],
    ["2026-08-23T18:00:00","viborg","kobenhavn"],
    ["2026-08-24T19:00:00","brondby","silkeborg"],
  ],
  r6: [
    ["2026-08-28T19:00:00","horsens","viborg"],
    ["2026-08-30T14:00:00","lyngby","ob"],
    ["2026-08-30T14:00:00","silkeborg","midtjylland"],
    ["2026-08-30T16:00:00","randers","agf"],
    ["2026-08-30T18:00:00","nordsjalland","brondby"],
    ["2026-08-31T19:00:00","kobenhavn","sonderjyske"],
    ["2026-09-02T20:00:00","agf","midtjylland"],
    ["2026-09-03T20:00:00","kobenhavn","nordsjalland"],
  ],
  r7: [
    ["2026-09-04T19:00:00","viborg","lyngby"],
    ["2026-09-05T18:00:00","agf","silkeborg"],
    ["2026-09-06T14:00:00","sonderjyske","horsens"],
    ["2026-09-06T16:00:00","ob","kobenhavn"],
    ["2026-09-06T18:00:00","brondby","randers"],
    ["2026-09-07T19:00:00","midtjylland","nordsjalland"],
  ],
  r8: [
    ["2026-09-11T19:00:00","kobenhavn","horsens"],
    ["2026-09-13T14:00:00","lyngby","sonderjyske"],
    ["2026-09-13T14:00:00","silkeborg","viborg"],
    ["2026-09-13T16:00:00","randers","ob"],
    ["2026-09-13T18:00:00","nordsjalland","agf"],
    ["2026-09-14T19:00:00","midtjylland","brondby"],
  ],
  r9: [
    ["2026-09-18T19:00:00","lyngby","silkeborg"],
    ["2026-09-19T18:00:00","ob","midtjylland"],
    ["2026-09-20T14:00:00","sonderjyske","randers"],
    ["2026-09-20T14:00:00","brondby","kobenhavn"],
    ["2026-09-20T16:00:00","horsens","agf"],
    ["2026-09-20T18:00:00","viborg","nordsjalland"],
  ]
};

// r10-r17: skoen (loerdag kl 16) indtil officielle tider kendes
const SAT = { r10:"2026-10-10", r11:"2026-10-17", r12:"2026-10-24", r13:"2026-10-31",
              r14:"2026-11-07", r15:"2026-11-21", r16:"2026-11-28", r17:"2026-12-05" };
const ALL = Object.keys(KEYS);
for (const [rk, date] of Object.entries(SAT)) {
  SCHEDULE[rk] = [];
  for (let i = 0; i < ALL.length; i += 2) {
    SCHEDULE[rk].push([date + "T16:00:00", ALL[i], ALL[i+1]]);
  }
}

function keyFor(name) {
  return "club_" + name.replace(/[^a-zA-Z0-9æøåÆØÅ]/g, "_");
}

async function run() {
  const snap = await db.ref("players").once("value");
  const players = snap.val() || {};
  const clubs = [...new Set(Object.values(players).map(p => p.club).filter(Boolean))];

  const resolved = {};
  for (const [id, words] of Object.entries(KEYS)) {
    const m = clubs.find(c => words.some(w => c.toLowerCase().includes(w)));
    if (m) resolved[id] = m;
    else console.log("ADVARSEL: ingen klub matchede '" + id + "'");
  }
  console.log("Matchede " + Object.keys(resolved).length + " af 12 klubber\n");

  const updates = {};
  let total = 0;
  for (const [rk, matches] of Object.entries(SCHEDULE)) {
    const earliest = {};
    for (const [ts, a, b] of matches) {
      for (const id of [a, b]) {
        const club = resolved[id];
        if (!club) continue;
        if (!earliest[club] || ts < earliest[club]) earliest[club] = ts;
      }
    }
    for (const [club, ts] of Object.entries(earliest)) {
      updates["clubKickoffs/" + rk + "/" + keyFor(club)] = tz(ts);
      total++;
    }
  }

  await db.ref("clubKickoffs").remove();
  await db.ref().update(updates);
  console.log("Skrev " + total + " kickoff-tidspunkter\n");

  for (const rk of ["r5", "r6"]) {
    console.log("Runde " + rk.slice(1) + ":");
    Object.entries(updates)
      .filter(([k]) => k.startsWith("clubKickoffs/" + rk + "/"))
      .sort((a, b) => a[1].localeCompare(b[1]))
      .forEach(([k, v]) => console.log("   " + k.split("/")[2].replace("club_", "").padEnd(18) + v.slice(0, 16)));
    console.log("");
  }
  console.log("OK - faerdig!");
  process.exit(0);
}

run().catch(e => { console.error(e); process.exit(1); });
