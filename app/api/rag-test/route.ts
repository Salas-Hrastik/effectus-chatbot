import { retrieveTenantDocuments } from '@/lib/rag/retrieve';
import { getTenantId } from '@/lib/tenant';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const tenantId = getTenantId();
    const documents = await retrieveTenantDocuments(5);

    return Response.json({
      ok: true,
      tenantId,
      count: documents.length,
      documents,
    });
  } catch (error) {
    console.error('RAG test error:', error);

    return Response.json(
      {
        ok: false,
        error: 'Dohvat dokumenata nije uspio.',
      },
      { status: 500 }
    );
  }
}
