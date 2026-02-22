// Scraper – bred netværkslytning (RSC/JSON/tekst), samler alle tekstlige svar,
// finder dem der indeholder spillerdata, og gemmer latest.json + debug + samples.
//
// Flow:
//  - Gå til landing → acceptér cookies → klik "Statistik"
//  - Lyt på ALLE responses (text/x-component, application/json, text/*, application/javascript)
//  - For hvert svar: læs .text() og se om det indeholder "growth" eller "fullName"
//  - Gem første match(e) som samples og parse samlet tekst til [{ fullName, growth }]
//  - Commit via workflow-step (hvis changed.flag=1)

import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const START_URL = 'https://www.holdet.dk/da/fantasy/super-manager-spring-2026';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36';

// ============= FS helpers =============
function ensureDir(p) { if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true }); }
function ensureDataDirs() {
  const dataDir = path.join('data');
  const sampDir = path.join(dataDir, 'samples');
  ensureDir(dataDir); ensureDir(sampDir);
  return { dataDir, sampDir };
}

// ============= Parsing =============
function extractPlayersFromText(s) {
  const out = [];
  const push = (n, g) => {
    const name = (n || '').trim();
    const gr = Number(g);
    if (name && Number.isFinite(gr)) out.push({ fullName: name, growth: gr });
  };
  let m;
  // person.fullName ... growth
  const reA = /"person"\s*:\s*\{[^}]*?"fullName"\s*:\s*"([^"]+)"[\s\S]{1,2000}?"growth"\s*:\s*(-?\d+)/g;
  while ((m = reA.exec(s)) !== null) push(m[1], m[2]);
  // growth ... person.fullName
  const reB = /"growth"\s*:\s*(-?\d+)[\s\S]{1,2000}?"person"\s*:\s*\{[^}]*?"fullName"\s*:\s*"([^"]+)"/g;
  while ((m = reB.exec(s)) !== null) push(m[2], m[1]);
  // fullName ... growth
  const reC = /"fullName"\s*:\s*"([^"]+)"[\s\S]{1,2000}?"growth"\s*:\s*(-?\d+)/g;
  while ((m = reC.exec(s)) !== null) push(m[1], m[2]);

  // Dedupe på navn
  const seen = new Map();
  for (const p of out) {
    const k = p.fullName.toLowerCase();
    if (!seen.has(k)) seen.set(k, p);
  }
  return Array.from(seen.values());
}

// ============= Cookiebot + navigation =============
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

async function clickStatisticsMenu(page) {
  const headerStat = page.locator('header a[href*="/statistics"]').first();
  if (await headerStat.isVisible().catch(() => false)) { await headerStat.click({ timeout: 12000 }); return; }

  const headerText = page.locator('header').getByRole('link', { name: /Statistik/i }).first();
  if (await headerText.isVisible().catch(() => false)) { await headerText.click({ timeout: 12000 }); return; }

  const links = page.getByRole('link', { name: /Statistik/i });
  const count = await links.count();
  for (let i = 0; i < count; i++) {
    const link = links.nth(i);
    const visible = await link.isVisible().catch(() => false);
    if (!visible) continue;
    const inDialog = await link.locator('#CybotCookiebotDialog, [id^="CybotCookiebotDialog"]').count();
    if (inDialog > 0) continue;
    await link.click({ timeout: 12000 }).catch(() => {});
    return;
  }
  const direct = await page.$('a[href*="/statistics"]');
  if (direct) await direct.click({ timeout: 12000 }).catch(() => {});
}

// ============= Main run =============
async function run() {
  const { dataDir, sampDir } = ensureDataDirs();

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ userAgent: UA });
  const page = await ctx.newPage();

  // Saml kandidater fra alle tekstlige responses
  const candidateUrls = new Set();
  const responseLog = [];
  const textChunks = [];         // tekster hvor vi fandt "growth"/"fullName"
  const sampledTexts = [];       // gem op til 2 prøvefiler

  // For at undgå at læse ALT for store svar, sæt en upper bound (bytes)
  const MAX_BYTES_READ = 1_000_000; // 1 MB pr. response
  let inspected = 0;

  page.on('response', async (resp) => {
    try {
      const url = resp.url() || '';
      const status = resp.status();
      const headers = resp.headers() || {};
      const ct = (headers['content-type'] || headers['Content-Type'] || '').toLowerCase();

      // Kun tekstlige typer (RSC, JSON, HTML, tekst, JS)
      const isTextual = /(text\/|json|x-component|javascript)/.test(ct);
      if (!isTextual) return;

      // Læs body som tekst (bounded)
      let txt = '';
      try {
        // Playwright returnerer hele teksten – vi begrænser efterfølgende ved slice
        txt = await resp.text();
        if (txt && txt.length > MAX_BYTES_READ) txt = txt.slice(0, MAX_BYTES_READ);
      } catch { /* ignore */ }

      responseLog.push({ url, status, ct, len: txt ? txt.length : 0 });

      // Hvis teksten indholder "growth" eller "fullName", gem som kandidat
      if (txt && (/"growth"\s*:\s*-?\d+/.test(txt) || /"fullName"\s*:\s*"/.test(txt))) {
        candidateUrls.add(url);
        textChunks.push(txt);

        // Gem op til 2 samples til inspektion
        if (sampledTexts.length < 2) {
          const idx = sampledTexts.length + 1;
          const p = path.join(sampDir, `match_${idx}.txt`);
          fs.writeFileSync(p, txt.slice(0, 100000)); // max 100 KB per sample
          sampledTexts.push(p);
        }
      }

      // Hold øje med ikke at inspicere uendeligt mange responses
      inspected++;
    } catch { /* ignore */ }
  });

  // Navigér og klik statistik
  await page.goto(START_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await acceptCookiesIfPresent(page);
  await clickStatisticsMenu(page);

  // Giv appen lidt tid til at skyde netværkskald af
  await page.waitForTimeout(5000);

  // Merge alle chunks og parse spillere
  const merged = textChunks.join('\n');
  const players = merged ? extractPlayersFromText(merged) : [];

  // Skriv outputfiler
  const latestPath = path.join(dataDir, 'latest.json');
  const debugPath  = path.join(dataDir, 'debug_info.txt');

  const payload = JSON.stringify(players, null, 2);
  let changed = true;
  if (fs.existsSync(latestPath)) {
    const prev = fs.readFileSync(latestPath, 'utf8');
    changed = prev !== payload;
  }
  fs.writeFileSync(latestPath, payload);

  const debugLines = [
    `foundPlayers=${players.length}`,
    `inspectedResponses=${inspected}`,
    `candidateUrls=${Array.from(candidateUrls).length}`,
    `sampleFiles=${sampledTexts.join(', ') || '-'}`,
    `topCandidates=${Array.from(candidateUrls).slice(0, 10).join(' | ') || '-'}`,
    `lastResponses=${responseLog.slice(-5).map(r => `${r.status} ${r.ct} ${r.url}`).join(' || ') || '-'}`,
    `ts=${new Date().toISOString()}`
  ];
  fs.writeFileSync(debugPath, debugLines.join('\n'));

  fs.writeFileSync(path.join(dataDir, 'changed.flag'), changed ? '1' : '0');

  await browser.close();
}

run().catch(err => {
  console.error(err);
  try {
    const { dataDir } = ensureDataDirs();
    fs.writeFileSync(path.join(dataDir, 'changed.flag'), '0');
    fs.writeFileSync(path.join(dataDir, 'debug_info.txt'), `ERROR=${String(err)}\nts=${new Date().toISOString()}`);
  } catch {}
  process.exit(1);
});
