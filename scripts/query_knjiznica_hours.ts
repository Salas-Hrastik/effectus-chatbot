import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function main() {
  const { pool } = await import('../lib/db');
  
  const r1 = await pool.query(`
    SELECT content FROM document_chunks 
    WHERE tenant_id='baltazar' AND url='https://www.bak.hr/en/studenti/knjiznica/kontakt-i-radno-vrijeme-knjiznice'
    ORDER BY chunk_index
  `);
  
  console.log('=== KNJIŽNICA KONTAKT I RADNO VRIJEME ===');
  r1.rows.forEach((r: any) => console.log(r.content));
  
  await pool.end();
}
main().catch(console.error);
