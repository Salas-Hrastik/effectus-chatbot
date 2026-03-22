require('dotenv').config({ path: '.env.local' });
const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

const configPath = path.join(process.cwd(), 'tenants', 'baltazar', 'config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

const MAX_DEPTH = config.crawler.maxDepth ?? 4;
const MAX_PAGES = config.crawler.maxPages ?? 2500;
const TIMEOUT_MS = config.crawler.timeoutMs ?? 20000;
const USER_AGENT = config.crawler.userAgent ?? 'BaltazarBot/1.0';

function normalizeUrl(input) {
  try {
    const u = new URL(input);
    u.hash = '';
    if (u.hostname === 'bak.hr') u.hostname = 'www.bak.hr';
    if (u.pathname !== '/' && u.pathname.endsWith('/')) {
      u.pathname = u.pathname.slice(0, -1);
    }
    return u.toString();
  } catch {
    return null;
  }
}

function isAllowedUrl(url) {
  if (!url) return false;
  if (!config.allowPrefixes.some((p) => url.startsWith(p.replace(/\/$/, '')) || url.startsWith(p))) {
    return false;
  }
  return !config.denyPatterns.some((pattern) => url.includes(pattern));
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

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('text/html')) {
      return null;
    }

    return await res.text();
  } finally {
    clearTimeout(timeout);
  }
}

function extractLinks(baseUrl, html) {
  const $ = cheerio.load(html);
  const links = new Set();

  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href) return;

    try {
      const abs = new URL(href, baseUrl).toString();
      const normalized = normalizeUrl(abs);
      if (normalized && isAllowedUrl(normalized)) {
        links.add(normalized);
      }
    } catch {}
  });

  return [...links];
}

(async () => {
  const queue = config.seedUrls
    .map((u) => ({ url: normalizeUrl(u), depth: 0 }))
    .filter((x) => x.url);

  const visited = new Set();
  const discovered = [];

  while (queue.length && visited.size < MAX_PAGES) {
    const current = queue.shift();
    if (!current || !current.url) continue;
    if (visited.has(current.url)) continue;

    visited.add(current.url);
    console.log(`Crawl: [${visited.size}] depth=${current.depth} ${current.url}`);

    try {
      const html = await fetchHtml(current.url);
      discovered.push({
        url: current.url,
        depth: current.depth,
        fetched: !!html
      });

      if (!html) continue;
      if (current.depth >= MAX_DEPTH) continue;

      const links = extractLinks(current.url, html);
      for (const link of links) {
        if (!visited.has(link)) {
          queue.push({ url: link, depth: current.depth + 1 });
        }
      }
    } catch (err) {
      console.log(`Greška: ${current.url} -> ${err.message}`);
      discovered.push({
        url: current.url,
        depth: current.depth,
        fetched: false,
        error: err.message
      });
    }
  }

  const outPath = path.join(process.cwd(), 'data', 'baltazar_crawl_urls.json');
  fs.writeFileSync(outPath, JSON.stringify(discovered, null, 2), 'utf8');

  console.log(`\nGotovo.`);
  console.log(`Ukupno obrađenih URL-ova: ${discovered.length}`);
  console.log(`Izlaz: ${outPath}`);
})();
