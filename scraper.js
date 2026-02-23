// Normaliser RSC/HTML: af-escape citattegn og linjeskift, så regex bliver triviel.
function normalizeRSC(s) {
  let t = String(s || '');
  // HTML &quot; → "
  t = t.replace(/&quot;/g, '"');
  // JavaScript-escape \" → "
  t = t.replace(/\\"/g, '"');
  // Unicode-escape \u0022 → "
  t = t.replace(/\\u0022/g, '"');
  // Linjeskift-escapes → rigtige linjer (har ingen betydning for regex, men gør samples læselige)
  t = t.replace(/\\r/g, '').replace(/\\n/g, '\n');
  return t;
}

// ——— SUPER ROBUST PARSER ———
// Finder spillerobjekter i stor RSC/HTML-tekst fra Next.js
//  1) "person.fullName" ... "growth"  (lang afstand)
//  2) "growth" ... "person.fullName"  (omvendt)
//  3) "fullName" ... "growth"         (uden at kræve "person")
//  4) "growth" ... "fullName"         (omvendt uden "person")
//  5) rows-fallback i ..."rows":[{ ... }]
function extractPlayersFromText(raw) {
  const s = normalizeRSC(raw);

  const out = [];
  const push = (n, g) => {
    const name = (n || '').trim();
    const gr = Number(g);
    if (name && Number.isFinite(gr)) out.push({ fullName: name, growth: gr });
  };

  let m;

  // (1) person.fullName ... growth (meget stor afstand tilladt)
  {
    const re = /"person"\s*:\s*\{[\s\S]*?"fullName"\s*:\s*"([^"]+)"[\s\S]{1,50000}?"growth"\s*:\s*(-?\d+)/g;
    while ((m = re.exec(s)) !== null) push(m[1], m[2]);
  }

  // (2) growth ... person.fullName (omvendt rækkefølge)
  {
    const re = /"growth"\s*:\s*(-?\d+)[\s\S]{1,50000}?"person"\s*:\s*\{[\s\S]*?"fullName"\s*:\s*"([^"]+)"/g;
    while ((m = re.exec(s)) !== null) push(m[2], m[1]);
  }

  // (3) Fallback: "fullName" ... "growth" (uden at kræve "person")
  {
    const re = /"fullName"\s*:\s*"([^"]+)"[\s\S]{1,50000}?"growth"\s*:\s*(-?\d+)/g;
    while ((m = re.exec(s)) !== null) push(m[1], m[2]);
  }

  // (4) Fallback: "growth" ... "fullName" (omvendt, uden "person")
  {
    const re = /"growth"\s*:\s*(-?\d+)[\s\S]{1,50000}?"fullName"\s*:\s*"([^"]+)"/g;
    while ((m = re.exec(s)) !== null) push(m[2], m[1]);
  }

  // (5) Rows-fallback – hvis data er samlet i ..."rows":[{...}]
  {
    const rowsMatch = /"rows"\s*:\s*\[([\s\S]*?)\]/.exec(s);
    if (rowsMatch && rowsMatch[1]) {
      const block = rowsMatch[1];
      const itemRe = /"fullName"\s*:\s*"([^"]+)"[\s\S]{1,2000}?"growth"\s*:\s*(-?\d+)/g;
      while ((m = itemRe.exec(block)) !== null) push(m[1], m[2]);
    }
  }

  // Dedupe på navn (første forekomst vinder)
  const seen = new Map();
  for (const p of out) {
    const key = p.fullName.toLowerCase();
    if (!seen.has(key)) seen.set(key, p);
  }
  return Array.from(seen.values());
}
