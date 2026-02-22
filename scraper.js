// Scraper – robust mod RSC/iframes:
// 1) Accepterer cookies
// 2) Klikker det rigtige "Statistik"-menupunkt (undgår cookieboks)
// 3) Lytter på alle network responses (RSC/json) OG trawler performance-entries
// 4) Henter kandidater direkte med page.request.get() og parser { fullName, growth }
// 5) Gemmer data i data/latest.json + debug_info.txt (så vi kan se, hvad der skete)

import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const START_URL = 'https://www.holdet.dk/da/fantasy/super-manager-spring-2026';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36';

function ensureOutDir() {
  const outDir = path.join('data');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  return outDir;
}

// --- Parser for tekst der indeholder spillerobjekter ---
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
  // fullName (på roden) ... growth
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

// --- Klik på menulink "Statistik" (undgå cookieboksen) ---
async function clickStatisticsMenu(page) {
  // 1) Link i header der peger mod /statistics
  const headerStat = page.locator('header a[href*="/statistics"]').first();
  if (await headerStat.isVisible().catch(() => false)) {
    await headerStat.click({ timeout: 12000 });
    return;
  }
  // 2) Link i header med tekst "Statistik"
  const headerText = page.locator('header').getByRole('link', { name: /Statistik/i }).first();
  if (await headerText.isVisible().catch(() => false)) {
    await headerText.click({ timeout: 12000 });
    return;
  }
  // 3) Generelt link med “Statistik” (uden for cookie-dialogen)
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
  // 4) Fallback: klik på et <a href*="/statistics"> hvor som helst
  const direct = await page.$('a[href*="/statistics"]');
  if (direct) await direct.click({ timeout: 12000 }).catch(() => {});
}

// --- Hjælp: hent tekst fra en kandidat-URL robust ---
async function fetchText(page, url) {
  // Resolve relative → absolut
  let abs;
  try { abs = new URL(url, page.url()).toString(); } catch { abs = url; }
  const resp = await page.request.get(abs, {
    headers: { 'Accept': '*/*', 'Referer': START_URL, 'User-Agent': UA }
  });
  if (!resp.ok()) return '';
  return await resp.text();
}

async function run() {
  const outDir = ensureOutDir();

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ userAgent: UA });
  const page = await ctx.newPage();

  // Saml kandidater fra network + performance
  const candidateUrls = new Set();
  const snapshots = { responses: [], perf: [] };

  // Lyt på ALLE responses og saml dem, der ligner statistik-data
  page.on('response', async (resp) => {
    try {
      const url = resp.url() || '';
      if (!/statistics/i.test(url)) return;
      const headers = resp.headers() || {};
      const ct = (headers['content-type'] || headers['Content-Type'] || '').toLowerCase();
      if (ct.includes('text/x-component') || ct.includes('json')) {
        candidateUrls.add(url);
        snapshots.responses.push({ url, ct, status: resp.status() });
      }
    } catch {}
  });

  // 1) Gå til landing og accepter cookies
  await page.goto(START_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await acceptCookiesIfPresent(page);

  // 2) Klik "Statistik"
  await clickStatisticsMenu(page);

  // 3) Giv appen lidt tid til at fyre RSC/Fetch requests af
  await page.waitForTimeout(3000);

  // 4) Supplér kandidater ved at trawle performance entries (ressourcenavne i browseren)
  try {
    const perf = await page.evaluate(() =>
      performance.getEntries().map(e => typeof e.name === 'string' ? e.name : '')
    );
    (perf || []).forEach(n => {
      if (/statistics/i.test(n) && (n.includes('_rsc=') || n.includes('data='))) candidateUrls.add(n);
    });
    snapshots.perf = (perf || []).filter(n => /statistics/i.test(n));
  } catch {}

  // 5) Hent alle kandidat-URL’er direkte og parse dem
  const chunks = [];
  for (const u of candidateUrls) {
    try {
      const txt = await fetchText(page, u);
      if (/"growth":-?\d+/.test(txt)) chunks.push(txt);
    } catch {}
  }

  // 6) Fallbacks (hvis ingen kandidater gav data):
  if (chunks.length === 0) {
    // a) Prøv alle frames (hent frame.url() direkte)
    const frames = page.frames();
    for (const f of frames) {
      const fu = (f.url() || '').toString();
      if (/statistics/i.test(fu)) {
        try {
          const txt = await fetchText(page, fu);
          if (/"growth":-?\d+/.test(txt)) { chunks.push(txt); break; }
        } catch {}
      }
    }
    // b) Prøv hele side-HTML
    if (chunks.length === 0) {
      try {
        const html = await page.content();
        if (/"growth":-?\d+/.test(html)) chunks.push(html);
      } catch {}
    }
  }

  // 7) Merge og parse
  const merged = chunks.join('\n');
  const players = merged ? extractPlayersFromText(merged) : [];

  // 8) Skriv filer
  const latestPath = path.join(outDir, 'latest.json');
  const debugPath  = path.join(outDir, 'debug_info.txt');

  const payload = JSON.stringify(players, null, 2);
  let changed = true;
  if (fs.existsSync(latestPath)) {
    const prev = fs.readFileSync(latestPath, 'utf8');
    changed = prev !== payload;
  }
  fs.writeFileSync(latestPath, payload);

  const debug = [
    `foundPlayers=${players.length}`,
    `candidates=${Array.from(candidateUrls).length}`,
    `responseCandidates=${snapshots.responses.length}`,
    `perfCandidates=${snapshots.perf.length}`,
    `urls=${Array.from(candidateUrls).slice(0, 10).join(' | ')}`,
    `ts=${new Date().toISOString()}`
  ].join('\n');
  fs.writeFileSync(debugPath, debug);
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
