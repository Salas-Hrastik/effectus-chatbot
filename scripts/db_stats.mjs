import { readFileSync } from 'fs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

// Load .env.local manually
const env = readFileSync('.env.local', 'utf8');
for (const line of env.split('\n')) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
}

const { Pool } = require('pg');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 1,
});

const q = (sql) => pool.query(sql).then(r => r.rows);

const stats = await q(`
  SELECT COUNT(*) as total, COUNT(DISTINCT url) as unique_urls,
    MIN(LENGTH(content)) as min_len, MAX(LENGTH(content)) as max_len,
    AVG(LENGTH(content))::int as avg_len
  FROM document_chunks WHERE tenant_id='baltazar'
`);
console.log('\n=== DB STATISTIKE ===');
console.table(stats);

const types = await q(`
  SELECT entity_type, COUNT(*) as count FROM document_chunks
  WHERE tenant_id='baltazar' GROUP BY entity_type ORDER BY count DESC
`);
console.log('\n=== ENTITY TYPES ===');
console.table(types);

const lang = await q(`
  SELECT CASE WHEN url ILIKE '%/en/%' THEN 'EN' ELSE 'HR' END as jezik,
    COUNT(*) as chunks
  FROM document_chunks WHERE tenant_id='baltazar' GROUP BY jezik
`);
console.log('\n=== HR vs EN ===');
console.table(lang);

const urls = await q(`
  SELECT REGEXP_REPLACE(url,'https://www.bak.hr','') as path, COUNT(*) as chunks
  FROM document_chunks WHERE tenant_id='baltazar'
  GROUP BY url ORDER BY chunks DESC LIMIT 40
`);
console.log('\n=== TOP 40 STRANICA ===');
urls.forEach(r => console.log(`  ${String(r.chunks).padStart(3)}x  ${r.path}`));

const bad = await q(`
  SELECT url, LENGTH(content) as len, LEFT(content,120) as preview
  FROM document_chunks WHERE tenant_id='baltazar'
  AND LENGTH(content) < 80 ORDER BY LENGTH(content) LIMIT 10
`);
console.log('\n=== KRATKI CHUNKOVI (< 80 znakova) ===');
bad.forEach(r => console.log(`  [${r.len}] ${r.url}\n       "${r.preview}"\n`));

await pool.end();
