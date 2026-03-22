import dotenv from "dotenv";
import { Pool } from "pg";
import fs from "fs";
import path from "path";

dotenv.config({ path: ".env.local" });
dotenv.config();

const TENANT_ID = process.env.TENANT_ID || "baltazar";
const INPUT_PATH = path.join(process.cwd(), "data", `teacher_reference_candidates_${TENANT_ID}.json`);

if (!process.env.DATABASE_URL) {
  console.error("ERROR: DATABASE_URL is missing in environment (.env.local or shell).");
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

type CandidateItem = {
  name: string;
  normalized_name: string;
  slug: string;
  url: string;
  source_document_id: string;
  source_count: number;
};

type CandidateFile = {
  institution_id: string;
  generated_at: string;
  source: string;
  raw_candidate_rows: number;
  unique_candidates: number;
  skipped_rows: number;
  items: CandidateItem[];
};

function buildPersonId(normalizedName: string): string {
  return `person_${TENANT_ID}_${normalizedName.replace(/\s+/g, "_")}`;
}

async function ensurePersonsTable(client: any) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS persons (
      id TEXT PRIMARY KEY,
      institution_id TEXT NOT NULL,
      full_name TEXT NOT NULL,
      normalized_name TEXT NOT NULL,
      titles TEXT,
      is_teacher BOOLEAN DEFAULT FALSE,
      is_management BOOLEAN DEFAULT FALSE,
      is_past_dean BOOLEAN DEFAULT FALSE,
      source_document_id TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS persons_institution_normalized_name_uidx
    ON persons (institution_id, normalized_name)
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS persons_institution_idx
    ON persons (institution_id)
  `);
}

function loadCandidateFile(filePath: string): CandidateFile {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Candidate JSON not found: ${filePath}`);
  }

  const raw = fs.readFileSync(filePath, "utf8");
  const parsed = JSON.parse(raw);

  if (!parsed || !Array.isArray(parsed.items)) {
    throw new Error(`Invalid candidate JSON structure in: ${filePath}`);
  }

  return parsed as CandidateFile;
}

async function main() {
  console.log("================================");
  console.log("BUILD PERSONS REGISTRY FROM JSON");
  console.log("TENANT:", TENANT_ID);
  console.log("INPUT:", INPUT_PATH);
  console.log("================================");

  const candidateFile = loadCandidateFile(INPUT_PATH);

  if (candidateFile.institution_id !== TENANT_ID) {
    throw new Error(
      `Institution mismatch: JSON has "${candidateFile.institution_id}" but TENANT_ID is "${TENANT_ID}"`
    );
  }

  console.log("JSON raw_candidate_rows:", candidateFile.raw_candidate_rows);
  console.log("JSON unique_candidates:", candidateFile.unique_candidates);
  console.log("JSON skipped_rows:", candidateFile.skipped_rows);

  const client = await pool.connect();

  try {
    await ensurePersonsTable(client);

    let created = 0;
    let updated = 0;
    let skipped = 0;

    for (const item of candidateFile.items) {
      const fullName = String(item.name || "").trim();
      const normalizedName = String(item.normalized_name || "").trim();
      const sourceDocumentId = String(item.source_document_id || "").trim();

      if (!fullName || !normalizedName) {
        skipped++;
        continue;
      }

      const personId = buildPersonId(normalizedName);

      const existing = await client.query(
        `
        SELECT id
        FROM persons
        WHERE institution_id = $1
          AND normalized_name = $2
        `,
        [TENANT_ID, normalizedName]
      );

      if (existing.rows.length > 0) {
        await client.query(
          `
          UPDATE persons
          SET full_name = $1,
              titles = NULL,
              is_teacher = TRUE,
              source_document_id = $2,
              updated_at = NOW()
          WHERE institution_id = $3
            AND normalized_name = $4
          `,
          [fullName, sourceDocumentId || null, TENANT_ID, normalizedName]
        );
        updated++;
      } else {
        await client.query(
          `
          INSERT INTO persons (
            id,
            institution_id,
            full_name,
            normalized_name,
            titles,
            is_teacher,
            is_management,
            is_past_dean,
            source_document_id
          )
          VALUES ($1, $2, $3, $4, NULL, TRUE, FALSE, FALSE, $5)
          `,
          [personId, TENANT_ID, fullName, normalizedName, sourceDocumentId || null]
        );
        created++;
      }
    }

    const countRes = await client.query(
      `
      SELECT COUNT(*)::int AS total
      FROM persons
      WHERE institution_id = $1
        AND is_teacher = TRUE
      `,
      [TENANT_ID]
    );

    console.log("Persons created:", created);
    console.log("Persons updated:", updated);
    console.log("Persons skipped:", skipped);
    console.log("Current teacher count in persons:", countRes.rows[0].total);
    console.log("================================");
    console.log("PERSON REGISTRY BUILD COMPLETE");
    console.log("================================");
  } catch (error) {
    console.error("ERROR:", error);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error("FATAL:", error);
  process.exit(1);
});
