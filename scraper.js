import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const START_URL = 'https://www.holdet.dk/da/fantasy/super-manager-spring-2026';

function extractPlayersFromText(s) {
  const out = [];
  const push = (n, g) => {
    const name = (n || '').trim();
    const gr = Number(g);
    if (name && Number.isFinite(gr)) out.push({ fullName: name, growth: gr });
  };

  let m;
  const reA = /"person"\s*:\s*\{[^}]*?"fullName"\s*:\s*"([^"]+)"[\s\S]{1,1500}?"growth"\s*:\s*(-?\d+)/g;
  while ((m = reA.exec(s)) !== null) push(m[1], m[2]);

  const reB = /"growth"\s*:\s*(-?\d+)[\s\S]{1,1500}?"person"\s*:\s*\{[^}]*?"fullName"\s*:\s*"([^"]+)"/g;
  while ((m = reB.exec(s)) !== null) push(m[2], m[1]);

  const reC = /"fullName"\s*:\s*"([^"]+)"[\s\S]{1,1500}?"growth"\s*:\s*(-?\d+)/g;
  while ((m = reC.exec(s)) !== null) push(m[1], m[2]);

  const seen = new Map();
  for (const p of out) {
    const key = p.fullName.toLowerCase();
    if (!seen.has(key)) seen.set(key, p);
  }
  return Array.from(seen.values());
}

async function run() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    userAgent: 'Mozilla/5.0 (compatible; ManagerBot/1.0)'
  });
  const page = await ctx.newPage();

  await page.goto(START_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.getByText('Statistik', { exact: true }).click({ timeout: 30000 });

  await page.waitForFunction(
    () => /"growth":-?\d+/.test(document.documentElement.innerHTML),
    { timeout: 60000 }
  );

  const html = await page.content();
  const players = extractPlayersFromText(html);
  await browser.close();

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
