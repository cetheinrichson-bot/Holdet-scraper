// Scraper til Holdet.dk – klikker korrekt på "Statistik" efter at have accepteret cookies,
// udtrækker spillere { fullName, growth } fra DOM/streamet HTML, og gemmer i data/latest.json.

import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const START_URL = 'https://www.holdet.dk/da/fantasy/super-manager-spring-2026';

// Robust brugeragent (minder om almindelig Chrome)
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/121.0.0.0 Safari/537.36';

function extractPlayersFromText(s) {
  const out = [];
  const push = (n, g) => {
    const name = (n || '').trim();
    const gr = Number(g);
    if (name && Number.isFinite(gr)) out.push({ fullName: name, growth: gr });
  };

  // (A) person.fullName ... growth
  let m;
  const reA = /"person"\s*:\s*\{[^}]*?"fullName"\s*:\s*"([^"]+)"[\s\S]{1,1500}?"growth"\s*:\s*(-?\d+)/g;
  while ((m = reA.exec(s)) !== null) push(m[1], m[2]);

  // (B) growth ... person.fullName
  const reB = /"growth"\s*:\s*(-?\d+)[\s\S]{1,1500}?"person"\s*:\s*\{[^}]*?"fullName"\s*:\s*"([^"]+)"/g;
  while ((m = reB.exec(s)) !== null) push(m[2], m[1]);

  // (C) fullName ... growth
  const reC = /"fullName"\s*:\s*"([^"]+)"[\s\S]{1,1500}?"growth"\s*:\s*(-?\d+)/g;
  while ((m = reC.exec(s)) !== null) push(m[1], m[2]);

  // Dedupe på navn
  const seen = new Map();
  for (const p of out) {
    const key = p.fullName.toLowerCase();
    if (!seen.has(key)) seen.set(key, p);
  }
  return Array.from(seen.values());
}

async function acceptCookiesIfPresent(page) {
  // Vent et øjeblik – Cookiebot kommer typisk asynkront
  await page.waitForTimeout(1000);

  // Prøv specifikke Cookiebot-knapper først (hvis de findes)
  const knownButtons = [
    '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll',
    '#CybotCookiebotDialogBodyButtonAccept' // alternativ id på nogle sites
  ];

  for (const sel of knownButtons) {
    const btn = page.locator(sel);
    if (await btn.first().isVisible().catch(() => false)) {
      await btn.first().click({ timeout: 5000 }).catch(() => {});
      // Vent på, at dialogen forsvinder
      await page.waitForTimeout(500);
      return;
    }
  }

  // Fallback: find en knap med tekst
  const labels = [
    /Tillad alle/i,
    /Accepter alle/i,
    /Accept all/i,
    /Allow all/i,
    /Accept/i
  ];

  for (const re of labels) {
    const btn = page.getByRole('button', { name: re }).first();
    if (await btn.isVisible().catch(() => false)) {
      await btn.click({ timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(500);
      return;
    }
  }
}

async function clickStatisticsMenu(page) {
  // 1) Prøv et link i header, der peger mod /statistics
  const headerStat = page.locator('header a[href*="/statistics"]').first();
  if (await headerStat.isVisible().catch(() => false)) {
    await headerStat.click({ timeout: 10000 });
    return;
  }

  // 2) Prøv et anker med tekst "Statistik" i header
  const headerText = page.locator('header').getByRole('link', { name: /Statistik/i }).first();
  if (await headerText.isVisible().catch(() => false)) {
    await headerText.click({ timeout: 10000 });
    return;
  }

  // 3) Prøv et generelt link (uden for Cookiebot-dialogen)
  // Udeluk elementer inde i cookie-dialogen (#CybotCookiebotDialog ...)
  // ved at vælge det første synlige link med "Statistik", som ikke er inde i dialogen.
  const allLinks = page.getByRole('link', { name: /Statistik/i });
  const count = await allLinks.count();
  for (let i = 0; i < count; i++) {
    const link = allLinks.nth(i);
    const visible = await link.isVisible().catch(() => false);
    if (!visible) continue;

    // Tjek at linket ikke ligger inde i cookie-dialogen
    const inDialog = await link.locator('#CybotCookiebotDialog, [id^="CybotCookiebotDialog"]').count();
    if (inDialog > 0) continue;

    await link.click({ timeout: 10000 }).catch(() => {});
    return;
  }

  // 4) Sidste udvej: navigér direkte til statistik‑ruten hvis muligt
  // (Hvis siden bruger et andet menunavn eller lazy-load)
  try {
    const direct = await page.$('a[href*="/statistics"]');
    if (direct) {
      await direct.click({ timeout: 10000 });
      return;
    }
  } catch {}
}

async function waitForGrowthInDom(page) {
  // Vent på at der er "growth" i DOM/HTML – det er vores heuristik for at data er indlæst
  await page.waitForFunction(
    () => /"growth":-?\d+/.test(document.documentElement.innerHTML),
    { timeout: 60000 }
  );
}

async function run() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ userAgent: UA });
  const page = await ctx.newPage();

  // 1) Gå til landing
  await page.goto(START_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });

  // 2) Accepter cookies hvis boksen er synlig
  await acceptCookiesIfPresent(page);

  // 3) Klik korrekt "Statistik"-menulink (ikke cookieboksen)
  await clickStatisticsMenu(page);

  // 4) Vent på at data er lastet (heuristik: "growth" i DOM)
  await waitForGrowthInDom(page);

  // 5) Udtræk hele HTML og parse
  const html = await page.content();
  const players = extractPlayersFromText(html);

  await browser.close();

  // 6) Skriv output til data/latest.json og marker om der er ændring
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

run().catch(err => {
  console.error(err);
  process.exit(1);
});
