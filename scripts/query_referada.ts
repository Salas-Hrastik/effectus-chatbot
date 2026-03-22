import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function main() {
  const { pool } = await import('../lib/db');
  
  const r1 = await pool.query(`
    SELECT entity_type, entity_name, section_type, url, LEFT(content, 300) as content 
    FROM document_chunks 
    WHERE tenant_id='baltazar' 
    AND (
      url ILIKE '%referada%' OR
      url ILIKE '%zavrsni%' OR url ILIKE '%diplomski-rad%' OR
      url ILIKE '%strucna-praksa%' OR url ILIKE '%strucna_praksa%' OR
      url ILIKE '%pravilnik%' OR
      url ILIKE '%prigovor%' OR
      url ILIKE '%ispit%' OR
      url ILIKE '%raspored%' OR
      content ILIKE '%studentska referada%' OR
      content ILIKE '%referada%' AND content ILIKE '%radno%'
    )
    ORDER BY url, chunk_index
    LIMIT 40
  `);
  
  console.log('Referada/studentski servisi chunks:', r1.rows.length);
  
  const urlsSeen = new Set<string>();
  r1.rows.forEach((r: any) => {
    if (!urlsSeen.has(r.url)) {
      urlsSeen.add(r.url);
      console.log(`\n--- URL: ${r.url}`);
      console.log(`entity_type=${r.entity_type} | entity_name=${r.entity_name} | section=${r.section_type}`);
      console.log(`Content: ${r.content}`);
    }
  });
  
  await pool.end();
}
main().catch(console.error);
