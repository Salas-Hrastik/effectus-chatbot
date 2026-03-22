import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function main() {
  const { pool } = await import('../lib/db');
  
  // Get full contact page referada section
  const r1 = await pool.query(`
    SELECT content FROM document_chunks 
    WHERE tenant_id='baltazar' AND url='https://www.bak.hr/kontakt'
    ORDER BY chunk_index
  `);
  
  console.log('=== KONTAKT - REFERADA SECTION ===');
  r1.rows.forEach((r: any) => {
    if (r.content.includes('referada') || r.content.includes('Referada') || r.content.includes('Habuš') || r.content.includes('Žlebački')) {
      console.log(r.content);
      console.log('---');
    }
  });
  
  // Get the zavrsni-radovi page content
  const r2 = await pool.query(`
    SELECT content FROM document_chunks 
    WHERE tenant_id='baltazar' AND url ILIKE '%zavrsni-i-diplomski-radovi%'
    ORDER BY chunk_index
  `);
  
  console.log('\n=== ZAVRŠNI I DIPLOMSKI RADOVI ===');
  r2.rows.forEach((r: any) => {
    console.log(r.content.substring(0, 500));
    console.log('---');
  });

  // Get ispitni rokovi
  const r3 = await pool.query(`
    SELECT content FROM document_chunks 
    WHERE tenant_id='baltazar' AND url ILIKE '%ispitni-rokovi%'
    ORDER BY chunk_index
  `);
  
  console.log('\n=== ISPITNI ROKOVI ===');
  r3.rows.forEach((r: any) => {
    console.log(r.content.substring(0, 500));
    console.log('---');
  });

  await pool.end();
}
main().catch(console.error);
