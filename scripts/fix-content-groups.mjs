/**
 * Fix NULL content_group on all document_chunks for tenant 'baltazar'.
 * Maps entity_type → content_group to match the RAG retrieval filters.
 *
 * Run: node scripts/fix-content-groups.mjs
 */

import { readFileSync } from 'fs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const env = readFileSync('.env.local', 'utf8');
for (const line of env.split('\n')) {
  const m = line.match(/^([^#=\s][^=]*)=(.*)$/);
  if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
}

const { Pool } = require('pg');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 2,
});

const TENANT_ID = 'baltazar';

const MAPPING = [
  { entity_type: 'studij',               content_group: 'studijski_programi' },
  { entity_type: 'upisi',                content_group: 'upisi' },
  { entity_type: 'online_studij',        content_group: 'online_studiranje' },
  { entity_type: 'cjelozivotni_program', content_group: 'cjelozivotno_obrazovanje' },
  { entity_type: 'opcenito',             content_group: 'opcenito' },
];

async function main() {
  const client = await pool.connect();
  try {
    console.log(`\n🔧 Fixing content_group for tenant: ${TENANT_ID}\n`);

    for (const { entity_type, content_group } of MAPPING) {
      const result = await client.query(
        `UPDATE document_chunks
         SET content_group = $1
         WHERE tenant_id = $2
           AND entity_type = $3
           AND (content_group IS NULL OR content_group != $1)`,
        [content_group, TENANT_ID, entity_type]
      );
      console.log(`  entity_type='${entity_type}' → content_group='${content_group}' — ${result.rowCount} rows updated`);
    }

    // Verify
    const stats = await client.query(
      `SELECT content_group, entity_type, COUNT(*) as cnt
       FROM document_chunks
       WHERE tenant_id = $1
       GROUP BY content_group, entity_type
       ORDER BY content_group, entity_type`,
      [TENANT_ID]
    );
    console.log('\n📊 Final content_group distribution:');
    for (const row of stats.rows) {
      console.log(`  content_group='${row.content_group ?? 'NULL'}' entity_type='${row.entity_type ?? 'NULL'}' → ${row.cnt} chunks`);
    }

  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(err => {
  console.error('FATAL:', err);
  pool.end();
  process.exit(1);
});
