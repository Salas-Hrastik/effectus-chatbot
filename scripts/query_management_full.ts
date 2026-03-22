import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function main() {
  const { pool } = await import('../lib/db');
  
  // Get all content from management page
  const r1 = await pool.query(`
    SELECT entity_type, entity_name, section_type, url, content
    FROM document_chunks 
    WHERE tenant_id='baltazar' 
    AND url ILIKE '%menadzment-veleucilista%'
    ORDER BY chunk_index
  `);
  
  console.log('=== MENADŽMENT VELEUČILIŠTA ===');
  r1.rows.forEach((r: any) => {
    console.log(`\n[chunk section=${r.section_type}]`);
    console.log(r.content);
  });
  
  // Past deans
  const r2 = await pool.query(`
    SELECT entity_type, entity_name, section_type, url, content
    FROM document_chunks 
    WHERE tenant_id='baltazar' 
    AND url ILIKE '%dosadasnji-dekani%'
    ORDER BY chunk_index
  `);
  
  console.log('\n\n=== DOSADAŠNJI DEKANI ===');
  r2.rows.forEach((r: any) => {
    console.log(`\n[chunk section=${r.section_type}]`);
    console.log(r.content);
  });
  
  // Kontakt
  const r3 = await pool.query(`
    SELECT entity_type, entity_name, section_type, url, content
    FROM document_chunks 
    WHERE tenant_id='baltazar' 
    AND url = 'https://www.bak.hr/kontakt'
    ORDER BY chunk_index
  `);
  
  console.log('\n\n=== KONTAKT ===');
  r3.rows.forEach((r: any) => {
    console.log(`\n[chunk section=${r.section_type}]`);
    console.log(r.content);
  });
  
  await pool.end();
}
main().catch(console.error);
