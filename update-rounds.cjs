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

const rounds = {
  r1: { label:"Runde 1", start:"2026-07-24T19:00:00", end:"2026-07-29T21:00:00", waiverEnd:"2026-07-30T09:00:00", status:"upcoming" },
  r2: { label:"Runde 2", start:"2026-08-01T18:00:00", end:"2026-08-05T21:00:00", waiverEnd:"2026-08-06T09:00:00", status:"upcoming" },
  r3: { label:"Runde 3", start:"2026-08-07T19:00:00", end:"2026-08-12T21:00:00", waiverEnd:"2026-08-13T09:00:00", status:"upcoming" },
  r4: { label:"Runde 4", start:"2026-08-14T19:00:00", end:"2026-08-19T21:00:00", waiverEnd:"2026-08-20T09:00:00", status:"upcoming" },
  r5: { label:"Runde 5", start:"2026-08-21T19:00:00", end:"2026-08-26T21:00:00", waiverEnd:"2026-08-27T09:00:00", status:"upcoming" },
  r6: { label:"Runde 6", start:"2026-08-28T19:00:00", end:"2026-09-02T21:00:00", waiverEnd:"2026-09-03T09:00:00", status:"upcoming" },
  r7: { label:"Runde 7", start:"2026-09-02T19:00:00", end:"2026-09-09T21:00:00", waiverEnd:"2026-09-10T09:00:00", status:"upcoming" },
  r8: { label:"Runde 8", start:"2026-09-12T19:00:00", end:"2026-09-15T21:00:00", waiverEnd:"2026-09-16T09:00:00", status:"upcoming" },
  r9: { label:"Runde 9", start:"2026-09-19T19:00:00", end:"2026-09-22T21:00:00", waiverEnd:"2026-09-23T09:00:00", status:"upcoming" },
  r10: { label:"Runde 10", start:"2026-10-10T19:00:00", end:"2026-10-13T21:00:00", waiverEnd:"2026-10-14T09:00:00", status:"upcoming" },
  r11: { label:"Runde 11", start:"2026-10-17T19:00:00", end:"2026-10-20T21:00:00", waiverEnd:"2026-10-21T09:00:00", status:"upcoming" },
  r12: { label:"Runde 12", start:"2026-10-24T19:00:00", end:"2026-10-27T21:00:00", waiverEnd:"2026-10-28T09:00:00", status:"upcoming" },
  r13: { label:"Runde 13", start:"2026-10-31T19:00:00", end:"2026-11-03T21:00:00", waiverEnd:"2026-11-04T09:00:00", status:"upcoming" },
  r14: { label:"Runde 14", start:"2026-11-07T19:00:00", end:"2026-11-10T21:00:00", waiverEnd:"2026-11-11T09:00:00", status:"upcoming" },
  r15: { label:"Runde 15", start:"2026-11-21T19:00:00", end:"2026-11-24T21:00:00", waiverEnd:"2026-11-25T09:00:00", status:"upcoming" },
  r16: { label:"Runde 16", start:"2026-11-28T19:00:00", end:"2026-12-01T21:00:00", waiverEnd:"2026-12-02T09:00:00", status:"upcoming" },
  r17: { label:"Runde 17", start:"2026-12-05T19:00:00", end:"2026-12-08T21:00:00", waiverEnd:"2026-12-09T09:00:00", status:"upcoming" },
};

async function run() {
  console.log("Sletter gamle runder...");
  await db.ref("rounds").remove();
  console.log("Skriver 17 nye runder...");
  await db.ref("rounds").set(rounds);
  console.log("✓ Færdig! 17 runder opdateret.");
  Object.entries(rounds).forEach(([k,r]) => console.log(`  ${k}: ${r.start} → ${r.end}`));
  process.exit(0);
}

run().catch(e => { console.error(e); process.exit(1); });
