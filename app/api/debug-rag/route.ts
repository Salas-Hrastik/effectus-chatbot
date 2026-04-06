import { NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import OpenAI from 'openai';

export const dynamic = 'force-dynamic';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const TENANT_ID = (process.env.TENANT_ID || 'effectus').trim();

export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = url.searchParams.get('q') || 'Što je Mini MBA?';
  const steps: Record<string, unknown> = { query: q, tenant: TENANT_ID };

  try {
    steps.step1 = 'generating embedding';
    const emb = await openai.embeddings.create({ model: 'text-embedding-3-small', input: q });
    const vec = '[' + emb.data[0].embedding.join(',') + ']';
    steps.embedding_len = emb.data[0].embedding.length;

    steps.step2 = 'querying match_document_chunks';
    const res = await pool.query(
      `SELECT id, entity_name, content_group, similarity, LEFT(content,80) as preview
       FROM match_document_chunks($1::vector, $2::text, 10)`,
      [vec, TENANT_ID]
    );
    steps.chunk_count = res.rows.length;
    steps.chunks = res.rows;
    steps.step3 = 'success';
    return NextResponse.json(steps);
  } catch (e: unknown) {
    steps.error = String(e);
    return NextResponse.json(steps, { status: 500 });
  }
}
