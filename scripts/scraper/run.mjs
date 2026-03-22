/**
 * Re-scraping pipeline for bak.hr → Supabase
 *
 * Steps:
 *  1. Fetch each page from PAGES list
 *  2. Clean HTML → structured sections
 *  3. Chunk sections into 300-900 char pieces
 *  4. Generate OpenAI embeddings (text-embedding-3-small)
 *  5. Delete old chunks for this URL, insert new ones
 *
 * Run: node scripts/scraper/run.mjs [--dry-run] [--url <partial-url>]
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

import { PAGES, SKIP_PATTERNS } from './urls.mjs';
import { extractSections, extractTitle } from './clean.mjs';
import { buildChunks } from './chunk.mjs';

const { Pool }   = require('pg');
const OpenAI     = require('openai');
const axios      = require('axios');

const TENANT_ID  = process.env.TENANT_ID || 'effectus';
const DRY_RUN    = process.argv.includes('--dry-run');
const URL_FILTER = (() => {
  const idx = process.argv.indexOf('--url');
  return idx >= 0 ? process.argv[idx + 1] : null;
})();
const DELAY_MS   = 600;  // respectful delay between requests

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 2,
});

const openai = new OpenAI.default({ apiKey: process.env.OPENAI_API_KEY });

// ── Helpers ───────────────────────────────────────────────────────────────────

async function fetchPage(url) {
  try {
    const resp = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 EffectusBot/1.0 (university-chatbot; info@effectus.com.hr)',
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

async function embedBatch(texts) {
  // OpenAI allows up to 2048 inputs per request but we stay conservative
  const response = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: texts,
  });
  return response.data.map(d => d.embedding);
}

/** Map scraper entity_type → content_group used by RAG retrieval filters */
function entityTypeToContentGroup(entityType) {
  switch (entityType) {
    case 'studij':               return 'studijski_programi';
    case 'upisi':                return 'upisi';
    case 'online_studij':        return 'online_studiranje';
    case 'cjelozivotni_program': return 'cjelozivotno_obrazovanje';
    default:                     return 'opcenito';
  }
}

async function upsertChunks(url, entityType, entityName, pageTitle, chunks) {
  if (chunks.length === 0) return 0;

  const docTitle = pageTitle || entityName;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Find or create the parent document record
    //    (documents table has no unique constraint on source_url, so use SELECT + INSERT/UPDATE)
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
        [docTitle, entityType, entityName, docTitle, documentId]
      );
    } else {
      const ins = await client.query(
        `INSERT INTO documents
           (tenant_id, source_url, title, entity_type, entity_name,
            content, language, is_active, last_crawled_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'hr', true, NOW())
         RETURNING id`,
        [TENANT_ID, url, docTitle, entityType, entityName, docTitle]
      );
      documentId = ins.rows[0].id;
    }

    // 2. Delete old chunks for this document
    await client.query(
      `DELETE FROM document_chunks WHERE document_id = $1`,
      [documentId]
    );

    // 3. Insert new chunks (with content_group so RAG filters work)
    const contentGroup = entityTypeToContentGroup(entityType);
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const vec = `[${chunk.embedding.join(',')}]`;
      await client.query(
        `INSERT INTO document_chunks
           (document_id, tenant_id, content, embedding, url, title,
            entity_name, entity_type, content_group, chunk_index)
         VALUES ($1, $2, $3, $4::vector, $5, $6, $7, $8, $9, $10)`,
        [documentId, TENANT_ID, chunk.content, vec, url,
         chunk.heading || entityName, entityName, entityType, contentGroup, i]
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

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function processPage(page) {
  const { url, entity_type, entity_name } = page;

  // Skip if URL_FILTER set and doesn't match
  if (URL_FILTER && !url.includes(URL_FILTER)) return null;

  // Skip unwanted patterns
  if (SKIP_PATTERNS.some(p => p.test(url))) {
    console.log(`  ⏭️  SKIP (pattern) — ${url}`);
    return null;
  }

  const html = await fetchPage(url);
  if (!html) return { url, status: 'error', chunks: 0 };

  const pageTitle = extractTitle(html);
  const sections  = extractSections(html, url);
  const rawChunks = buildChunks(sections, pageTitle || entity_name);

  if (rawChunks.length === 0) {
    console.log(`  ⚠️  0 chunks — ${url}`);
    return { url, status: 'empty', chunks: 0 };
  }

  if (DRY_RUN) {
    console.log(`  [DRY] ${rawChunks.length} chunks — ${url}`);
    rawChunks.slice(0, 2).forEach(c =>
      console.log(`    "${c.content.slice(0, 100)}..."`)
    );
    return { url, status: 'dry', chunks: rawChunks.length };
  }

  // Embed in batches of 20
  const BATCH = 20;
  const embeddings = [];
  for (let i = 0; i < rawChunks.length; i += BATCH) {
    const batch = rawChunks.slice(i, i + BATCH).map(c => c.content);
    const vecs  = await embedBatch(batch);
    embeddings.push(...vecs);
  }

  const enriched = rawChunks.map((c, i) => ({ ...c, embedding: embeddings[i] }));
  const count    = await upsertChunks(url, entity_type, entity_name, pageTitle, enriched);

  return { url, status: 'ok', chunks: count };
}

async function main() {
  const pages = URL_FILTER
    ? PAGES.filter(p => p.url.includes(URL_FILTER))
    : PAGES;

  console.log(`\n🚀 Effectus scraping — ${pages.length} stranica`);
  console.log(DRY_RUN ? '   Mode: DRY RUN (bez upisa u Supabase)\n' : '   Mode: LIVE\n');

  const stats = { ok: 0, empty: 0, error: 0, total_chunks: 0 };

  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    const prefix = `[${String(i+1).padStart(2)}/${pages.length}]`;
    process.stdout.write(`${prefix} ${page.url} ... `);

    try {
      const result = await processPage(page);
      if (!result) {
        process.stdout.write('skip\n');
        continue;
      }
      const icon = result.status === 'ok' ? '✅' : result.status === 'empty' ? '⚠️' : '❌';
      process.stdout.write(`${icon} ${result.chunks} chunks\n`);
      stats[result.status === 'ok' || result.status === 'dry' ? 'ok' : result.status]++;
      stats.total_chunks += result.chunks;
    } catch (err) {
      process.stdout.write(`❌ ERROR: ${err.message}\n`);
      stats.error++;
    }

    if (!DRY_RUN) await sleep(DELAY_MS);
  }

  console.log('\n═══════════════════════════════');
  console.log('✅  OK:       ', stats.ok);
  console.log('⚠️   Prazno:  ', stats.empty);
  console.log('❌  Greška:   ', stats.error);
  console.log('📦  Ukupno chunks:', stats.total_chunks);
  console.log('═══════════════════════════════\n');

  await pool.end();
}

main().catch(err => {
  console.error('FATAL:', err);
  pool.end();
  process.exit(1);
});
