import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function main() {
  const { pool } = await import('../lib/db');
  
  const r1 = await pool.query(`
    SELECT entity_type, entity_name, section_type, url, content
    FROM document_chunks 
    WHERE tenant_id='baltazar' 
    AND (url ILIKE '%turisticki-vodic%' OR entity_name ILIKE '%turistički vodič%')
    ORDER BY url, chunk_index
    LIMIT 8
  `);
  
  console.log('=== TURISTIČKI VODIČ ===', r1.rows.length, 'chunks');
  r1.rows.forEach((r: any) => {
    console.log(`\n[section=${r.section_type}] URL: ${r.url}`);
    console.log(`Content:\n${r.content}`);
  });
  
  await pool.end();
}
main().catch(console.error);
