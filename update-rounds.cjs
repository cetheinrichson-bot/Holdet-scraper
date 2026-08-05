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

// start/end  = pointvinduet (hvornaar der scrapes) - skal matche holdet.dk's runde
// waiverEnd  = hvornaar waiver-perioden slutter og spillere bliver frie
// r6 rummer de to udskudte kampe 2.+3. sep, praecis som paa holdet.dk
// r10-r17 er skoen (fre 19 - man 21) indtil officielle tider offentliggoeres
const rounds = {
  r1: { label:"Runde 1", start:"2026-07-24T19:00:00+02:00", end:"2026-07-27T21:00:00+02:00", waiverEnd:"2026-07-28T09:00:00+02:00" },
  r2: { label:"Runde 2", start:"2026-08-01T18:00:00+02:00", end:"2026-08-03T21:00:00+02:00", waiverEnd:"2026-08-04T09:00:00+02:00" },
  r3: { label:"Runde 3", start:"2026-08-07T19:00:00+02:00", end:"2026-08-10T21:00:00+02:00", waiverEnd:"2026-08-11T09:00:00+02:00" },
  r4: { label:"Runde 4", start:"2026-08-14T19:00:00+02:00", end:"2026-08-17T21:00:00+02:00", waiverEnd:"2026-08-18T09:00:00+02:00" },
  r5: { label:"Runde 5", start:"2026-08-21T19:00:00+02:00", end:"2026-08-24T21:00:00+02:00", waiverEnd:"2026-08-25T09:00:00+02:00" },
  r6: { label:"Runde 6", start:"2026-08-28T19:00:00+02:00", end:"2026-09-03T22:00:00+02:00", waiverEnd:"2026-09-04T09:00:00+02:00" },
  r7: { label:"Runde 7", start:"2026-09-04T19:00:00+02:00", end:"2026-09-07T21:00:00+02:00", waiverEnd:"2026-09-08T09:00:00+02:00" },
  r8: { label:"Runde 8", start:"2026-09-11T19:00:00+02:00", end:"2026-09-14T21:00:00+02:00", waiverEnd:"2026-09-15T09:00:00+02:00" },
  r9: { label:"Runde 9", start:"2026-09-18T19:00:00+02:00", end:"2026-09-20T20:00:00+02:00", waiverEnd:"2026-09-21T09:00:00+02:00" },
  r10: { label:"Runde 10", start:"2026-10-09T19:00:00+02:00", end:"2026-10-12T21:00:00+02:00", waiverEnd:"2026-10-13T09:00:00+02:00" },
  r11: { label:"Runde 11", start:"2026-10-16T19:00:00+02:00", end:"2026-10-19T21:00:00+02:00", waiverEnd:"2026-10-20T09:00:00+02:00" },
  r12: { label:"Runde 12", start:"2026-10-23T19:00:00+02:00", end:"2026-10-26T21:00:00+01:00", waiverEnd:"2026-10-27T09:00:00+01:00" },
  r13: { label:"Runde 13", start:"2026-10-30T19:00:00+01:00", end:"2026-11-02T21:00:00+01:00", waiverEnd:"2026-11-03T09:00:00+01:00" },
  r14: { label:"Runde 14", start:"2026-11-06T19:00:00+01:00", end:"2026-11-09T21:00:00+01:00", waiverEnd:"2026-11-10T09:00:00+01:00" },
  r15: { label:"Runde 15", start:"2026-11-20T19:00:00+01:00", end:"2026-11-23T21:00:00+01:00", waiverEnd:"2026-11-24T09:00:00+01:00" },
  r16: { label:"Runde 16", start:"2026-11-27T19:00:00+01:00", end:"2026-11-30T21:00:00+01:00", waiverEnd:"2026-12-01T09:00:00+01:00" },
  r17: { label:"Runde 17", start:"2026-12-04T19:00:00+01:00", end:"2026-12-07T21:00:00+01:00", waiverEnd:"2026-12-08T09:00:00+01:00" },
};

async function run() {
  const now = new Date();
  for (const r of Object.values(rounds)) {
    const s = new Date(r.start), e = new Date(r.end);
    r.status = now > e ? "done" : (now >= s ? "active" : "upcoming");
  }

  await db.ref("rounds").set(rounds);
  console.log("OK - 17 runder opdateret\n");

  let aktiv = null, waiver = null;
  for (const [k, r] of Object.entries(rounds)) {
    if (r.status === "active") aktiv = k;
    if (now >= new Date(r.start) && now <= new Date(r.waiverEnd)) waiver = k;
    const mark = r.status === "active" ? "   <-- AKTIV" : "";
    console.log("  " + k + " [" + r.status + "] " + r.start.slice(0,16) + " -> " + r.end.slice(0,16) + mark);
  }

  console.log("\nLIGE NU:");
  console.log("  Pointscraping : " + (aktiv ? aktiv + " er aktiv" : "ingen aktiv runde"));
  console.log("  Waiver-periode: " + (waiver ? "JA (" + waiver + ") - spillere kan kun hentes via waiver"
                                             : "NEJ - spillere er frie (first come, first served)"));
  process.exit(0);
}

run().catch(e => { console.error(e); process.exit(1); });
