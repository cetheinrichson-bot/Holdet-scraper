/**
 * scrape-positions.cjs
 * Henter position og klub for alle spillere fra holdet.dk
 */

const { chromium } = require("playwright");
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

const STATS_URL = "https://nexus-app-fantasy-fargate.holdet.dk/da/super-manager-fall-2026/soccer/statistics";
const posMap = { 1:"MÅL", 2:"FOR", 3:"MID", 4:"ANG" };

async function run() {
  console.log("Starter browser...");
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  // Gem alle JSON responses
  const allResponses = [];
  page.on("response", async (response) => {
    const ct = response.headers()["content-type"] || "";
    if (!ct.includes("json")) return;
    try {
      const json = await response.json();
      allResponses.push({ url: response.url(), data: json });
    } catch {}
  });

  console.log("Henter siden...");
  await page.goto(STATS_URL, { waitUntil: "networkidle", timeout: 90000 });
  await page.waitForTimeout(8000);

  // Log alle JSON responses for debugging
  console.log(`\nFangede ${allResponses.length} JSON responses:`);
  for (const r of allResponses) {
    const dataStr = JSON.stringify(r.data).slice(0, 200);
    console.log(`  ${r.url.slice(0, 100)}: ${dataStr}`);
  }

  // Prøv at hente fra window.__NEXT_DATA__ eller lignende
  const pageData = await page.evaluate(() => {
    // Prøv Next.js data
    if (window.__NEXT_DATA__) return JSON.stringify(window.__NEXT_DATA__).slice(0, 5000);
    // Prøv React query cache
    const reactQuery = window.__REACT_QUERY_STATE__;
    if (reactQuery) return JSON.stringify(reactQuery).slice(0, 5000);
    return null;
  });
  
  if (pageData) {
    console.log("\nPage data fundet:", pageData.slice(0, 500));
  }

  // Prøv scroll og vent
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(3000);

  // Tag screenshot til debugging
  await page.screenshot({ path: "debug.png" });
  console.log("\nScreenshot gemt som debug.png");

  // Hent HTML
  const html = await page.content();
  console.log(`HTML længde: ${html.length}`);
  
  // Gem HTML sample
  fs.writeFileSync("debug.html", html.slice(0, 50000));
  console.log("HTML sample gemt som debug.html");

  await browser.close();
  process.exit(0);
}

run().catch(e => { console.error(e); process.exit(1); });
