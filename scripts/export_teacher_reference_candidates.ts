import dotenv from "dotenv";
import { Pool } from "pg";
import fs from "fs";
import path from "path";

dotenv.config({ path: ".env.local" });
dotenv.config();

const TENANT_ID = process.env.TENANT_ID || "baltazar";
const OUTPUT_PATH = path.join(process.cwd(), "data", `teacher_reference_candidates_${TENANT_ID}.json`);

if (!process.env.DATABASE_URL) {
  console.error("ERROR: DATABASE_URL is missing in environment (.env.local or shell).");
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

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

function slugFromUrl(url: string): string {
  return url.split("/").filter(Boolean).pop() || "";
}

async function main() {
  console.log("================================");
  console.log("EXPORT TEACHER REFERENCE CANDIDATES");
  console.log("TENANT:", TENANT_ID);
  console.log("OUTPUT:", OUTPUT_PATH);
  console.log("================================");

  const client = await pool.connect();

  try {
    const res = await client.query(
      `
      SELECT id, source_url, title, entity_name
      FROM documents
      WHERE tenant_id = $1
        AND source_url ILIKE '%/nastavnici-suradnici/%'
        AND source_url NOT ILIKE '%/en/%'
      ORDER BY source_url
      `,
      [TENANT_ID]
    );

    console.log("Raw candidate rows:", res.rows.length);

    const byNormalized = new Map<
      string,
      {
        name: string;
        normalized_name: string;
        slug: string;
        url: string;
        source_document_id: string;
        source_count: number;
      }
    >();

    let skipped = 0;

    for (const row of res.rows) {
      const base =
        row.entity_name && String(row.entity_name).trim().length > 0
          ? String(row.entity_name).trim()
          : String(row.title).trim();

      const cleaned = cleanDisplayName(base);
      const normalized = normalizeName(cleaned);

      if (!cleaned || !normalized) {
        skipped++;
        continue;
      }

      const existing = byNormalized.get(normalized);

      if (!existing) {
        byNormalized.set(normalized, {
          name: cleaned,
          normalized_name: normalized,
          slug: slugFromUrl(String(row.source_url)),
          url: String(row.source_url),
          source_document_id: String(row.id),
          source_count: 1,
        });
      } else {
        existing.source_count += 1;
      }
    }

    const items = Array.from(byNormalized.values()).sort((a, b) =>
      a.name.localeCompare(b.name, "hr")
    );

    const payload = {
      institution_id: TENANT_ID,
      generated_at: new Date().toISOString(),
      source: "documents table -> /nastavnici-suradnici/ excluding /en/",
      raw_candidate_rows: res.rows.length,
      unique_candidates: items.length,
      skipped_rows: skipped,
      items,
    };

    fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
    fs.writeFileSync(OUTPUT_PATH, JSON.stringify(payload, null, 2), "utf8");

    console.log("Unique candidates exported:", items.length);
    console.log("Skipped rows:", skipped);
    console.log("JSON written to:", OUTPUT_PATH);
    console.log("================================");
    console.log("EXPORT COMPLETE");
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
