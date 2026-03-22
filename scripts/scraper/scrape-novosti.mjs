/**
 * Novosti scraper for bak.hr/novosti/
 *
 * Crawls all pages of /novosti/, extracts individual article URLs,
 * fetches each article, extracts clean text, chunks, embeds and upserts.
 *
 * Run:
 *   node scripts/scraper/scrape-novosti.mjs             # all pages
 *   node scripts/scraper/scrape-novosti.mjs --pages 5   # last 5 pages only
 *   node scripts/scraper/scrape-novosti.mjs --dry-run   # no DB writes
 */

import { readFileSync } from 'fs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

// ── Env ───────────────────────────────────────────────────────────────────────
const env = readFileSync('.env.local', 'utf8');
for (const line of env.split('\n')) {
  const m = line.match(/^([^#=\s][^=]*)=(.*)$/);
  if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
}

import { buildChunks } from './chunk.mjs';

const { Pool } = require('pg');
const OpenAI   = require('openai');
const axios    = require('axios');
const cheerio  = require('cheerio');

// ── Config ────────────────────────────────────────────────────────────────────
const TENANT_ID   = 'baltazar';
const BASE_URL    = 'https://www.bak.hr';
const NOVOSTI_URL = 'https://www.bak.hr/novosti/';
const ENTITY_TYPE = 'novost';
const DELAY_MS    = 600;

const DRY_RUN = process.argv.includes('--dry-run');
const MAX_PAGES = (() => {
  const idx = process.argv.indexOf('--pages');
  return idx >= 0 ? parseInt(process.argv[idx + 1], 10) : 999;
})();

// ── DB / OpenAI ───────────────────────────────────────────────────────────────
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 2,
});

const openai = new OpenAI.default({ apiKey: process.env.OPENAI_API_KEY });

// ── Helpers ───────────────────────────────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetchHtml(url) {
  try {
    const resp = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 BaltazarBot/1.0 (university-chatbot; info@bak.hr)',
        'Accept-Language': 'hr,en;q=0.5',
        'Accept': 'text/html,application/xhtml+xml',
      },
      timeout: 15000,
      maxRedirects: 5,
    });
    return resp.data;
  } catch (err) {
    const code = err.response?.status || err.code;
    console.warn(`  ⚠️  HTTP ${code} — ${url}`);
    return null;
  }
}

async function embed(text) {
  const resp = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: text,
  });
  return resp.data[0].embedding;
}

// ── Extract article links from a listing page ─────────────────────────────────
function extractArticleLinks(html) {
  const $ = cheerio.load(html);
  const links = new Set();

  // WordPress post links — typically in <h2 class="entry-title"> or article > a
  $('article a[href], h2 a[href], h3 a[href], .entry-title a[href], .post-title a[href]').each((_, el) => {
    const href = $(el).attr('href') || '';
    if (href.startsWith(BASE_URL) &&
        !href.includes('/novosti/page/') &&
        !href.includes('/category/') &&
        !href.includes('/tag/') &&
        href !== NOVOSTI_URL &&
        href !== BASE_URL + '/') {
      links.add(href.replace(/\/$/, '') + '/'); // normalise trailing slash
    }
  });

  return [...links];
}

// ── Extract clean text from a news article page ───────────────────────────────
function extractArticleContent(html, url) {
  const $ = cheerio.load(html);

  // Title
  const title = $('h1.entry-title, h1.page-title, article h1, h1').first().text().trim()
    || $('title').text().replace(/ [–|-] .*/, '').trim();

  // Date
  const dateRaw = $('time[datetime]').attr('datetime')
    || $('time').first().text().trim()
    || '';
  const date = dateRaw ? dateRaw.slice(0, 10) : '';

  // Body — prefer entry-content / post-content
  let bodyEl = $('.entry-content, .post-content, .elementor-widget-theme-post-content, article .elementor-widget-container').first();
  if (!bodyEl.length) bodyEl = $('article');
  if (!bodyEl.length) bodyEl = $('main');

  // Remove nav, sidebar, widgets, scripts
  bodyEl.find('nav, aside, script, style, .elementor-nav-menu, footer, .wp-block-cover, .elementor-hidden').remove();

  // Extract paragraphs
  const paragraphs = [];
  bodyEl.find('p, li, h2, h3, h4').each((_, el) => {
    const txt = $(el).text().replace(/\s+/g, ' ').trim();
    if (txt.length > 30) paragraphs.push(txt);
  });

  let body = paragraphs.join('\n');
  if (!body || body.length < 100) {
    body = bodyEl.text().replace(/\s+/g, ' ').trim();
  }

  if (!body || body.length < 100) return null;

  const headerLine = `Novost: ${title}${date ? ` (${date})` : ''}\nIzvor: ${url}`;
  return { title, date, text: `${headerLine}\n\n${body}` };
}

