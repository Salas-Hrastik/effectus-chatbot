/**
 * Generira Obsidian .md datoteke iz Supabase chunkova (tenant: effectus)
 * i sprema ih u /tmp/effectus-vault/ spreman za push na GitHub.
 */

import pg from 'pg';
import fs from 'fs';
import path from 'path';

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const VAULT_DIR = '/tmp/effectus-vault';

const FOLDER_MAP = {
  studij:               '01-Studiji',
  upisi:                '02-Upisi',
  cjelozivotni_program: '03-Cjelozivotno',
  opcenito:             '04-Opcenito',
};

function slugify(str) {
  return str
    .toLowerCase()
    .replace(/č/g,'c').replace(/ć/g,'c').replace(/š/g,'s')
    .replace(/ž/g,'z').replace(/đ/g,'d')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

async function main() {
  const res = await pool.query(
    `SELECT entity_type, entity_name, url, content, chunk_index
     FROM document_chunks
     WHERE tenant_id = 'effectus'
     ORDER BY entity_type, entity_name, chunk_index`
  );

  // Grupiraj po entity_name
  const grouped = {};
  for (const row of res.rows) {
    const key = row.entity_name;
    if (!grouped[key]) {
      grouped[key] = {
        entity_type: row.entity_type,
        entity_name: row.entity_name,
        url: row.url,
        chunks: [],
      };
    }
    grouped[key].chunks.push(row.content);
  }

  // Kreiraj foldere
  fs.mkdirSync(VAULT_DIR, { recursive: true });
  for (const folder of Object.values(FOLDER_MAP)) {
    fs.mkdirSync(path.join(VAULT_DIR, folder), { recursive: true });
  }

  let count = 0;
  for (const entity of Object.values(grouped)) {
    const folder = FOLDER_MAP[entity.entity_type] || '04-Opcenito';
    const filename = slugify(entity.entity_name) + '.md';
    const filepath = path.join(VAULT_DIR, folder, filename);

    const frontmatter = [
      '---',
      `title: "${entity.entity_name}"`,
      `url: "${entity.url}"`,
      `entity_type: "${entity.entity_type}"`,
      `tenant: "effectus"`,
      `updated: "${new Date().toISOString().slice(0,10)}"`,
      '---',
      '',
    ].join('\n');

    const body = entity.chunks.join('\n\n---\n\n');
    fs.writeFileSync(filepath, frontmatter + body + '\n');
    count++;
    console.log(`✓ ${folder}/${filename} (${entity.chunks.length} chunks)`);
  }

  console.log(`\n✅ Generirano ${count} .md datoteka u ${VAULT_DIR}`);
  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
