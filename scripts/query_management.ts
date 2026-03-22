import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function main() {
  const { pool } = await import('../lib/db');
  
  const r1 = await pool.query(`
    SELECT entity_type, entity_name, section_type, url, LEFT(content, 300) as content 
    FROM document_chunks 
    WHERE tenant_id='baltazar' 
    AND (content ILIKE '%dekan%' OR content ILIKE '%prodekan%' OR content ILIKE '%uprava%')
    LIMIT 30
  `);
  
  console.log('Management/Uprava chunks:', r1.rows.length);
  r1.rows.forEach((r: any) => {
    console.log(`\n--- entity_type=${r.entity_type} | entity_name=${r.entity_name} | section=${r.section_type}`);
    console.log(`URL: ${r.url}`);
    console.log(`Content: ${r.content}`);
  });
  
  await pool.end();
}
main().catch(console.error);
