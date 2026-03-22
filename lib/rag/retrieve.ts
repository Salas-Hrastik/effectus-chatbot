import { pool } from '@/lib/db';
import { getTenantId } from '@/lib/tenant';

export type RetrievedChunk = {
  id: number;
  tenant_id: string;
  source_url: string | null;
  title: string | null;
  section: string | null;
  page: number | null;
  content: string;
};

export async function retrieveTenantDocuments(limit = 5): Promise<RetrievedChunk[]> {
  const tenantId = getTenantId();

  const result = await pool.query(
    `
    select id, tenant_id, source_url, title, section, page, content
    from documents
    where tenant_id = $1
    order by id desc
    limit $2
    `,
    [tenantId, limit]
  );

  return result.rows;
}

export function buildContextFromDocuments(documents: RetrievedChunk[]) {
  if (!documents.length) {
    return '';
  }

  return documents
    .map((doc, index) => {
      return [
        `[Dokument ${index + 1}]`,
        `Naslov: ${doc.title ?? 'Bez naslova'}`,
        `Odjeljak: ${doc.section ?? 'Nije navedeno'}`,
        `Stranica: ${doc.page ?? 'Nije navedeno'}`,
        `Izvor: ${doc.source_url ?? 'Nije naveden'}`,
        `Sadržaj: ${doc.content}`,
      ].join('\n');
    })
    .join('\n\n');
}
