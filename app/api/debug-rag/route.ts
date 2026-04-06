import { NextResponse } from 'next/server';
import { Pool } from 'pg';
import OpenAI from 'openai';

export const dynamic = 'force-dynamic';

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const TENANT_ID = process.env.TENANT_ID || 'effectus';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = url.searchParams.get('q') || 'Što je Mini MBA?';
  
  try {
    const emb = await openai.embeddings.create({ model: 'text-embedding-3-small', input: q });
    const vec = '[' + emb.data[0].embedding.join(',') + ']';
    
    const res = await pool.query(
      `SELECT id, entity_name, content_group, entity_type, section_type,
              1-(embedding <=> $1::vector) as similarity,
              LEFT(content, 100) as preview
       FROM document_chunks 
       WHERE tenant_id = $2 AND embedding IS NOT NULL 
       ORDER BY embedding <=> $1::vector LIMIT 10`,
      [vec, TENANT_ID]
    );
    
    const res2 = await pool.query(
      `SELECT id, entity_name, content_group, similarity, LEFT(content,100) as preview
       FROM match_document_chunks($1::vector, $2::text, 10)`,
      [vec, TENANT_ID]
    );
    
    return NextResponse.json({
      query: q,
      tenant: TENANT_ID,
      direct_query_count: res.rows.length,
      match_function_count: res2.rows.length,
      direct_results: res.rows,
      match_results: res2.rows,
    });
  } catch (e: unknown) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
