// Scraper – robust mod Cookiebot og RSC: lytter på network response (text/x-component)
// og parser spillerdata { fullName, growth } direkte fra stream-teksten.

import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const START_URL = 'https://www.holdet.dk/da/fantasy/super-manager-spring-2026';

// Almindelig Chrome UA for at undgå eventuelle blocks
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/121.0.0.0 Safari/537.36';

// --- Parsing af RSC-tekst ---
function extractPlayersFromText(s) {
  const out = [];
  const push = (n, g) => {
    const name = (n || '').trim();
    const gr = Number(g);
    if (name && Number.isFinite(gr)) out.push({ fullName: name, growth: gr });
  };

  let m;
  // (A) person.fullName ... growth
  const reA = /"person"\s*:\s*\{[^}]*?"fullName"\s*:\s*"([^"]+)"[\s\S]{1,2000}?"growth"\s*:\s*(-?\d+)/g;
  while ((m = reA.exec(s)) !== null) push(m[1], m[2]);

  // (B) growth ... person.fullName
  const reB = /"growth"\s*:\s*(-?\d+)[\s\S]{1,2000}?"person"\s*:\s*\{[^}]*?"fullName"\s*:\s*"([^"]+)"/g;
  while ((m = reB.exec(s)) !== null) push(m[2], m[1]);

  // (C) fullName ... growth
  const reC = /"fullName"\s*:\s*"([^"]+)"[\s\S]{1,2000}?"growth"\s*:\s*(-?\d+)/g;
  while ((m = reC.exec(s)) !== null) push(m[1], m[2]);

  // dedupe på navn
  const seen = new Map();
  for (const p of out) {
    const key = p.fullName.toLowerCase();
    if (!seen.has(key)) seen.set(key, p);
  }
  return Array.from(seen.values());
}

// --- Cookiebot: acceptér hvis dialogen er synlig ---
async function acceptCookiesIfPresent(page) {
  // Vent kort så dialogen kan nå at dukke op
  await page.waitForTimeout(800);

  const buttonSelectors = [
    '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll',
    '#CybotCookiebotDialogBodyButtonAccept',
  ];
  for (const sel of buttonSelectors) {
    const btn = page.locator(sel).first();
    if (await btn.isVisible().catch(() => false)) {
      await btn.click({ timeout: 4000 }).catch(() => {});
      await page.waitForTimeout(300);
      return;
    }
  }

  const labels = [/Tillad alle/i, /Accepter alle/i, /Accept all/i, /Allow all/i, /Accept/i];
  for (const re of labels) {
    const btn = page.getByRole('button', { name: re }).first();
    if (await btn.isVisible().catch(() => false)) {
      await btn.click({ timeout: 4000 }).catch(() => {});
      await page.waitForTimeout(300);
      return;
    }
  }
}

// --- Klik på det rigtige menulink til Statistik (ikke cookie-tekster) ---
async function clickStatisticsMenu(page) {
  // 1) Link i header der peger mod /statistics
  const headerStat = page.locator('header a[href*="/statistics"]').first();
  if (await headerStat.isVisible().catch(() => false)) {
    await headerStat.click({ timeout: 10000 });
    return;
  }

  // 2) Link i header med tekst "Statistik"
  const headerText = page.locator('header').getByRole('link', { name: /Statistik/i }).first();
  if (await headerText.isVisible().catch(() => false)) {
    await headerText.click({ timeout: 10000 });
    return;
  }

  // 3) Generelt link med “Statistik” uden for cookie-dialogen
  const allLinks = page.getByRole('link', { name: /Statistik/i });
  const count = await allLinks.count();
  for (let i = 0; i < count; i++) {
    const link = allLinks.nth(i);
    const visible = await link.isVisible().catch(() => false);
    if (!visible) continue;
    // Undgå Cookiebot-dialogen
    const inDialog = await link.locator('#CybotCookiebotDialog, [id^="CybotCookiebotDialog"]').count();
    if (inDialog > 0) continue;

    await link.click({ timeout: 10000 }).catch(() => {});
    return;
  }

  // 4) Fallback: navigér direkte til statistik-URL’en (kan være på nexus-domain, men linkes fra holdet.dk)
  try {
    const direct = await page.$('a[href*="/statistics"]');
    if (direct) {
      await direct.click({ timeout: 10000 });
      return;
    }
  } catch {}
}

// --- Vent på RSC- eller data-response fra “statistics” ---
async function waitForStatisticsRSC(page, timeoutMs = 60000) {
  // Vi fanger det første response, hvis URL indeholder “statistics”
  // og/eller content-type siger x-component (RSC). Hvis ct ikke kan læses,
  // tager vi stadig teksten og kigger efter "growth".
  const response = await page.waitForResponse(async (resp) => {
    const url = resp.url() || '';
    if (!/statistics/i.test(url)) return false;
    const headers = resp.headers() || {};
    const ct = (headers['content-type'] || headers['Content-Type'] || '').toLowerCase();
    if (ct.includes('text/x-component') || ct.includes('application/x-component')) return true;
    // ellers: accepter også, hvis svaret indeholder growth (hurtigt check)
    try {
      const txt = await resp.text();
      return /"growth":-?\d+/.test(txt);
    } catch {
      return false;
    }
  }, { timeout: timeoutMs }).catch(() => null);

  if (!response) return null;

  try {
    return await response.text();
  } catch {
    return null;
  }
}

async function run() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ userAgent: UA });
  const page = await ctx.newPage();

  // 1) Gå til landing
  await page.goto(START_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });

  // 2) Accepter cookies
  await acceptCookiesIfPresent(page);

  // 3) Klik “Statistik”
  await clickStatisticsMenu(page);

  // 4) Vent på RSC-respons med data (eller hvad der ligner)
  let rscText = await waitForStatisticsRSC(page, 60000);

  // 5) Ekstra fallback: hvis ingen RSC fanget, så prøv at vente kort og tag HTML’en
  if (!rscText) {
    await page.waitForTimeout(2000);
    const html = await page.content();
    if (/"growth":-?\d+/.test(html)) rscText = html;
  }

  // 6) Parse tekst → spillere
  const players = rscText ? extractPlayersFromText(rscText) : [];
  // Luk browser
  await browser.close();

  // 7) Skriv output & marker ændring
  const outDir = path.join('data');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'latest.json');

  const payload = JSON.stringify(players, null, 2);
  let changed = true;

  if (fs.existsSync(outPath)) {
    const prev = fs.readFileSync(outPath, 'utf8');
    changed = prev !== payload;
  }

  fs.writeFileSync(outPath, payload);
  fs.writeFileSync(path.join(outDir, 'changed.flag'), changed ? '1' : '0');
}

// Kør
run().catch(err => {
  console.error(err);
  // skriv changed.flag = 0, så workflow ikke fejler i commit-steppet
  try {
    const outDir = path.join('data');
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'changed.flag'), '0');
  } catch {}
  process.exit(1);
});
