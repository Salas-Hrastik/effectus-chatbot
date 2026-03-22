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

function transliterateBasic(text: string): string {
  return text
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .replace(/č/g, "c")
    .replace(/Č/g, "C")
    .replace(/ć/g, "c")
    .replace(/Ć/g, "C")
    .replace(/ž/g, "z")
    .replace(/Ž/g, "Z")
    .replace(/š/g, "s")
    .replace(/Š/g, "S");
}

function normalizeName(name: string): string {
  return transliterateBasic(name)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[.,]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanDisplayName(input: string): string {
  let s = input.trim();

  s = s.replace(/\s+-\s+.*$/i, "");
  s = s.replace(/\s+\|\s+.*$/i, "");
  s = s.replace(/\s+/g, " ").trim();

  s = s.replace(
    /\b(nasl\.?\s*doc\.?\s*dr\.?\s*sc\.?|red\.?\s*prof\.?\s*dr\.?\s*sc\.?|izv\.?\s*prof\.?\s*dr\.?\s*sc\.?|prof\.?\s*dr\.?\s*sc\.?|doc\.?\s*dr\.?\s*sc\.?|dr\.?\s*sc\.?\s*socio\.?|dr\.?\s*sc\.?\s*human\.?|dr\.?\s*sc\.?|mr\.?\s*sc\.?)\b/gi,
    " "
  );

  s = s.replace(
    /\b(redoviti\s+profesor|izvanredni\s+profesor|profesor\s+visoke\s+skole|viši\s+predavač|visi\s+predavac|predavač|predavac|docent|v\.?\s*pred\.?|pred\.?)\b/gi,
    " "
  );

  s = s.replace(
    /\b(prof\.?\s*struč\.?\s*stud\.?|prof\.?\s*v\.?\s*š\.?|struč\.?\s*spec\.?|struc\.?\s*spec\.?|univ\.?\s*spec\.?|univ\.?\s*mag\.?|mag\.?\s*spec\.?)\b/gi,
    " "
  );

  s = s.replace(
    /\b(mag\.?\s*educ\.?|mag\.?\s*philol\.?|mag\.?\s*litt\.?|mag\.?\s*psych\.?|mag\.?\s*comm\.?|mag\.?\s*iur\.?|mag\.?\s*art\.?|mag\.?\s*oec\.?|dipl\.?\s*oec\.?|bacc\.?\s*oec\.?|dipl\.?\s*ing\.?\s*el\.?|dipl\.?\s*ing\.?\s*građ\.?|dipl\.?\s*ing\.?\s*grad\.?|univ\.?\s*dipl\.?\s*prav\.?)\b/gi,
    " "
  );

  s = s.replace(
    /\b(socio\.?|human\.?|educ\.?|philol\.?|litt\.?|comp\.?|croat\.?|germ\.?|angl\.?|pec\.?|techn\.?|inf\.?|grad\.?|oec\.?|iur\.?|art\.?|comm\.?|psych\.?|mba|ml\.?|et)\b/gi,
    " "
  );

  s = s.replace(/[.,]/g, " ");
  s = s.replace(/\s+/g, " ").trim();

  const blacklist = new Set([
    "nasl",
    "red",
    "izv",
    "doc",
    "dr",
    "sc",
    "mr",
    "prof",
    "docent",
    "pred",
    "predavac",
    "predavac",
    "visi",
    "viši",
    "struc",
    "struč",
    "spec",
    "univ",
    "mag",
    "dipl",
    "ing",
    "oec",
    "iur",
    "art",
    "comm",
    "psych",
    "philol",
    "litt",
    "educ",
    "comp",
    "croat",
    "germ",
    "angl",
    "pec",
    "techn",
    "inf",
    "grad",
    "bacc",
    "mba",
    "ml",
    "socio",
    "human",
    "prav",
    "stud",
    "skole",
    "visoke",
    "redoviti",
    "izvanredni",
    "profesor",
    "et",
    "v",
  ]);

  const cleanedWords = s
    .split(/\s+/)
    .map((w) => w.trim())
    .filter(Boolean)
    .filter((w) => {
      const lower = transliterateBasic(w).toLowerCase().replace(/\./g, "");
      if (!lower) return false;
      if (lower.length <= 1) return false;
      if (/^\d+$/.test(lower)) return false;
      if (blacklist.has(lower)) return false;
      return true;
    });

  s = cleanedWords.join(" ").replace(/\s+/g, " ").trim();

  return s;
}

function extractNameAndTitles(rawTitle: string | null): {
  fullName: string | null;
  titles: string | null;
} {
  if (!rawTitle) {
    return { fullName: null, titles: null };
  }

  const original = rawTitle.trim();

  const titlePatterns = [
    "nasl. doc. dr. sc.",
    "red. prof. dr.sc.",
    "red. prof. dr. sc.",
    "izv. prof. dr. sc.",
    "prof. dr. sc.",
    "doc. dr. sc.",
    "dr. sc. socio.",
    "dr. sc. human.",
    "dr. sc.",
    "mr. sc.",
    "prof. struč. stud.",
    "prof. v. š.",
    "prof.",
    "docent",
    "redoviti profesor",
    "izvanredni profesor",
    "viši predavač",
    "predavač",
    "v. pred.",
    "pred.",
  ];

  const lower = original.toLowerCase();
  const foundTitles = titlePatterns.filter((t) => lower.includes(t.toLowerCase()));

  const fullName = cleanDisplayName(original);
  const titles = foundTitles.length > 0 ? foundTitles.join(", ") : null;

  if (!fullName || fullName.length < 3) {
    return { fullName: null, titles };
  }

  return { fullName, titles };
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
  console.log("ANALYZE HR TEACHER CANDIDATES");
  console.log("TENANT:", TENANT_ID);
  console.log("================================");

  const client = await pool.connect();

  try {
    const columns = await getDocumentsColumns(client);

    const tenantCol = pickFirstExisting(columns, ["tenant_id"]);
    const urlCol = pickFirstExisting(columns, ["url", "source_url", "link", "document_url", "page_url"]);
    const titleCol = pickFirstExisting(columns, ["title", "name", "source_title", "document_title", "page_title"]);
    const entityNameCol = pickFirstExisting(columns, ["entity_name"]);

    if (!tenantCol) throw new Error("Missing required documents column: tenant_id");
    if (!urlCol) throw new Error("Missing usable URL column in documents");
    if (!titleCol) throw new Error("Missing usable TITLE column in documents");

    const selectCols = [
      `"id"::text AS id`,
      `${quoteIdent(urlCol)}::text AS source_url`,
      `${quoteIdent(titleCol)}::text AS title`,
    ];

    if (entityNameCol) {
      selectCols.push(`${quoteIdent(entityNameCol)}::text AS entity_name`);
    } else {
      selectCols.push(`NULL::text AS entity_name`);
    }

    const query = `
      SELECT
        ${selectCols.join(",\n        ")}
      FROM documents
      WHERE ${quoteIdent(tenantCol)} = $1
        AND ${quoteIdent(urlCol)} ILIKE '%/nastavnici-suradnici/%'
        AND ${quoteIdent(urlCol)} NOT ILIKE '%/en/%'
      ORDER BY ${quoteIdent(urlCol)}
    `;

    const res = await client.query(query, [TENANT_ID]);

    console.log("HR candidate rows found:", res.rows.length);

    const normalizedMap = new Map<
      string,
      {
        normalized_name: string;
        chosen_name: string;
        source_count: number;
        urls: string[];
        ids: string[];
      }
    >();

    const skipped: Array<{ id: string; source_url: string; title: string; entity_name: string | null }> = [];

    for (const row of res.rows) {
      const sourceBase =
        row.entity_name && String(row.entity_name).trim().length > 0
          ? String(row.entity_name).trim()
          : String(row.title).trim();

      const parsed = extractNameAndTitles(sourceBase);
      const fullName = parsed.fullName;

      if (!fullName) {
        skipped.push({
          id: String(row.id),
          source_url: String(row.source_url),
          title: String(row.title),
          entity_name: row.entity_name ?? null,
        });
        continue;
      }

      const normalized = normalizeName(fullName);

      if (!normalized) {
        skipped.push({
          id: String(row.id),
          source_url: String(row.source_url),
          title: String(row.title),
          entity_name: row.entity_name ?? null,
        });
        continue;
      }

      const existing = normalizedMap.get(normalized);

      if (!existing) {
        normalizedMap.set(normalized, {
          normalized_name: normalized,
          chosen_name: fullName,
          source_count: 1,
          urls: [String(row.source_url)],
          ids: [String(row.id)],
        });
      } else {
        existing.source_count += 1;
        existing.urls.push(String(row.source_url));
        existing.ids.push(String(row.id));
      }
    }

    const uniqueRows = Array.from(normalizedMap.values()).sort((a, b) =>
      a.chosen_name.localeCompare(b.chosen_name, "hr")
    );

    const duplicates = uniqueRows
      .filter((r) => r.source_count > 1)
      .sort((a, b) => b.source_count - a.source_count || a.chosen_name.localeCompare(b.chosen_name, "hr"));

    console.log("Unique normalized persons:", uniqueRows.length);
    console.log("Skipped rows:", skipped.length);
    console.log("Duplicate normalized persons:", duplicates.length);

    console.log("================================");
    console.log("UNIQUE PERSON LIST");
    console.log("================================");
    console.table(
      uniqueRows.map((r) => ({
        chosen_name: r.chosen_name,
        normalized_name: r.normalized_name,
        source_count: r.source_count,
      }))
    );

    console.log("================================");
    console.log("DUPLICATE GROUPS");
    console.log("================================");
    for (const d of duplicates) {
      console.log(`\nNAME: ${d.chosen_name}`);
      console.log(`NORMALIZED: ${d.normalized_name}`);
      console.log(`SOURCE COUNT: ${d.source_count}`);
      for (const url of d.urls) {
        console.log(`- ${url}`);
      }
    }

    if (skipped.length > 0) {
      console.log("================================");
      console.log("SKIPPED ROWS");
      console.log("================================");
      console.table(skipped);
    }

    console.log("================================");
    console.log("ANALYSIS COMPLETE");
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
