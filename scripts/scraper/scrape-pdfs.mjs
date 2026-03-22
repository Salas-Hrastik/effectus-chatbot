/**
 * PDF scraper for bak.hr/o-nama/dokumenti
 *
 * Steps:
 *  1. Fetch https://www.bak.hr/o-nama/dokumenti HTML
 *  2. Extract all PDF hrefs
 *  3. For each PDF: download → parse text → clean → chunk → embed → upsert to Supabase
 *  4. Skip PDFs with no extractable text (scanned images)
 *
 * Run: node scripts/scraper/scrape-pdfs.mjs [--dry-run] [--url <partial>]
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
const pdfParse = require('pdf-parse');

// ── Config ────────────────────────────────────────────────────────────────────
const TENANT_ID    = 'baltazar';
const DOCS_URL     = 'https://www.bak.hr/o-nama/dokumenti';
const ENTITY_TYPE  = 'dokument';
const MIN_TEXT_LEN = 100;   // below this → treat as scanned image PDF
const DELAY_MS     = 800;   // polite delay between PDF downloads

const DRY_RUN    = process.argv.includes('--dry-run');
const URL_FILTER = (() => {
  const idx = process.argv.indexOf('--url');
  return idx >= 0 ? process.argv[idx + 1] : null;
})();

// ── DB / OpenAI ───────────────────────────────────────────────────────────────
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 2,
});

const openai = new OpenAI.default({ apiKey: process.env.OPENAI_API_KEY });

// ── Content-group mapping ─────────────────────────────────────────────────────
function pdfToContentGroup(name) {
  const n = name.toLowerCase();
  if (/cjelozivot|cjeloživot/.test(n)) return 'cjelozivotno_obrazovanje';
  if (/upis|upisni|upisa/.test(n))     return 'upisi';
  if (/nastava|izvedbeni|studij|kolegij|semestar/.test(n)) return 'studijski_programi';
  if (/online/.test(n))                return 'online_studiranje';
  return 'opcenito';
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

/** Fetch an HTML page, return body string or null on error. */
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
    console.warn(`  ⚠️  HTTP ${code} fetching HTML — ${url}`);
    return null;
  }
}

/** Download a PDF and return its ArrayBuffer, or null on error. */
async function fetchPdf(url) {
  try {
    const resp = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 30000,
      maxRedirects: 5,
      headers: {
        'User-Agent': 'Mozilla/5.0 BaltazarBot/1.0 (university-chatbot; info@bak.hr)',
      },
    });
    return Buffer.from(resp.data);
  } catch (err) {
    const code = err.response?.status || err.code;
    throw new Error(`HTTP ${code} downloading PDF`);
  }
}

/**
 * Extract all PDF links from the dokumenti page HTML.
 * Returns array of { url, label } objects.
 */
function extractPdfLinks(html, baseUrl) {
  const $ = cheerio.load(html);
  const links = [];
  const seen  = new Set();

  $('a[href]').each((_, el) => {
    const href  = $(el).attr('href') || '';
    const label = $(el).text().trim() || '';

    // Match explicit .pdf extension or PDF download paths
    const isPdf = /\.pdf(\?.*)?$/i.test(href) ||
                  /\/download\//i.test(href) && /pdf/i.test(href);
    if (!isPdf) return;

    // Resolve relative URLs
    let resolved;
    try {
      resolved = new URL(href, baseUrl).href;
    } catch {
      return; // skip malformed URLs
    }

    if (seen.has(resolved)) return;
    seen.add(resolved);
    links.push({ url: resolved, label });
  });

  return links;
}

/**
 * Clean raw PDF text:
 *  - Remove lines that are standalone page numbers
 *  - Remove very short lines (< 20 chars) repeated 3+ times (headers/footers)
 *  - Normalize whitespace
 */
function cleanPdfText(raw) {
  const lines = raw.split('\n');

  // Count line occurrences (trimmed) to detect repeated headers/footers
  const freq = {};
  for (const line of lines) {
    const t = line.trim();
    if (t.length > 0 && t.length < 20) {
      freq[t] = (freq[t] || 0) + 1;
    }
  }
  const repeatedShort = new Set(
    Object.entries(freq).filter(([, c]) => c >= 3).map(([t]) => t)
  );

  const cleaned = lines.filter(line => {
    const t = line.trim();
    if (!t) return true;                          // keep blank lines (structure)
    if (/^\d+$/.test(t)) return false;            // standalone page numbers
    if (repeatedShort.has(t)) return false;       // repeated short lines
    return true;
  });

  return cleaned
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')   // collapse excess blank lines
    .replace(/[ \t]{2,}/g, ' ')   // collapse horizontal whitespace
    .trim();
}

