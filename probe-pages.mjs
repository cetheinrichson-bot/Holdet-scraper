/**
 * probe-pages.mjs
 * Undersøger om holdet.dk statistiksiden har flere sider af spillere
 */

import { chromium } from 'playwright';
import fs from 'fs';

const START_URL = 'https://www.holdet.dk/da/fantasy/super-manager-fall-2026';
const BASE = 'https://nexus-app-fantasy-fargate.holdet.dk/da/super-manager-fall-2026/soccer/statistics';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36';

function normalizeRSC(s) {
  let t = String(s || '');
  t = t.replace(/&quot;/g, '"').replace(/\\"/g, '"').replace(/\\u0022/g, '"');
  return t;
}

function countNames(body) {
  const s = normalizeRSC(body);
  const names = new Set();
  const re = /"fullName"\s*:\s*"([^"]+)"/g;
  let m;
  while ((m = re.exec(s)) !== null) names.add(m[1].trim());
  return names;
}

async function run() {
  if (!fs.existsSync('data/samples')) fs.mkdirSync('data/samples', { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ userAgent: UA });
  const page = await ctx.newPage();

  try { await page.goto(START_URL, { waitUntil: 'domcontentloaded', timeout: 30000 }); } catch {}

  const headers = { 'User-Agent': UA, 'Accept': '*/*', 'Accept-Language': 'da-DK,da;q=0.9', 'Referer': START_URL };

  // Test forskellige URL-varianter
  const variants = [
    BASE,
    BASE + '?page=1',
    BASE + '?page=2',
    BASE + '?page=3',
    BASE + '/2',
    BASE + '?offset=350',
    BASE + '?limit=1000',
    BASE + '?pageSize=1000',
    BASE + '?take=1000',
    BASE + '?rows=1000',
  ];

  const allNames = new Set();

  for (const url of variants) {
    try {
      const resp = await page.request.get(url, { headers });
      const body = await resp.text();
      const names = countNames(body);
      names.forEach(n => allNames.add(n));
      console.log(`${url.replace(BASE, 'BASE')}: status=${resp.status()} navne=${names.size}`);
      // Vis et par navne fra denne side
      const sample = [...names].slice(0, 3);
      if (sample.length) console.log(`   fx: ${sample.join(', ')}`);
    } catch (e) {
      console.log(`${url.replace(BASE, 'BASE')}: FEJL ${e.message.slice(0,50)}`);
    }
  }

  console.log(`\nUnikke navne på tværs af alle varianter: ${allNames.size}`);
  console.log(`Friday Etim fundet: ${allNames.has('Friday Etim')}`);

  // Prøv også at scrolle på selve siden og se om flere spillere loader
  console.log('\nTester scroll på selve siden...');
  const scrollNames = new Set();
  page.on('response', async (response) => {
    if (!response.url().includes('statistics')) return;
    try {
      const body = await response.text();
      countNames(body).forEach(n => scrollNames.add(n));
    } catch {}
  });

  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 60000 }).catch(()=>{});
  for (let i = 0; i < 15; i++) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(1500);
  }
  console.log(`Efter scroll: ${scrollNames.size} navne fanget fra responses`);
  console.log(`Friday Etim efter scroll: ${scrollNames.has('Friday Etim')}`);

  await browser.close();
  process.exit(0);
}

run().catch(e => { console.error(e); process.exit(1); });
