// Scraper – robust: accepterer cookies, finder statistik-iframe URL, henter dens tekst direkte,
// parser spillere { fullName, growth } og gemmer i data/latest.json + debug_info.txt.

import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const START_URL = 'https://www.holdet.dk/da/fantasy/super-manager-spring-2026';
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
  let m;
  const reA = /"person"\s*:\s*\{[^}]*?"fullName"\s*:\s*"([^"]+)"[\s\S]{1,2000}?"growth"\s*:\s*(-?\d+)/g;
  while ((m = reA.exec(s)) !== null) push(m[1], m[2]);
  const reB = /"growth"\s*:\s*(-?\d+)[\s\S]{1,2000}?"person"\s*:\s*\{[^}]*?"fullName"\s*:\s*"([^"]+)"/g;
  while ((m = reB.exec(s)) !== null) push(m[2], m[1]);
  const reC = /"fullName"\s*:\s*"([^"]+)"[\s\S]{1,2000}?"growth"\s*:\s*(-?\d+)/g;
  while ((m = reC.exec(s)) !== null) push(m[1], m[2]);
  const seen = new Map();
  for (const p of out) {
    const key = p.fullName.toLowerCase();
    if (!seen.has(key)) seen.set(key, p);
  }
  return Array.from(seen.values());
}

async function acceptCookiesIfPresent(page) {
  await page.waitForTimeout(800);
  const ids = [
    '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll',
    '#CybotCookiebotDialogBodyButtonAccept',
  ];
  for (const sel of ids) {
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

async function goToStatistics(page) {
  // forsøg 1: header-link mod /statistics
  const headerStat = page.locator('header a[href*="/statistics"]').first();
  if (await headerStat.isVisible().catch(() => false)) {
    await headerStat.click({ timeout: 10000 });
    return;
  }
  // forsøg 2: link med tekst "Statistik" i header
  const headerText = page.locator('header').getByRole('link', { name: /Statistik/i }).first();
  if (await headerText.isVisible().catch(() => false)) {
    await headerText.click({ timeout: 10000 });
    return;
  }
  // forsøg 3: et hvilket som helst synligt link "Statistik" uden for cookiedialog
  const links = page.getByRole('link', { name: /Statistik/i });
  const count = await links.count();
  for (let i = 0; i < count; i++) {
    const link = links.nth(i);
    if (!(await link.isVisible().catch(() => false))) continue;
    const inDialog = await link.locator('#CybotCookiebotDialog, [id^="CybotCookiebotDialog"]').count();
    if (inDialog > 0) continue;
    await link.click({ timeout: 10000 }).catch(() => {});
    return;
  }
  // fallback 4: direkte klik på et <a href*="/statistics">
  const direct = await page.$('a[href*="/statistics"]');
  if (direct) await direct.click({ timeout: 10000 }).catch(() => {});
}

function ensureOutDir() {
  const outDir = path.join('data');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  return outDir;
}

async function run() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ userAgent: UA });
  const page = await ctx.newPage();

  await page.goto(START_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await acceptCookiesIfPresent(page);
  await goToStatistics(page);

  // --- NYT: find statistik-iframe (eller under-dokument) og hent dens URL direkte ---
  // Vi leder efter en frame hvis URL indeholder "/statistics"
  // og henter så rå-teksten via page.request.get(frame.url()) for at parse derfra.
  let rscText = '';
  // give app tid til at loade iframes / router
  await page.waitForTimeout(2000);

  // 1) Prøv alle frames
  const frames = page.frames();
  for (const f of frames) {
    const fu = (f.url() || '').toString();
    if (/\/statistics/i.test(fu)) {
      try {
        const resp = await page.request.get(fu, {
          headers: { 'Accept': '*/*', 'Referer': START_URL, 'User-Agent': UA }
        });
        if (resp.ok()) {
          rscText = await resp.text();
          if (/"growth":-?\d+/.test(rscText)) break; // ok
        }
      } catch {}
    }
  }

  // 2) Hvis intet fundet: let efter links til /statistics i DOM og prøv GET
  if (!rscText) {
    const hrefs = await page.$$eval('a[href*="/statistics"]', as => as.map(a => a.href));
    for (const u of hrefs || []) {
      try {
        const resp = await page.request.get(u, {
          headers: { 'Accept': '*/*', 'Referer': START_URL, 'User-Agent': navigator.userAgent }
        });
        if (resp.ok()) {
          const txt = await resp.text();
          if (/"growth":-?\d+/.test(txt)) { rscText = txt; break; }
        }
      } catch {}
    }
  }

  // 3) Sidste fallback: hent hele HTML og parse (mindre sandsynligt men ufarligt)
  if (!rscText) {
    const html = await page.content();
    if (/"growth":-?\d+/.test(html)) rscText = html;
  }

  const players = rscText ? extractPlayersFromText(rscText) : [];

  // skriv filer
  const outDir = ensureOutDir();
  const latestPath = path.join(outDir, 'latest.json');
  const debugPath  = path.join(outDir, 'debug_info.txt');

  const payload = JSON.stringify(players, null, 2);
  let changed = true;
  if (fs.existsSync(latestPath)) {
    const prev = fs.readFileSync(latestPath, 'utf8');
    changed = prev !== payload;
  }
  fs.writeFileSync(latestPath, payload);
  // debug-info
  const info = [
    `foundPlayers=${players.length}`,
    `frames=${frames.length}`,
    `dataDetected=${/"growth":-?\d+/.test(rscText)}`,
    `ts=${new Date().toISOString()}`
  ].join('\n');
  fs.writeFileSync(debugPath, info);
  fs.writeFileSync(path.join(outDir, 'changed.flag'), changed ? '1' : '0');

  await browser.close();
}

run().catch(err => {
  console.error(err);
  try {
    const outDir = ensureOutDir();
    fs.writeFileSync(path.join(outDir, 'changed.flag'), '0');
    fs.writeFileSync(path.join(outDir, 'debug_info.txt'), `ERROR=${String(err)}\nts=${new Date().toISOString()}`);
  } catch {}
  process.exit(1);
});
