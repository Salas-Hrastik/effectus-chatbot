import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function main() {
  const { pool } = await import('../lib/db');

  console.log('Pokrećem migraciju baze podataka...');

  // Dodaj kolone u documents tablicu
  await pool.query(`
    alter table if exists documents
      add column if not exists content_group text,
      add column if not exists entity_type text,
      add column if not exists entity_name text,
      add column if not exists section_type text,
      add column if not exists parent_entity_type text,
      add column if not exists parent_entity_name text
  `);
  console.log('✓ documents tablica ažurirana');

  // Kreiraj document_chunks tablicu
  await pool.query(`
    create table if not exists document_chunks (
      id bigserial primary key,
      document_id bigint references documents(id) on delete cascade,
      tenant_id text not null,
      url text,
      title text,
      chunk_index integer,
      content text not null,
      embedding vector(1536),
      content_group text,
      entity_type text,
      entity_name text,
      section_type text,
      parent_entity_type text,
      parent_entity_name text,
      created_at timestamptz default now()
    )
  `);
  console.log('✓ document_chunks tablica kreirana');

  // Indeksi
  await pool.query(`
    create index if not exists document_chunks_tenant_idx
      on document_chunks (tenant_id)
  `);
  await pool.query(`
    create index if not exists document_chunks_content_group_idx
      on document_chunks (tenant_id, content_group)
  `);
  await pool.query(`
    create index if not exists document_chunks_entity_idx
      on document_chunks (tenant_id, entity_type, entity_name)
  `);
  await pool.query(`
    create index if not exists document_chunks_embedding_idx
      on document_chunks using ivfflat (embedding vector_cosine_ops)
      with (lists = 100)
  `);
  console.log('✓ Indeksi kreirani');

  console.log('Migracija završena.');
  await pool.end();
}

main().catch(async (err) => {
  console.error('Greška u migraciji:', err);
  const { pool } = await import('../lib/db');
  await pool.end();
  process.exit(1);
});
