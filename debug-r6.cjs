/**
 * debug-r6.cjs  - LAESER KUN, aendrer intet
 * Undersoeger hvorfor de udskudte kampe 2.+3. sep ikke er talt med i r6.
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

// Klubberne i de udskudte kampe: AGF-FCM (2/9) og FCK-FCN (3/9)
const UDSKUDT = ["agf", "midtjylland", "købe", "koeben", "nordsj"];

async function run() {
  const [pS, rS, mS, metaS] = await Promise.all([
    db.ref("players").once("value"),
    db.ref("rounds").once("value"),
    db.ref("managers").once("value"),
    db.ref("meta").once("value"),
  ]);
  const players = pS.val() || {};
  const rounds  = rS.val() || {};
  const managers= mS.val() || {};
  const meta    = metaS.val() || {};

  console.log("=== RUNDE-OPSAETNING ===");
  for (const rk of ["r5","r6","r7"]) {
    const r = rounds[rk];
    if (!r) { console.log("  " + rk + ": MANGLER"); continue; }
    console.log("  " + rk + " [" + (r.status||"?") + "]  " + r.start + "  ->  " + r.end);
    console.log("        waiverEnd: " + r.waiverEnd);
  }
  console.log("\n  Sidste sync: " + (meta.lastSync || "ukendt"));
  console.log("  Tid nu     : " + new Date().toISOString());

  console.log("\n=== SPILLERE FRA DE UDSKUDTE KAMPE (r6) ===");
  const berort = [], andre = [];
  for (const p of Object.values(players)) {
    if (!p.club) continue;
    const c = p.club.toLowerCase();
    const erBerort = UDSKUDT.some(k => c.includes(k));
    (erBerort ? berort : andre).push(p);
  }

  const vis = (liste, titel) => {
    console.log("\n" + titel + ":");
    const byClub = {};
    for (const p of liste) (byClub[p.club] = byClub[p.club] || []).push(p);
    for (const [club, ps] of Object.entries(byClub)) {
      const medVaerdi = ps.filter(p => (p.roundGrowth?.r6 || 0) !== 0);
      const sum = ps.reduce((a,p) => a + (p.roundGrowth?.r6 || 0), 0);
      console.log("  " + club.padEnd(20) + ps.length + " spillere, " +
                  medVaerdi.length + " med r6-vaerdi, sum " +
                  (sum>=0?"+":"") + Math.round(sum/1000) + "k");
    }
  };
  vis(berort, "Klubber med udskudt kamp");
  vis(andre.slice(0, 200), "Oevrige klubber (til sammenligning)");

  console.log("\n=== EKSEMPLER (r5/r6/r7 pr. spiller) ===");
  const eks = berort.filter(p => p.owner && p.owner !== "Ledig").slice(0, 8);
  for (const p of eks) {
    const g = p.roundGrowth || {};
    const f = v => v === undefined ? "  -  " : ((v>=0?"+":"") + Math.round(v/1000) + "k").padStart(6);
    console.log("  " + (p.fullName||"").padEnd(26) + (p.club||"").padEnd(18) +
                " r5:" + f(g.r5) + "  r6:" + f(g.r6) + "  r7:" + f(g.r7));
  }

  console.log("\n=== MANAGERNES r6-SCORE ===");
  for (const [m, md] of Object.entries(managers)) {
    if (md.isAdmin) continue;
    const s = md.roundScores?.r6;
    console.log("  " + m.padEnd(12) + (s === undefined ? "ikke gemt (regnes live)"
                : ((s>=0?"+":"") + Math.round(s/1000) + "k  (fast gemt)")));
  }

  process.exit(0);
}
run().catch(e => { console.error(e); process.exit(1); });
