require('dotenv').config({ path: '.env.local' });
const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

const inputPath = path.join(process.cwd(), 'data', 'baltazar_crawl_urls.json');
const outputPath = path.join(process.cwd(), 'data', 'documents_full.json');

const USER_AGENT = 'Mozilla/5.0 (compatible; BaltazarBot/1.0; +https://www.bak.hr)';
const TIMEOUT_MS = 20000;

function cleanText(text) {
  return String(text || '')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function removeNoise($) {
  const selectors = [
    'script',
    'style',
    'noscript',
    'iframe',
    'svg',
    'canvas',
    'form',
    'nav',
    'header',
    'footer',
    '.menu',
    '.nav',
    '.navigation',
    '.breadcrumbs',
    '.breadcrumb',
    '.footer',
    '.header',
    '.sidebar',
    '.widget',
    '.cookie',
    '.cookies',
    '#cookie-law-info-bar',
    '.cli-bar-container',
    '.moove-gdpr-info-bar-container',
    '.sharedaddy',
    '.jp-relatedposts',
    '.print',
    '.search-form',
    '.wp-block-search',
    '.pagination',
    '.post-navigation',
    '.comments',
    '.comment-respond'
  ];

  selectors.forEach((sel) => {
    try { $(sel).remove(); } catch {}
  });
}

function pickMainContent($) {
  const candidates = [
    'main',
    'article',
    '.entry-content',
    '.post-content',
    '.content',
    '.site-content',
    '#content',
    '.page-content',
    '.elementor-widget-theme-post-content'
  ];

  for (const sel of candidates) {
    const el = $(sel).first();
    if (el && cleanText(el.text()).length > 200) return el;
  }

  return $('body');
}

function extractTitle($) {
  const candidates = [
    $('h1').first().text(),
    $('title').text(),
    $('meta[property="og:title"]').attr('content')
  ].map(cleanText).filter(Boolean);

  return candidates[0] || 'Bez naslova';
}

function extractContent(html) {
  const $ = cheerio.load(html);
  removeNoise($);

  const title = extractTitle($);
  const main = pickMainContent($);

  let content = cleanText(main.text());

  content = content
    .replace(/Pravila privatnosti/gi, ' ')
    .replace(/Upravljajte pristankom/gi, ' ')
    .replace(/Tehničko skladištenje ili pristup/gi, ' ')
    .replace(/Copyright © \d{4} Veleučilište Baltazar Zaprešić/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return { title, content };
}

async function fetchHtml(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      signal: controller.signal,
      redirect: 'follow',
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('text/html')) return null;

    return await res.text();
  } finally {
    clearTimeout(timeout);
  }
}

(async () => {
  const crawled = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  const urls = crawled
    .filter((x) => x && x.url && x.fetched)
    .map((x) => x.url);

  const docs = [];
  let count = 0;

  for (const url of urls) {
    count += 1;
    console.log(`[${count}/${urls.length}] Dohvaćam: ${url}`);

    try {
      const html = await fetchHtml(url);
      if (!html) continue;

      const { title, content } = extractContent(html);

      if (!content || content.length < 120) {
        console.log(`  Preskočeno (premalo sadržaja)`);
        continue;
      }

      docs.push({
        url,
        title,
        content
      });

      console.log(`  Spremljeno: ${title} (${content.length} znakova)`);
    } catch (err) {
      console.log(`  Greška: ${err.message}`);
    }
  }

  fs.writeFileSync(outputPath, JSON.stringify(docs, null, 2), 'utf8');

  console.log(`\nGotovo.`);
  console.log(`Dokumenata: ${docs.length}`);
  console.log(`Izlaz: ${outputPath}`);
})();
