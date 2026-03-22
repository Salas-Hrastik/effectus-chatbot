import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function main() {
  const { pool } = await import('../lib/db');
  
  // Get library info
  const r1 = await pool.query(`
    SELECT entity_type, entity_name, section_type, url, LEFT(content, 400) as content 
    FROM document_chunks 
    WHERE tenant_id='baltazar' 
    AND (url ILIKE '%knjiznica%' OR url ILIKE '%library%')
    AND NOT url ILIKE '%baze-podataka%' AND NOT url ILIKE '%nakladnicka%'
    ORDER BY url, chunk_index
    LIMIT 20
  `);
  
  console.log('=== KNJIŽNICA ===');
  const seen = new Set<string>();
  r1.rows.forEach((r: any) => {
    if (!seen.has(r.url)) {
      seen.add(r.url);
      console.log(`\nURL: ${r.url}`);
      console.log(`Content: ${r.content}`);
    }
  });
  
  await pool.end();
}
main().catch(console.error);
