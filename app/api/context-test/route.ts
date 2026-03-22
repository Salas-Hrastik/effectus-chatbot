import { buildContextFromDocuments, retrieveTenantDocuments } from '@/lib/rag/retrieve';
import { getTenantId } from '@/lib/tenant';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const tenantId = getTenantId();
    const documents = await retrieveTenantDocuments(5);
    const context = buildContextFromDocuments(documents);

    return Response.json({
      ok: true,
      tenantId,
      count: documents.length,
      context,
      documents,
    });
  } catch (error) {
    console.error('Context test error:', error);

    return Response.json(
      {
        ok: false,
        error: 'Dohvat konteksta nije uspio.',
      },
      { status: 500 }
    );
  }
}
