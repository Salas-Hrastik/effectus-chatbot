/**
 * Nastavnici scraper — fetches all teacher/staff profiles via WordPress REST API.
 *
 * Source: https://www.bak.hr/wp-json/wp/v2/nastavnici-suradnici
 * The WordPress CPT 'nastavnici-suradnici' contains 134 teacher records with bio
 * content in `content.rendered`. This is the authoritative source — individual
 * HTML profile pages are JavaScript-rendered and redirect to other pages.
 *
 * Run:
 *   node scripts/scraper/scrape-nastavnici.mjs             # all profiles
 *   node scripts/scraper/scrape-nastavnici.mjs --dry-run   # no DB writes
 */

import { readFileSync } from 'fs';
import https from 'https';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

// Bypass self-signed cert issues
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

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
const TENANT_ID    = 'baltazar';
const ENTITY_TYPE  = 'nastavnik';
const CONTENT_GROUP = 'nastavnici';
const DELAY_MS     = 300;
const DRY_RUN      = process.argv.includes('--dry-run');
const API_BASE     = 'https://www.bak.hr/wp-json/wp/v2/nastavnici-suradnici';

// ── Email lookup from our known teacher list ──────────────────────────────────
// Keyed by normalised name for fuzzy matching
const EMAIL_MAP = new Map([
  ["aco momcilovic", "aco.momcilovic@mba-croatia.hr"],
  ["ana cvetinovic vlahovic", "acvetinovicvlahovic@bak.hr"],
  ["barbara franic", "barbara.franic@bak.hr"],
  ["dario lesic", "dlesic@bak.hr"],
  ["dasa panjakovic senjic", "dpanjakovic@bak.hr"],
  ["darija ivandic vidovic", "divandic@bak.hr"],
  ["ivica klinac", "iklinac@bak.hr"],
  ["martina vukasina", "mvukasina@bak.hr"],
  ["milan puvaca", "mpuvaca@bak.hr"],
  ["sanela ravlic", "sravlic@bak.hr"],
  ["vesna obradovic", "vobradovic@bak.hr"],
  ["maja buljat", "mbuljat@bak.hr"],
  ["alisa bilal zoric", "abilalzoric@bak.hr"],
  ["ana skledar corluka", "askleda@bak.hr"],
  ["antal balog", "abalog@bak.hr"],
  ["branko mihaljevic", "bmihaljevic@bak.hr"],
  ["denis hrestak", "dhrestak@bak.hr"],
  ["goran jelen", "gjelen@bak.hr"],
  ["hrvoje ocevcic", "hocevic@bak.hr"],
  ["irena bosnic", "ibosnic@bak.hr"],
  ["ivana cunjak matakovic", "icunjak@bak.hr"],
  ["josip kereta", "jkereta@bak.hr"],
  ["konstanca korencic kampl", "kkampl@bak.hr"],
  ["lana domsic", "ldomsic@bak.hr"],
  ["luka balvan", "lbalvan@bak.hr"],
  ["mario spundak", "mspundak@bak.hr"],
  ["matej galic", "mgalic@bak.hr"],
  ["milorad cupurdija", "mcupurdija@bak.hr"],
  ["ninoslav greguric bajza", "ngreguric@bak.hr"],
  ["pave ivic", "pivic@bak.hr"],
  ["sendi dezelic", "sdezelic@bak.hr"],
  ["stjepan lackovic", "slackovic@bak.hr"],
  ["tomislav cerinski", "tcerinski@bak.hr"],
  ["tomislav rastovski", "trastovski@bak.hr"],
  ["zlatko barilovic", "zbarilovic@bak.hr"],
  ["dafne vidanec", "dvidanec@bak.hr"],
  ["bruno raguz", "braguž@bak.hr"],
  ["ivana lackovic", "ilackovic@bak.hr"],
  ["kristijan covic", "kcovic@bak.hr"],
  ["sasa bilic", "sbilic@bak.hr"],
  ["suzana herman", "sherman@bak.hr"],
  ["vinko mostarac", "vmostarac@bak.hr"],
  ["zlatko resetar", "zresetar@bak.hr"],
  ["gabrijela cepo", "gcepo@bak.hr"],
  ["goranka majic", "gmajic@bak.hr"],
  ["ivan rupcic", "irupcic@bak.hr"],
  ["alan labus", "alabus@bak.hr"],
  ["ivan ruzic", "iruzi@bak.hr"],
  ["matija varga", "mvarga@bak.hr"],
  ["saso murtic", "n/a"],
  ["jadranka kardum uskok", null],
  ["jasenka crnkovic", "jcrnkovic@bak.hr"],
  ["karlo jurac", "kjurac@bak.hr"],
  ["kresimir jurina", "kjurina@bak.hr"],
  ["kristian sustar", "ksustar@bak.hr"],
  ["krunoslav colak", "kcolak@bak.hr"],
  ["ksenija vanjorek stojakovic", "kvanjorek@bak.hr"],
  ["lidija djevoic", "ldjevoic@bak.hr"],
  ["lidija muller", "lmuller@bak.hr"],
  ["marina baralic", "mbaralic@bak.hr"],
  ["marina bolanca radunovic", "mbolanca@bak.hr"],
  ["marin pajic", "mpajic@bak.hr"],
  ["marko simac", "msimac@bak.hr"],
  ["mateja sporcic", "msporcic@bak.hr"],
  ["ines jemric ostojic", "ijemric@bak.hr"],
  ["ivan madunic", "imaduni@bak.hr"],
  ["marko eljuga", "meljuga@bak.hr"],
  ["tamara obradovic mazal", "tobradovic@bak.hr"],
  ["zoran stanko", "zstanko@bak.hr"],
  ["natasa belamaric", "nbelamaric@bak.hr"],
  ["natalija jurina babovic", "njurina@bak.hr"],
  ["nikolina pavicic resetar", "npavicic@bak.hr"],
  ["petra stazic", "pstazic@bak.hr"],
  ["drago ruzic", "druzic@bak.hr"],
  ["sasa beslic", "sbeslic@bak.hr"],
  ["silvija vitkovic zizic", "svitkoviczizic@bak.hr"],
  ["stjepan santak", "ssantak@bak.hr"],
  ["tajana batur", "tbatur@bak.hr"],
  ["tena sijakovic", "tsijakovic@bak.hr"],
]);