// ── Upsert chunks to DB ───────────────────────────────────────────────────────
async function upsertChunks(url, title, chunks) {
  // Find or create document record (no unique constraint — use SELECT + INSERT/UPDATE)
  const existing = await pool.query(
    `SELECT id FROM documents WHERE tenant_id = $1 AND source_url = $2 LIMIT 1`,
    [TENANT_ID, url]
  );
  let documentId;
  if (existing.rows.length > 0) {
    documentId = existing.rows[0].id;
    await pool.query(
      `UPDATE documents SET title=$1, last_crawled_at=NOW(), updated_at=NOW() WHERE id=$2`,
      [title, documentId]
    );
  } else {
    const ins = await pool.query(
      `INSERT INTO documents
         (tenant_id, source_url, title, entity_type, entity_name, content, language, is_active, last_crawled_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'hr', true, NOW())
       RETURNING id`,
      [TENANT_ID, url, title, ENTITY_TYPE, title, title]
    );
    documentId = ins.rows[0].id;
  }

  // Delete old chunks for this document
  await pool.query(
    `DELETE FROM document_chunks WHERE document_id = $1`,
    [documentId]
  );

  // Insert new chunks
  for (let i = 0; i < chunks.length; i++) {
    const vec = await embed(chunks[i].content);
    await pool.query(
      `INSERT INTO document_chunks
         (document_id, tenant_id, content, embedding, url, title,
          entity_name, entity_type, content_group, chunk_index)
       VALUES ($1, $2, $3, $4::vector, $5, $6, $7, $8, $9, $10)`,
      [documentId, TENANT_ID, chunks[i].content, JSON.stringify(vec),
       url, chunks[i].heading || title, title, ENTITY_TYPE, 'novosti', i]
    );
  }
}

// ── Process a single article ──────────────────────────────────────────────────
async function processArticle(url) {
  const html = await fetchHtml(url);
  if (!html) return { status: 'error', chunks: 0 };

  const article = extractArticleContent(html, url);
  if (!article) {
    console.log(`   ⏭️  SKIP (no usable content)`);
    return { status: 'skipped', chunks: 0 };
  }

  const chunks = buildChunks([{ heading: article.title, text: article.text }]);
  if (!chunks.length) {
    console.log(`   ⏭️  SKIP (0 chunks after chunking)`);
    return { status: 'skipped', chunks: 0 };
  }

  console.log(`   ✅  ${chunks.length} chunk(ova) — "${article.title.slice(0, 60)}"`);

  if (!DRY_RUN) {
    await upsertChunks(url, article.title, chunks);
  }

  return { status: 'ok', chunks: chunks.length };
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`🗞️  Novosti scraper — Veleučilište Baltazar`);
  console.log(`   DRY_RUN: ${DRY_RUN}  |  MAX_PAGES: ${MAX_PAGES}`);
  console.log('');

  // Step 1: Collect all article URLs from listing pages
  const allArticleUrls = new Set();
  let page = 1;

  while (page <= MAX_PAGES) {
    const listUrl = page === 1 ? NOVOSTI_URL : `${NOVOSTI_URL}page/${page}/`;
    console.log(`📄  Listing page ${page}: ${listUrl}`);

    const html = await fetchHtml(listUrl);
    if (!html) { console.log(`   ⛔ Failed — stopping pagination`); break; }

    const links = extractArticleLinks(html);
    if (!links.length) { console.log(`   ✅  No more articles — done paginating`); break; }

    let newCount = 0;
    for (const link of links) {
      if (!allArticleUrls.has(link)) { allArticleUrls.add(link); newCount++; }
    }
    console.log(`   Found ${links.length} links (${newCount} new, ${allArticleUrls.size} total)`);

    if (newCount === 0) break; // same links repeating — stop
    await sleep(300);
    page++;
  }

  console.log(`\n🔗  Total article URLs collected: ${allArticleUrls.size}\n`);

  // Step 2: Scrape each article
  let ok = 0, skipped = 0, errors = 0, totalChunks = 0;
  const articleList = [...allArticleUrls];

  for (let i = 0; i < articleList.length; i++) {
    const url = articleList[i];
    console.log(`[${i + 1}/${articleList.length}] ${url}`);
    try {
      const result = await processArticle(url);
      if (result.status === 'ok')      { ok++;      totalChunks += result.chunks; }
      else if (result.status === 'skipped') skipped++;
      else errors++;
    } catch (err) {
      console.error(`   ❌  Error: ${err.message}`);
      errors++;
    }
    await sleep(DELAY_MS);
  }

  console.log('\n══════════════════════════════════════════');
  console.log(`✅  OK:       ${ok} novosti`);
  console.log(`⏭️  Skipped:  ${skipped}`);
  console.log(`❌  Errors:   ${errors}`);
  console.log(`📦  Chunks:   ${totalChunks}`);
  console.log(`💾  DB write: ${DRY_RUN ? 'NO (dry-run)' : 'YES'}`);
  console.log('══════════════════════════════════════════');

  await pool.end();
}

main().catch(err => { console.error(err); process.exit(1); });
