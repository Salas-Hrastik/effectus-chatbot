/**
 * Predmeti scraper — crawls all /predmeti/ course pages on bak.hr.
 *
 * Each course page contains: Cilj predmeta, (Sadržaj predmeta), Ishodi učenja,
 * Kratke informacije (semestar, vrsta, razina) and Nastavnici i suradnici.
 *
 * Discovers course URLs from study-program pages, then scrapes and upserts
 * each course as entity_type='predmet', content_group='studijski_programi'.
 *
 * Run: node scripts/scraper/scrape-predmeti.mjs [--dry-run] [--url <slug>]
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

const { Pool }  = require('pg');
const OpenAI    = require('openai');
const axios     = require('axios');

const TENANT_ID  = 'baltazar';
const DRY_RUN    = process.argv.includes('--dry-run');
const URL_FILTER = (() => {
  const idx = process.argv.indexOf('--url');
  return idx >= 0 ? process.argv[idx + 1] : null;
})();
const DELAY_MS   = 400;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 2,
});

const openai = new OpenAI.default({ apiKey: process.env.OPENAI_API_KEY });

// ── Study program pages that link to /predmeti/ ───────────────────────────────

const STUDY_PROGRAM_URLS = [
  'https://www.bak.hr/studijski-programi/primijenjena-ekonomija',
  'https://www.bak.hr/studijski-programi/poslovna-ekonomija-i-financije',
  'https://www.bak.hr/studijski-programi/menadzment-uredskog-poslovanja',
  'https://www.bak.hr/studijski-programi/menadzment-u-kulturi-i-kulturnom-turizmu',
  'https://www.bak.hr/studijski-programi/informacijske-tehnologije',
  'https://www.bak.hr/studijski-programi/socijalna-i-kulturna-integracija',
  'https://www.bak.hr/studijski-programi/menadzment-u-turizmu-i-ugostiteljstvu',
  'https://www.bak.hr/studijski-programi/poslovna-ekonomija-i-financije-biograd-n-m',
  'https://www.bak.hr/studijski-programi/financije-i-investicije-novo',
  'https://www.bak.hr/studijski-programi/primijenjene-informacijske-tehnologije',
  'https://www.bak.hr/studijski-programi/projektni-menadzment',
  'https://www.bak.hr/studijski-programi/projektni-menadzment-osijek',
  'https://www.bak.hr/studijski-programi/komunikacijski-menadzment',
  'https://www.bak.hr/studijski-programi/menadzment-javnog-sektora',
];

// ── Discover all unique /predmeti/ URLs ───────────────────────────────────────

async function discoverPredmetiUrls() {
  const all = new Set();
  for (const studyUrl of STUDY_PROGRAM_URLS) {
    try {
      const r = await axios.get(studyUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 BaltazarBot/1.0 (info@bak.hr)' },
        timeout: 10000,
      });
      const matches = [...r.data.matchAll(/href="(https?:\/\/www\.bak\.hr\/predmeti\/[^"]+)"/g)];
      for (const m of matches) {
        const url = m[1].replace(/\/$/, '') + '/';
        all.add(url);
      }
    } catch (e) {
      console.warn(`  ⚠️  Failed to fetch ${studyUrl}: ${e.message}`);
    }
  }
  return [...all].sort();
}

// ── Extract course info from HTML ─────────────────────────────────────────────

function extractPredmetInfo(html, url) {
  // Strip scripts and styles
  const clean = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, '\n')
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0);

  // Course title from <title> tag
  const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
  const title = titleMatch
    ? titleMatch[1].replace(/\s*-\s*Veleučilište.*$/i, '').trim()
    : url.split('/predmeti/')[1]?.replace(/[/-]/g, ' ').trim() || 'Kolegij';

  // Find second occurrence of key labels (first is in navigation tabs)
  // Strategy: scan lines and pick up content after the second heading block
  let ciljParagraph = '';
  let sadrzajText = '';
  let ishodiText = '';
  let nastavnici = '';
  let semestar = '';
  let razina = '';
  let vrsta = '';

  let ciljCount = 0;
  let inCilj = false;
  let inSadrzaj = false;
  let inIshodi = false;
  let inNastavnici = false;

  const STOP_LABELS = new Set([
    'Sadržaj predmeta', 'Ishodi učenja', 'Kratke informacije',
    'Oznaka predmeta', 'Vrsta predmeta', 'Razina studija', 'Semestar',
    'ECTS', 'Nastavnici i suradnici', 'Literatura',
    'Veleučilište s pravom javnosti BALTAZAR ZAPREŠIĆ',
  ]);

  for (let i = 0; i < clean.length; i++) {
    const line = clean[i];

    if (line === 'Cilj predmeta') {
      ciljCount++;
      if (ciljCount >= 2) { inCilj = true; inSadrzaj = false; inIshodi = false; }
      continue;
    }
    if (line === 'Sadržaj predmeta') {
      inCilj = false; inSadrzaj = true; inIshodi = false; continue;
    }
    if (line === 'Ishodi učenja') {
      inCilj = false; inSadrzaj = false; inIshodi = true; continue;
    }
    if (line === 'Kratke informacije' || line === 'Oznaka predmeta') {
      inCilj = false; inSadrzaj = false; inIshodi = false; continue;
    }
    if (line === 'Vrsta predmeta')  { inCilj = false; vrsta = clean[i + 1] || ''; continue; }
    if (line === 'Razina studija')  { razina = clean[i + 1] || ''; continue; }
    if (line === 'Semestar')        { semestar = clean[i + 1] || ''; continue; }
    if (line === 'Nastavnici i suradnici') {
      inNastavnici = true;
      inCilj = false; inSadrzaj = false; inIshodi = false;
      continue;
    }

    if (inCilj && !STOP_LABELS.has(line)) {
      ciljParagraph += (ciljParagraph ? ' ' : '') + line;
    }
    if (inSadrzaj && !STOP_LABELS.has(line)) {
      sadrzajText += (sadrzajText ? '\n' : '') + line;
    }
    if (inIshodi && !STOP_LABELS.has(line)) {
      if (STOP_LABELS.has(line)) { inIshodi = false; }
      else ishodiText += (ishodiText ? '\n' : '') + line;
    }
    if (inNastavnici) {
      if (STOP_LABELS.has(line) || line.startsWith('Veleučilište') || line.includes('10290 Zaprešić')) {
        inNastavnici = false;
      } else if (line.length > 3 && !line.startsWith('Copyright') && !line.includes('@bak.hr')) {
        nastavnici += (nastavnici ? ', ' : '') + line;
        if (nastavnici.length > 200) inNastavnici = false;
      }
    }
  }

  return { title, ciljParagraph, sadrzajText, ishodiText, nastavnici, semestar, razina, vrsta };
}

// ── Build text chunk from extracted info ──────────────────────────────────────

function buildPredmetChunk(info, url) {
  const parts = [];
  parts.push(`Kolegij: ${info.title}`);
  if (info.razina)         parts.push(`Razina studija: ${info.razina}`);
  if (info.semestar)       parts.push(`Semestar: ${info.semestar}`);
  if (info.vrsta)          parts.push(`Vrsta predmeta: ${info.vrsta}`);
  if (info.nastavnici)     parts.push(`Nastavnici: ${info.nastavnici}`);
  if (info.ciljParagraph)  parts.push(`\nCilj predmeta: ${info.ciljParagraph}`);
  if (info.sadrzajText)    parts.push(`\nSadržaj predmeta:\n${info.sadrzajText}`);
  if (info.ishodiText)     parts.push(`\nIshodi učenja:\n${info.ishodiText}`);

  const content = parts.join('\n');
  return content.length >= 50 ? content : null;
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

async function upsertPredmet(url, title, content, embedding) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const existing = await client.query(
      `SELECT id FROM documents WHERE tenant_id = $1 AND source_url = $2 LIMIT 1`,
      [TENANT_ID, url]
    );

    let documentId;
    if (existing.rows.length > 0) {
      documentId = existing.rows[0].id;
      await client.query(
        `UPDATE documents SET title=$1, entity_type='predmet', entity_name=$2,
         content=$3, is_active=true, last_crawled_at=NOW(), updated_at=NOW() WHERE id=$4`,
        [title, title, title, documentId]
      );
    } else {
      const ins = await client.query(
        `INSERT INTO documents (tenant_id, source_url, title, entity_type, entity_name,
           content, language, is_active, last_crawled_at)
         VALUES ($1, $2, $3, 'predmet', $4, $5, 'hr', true, NOW()) RETURNING id`,
        [TENANT_ID, url, title, title, title]
      );
      documentId = ins.rows[0].id;
    }

    await client.query(`DELETE FROM document_chunks WHERE document_id = $1`, [documentId]);

    const vec = `[${embedding.join(',')}]`;
    await client.query(
      `INSERT INTO document_chunks
         (document_id, tenant_id, content, embedding, url, title,
          entity_name, entity_type, content_group, chunk_index)
       VALUES ($1, $2, $3, $4::vector, $5, $6, $7, 'predmet', 'studijski_programi', 0)`,
      [documentId, TENANT_ID, content, vec, url, title, title]
    );

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ── Fetch ─────────────────────────────────────────────────────────────────────

async function fetchPage(url) {
  try {
    const r = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 BaltazarBot/1.0 (university-chatbot; info@bak.hr)',
        'Accept-Language': 'hr,en;q=0.5',
        'Accept': 'text/html',
      },
      timeout: 12000,
      maxRedirects: 5,
    });
    return r.data;
  } catch (err) {
    console.warn(`  ⚠️  HTTP ${err.response?.status || err.code} — ${url}`);
    return null;
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n🔍 Discovering /predmeti/ URLs from study program pages...');
  let predmetiUrls = await discoverPredmetiUrls();

  if (URL_FILTER) {
    predmetiUrls = predmetiUrls.filter(u => u.includes(URL_FILTER));
  }

  console.log(`✅ Found ${predmetiUrls.length} unique predmet pages\n`);
  console.log(DRY_RUN ? '   Mode: DRY RUN\n' : '   Mode: LIVE\n');

  const stats = { ok: 0, empty: 0, error: 0 };
  const BATCH_SIZE = 20;
  const pending = [];

  const flush = async () => {
    if (!pending.length) return;
    const texts = pending.map(p => p.content);
    const embeddings = await embedBatch(texts);
    for (let i = 0; i < pending.length; i++) {
      await upsertPredmet(pending[i].url, pending[i].title, pending[i].content, embeddings[i]);
    }
    pending.length = 0;
  };

  for (let i = 0; i < predmetiUrls.length; i++) {
    const url = predmetiUrls[i];
    const prefix = `[${String(i + 1).padStart(3)}/${predmetiUrls.length}]`;
    process.stdout.write(`${prefix} ${url} ... `);

    try {
      const html = await fetchPage(url);
      if (!html) { process.stdout.write('❌ fetch error\n'); stats.error++; continue; }

      const info = extractPredmetInfo(html, url);
      const content = buildPredmetChunk(info, url);

      if (!content) {
        process.stdout.write('⚠️  empty\n');
        stats.empty++;
        continue;
      }

      if (DRY_RUN) {
        process.stdout.write(`[DRY] ${info.title} (${content.length} chars)\n`);
        console.log('  ' + content.slice(0, 200).replace(/\n/g, '\n  '));
        stats.ok++;
        continue;
      }

      pending.push({ url, title: info.title, content });
      process.stdout.write(`✅ ${info.title}\n`);
      stats.ok++;

      if (pending.length >= BATCH_SIZE) {
        await flush();
      }

      await sleep(DELAY_MS);
    } catch (err) {
      process.stdout.write(`❌ ERROR: ${err.message}\n`);
      stats.error++;
    }
  }

  if (!DRY_RUN) await flush();

  console.log('\n═══════════════════════════════');
  console.log('✅  OK:       ', stats.ok);
  console.log('⚠️   Prazno:  ', stats.empty);
  console.log('❌  Greška:   ', stats.error);
  console.log(`📦  Ukupno predmeta: ${stats.ok}`);
  console.log('═══════════════════════════════\n');

  await pool.end();
}

main().catch(err => {
  console.error('FATAL:', err);
  pool.end();
  process.exit(1);
});