/**
 * Split PDF text into sections by major headings.
 * A "major heading" is:
 *  - A line in ALL CAPS (min 4 chars), OR
 *  - A line followed by a blank line (preceded by blank or start)
 *
 * Returns array of { heading, text } suitable for buildChunks.
 */
function pdfToSections(text, docTitle) {
  const lines = text.split('\n');
  const sections = [];

  let currentHeading = docTitle;
  let currentLines   = [];

  function flushSection() {
    const body = currentLines.join('\n').trim();
    if (body.length >= 50) {
      sections.push({ heading: currentHeading, text: body });
    }
    currentLines = [];
  }

  for (let i = 0; i < lines.length; i++) {
    const line    = lines[i];
    const trimmed = line.trim();
    const prev    = i > 0 ? lines[i - 1].trim() : '';
    const next    = i < lines.length - 1 ? lines[i + 1].trim() : '';

    // Detect ALL CAPS heading (min 4 non-space chars, not a number-only line)
    const isAllCaps = trimmed.length >= 4 &&
                      trimmed === trimmed.toUpperCase() &&
                      /[A-ZČĆŽŠĐ]/.test(trimmed) &&
                      !/^\d+\.?\s/.test(trimmed);

    // Detect heading-like line: non-empty, followed by blank line,
    // and preceded by blank line or start of doc
    const isFollowedByBlank = next === '' && trimmed.length > 0;
    const isPrecededByBlank = prev === '';
    const isHeadingByContext = isFollowedByBlank && isPrecededByBlank && trimmed.length < 120;

    if ((isAllCaps || isHeadingByContext) && trimmed.length > 0) {
      flushSection();
      currentHeading = trimmed;
    } else {
      currentLines.push(line);
    }
  }
  flushSection();

  // If we got no sections at all, treat entire text as one section
  if (sections.length === 0 && text.trim().length > 0) {
    sections.push({ heading: docTitle, text: text.trim() });
  }

  return sections;
}

/**
 * Derive a clean document title from the PDF link label or filename.
 */
function derivePdfTitle(label, url) {
  if (label && label.length > 3 && !/^https?:\/\//.test(label)) {
    // Clean up common label artefacts
    return label.replace(/\s+/g, ' ').trim();
  }
  // Fall back to filename without extension
  const filename = url.split('/').pop().split('?')[0];
  return decodeURIComponent(filename)
    .replace(/[-_]/g, ' ')
    .replace(/\.pdf$/i, '')
    .trim();
}

// ── Embedding ─────────────────────────────────────────────────────────────────

async function embedBatch(texts) {
  const response = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: texts,
  });
  return response.data.map(d => d.embedding);
}

// ── DB upsert ─────────────────────────────────────────────────────────────────

async function upsertChunks(url, entityName, contentGroup, chunks) {
  if (chunks.length === 0) return 0;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Find or create parent document
    const existing = await client.query(
      `SELECT id FROM documents WHERE tenant_id = $1 AND source_url = $2 LIMIT 1`,
      [TENANT_ID, url]
    );

    let documentId;
    if (existing.rows.length > 0) {
      documentId = existing.rows[0].id;
      await client.query(
        `UPDATE documents
         SET title = $1, entity_type = $2, entity_name = $3,
             content = $4, is_active = true,
             last_crawled_at = NOW(), updated_at = NOW()
         WHERE id = $5`,
        [entityName, ENTITY_TYPE, entityName, entityName, documentId]
      );
    } else {
      const ins = await client.query(
        `INSERT INTO documents
           (tenant_id, source_url, title, entity_type, entity_name,
            content, language, is_active, last_crawled_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'hr', true, NOW())
         RETURNING id`,
        [TENANT_ID, url, entityName, ENTITY_TYPE, entityName, entityName]
      );
      documentId = ins.rows[0].id;
    }

    // Delete old chunks
    await client.query(
      `DELETE FROM document_chunks WHERE document_id = $1`,
      [documentId]
    );

    // Insert new chunks
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const vec   = `[${chunk.embedding.join(',')}]`;
      await client.query(
        `INSERT INTO document_chunks
           (document_id, tenant_id, content, embedding, url, title,
            entity_name, entity_type, content_group, chunk_index)
         VALUES ($1, $2, $3, $4::vector, $5, $6, $7, $8, $9, $10)`,
        [
          documentId, TENANT_ID, chunk.content, vec, url,
          chunk.heading || entityName, entityName,
          ENTITY_TYPE, contentGroup, i,
        ]
      );
    }

    await client.query('COMMIT');
    return chunks.length;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ── Per-PDF processing ────────────────────────────────────────────────────────

