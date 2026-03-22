import { pool } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const result = await pool.query('select now() as current_time');

    return Response.json({
      ok: true,
      current_time: result.rows[0]?.current_time ?? null,
    });
  } catch (error) {
    console.error('DB test error:', error);

    return Response.json(
      {
        ok: false,
        error: 'Spajanje na bazu nije uspjelo.',
      },
      { status: 500 }
    );
  }
}
