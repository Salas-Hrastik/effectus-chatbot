import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function main() {
  const { pool } = await import('../lib/db');
  
  const r1 = await pool.query(`
    SELECT entity_type, entity_name, section_type, url, LEFT(content, 400) as content 
    FROM document_chunks 
    WHERE tenant_id='baltazar' 
    AND (
      url ILIKE '%kratki%' OR
      url ILIKE '%short%' OR
      content ILIKE '%kratki studij%' OR
      content ILIKE '%kratki stručni%'
    )
    ORDER BY url, chunk_index
    LIMIT 20
  `);
  
  console.log('=== KRATKI STUDIJ ===', r1.rows.length, 'chunks');
  const seen = new Set<string>();
  r1.rows.forEach((r: any) => {
    if (!seen.has(r.url)) {
      seen.add(r.url);
      console.log(`\nURL: ${r.url}`);
      console.log(`entity_type=${r.entity_type} entity_name=${r.entity_name}`);
      console.log(`Content: ${r.content}`);
    }
  });
  
  // English study
  const r2 = await pool.query(`
    SELECT entity_type, entity_name, section_type, url, LEFT(content, 400) as content 
    FROM document_chunks 
    WHERE tenant_id='baltazar' 
    AND (
      url ILIKE '%english%' OR
      url ILIKE '%engleski%' OR
      content ILIKE '%studij na englesk%' OR
      content ILIKE '%english study%' OR
      content ILIKE '%course in english%'
    )
    AND NOT url ILIKE '%en/%'
    ORDER BY url, chunk_index
    LIMIT 15
  `);
  
  console.log('\n\n=== ENGLESKI STUDIJ ===', r2.rows.length, 'chunks');
  const seen2 = new Set<string>();
  r2.rows.forEach((r: any) => {
    if (!seen2.has(r.url)) {
      seen2.add(r.url);
      console.log(`\nURL: ${r.url}`);
      console.log(`entity_type=${r.entity_type} entity_name=${r.entity_name}`);
      console.log(`Content: ${r.content}`);
    }
  });
  
  await pool.end();
}
main().catch(console.error);
