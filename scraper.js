// ——— ROBUST PARSER ———
// Finder spillerobjekter i stor RSC/HTML-tekst fra Next.js.
// Gør tre ting:
//  1) Matcher "person.fullName ... growth" (stor afstand: op til 20.000 tegn)
//  2) Matcher "growth ... person.fullName"
//  3) Fallback: matcher "fullName ... growth" i *enhver* rækkefølge tæt på hinanden
//  4) Særligt fallback til lister som "rows":[{ ... "person":{...}, ..."growth":123, ...}]
function extractPlayersFromText(s) {
  const out = [];
  const push = (n, g) => {
    const name = (n || '').trim();
    const gr = Number(g);
    if (name && Number.isFinite(gr)) out.push({ fullName: name, growth: gr });
  };

  let m;

  // (1) person.fullName ... growth (lang afstand tilladt)
  {
    const re = /"person"\s*:\s*\{[^}]*?"fullName"\s*:\s*"([^"]+)"[\s\S]{1,20000}?"growth"\s*:\s*(-?\d+)/g;
    while ((m = re.exec(s)) !== null) push(m[1], m[2]);
  }

  // (2) growth ... person.fullName (lang afstand)
  {
    const re = /"growth"\s*:\s*(-?\d+)[\s\S]{1,20000}?"person"\s*:\s*\{[^}]*?"fullName"\s*:\s*"([^"]+)"/g;
    while ((m = re.exec(s)) !== null) push(m[2], m[1]);
  }

  // (3) Fallback: "fullName" ... "growth" uden "person" blok (lang afstand)
  {
    const re = /"fullName"\s*:\s*"([^"]+)"[\s\S]{1,20000}?"growth"\s*:\s*(-?\d+)/g;
    while ((m = re.exec(s)) !== null) push(m[1], m[2]);
  }

  // (4) Rows-fallback: matcher blokke ala ..."rows":[{..."person":{..."fullName":"X"...},..."growth":123,...}]
  {
    const rowRe = /"rows"\s*:\s*\[([\s\S]*?)\]/g;
    while ((m = rowRe.exec(s)) !== null) {
      const rowsBlock = m[1];
      const itemRe = /"person"\s*:\s*\{[^}]*?"fullName"\s*:\s*"([^"]+)"[\s\S]*?"growth"\s*:\s*(-?\d+)/g;
      let mi;
      while ((mi = itemRe.exec(rowsBlock)) !== null) push(mi[1], mi[2]);
    }
  }

  // Dedupe på navn (første vinder)
  const seen = new Map();
  for (const p of out) {
    const key = p.fullName.toLowerCase();
    if (!seen.has(key)) seen.set(key, p);
  }
  return Array.from(seen.values());
}
