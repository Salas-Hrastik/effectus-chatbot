import dotenv from "dotenv";
import { Pool } from "pg";

dotenv.config({ path: ".env.local" });
dotenv.config();

const TENANT_ID = process.env.TENANT_ID || "baltazar";

if (!process.env.DATABASE_URL) {
  console.error("ERROR: DATABASE_URL is missing in environment (.env.local or shell).");
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

async function getDocumentsColumns(client: any): Promise<string[]> {
  const res = await client.query(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'documents'
    ORDER BY ordinal_position
  `);

  return res.rows.map((r: any) => String(r.column_name));
}

function pickFirstExisting(columns: string[], candidates: string[]): string | null {
  for (const c of candidates) {
    if (columns.includes(c)) return c;
  }
  return null;
}

async function main() {
  console.log("================================");
  console.log("INSPECT TEACHER PROFILE CANDIDATES");
  console.log("TENANT:", TENANT_ID);
  console.log("================================");

  const client = await pool.connect();

  try {
    const columns = await getDocumentsColumns(client);

    console.log("documents columns:", columns.join(", "));
    console.log("--------------------------------");

    const tenantCol = pickFirstExisting(columns, ["tenant_id"]);
    const urlCol = pickFirstExisting(columns, ["url", "source_url", "link", "document_url", "page_url"]);
    const titleCol = pickFirstExisting(columns, ["title", "name", "source_title", "document_title", "page_title"]);

    if (!tenantCol) throw new Error("Missing required documents column: tenant_id");
    if (!urlCol) throw new Error("Missing usable URL column in documents");
    if (!titleCol) throw new Error("Missing usable TITLE column in documents");

    const optionalCols = [
      "is_active",
      "entity_type",
      "document_type",
      "section_type",
      "section",
      "page",
      "entity_name",
      "parent_entity_type",
      "parent_entity_name",
      "updated_at",
      "last_crawled_at",
    ].filter((c) => columns.includes(c));

    const selectCols = [
      `${quoteIdent(urlCol)}::text AS source_url`,
      `${quoteIdent(titleCol)}::text AS title`,
      ...optionalCols.map((c) => `${quoteIdent(c)}::text AS ${c}`),
    ];

    const query = `
      SELECT
        ${selectCols.join(",\n        ")}
      FROM documents
      WHERE ${quoteIdent(tenantCol)} = $1
        AND ${quoteIdent(urlCol)} ILIKE '%/nastavnici-suradnici/%'
      ORDER BY ${quoteIdent(urlCol)}
      LIMIT 250
    `;

    const res = await client.query(query, [TENANT_ID]);

    console.log("Candidate rows found:", res.rows.length);
    console.log("================================");
    console.table(res.rows);

    console.log("================================");
    console.log("DISTINCT VALUE SUMMARY");
    console.log("================================");

    for (const col of optionalCols) {
      const values = Array.from(
        new Set(
          res.rows
            .map((r: any) => r[col])
            .filter((v: any) => v !== null && v !== undefined && String(v).trim() !== "")
        )
      ).sort();

      console.log(`\n[${col}] distinct (${values.length})`);
      for (const v of values.slice(0, 50)) {
        console.log(`- ${v}`);
      }
      if (values.length > 50) {
        console.log(`... +${values.length - 50} more`);
      }
    }

    console.log("================================");
    console.log("INSPECTION COMPLETE");
    console.log("================================");
  } catch (error) {
    console.error("ERROR:", error);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
