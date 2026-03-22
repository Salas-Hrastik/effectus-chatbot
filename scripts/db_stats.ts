import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function main() {
  const { pool } = await import('../lib/db');

  const { rows: stats } = await pool.query(`
    SELECT
      COUNT(*) as total,
      COUNT(DISTINCT url) as unique_urls,
      MIN(LENGTH(content)) as min_len,
      MAX(LENGTH(content)) as max_len,
      AVG(LENGTH(content))::int as avg_len
    FROM document_chunks WHERE tenant_id='baltazar'
  `);
  console.log('\n=== DB STATISTIKE ===');
  console.log(stats[0]);

  const { rows: types } = await pool.query(`
    SELECT entity_type, COUNT(*) as count
    FROM document_chunks WHERE tenant_id='baltazar'
    GROUP BY entity_type ORDER BY count DESC
  `);
  console.log('\n=== ENTITY TYPES ===');
  types.forEach(r => console.log(`  ${r.entity_type || '(null)'}: ${r.count}`));

  const { rows: urls } = await pool.query(`
    SELECT DISTINCT
      REGEXP_REPLACE(url, 'https://www.bak.hr', '') as path,
      COUNT(*) as chunks
    FROM document_chunks WHERE tenant_id='baltazar'
    GROUP BY url ORDER BY chunks DESC LIMIT 30
  `);
  console.log('\n=== TOP 30 STRANICA (po broju chunkova) ===');
  urls.forEach(r => console.log(`  ${r.chunks}x  ${r.path}`));

  // Sample bad content (very short chunks)
  const { rows: bad } = await pool.query(`
    SELECT url, LENGTH(content) as len, LEFT(content, 120) as preview
    FROM document_chunks WHERE tenant_id='baltazar'
    AND LENGTH(content) < 100
    ORDER BY LENGTH(content)
    LIMIT 10
  `);
  console.log('\n=== KRATKI / LOŠI CHUNKOVI (< 100 znakova) ===');
  bad.forEach(r => console.log(`  [${r.len}] ${r.url}\n       "${r.preview}"`));

  // EN vs HR split
  const { rows: lang } = await pool.query(`
    SELECT
      CASE WHEN url ILIKE '%/en/%' THEN 'engleski' ELSE 'hrvatski' END as jezik,
      COUNT(*) as chunks
    FROM document_chunks WHERE tenant_id='baltazar'
    GROUP BY jezik
  `);
  console.log('\n=== HR vs EN ===');
  lang.forEach(r => console.log(`  ${r.jezik}: ${r.chunks} chunkova`));

  await pool.end();
}

main().catch(console.error);
