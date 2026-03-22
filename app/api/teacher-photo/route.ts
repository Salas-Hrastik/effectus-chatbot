import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { getTenantId } from '@/lib/tenant';

export const runtime = 'nodejs';

const ACADEMIC_TITLES = new Set([
  'dr', 'sc', 'prof', 'doc', 'izv', 'red', 'mag', 'oec', 'pred',
  'v', 'vs', 'univ', 'struc', 'spec', 'socio', 'nasl', 'dipl',
  'ing', 'mba', 'bacc',
]);

function normalizeToAscii(str: string): string {
  return str
    .replace(/[ćč]/g, 'c')
    .replace(/ž/g, 'z')
    .replace(/š/g, 's')
    .replace(/đ/g, 'd')
    .replace(/[ĆČ]/g, 'c')
    .replace(/Ž/g, 'z')
    .replace(/Š/g, 's')
    .replace(/Đ/g, 'd');
}

function extractSurname(fullName: string): string {
  const tokens = fullName
    .toLowerCase()
    .replace(/\./g, '')
    .split(/\s+/)
    .filter(Boolean);

  const significant = tokens.filter(t => !ACADEMIC_TITLES.has(t));
  // Last significant token is the surname
  return significant[significant.length - 1] ?? tokens[tokens.length - 1] ?? '';
}

function extractSlug(url: string): string {
  return url.replace(/\/+$/, '').split('/').pop() ?? '';
}

async function resolveProfileUrl(name: string, tenantId: string): Promise<string | null> {
  const surname = extractSurname(name);
  if (!surname) return null;

  const normSurname = normalizeToAscii(surname);
  const pattern = `%nastavnici-suradnici%${normSurname}%`;

  const result = await pool.query<{ url: string }>(
    `SELECT DISTINCT url FROM document_chunks
     WHERE tenant_id = $1 AND url ILIKE $2
     ORDER BY url LIMIT 1`,
    [tenantId, pattern],
  );

  return result.rows[0]?.url ?? null;
}

async function fetchPhoto(slug: string): Promise<string | null> {
  const wpUrl =
    `https://www.bak.hr/wp-json/wp/v2/nastavnici-suradnici` +
    `?slug=${encodeURIComponent(slug)}&_embed&_fields=id,slug,_embedded`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);

  try {
    const res = await fetch(wpUrl, { signal: controller.signal });
    if (!res.ok) return null;
    const data = await res.json();
    return (
      data[0]?._embedded?.['wp:featuredmedia']?.[0]?.source_url ?? null
    );
  } finally {
    clearTimeout(timeout);
  }
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = req.nextUrl;
    const name = searchParams.get('name')?.trim();
    const urlParam = searchParams.get('url')?.trim();

    if (!name && !urlParam) {
      return NextResponse.json({ photo: null }, { status: 400 });
    }

    let profileUrl: string | null = urlParam ?? null;

    if (!profileUrl && name) {
      const tenantId = getTenantId();
      profileUrl = await resolveProfileUrl(name, tenantId);
    }

    if (!profileUrl) {
      return NextResponse.json({ photo: null });
    }

    const slug = extractSlug(profileUrl);
    if (!slug) {
      return NextResponse.json({ photo: null });
    }

    const photo = await fetchPhoto(slug);

    return NextResponse.json(
      { photo },
      { headers: { 'Cache-Control': 'public, max-age=86400' } },
    );
  } catch {
    return NextResponse.json({ photo: null });
  }
}
