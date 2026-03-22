import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function main() {
  const { pool } = await import('../lib/db');
  const tenantId = process.env.TENANT_ID || 'baltazar';

  console.log(`Brišem sve podatke za tenant: ${tenantId}`);

  const docs = await pool.query('select id from documents where tenant_id = $1', [tenantId]);
  const ids = docs.rows.map((r: any) => r.id);

  if (ids.length > 0) {
    await pool.query('delete from document_chunks where document_id = any($1)', [ids]);
    console.log(`✓ Obrisano ${ids.length} dokumenata i njihovi chunkovi`);
  }

  await pool.query('delete from documents where tenant_id = $1', [tenantId]);
  console.log('✓ Dokumenti obrisani');
  console.log('Reset završen. Možete pokrenuti ingest.');
  await pool.end();
}

main().catch(async (err) => {
  console.error('Greška:', err);
  process.exit(1);
});
