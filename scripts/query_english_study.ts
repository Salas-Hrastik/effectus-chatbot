import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function main() {
  const { pool } = await import('../lib/db');
  
  // Check if there's a dedicated English-taught study program
  const r1 = await pool.query(`
    SELECT entity_type, entity_name, section_type, url, LEFT(content, 600) as content 
    FROM document_chunks 
    WHERE tenant_id='baltazar' 
    AND (
      content ILIKE '%kolegij na englesk%' OR
      content ILIKE '%predavanja na englesk%' OR
      content ILIKE '%course in english%' OR
      content ILIKE '%nastava na englesk%' OR
      url ILIKE '%raspored%'
    )
    LIMIT 10
  `);
  
  console.log('=== ENGLESKI NASTAVA ===');
  const seen = new Set<string>();
  r1.rows.forEach((r: any) => {
    if (!seen.has(r.url)) {
      seen.add(r.url);
      console.log(`\nURL: ${r.url}`);
      console.log(`Content: ${r.content}`);
    }
  });
  
  // Check kratki studij full details
  const r2 = await pool.query(`
    SELECT entity_type, entity_name, section_type, url, LEFT(content, 800) as content 
    FROM document_chunks 
    WHERE tenant_id='baltazar' 
    AND url='https://www.bak.hr/upisi/postupak-i-termini-upisa/online-studiranje-upisi-na-strucni-kratki-studij'
    ORDER BY chunk_index
  `);
  
  console.log('\n=== KRATKI STUDIJ FULL ===');
  r2.rows.forEach((r: any) => {
    console.log(r.content);
    console.log('---');
  });
  
  // Check if Primijenjena ekonomija is a study in studijski_programi
  const r3 = await pool.query(`
    SELECT entity_type, entity_name, section_type, url, LEFT(content, 500) as content 
    FROM document_chunks 
    WHERE tenant_id='baltazar' 
    AND (
      entity_name ILIKE '%primijenjena ekonomija%' OR
      content ILIKE '%primijenjena ekonomija%'
    )
    ORDER BY url, chunk_index
    LIMIT 10
  `);
  
  console.log('\n=== PRIMIJENJENA EKONOMIJA ===');
  seen.clear();
  r3.rows.forEach((r: any) => {
    if (!seen.has(r.url)) {
      seen.add(r.url);
      console.log(`\nURL: ${r.url}`);
      console.log(`entity_type=${r.entity_type} entity_name=${r.entity_name}`);
      console.log(`Content: ${r.content}`);
    }
  });
  
  await pool.end();
}
main().catch(console.error);
