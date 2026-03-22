import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function main() {
  const { pool } = await import('../lib/db');

  const { rows } = await pool.query(`
    SELECT url, LEFT(content, 400) as snippet
    FROM document_chunks
    WHERE tenant_id='baltazar'
      AND url ILIKE '%upis%'
      AND (content ILIKE '%uvjet%' OR content ILIKE '%pravo upisa%' OR content ILIKE '%matura%')
    ORDER BY url
    LIMIT 15
  `);

  for (const r of rows) {
    console.log('\n=== ' + r.url + ' ===');
    console.log(r.snippet);
    console.log('---');
  }
  await pool.end();
}

main().catch(console.error);