// ── DB / OpenAI ───────────────────────────────────────────────────────────────
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 2,
});

const openai = new OpenAI.default({ apiKey: process.env.OPENAI_API_KEY });

// ── Helpers ───────────────────────────────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function normName(name) {
  return name.toLowerCase()
    .replace(/[čć]/g, 'c').replace(/ž/g, 'z').replace(/š/g, 's')
    .replace(/đ/g, 'd').replace(/[áàä]/g, 'a').replace(/[éèë]/g, 'e')
    .replace(/[íìï]/g, 'i').replace(/[óòö]/g, 'o').replace(/[úùüű]/g, 'u')
    // strip title prefixes
    .replace(/\b(nasl|izv|red|prof|doc|dr|sc|mr|mag|oec|pred|v|pred|visi|predavac|struc|spec|stud|univ|dipl|ing|mba|bacc)\b\.?/g, '')
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

function lookupEmail(name) {
  const normalised = normName(name);
  // Try exact key match
  if (EMAIL_MAP.has(normalised)) return EMAIL_MAP.get(normalised);
  // Fuzzy: find first key where all words of key appear in normalised name
  for (const [key, email] of EMAIL_MAP) {
    const keyWords = key.split(' ').filter(w => w.length >= 3);
    if (keyWords.every(w => normalised.includes(w))) return email;
  }
  return null;
}

function stripHtml(html) {
  const $ = cheerio.load(html);
  $('script, style, nav, footer').remove();
  return $.text().replace(/\s+/g, ' ').trim();
}

async function embed(text) {
  const resp = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: text,
  });
  return resp.data[0].embedding;
}

// ── Fetch all teachers from WP REST API ───────────────────────────────────────
async function fetchAllTeachersFromAPI() {
  const allItems = [];
  let page = 1;
  while (true) {
    const url = `${API_BASE}?per_page=100&page=${page}&_fields=id,slug,title,content,link`;
    try {
      const resp = await axios.get(url, {
        headers: { 'User-Agent': 'BaltazarBot/1.0' },
        timeout: 15000,
        httpsAgent,
      });
      const items = resp.data;
      if (!Array.isArray(items) || items.length === 0) break;
      allItems.push(...items);
      const totalPages = parseInt(resp.headers['x-wp-totalpages'] || '1', 10);
      if (page >= totalPages) break;
      page++;
      await sleep(300);
    } catch (err) {
      console.error(`  ❌ API error page ${page}: ${err.message}`);
      break;
    }
  }
  return allItems;
}

