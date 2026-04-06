import { NextResponse } from 'next/server';
import { Pool } from 'pg';
import OpenAI from 'openai';

const INGEST_SECRET = process.env.INGEST_SECRET || 'change-me';
const TENANT_ID = process.env.TENANT_ID || 'effectus';
const CHUNK_SIZE = 800;
const CHUNK_OVERLAP = 100;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function POST(req: Request) {
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${INGEST_SECRET}`) {
    return NextResponse.json({ error: 'Neautoriziran pristup' }, { status: 401 });
  }

  try {
    const files = await fetchVaultFiles();
    let processed = 0;
    let errors = 0;
    let totalChunks = 0;

    for (const file of files) {
      try {
        const { frontmatter, body } = parseFrontmatter(file.content);
        if (!body.trim()) continue;

        const chunks = chunkText(body);
        const entityName = frontmatter.title || file.name.replace('.md', '');
        const entityType = frontmatter.entity_type || file.folder;
        const url = frontmatter.url || null;

        // Briši stare chunkove za ovu stranicu
        await pool.query(
          `DELETE FROM document_chunks WHERE tenant_id = $1 AND url = $2`,
          [TENANT_ID, url || `vault:${file.path}`]
        );

        for (let i = 0; i < chunks.length; i++) {
          const chunk = chunks[i];
          const embeddingRes = await openai.embeddings.create({
            model: 'text-embedding-3-small',
            input: chunk,
          });
          const embedding = embeddingRes.data[0].embedding;

          await pool.query(
            `INSERT INTO document_chunks
              (tenant_id, url, title, entity_type, entity_name, chunk_index, content, embedding, language, content_group)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8::vector, $9, $10)`,
            [
              TENANT_ID,
              url || `vault:${file.path}`,
              entityName,
              entityType,
              entityName,
              i,
              chunk,
              JSON.stringify(embedding),
              'hr',
              entityType,
            ]
          );
          totalChunks++;
        }
        processed++;
      } catch (err) {
        console.error(`Greška: ${file.path}`, err);
        errors++;
      }
    }

    return NextResponse.json({ success: true, processed, errors, totalChunks, files: files.length });
  } catch (err) {
    console.error('Ingestija neuspješna:', err);
    return NextResponse.json({ error: 'Ingestija neuspješna' }, { status: 500 });
  }
}

async function fetchVaultFiles() {
  const repo = process.env.GITHUB_VAULT_REPO;
  const branch = process.env.GITHUB_VAULT_BRANCH || 'main';
  const token = process.env.GITHUB_TOKEN;

  const headers: Record<string, string> = {
    Accept: 'application/vnd.github.v3+json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  const treeRes = await fetch(
    `https://api.github.com/repos/${repo}/git/trees/${branch}?recursive=1`,
    { headers }
  );
  const treeData = await treeRes.json();

  const mdFiles = (treeData.tree || []).filter(
    (f: { type: string; path: string }) =>
      f.type === 'blob' &&
      f.path.endsWith('.md') &&
      !f.path.startsWith('.obsidian/') &&
      !f.path.startsWith('.github/')
  );

  return Promise.all(
    mdFiles.map(async (file: { path: string }) => {
      const res = await fetch(
        `https://api.github.com/repos/${repo}/contents/${file.path}?ref=${branch}`,
        { headers }
      );
      const data = await res.json();
      const parts = file.path.split('/');
      return {
        path: file.path,
        name: parts.at(-1) || '',
        folder: parts[0] || 'root',
        content: Buffer.from(data.content, 'base64').toString('utf-8'),
      };
    })
  );
}

function parseFrontmatter(content: string) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { frontmatter: {}, body: content };
  const frontmatter: Record<string, string> = {};
  for (const line of match[1].split('\n')) {
    const [key, ...val] = line.split(':');
    if (key) frontmatter[key.trim()] = val.join(':').trim().replace(/^"|"$/g, '');
  }
  return { frontmatter, body: match[2] };
}

function chunkText(text: string): string[] {
  const words = text.split(/\s+/);
  const chunks: string[] = [];
  let start = 0;
  while (start < words.length) {
    const slice = words.slice(start, start + CHUNK_SIZE).join(' ');
    chunks.push(slice);
    start += CHUNK_SIZE - CHUNK_OVERLAP;
  }
  return chunks.filter(c => c.trim().length > 50);
}
