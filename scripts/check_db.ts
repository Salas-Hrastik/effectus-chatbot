import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function main() {
  const { pool } = await import('../lib/db');
  const r1 = await pool.query("select count(*) from document_chunks where tenant_id = 'baltazar'");
  const r2 = await pool.query("select count(*) from documents where tenant_id = 'baltazar'");
  const r3 = await pool.query("select content_group, count(*) from document_chunks where tenant_id = 'baltazar' group by content_group order by count desc");
  console.log('Dokumenti:', r2.rows[0].count);
  console.log('Chunkovi:', r1.rows[0].count);
  console.log('\nPo kategoriji:');
  r3.rows.forEach((r: any) => console.log(` ${r.content_group || 'null'}: ${r.count}`));
  await pool.end();
}
main().catch(console.error);
