const fs = require('fs');
const path = require('path');

const inputPath = path.join(process.cwd(), 'data', 'documents_full.json');
const outputPath = path.join(process.cwd(), 'data', 'documents_clean.json');

function cleanText(text) {
  return String(text || '')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeUrl(url) {
  return String(url || '').trim().replace(/\/$/, '');
}

function isBadTitle(title) {
  const t = cleanText(title).toLowerCase();
  if (!t) return true;
  return (
    t === 'kontaktirajte nas' ||
    t === 'bez naslova' ||
    t.includes('pravila privatnosti') ||
    t.includes('upravljajte pristankom')
  );
}

function isBadContent(content) {
  const c = cleanText(content).toLowerCase();
  if (!c || c.length < 180) return true;

  const badPatterns = [
    'pravila privatnosti',
    'upravljajte pristankom',
    'tehnicko skladistenje ili pristup',
    'tehničko skladištenje ili pristup',
    'copyright ©',
  ];

  const badHitCount = badPatterns.filter((p) => c.includes(p)).length;
  return badHitCount >= 2;
}

function scoreDoc(doc) {
  let score = 0;
  const title = cleanText(doc.title);
  const content = cleanText(doc.content);
  const url = normalizeUrl(doc.url);

  score += Math.min(content.length, 5000);

  if (title && title.length > 5) score += 500;
  if (/upisi|studijski-programi|online-studiranje|cjelozivotno-obrazovanje|studenti|biograd|kontakt/i.test(url)) score += 300;
  if (/veleučilište|veleuciliste|studij|program|upis|studenti|biograd/i.test(title)) score += 300;
  if (isBadTitle(title)) score -= 1000;
  if (isBadContent(content)) score -= 1500;

  return score;
}

const docs = JSON.parse(fs.readFileSync(inputPath, 'utf8'));

const bestByUrl = new Map();

for (const doc of docs) {
  const url = normalizeUrl(doc.url);
  if (!url) continue;

  const cleaned = {
    url,
    title: cleanText(doc.title),
    content: cleanText(doc.content),
  };

  if (!cleaned.content) continue;

  const currentScore = scoreDoc(cleaned);
  const existing = bestByUrl.get(url);

  if (!existing || currentScore > existing._score) {
    bestByUrl.set(url, { ...cleaned, _score: currentScore });
  }
}

let cleanedDocs = [...bestByUrl.values()]
  .filter((d) => !isBadContent(d.content))
  .filter((d) => d.content.length >= 180)
  .map(({ _score, ...rest }) => rest);

fs.writeFileSync(outputPath, JSON.stringify(cleanedDocs, null, 2), 'utf8');

console.log(`Ulaznih dokumenata: ${docs.length}`);
console.log(`Očišćenih dokumenata: ${cleanedDocs.length}`);
console.log(`Izlaz: ${outputPath}`);