// ── Build text content for a teacher ─────────────────────────────────────────
function buildTeacherText(item) {
  const name = item.title.rendered;
  const link = item.link;
  const email = lookupEmail(name);
  const bioHtml = item.content.rendered || '';
  const bio = stripHtml(bioHtml);

  const lines = [`Nastavnik/Suradnik: ${name}`];
  if (email) lines.push(`E-pošta: ${email}`);
  lines.push(`Profil: ${link}`);
  if (bio && bio.length > 30) lines.push(`\n${bio}`);

  return { name, link, email, text: lines.join('\n') };
}

// ── Upsert to DB ──────────────────────────────────────────────────────────────
async function upsertProfile(name, url, email, chunks) {
  const existing = await pool.query(
    `SELECT id FROM documents WHERE tenant_id = $1 AND source_url = $2 LIMIT 1`,
    [TENANT_ID, url]
  );

  let documentId;
  if (existing.rows.length > 0) {
    documentId = existing.rows[0].id;
    await pool.query(
      `UPDATE documents SET title=$1, last_crawled_at=NOW(), updated_at=NOW() WHERE id=$2`,
      [name, documentId]
    );
  } else {
    const ins = await pool.query(
      `INSERT INTO documents
         (tenant_id, source_url, title, entity_type, entity_name, content, language, is_active, last_crawled_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'hr', true, NOW())
       RETURNING id`,
      [TENANT_ID, url, name, ENTITY_TYPE, name, name]
    );
    documentId = ins.rows[0].id;
  }

  await pool.query(`DELETE FROM document_chunks WHERE document_id = $1`, [documentId]);

  for (let i = 0; i < chunks.length; i++) {
    const vec = await embed(chunks[i].content);
    await pool.query(
      `INSERT INTO document_chunks
         (document_id, tenant_id, content, embedding, url, title,
          entity_name, entity_type, content_group, chunk_index)
       VALUES ($1, $2, $3, $4::vector, $5, $6, $7, $8, $9, $10)`,
      [documentId, TENANT_ID, chunks[i].content, JSON.stringify(vec),
       url, chunks[i].heading || name, name, ENTITY_TYPE, CONTENT_GROUP, i]
    );
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`👩‍🏫  Nastavnici scraper — Veleučilište Baltazar (via WP REST API)`);
  console.log(`   DRY_RUN: ${DRY_RUN}`);
  console.log('');

  // Step 1: fetch all teacher records from API
  console.log('📡  Fetching teacher data from WordPress REST API...');
  const items = await fetchAllTeachersFromAPI();
  console.log(`   Found ${items.length} teacher records.\n`);

  let ok = 0, skipped = 0, errors = 0, totalChunks = 0;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const name = item.title.rendered;
    console.log(`[${i + 1}/${items.length}] ${name}`);

    try {
      const { text, link, email } = buildTeacherText(item);

      if (!text || text.length < 30) {
        console.log(`   ⏭️  SKIP — nema sadržaja`);
        skipped++;
        continue;
      }

      const hasBio = (item.content.rendered || '').length > 50;
      const sections = [{ heading: name, text }];
      const chunks = buildChunks(sections, name);

      if (!chunks.length) {
        console.log(`   ⏭️  SKIP — 0 chunks`);
        skipped++;
        continue;
      }

      const bioStatus = hasBio ? '📝 bio' : '📋 basic';
      console.log(`   ✅  ${chunks.length} chunk(a) [${bioStatus}]`);

      if (!DRY_RUN) {
        await upsertProfile(name, link, email, chunks);
      }

      ok++;
      totalChunks += chunks.length;
    } catch (err) {
      console.error(`   ❌  Error: ${err.message}`);
      errors++;
    }

    await sleep(DELAY_MS);
  }

  console.log('\n══════════════════════════════════════════');
  console.log(`✅  OK:       ${ok} nastavnika`);
  console.log(`⏭️  Skipped:  ${skipped}`);
  console.log(`❌  Errors:   ${errors}`);
  console.log(`📦  Chunks:   ${totalChunks}`);
  console.log(`💾  DB write: ${DRY_RUN ? 'NO (dry-run)' : 'YES'}`);
  console.log('══════════════════════════════════════════');

  await pool.end();
}

main().catch(err => { console.error(err); process.exit(1); });
