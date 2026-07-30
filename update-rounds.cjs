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

// VIGTIGT: "end" er sat til ca. 2 timer efter rundens SIDSTE kamp.
// Star rundevinduet aabent laengere, naar holdet.dk at nulstille vaeksten
// mens vi stadig scraper - og saa overskrives rundens resultater med 0.
const rounds = {
  r1: { label:"Runde 1", start:"2026-07-24T19:00:00+02:00", end:"2026-07-27T21:00:00+02:00", waiverEnd:"2026-07-28T09:00:00+02:00", status:"upcoming" },
  r2: { label:"Runde 2", start:"2026-08-01T18:00:00+02:00", end:"2026-08-03T21:00:00+02:00", waiverEnd:"2026-08-04T09:00:00+02:00", status:"upcoming" },
  r3: { label:"Runde 3", start:"2026-08-07T19:00:00+02:00", end:"2026-08-10T21:00:00+02:00", waiverEnd:"2026-08-11T09:00:00+02:00", status:"upcoming" },
  r4: { label:"Runde 4", start:"2026-08-14T19:00:00+02:00", end:"2026-08-17T21:00:00+02:00", waiverEnd:"2026-08-18T09:00:00+02:00", status:"upcoming" },
  r5: { label:"Runde 5", start:"2026-08-21T19:00:00+02:00", end:"2026-08-24T21:00:00+02:00", waiverEnd:"2026-08-25T09:00:00+02:00", status:"upcoming" },
  r6: { label:"Runde 6", start:"2026-08-28T19:00:00+02:00", end:"2026-08-31T21:00:00+02:00", waiverEnd:"2026-09-01T09:00:00+02:00", status:"upcoming" },
  r7: { label:"Runde 7", start:"2026-09-02T19:00:00+02:00", end:"2026-09-07T21:00:00+02:00", waiverEnd:"2026-09-08T09:00:00+02:00", status:"upcoming" },
  r8: { label:"Runde 8", start:"2026-09-12T19:00:00+02:00", end:"2026-09-13T18:00:00+02:00", waiverEnd:"2026-09-14T09:00:00+02:00", status:"upcoming" },
  r9: { label:"Runde 9", start:"2026-09-19T19:00:00+02:00", end:"2026-09-20T18:00:00+02:00", waiverEnd:"2026-09-21T09:00:00+02:00", status:"upcoming" },
  r10: { label:"Runde 10", start:"2026-10-10T19:00:00+02:00", end:"2026-10-11T18:00:00+02:00", waiverEnd:"2026-10-12T09:00:00+02:00", status:"upcoming" },
  r11: { label:"Runde 11", start:"2026-10-17T19:00:00+02:00", end:"2026-10-18T18:00:00+02:00", waiverEnd:"2026-10-19T09:00:00+02:00", status:"upcoming" },
  r12: { label:"Runde 12", start:"2026-10-24T19:00:00+02:00", end:"2026-10-25T18:00:00+01:00", waiverEnd:"2026-10-26T09:00:00+01:00", status:"upcoming" },
  r13: { label:"Runde 13", start:"2026-10-31T19:00:00+01:00", end:"2026-11-01T18:00:00+01:00", waiverEnd:"2026-11-02T09:00:00+01:00", status:"upcoming" },
  r14: { label:"Runde 14", start:"2026-11-07T19:00:00+01:00", end:"2026-11-08T18:00:00+01:00", waiverEnd:"2026-11-09T09:00:00+01:00", status:"upcoming" },
  r15: { label:"Runde 15", start:"2026-11-21T19:00:00+01:00", end:"2026-11-22T18:00:00+01:00", waiverEnd:"2026-11-23T09:00:00+01:00", status:"upcoming" },
  r16: { label:"Runde 16", start:"2026-11-28T19:00:00+01:00", end:"2026-11-29T18:00:00+01:00", waiverEnd:"2026-11-30T09:00:00+01:00", status:"upcoming" },
  r17: { label:"Runde 17", start:"2026-12-05T19:00:00+01:00", end:"2026-12-06T18:00:00+01:00", waiverEnd:"2026-12-07T09:00:00+01:00", status:"upcoming" },
};

async function run() {
  // Bevar eksisterende status saa afsluttede runder ikke bliver "upcoming" igen
  const snap = await db.ref("rounds").once("value");
  const old = snap.val() || {};
  const now = new Date();
  for (const [k, r] of Object.entries(rounds)) {
    const s = new Date(r.start), e = new Date(r.end);
    r.status = now > e ? "done" : (now >= s ? "active" : "upcoming");
  }

  await db.ref("rounds").set(rounds);
  console.log("OK - 17 runder opdateret med korrekte sluttider\n");
  for (const [k, r] of Object.entries(rounds)) {
    const mark = r.status === "active" ? "  <-- AKTIV" : "";
    console.log("  " + k + " [" + r.status + "] " + r.start + " -> " + r.end + mark);
  }
  process.exit(0);
}

run().catch(e => { console.error(e); process.exit(1); });
