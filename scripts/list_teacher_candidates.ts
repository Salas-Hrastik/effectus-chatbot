import dotenv from "dotenv";
import { Pool } from "pg";

dotenv.config({ path: ".env.local" });
dotenv.config();

const TENANT_ID = process.env.TENANT_ID || "baltazar";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL missing");
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

async function main() {
  console.log("================================");
  console.log("LIST TEACHER CANDIDATES");
  console.log("TENANT:", TENANT_ID);
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

    const rows = res.rows.map((r) => {
      const base =
        r.entity_name && String(r.entity_name).trim().length > 0
          ? String(r.entity_name).trim()
          : String(r.title).trim();

      const cleaned = cleanDisplayName(base);
      const normalized = normalizeName(cleaned);
      const slug = String(r.source_url).split("/").pop() || "";

      return {
        name: cleaned,
        normalized,
        slug,
        url: String(r.source_url),
      };
    });

    rows.sort((a, b) => a.name.localeCompare(b.name, "hr"));

    console.log("Candidates:", rows.length);
    console.table(rows);
    console.log("================================");
    console.log("TOTAL UNIQUE:", new Set(rows.map((r) => r.normalized)).size);
    console.log("================================");
  } catch (e) {
    console.error(e);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
