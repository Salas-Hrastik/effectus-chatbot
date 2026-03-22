require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');

const cs = process.env.DATABASE_URL;
if (!cs) throw new Error('DATABASE_URL nije pronađen u .env.local');

const pool = new Pool({
  connectionString: cs,
  ssl: cs.includes('localhost') ? false : { rejectUnauthorized: false },
});

const sql = `
create extension if not exists vector;

create table if not exists tenant_configs (
  id bigserial primary key,
  tenant_id text not null unique,
  tenant_name text not null,
  base_domain text,
  base_url text,
  language text default 'hr',
  is_active boolean not null default true,
  config_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_tenant_configs_tenant_id
  on tenant_configs (tenant_id);

alter table documents add column if not exists document_type text;
alter table documents add column if not exists language text default 'hr';
alter table documents add column if not exists location_tag text;
alter table documents add column if not exists is_active boolean default true;
alter table documents add column if not exists last_crawled_at timestamptz;
alter table documents add column if not exists updated_at timestamptz default now();

alter table document_chunks add column if not exists location_tag text;
alter table document_chunks add column if not exists source_priority integer default 0;

create index if not exists idx_documents_tenant_id
  on documents (tenant_id);

create index if not exists idx_documents_content_group
  on documents (tenant_id, content_group);

create index if not exists idx_document_chunks_tenant_id
  on document_chunks (tenant_id);

create index if not exists idx_document_chunks_group
  on document_chunks (tenant_id, content_group);

create index if not exists idx_document_chunks_entity_name
  on document_chunks (tenant_id, entity_name);

create index if not exists idx_document_chunks_entity_type
  on document_chunks (tenant_id, entity_type);

create index if not exists idx_document_chunks_section_type
  on document_chunks (tenant_id, section_type);

create table if not exists entities (
  id bigserial primary key,
  tenant_id text not null,
  entity_name text not null,
  entity_type text not null,
  canonical_url text,
  content_group text,
  parent_entity_type text,
  parent_entity_name text,
  location_tag text,
  aliases_json jsonb not null default '[]'::jsonb,
  metadata_json jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, entity_name, entity_type)
);

create index if not exists idx_entities_tenant_id
  on entities (tenant_id);

create index if not exists idx_entities_name
  on entities (tenant_id, entity_name);

create index if not exists idx_entities_type
  on entities (tenant_id, entity_type);

create index if not exists idx_entities_group
  on entities (tenant_id, content_group);

drop function if exists match_document_chunks(vector(1536), text, integer);

create function match_document_chunks(
  query_embedding vector(1536),
  filter_tenant_id text,
  match_count int
)
returns table (
  id bigint,
  document_id bigint,
  tenant_id text,
  url text,
  title text,
  chunk_index integer,
  content text,
  similarity double precision,
  content_group text,
  entity_type text,
  entity_name text,
  section_type text,
  parent_entity_type text,
  parent_entity_name text
)
language sql
stable
as $$
  select
    dc.id,
    dc.document_id,
    dc.tenant_id,
    dc.url,
    dc.title,
    dc.chunk_index,
    dc.content,
    1 - (dc.embedding <=> query_embedding) as similarity,
    dc.content_group,
    dc.entity_type,
    dc.entity_name,
    dc.section_type,
    dc.parent_entity_type,
    dc.parent_entity_name
  from document_chunks dc
  where dc.tenant_id = filter_tenant_id
    and dc.embedding is not null
  order by dc.embedding <=> query_embedding
  limit match_count;
$$;
`;

(async () => {
  try {
    await pool.query(sql);
    console.log('OK: platform schema primijenjena.');

    await pool.query(`
      insert into tenant_configs (
        tenant_id, tenant_name, base_domain, base_url, language, config_json
      )
      values (
        'baltazar',
        'Veleučilište Baltazar',
        'www.bak.hr',
        'https://www.bak.hr',
        'hr',
        '{
          "crawler": {
            "respectRobots": true,
            "maxDepth": 4,
            "sameDomainOnly": true
          },
          "academicModel": {
            "defaultLocation": "Hrvatska"
          }
        }'::jsonb
      )
      on conflict (tenant_id)
      do update set
        tenant_name = excluded.tenant_name,
        base_domain = excluded.base_domain,
        base_url = excluded.base_url,
        language = excluded.language,
        config_json = excluded.config_json,
        updated_at = now()
    `);

    console.log('OK: tenant baltazar upisan.');

    await pool.query(`
      update documents
      set document_type = coalesce(document_type, 'web_page'),
          language = coalesce(language, 'hr'),
          is_active = coalesce(is_active, true),
          updated_at = coalesce(updated_at, now())
      where tenant_id = 'baltazar'
    `);

    await pool.query(`
      update document_chunks
      set source_priority = coalesce(source_priority, 0)
      where tenant_id = 'baltazar'
    `);

    await pool.query(`
      insert into entities (
        tenant_id,
        entity_name,
        entity_type,
        canonical_url,
        content_group,
        parent_entity_type,
        parent_entity_name,
        location_tag,
        aliases_json,
        metadata_json
      )
      select
        dc.tenant_id,
        dc.entity_name,
        coalesce(dc.entity_type, 'program') as entity_type,
        min(dc.url) as canonical_url,
        min(dc.content_group) as content_group,
        min(dc.parent_entity_type) as parent_entity_type,
        min(dc.parent_entity_name) as parent_entity_name,
        min(dc.location_tag) as location_tag,
        '[]'::jsonb as aliases_json,
        '{}'::jsonb as metadata_json
      from document_chunks dc
      where dc.tenant_id = 'baltazar'
        and dc.entity_name is not null
        and trim(dc.entity_name) <> ''
      group by
        dc.tenant_id,
        dc.entity_name,
        coalesce(dc.entity_type, 'program')
      on conflict (tenant_id, entity_name, entity_type)
      do update set
        canonical_url = excluded.canonical_url,
        content_group = excluded.content_group,
        parent_entity_type = excluded.parent_entity_type,
        parent_entity_name = excluded.parent_entity_name,
        location_tag = excluded.location_tag,
        updated_at = now()
    `);

    console.log('OK: entities indeks osvježen.');

    const tables = await pool.query(`
      select table_name
      from information_schema.tables
      where table_schema = 'public'
        and table_name in ('documents', 'document_chunks', 'entities', 'tenant_configs')
      order by table_name
    `);
    console.table(tables.rows);

    const tenants = await pool.query(`
      select tenant_id, tenant_name, base_domain, base_url
      from tenant_configs
      order by tenant_id
    `);
    console.table(tenants.rows);

    const entityTypes = await pool.query(`
      select entity_type, count(*)::int as count
      from entities
      where tenant_id = 'baltazar'
      group by entity_type
      order by count desc, entity_type asc
    `);
    console.table(entityTypes.rows);

  } finally {
    await pool.end();
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