async function processPdf(link, index, total) {
  const { url, label } = link;
  const prefix = `[${String(index + 1).padStart(2)}/${total}]`;

  const title        = derivePdfTitle(label, url);
  const contentGroup = pdfToContentGroup(title + ' ' + url);

  process.stdout.write(`${prefix} ${title} ...\n`);

  // Skip English-language documents — chatbot is Croatian-only
  if (/english|course catalogue|en_/i.test(title + ' ' + url)) {
    console.log(`   ⏭️  SKIP (English document)`);
    return { status: 'skipped', chunks: 0 };
  }

  // 1. Download
  let buffer;
  try {
    buffer = await fetchPdf(url);
  } catch (err) {
    console.log(`   ❌  ERROR downloading: ${err.message}`);
    return { status: 'error', chunks: 0 };
  }

  // 2. Parse PDF text
  let rawText;
  try {
    const data = await pdfParse(buffer);
    rawText = data.text || '';
  } catch (err) {
    console.log(`   ❌  ERROR parsing PDF: ${err.message}`);
    return { status: 'error', chunks: 0 };
  }

  // 3. Check for extractable text
  const cleanedText = cleanPdfText(rawText);
  if (cleanedText.length < MIN_TEXT_LEN) {
    console.log(`   ⚠️  SKIP (no extractable text — likely scanned image)`);
    return { status: 'skipped', chunks: 0 };
  }

  // 4. Split into sections → chunks
  const sections  = pdfToSections(cleanedText, title);
  const rawChunks = buildChunks(sections, title);

  if (rawChunks.length === 0) {
    console.log(`   ⚠️  SKIP (0 chunks produced after splitting)`);
    return { status: 'skipped', chunks: 0 };
  }

  // 5. Dry-run: just report
  if (DRY_RUN) {
    console.log(`   [DRY] ${rawChunks.length} chunks (content_group: ${contentGroup})`);
    rawChunks.slice(0, 2).forEach(c =>
      console.log(`      "${c.content.slice(0, 120)}..."`)
    );
    return { status: 'dry', chunks: rawChunks.length };
  }

  // 6. Embed in batches of 20
  const BATCH      = 20;
  const embeddings = [];
  for (let i = 0; i < rawChunks.length; i += BATCH) {
    const batch = rawChunks.slice(i, i + BATCH).map(c => c.content);
    const vecs  = await embedBatch(batch);
    embeddings.push(...vecs);
  }

  const enriched = rawChunks.map((c, i) => ({ ...c, embedding: embeddings[i] }));

  // 7. Upsert to Supabase
  const count = await upsertChunks(url, title, contentGroup, enriched);
  console.log(`   ✅  ${count} chunks (content_group: ${contentGroup})`);
  return { status: 'ok', chunks: count };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n🔍 Fetching ${DOCS_URL} ...`);

  const html = await fetchHtml(DOCS_URL);
  if (!html) {
    console.error('❌  Could not fetch dokumenti page. Aborting.');
    process.exit(1);
  }

  let pdfLinks = extractPdfLinks(html, DOCS_URL);

  if (pdfLinks.length === 0) {
    console.warn('⚠️  No PDF links found on the page.');
    await pool.end();
    return;
  }

  console.log(`   Found ${pdfLinks.length} PDF links`);

  // Apply --url filter
  if (URL_FILTER) {
    pdfLinks = pdfLinks.filter(l => l.url.includes(URL_FILTER));
    console.log(`   (filtered to ${pdfLinks.length} by --url "${URL_FILTER}")`);
  }

  console.log(DRY_RUN ? '\n   Mode: DRY RUN (no DB writes)\n' : '\n   Mode: LIVE\n');

  const stats = { ok: 0, skipped: 0, error: 0, total_chunks: 0 };

  for (let i = 0; i < pdfLinks.length; i++) {
    try {
      const result = await processPdf(pdfLinks[i], i, pdfLinks.length);
      if (result.status === 'ok' || result.status === 'dry') stats.ok++;
      else if (result.status === 'skipped') stats.skipped++;
      else stats.error++;
      stats.total_chunks += result.chunks;
    } catch (err) {
      console.log(`   ❌  UNEXPECTED ERROR: ${err.message}`);
      stats.error++;
    }

    if (!DRY_RUN && i < pdfLinks.length - 1) await sleep(DELAY_MS);
  }

  console.log('\n═══════════════════════════════');
  console.log('✅  OK:          ', stats.ok);
  console.log('⚠️   Preskočeno: ', stats.skipped);
  console.log('❌  Greška:      ', stats.error);
  console.log('📦  Ukupno chunks:', stats.total_chunks);
  console.log('═══════════════════════════════\n');

  await pool.end();
}

main().catch(err => {
  console.error('FATAL:', err);
  pool.end();
  process.exit(1);
});
