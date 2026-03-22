import fs from "fs";
import path from "path";

type CandidateRow = {
  programme_group: string;
  normalized_key: string;
  course_count: number;
  candidates: Array<{
    study: string;
    slug: string;
    score: number;
    reasons: string[];
  }>;
};

type CandidateFile = {
  generated_at?: string;
  input_files?: {
    source_map?: string;
    academic_model_v2?: string;
  };
  candidate_rows?: CandidateRow[];
};

type ReviewStatus =
  | "safe_single_match"
  | "needs_manual_review"
  | "broad_group_not_directly_mappable"
  | "insufficient_signal";

type ReviewRow = {
  programme_group: string;
  normalized_key: string;
  course_count: number;
  review_status: ReviewStatus;
  recommended_match: string | null;
  rationale: string[];
  top_candidates: Array<{
    study: string;
    score: number;
    reasons: string[];
  }>;
};

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, "data");

const INPUT_FILE = path.join(DATA_DIR, "baltazar_programme_mapping_candidates.json");
const OUTPUT_FILE = path.join(DATA_DIR, "baltazar_programme_mapping_review.json");

function readJsonSafe<T>(filePath: string, fallback: T): T {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
  } catch {
    return fallback;
  }
}

function writeJson(filePath: string, data: unknown) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
}

function normalizeWhitespace(s: string): string {
  return (s || "").replace(/\s+/g, " ").trim();
}

function normalizeText(s: string): string {
  return normalizeWhitespace((s || "").toLowerCase());
}

function unique(arr: string[]): string[] {
  return [...new Set(arr.filter(Boolean).map((x) => normalizeWhitespace(x)))];
}

function isBroadGroup(group: CandidateRow): boolean {
  const key = normalizeText(group.normalized_key || group.programme_group || "");
  return (
    key === "business management" ||
    key === "business administration" ||
    key.includes("business management") ||
    key.includes("business administration") ||
    key.includes("management") && !key.includes("tourism") && !key.includes("project")
  );
}

function classifyRow(row: CandidateRow): ReviewRow {
  const candidates = row.candidates || [];
  const top = candidates[0] || null;
  const second = candidates[1] || null;

  const rationale: string[] = [];
  let review_status: ReviewStatus = "needs_manual_review";
  let recommended_match: string | null = null;

  if (!top || top.score <= 0) {
    review_status = "insufficient_signal";
    rationale.push("Nema dovoljno jakog kandidata za pouzdano mapiranje.");
  } else {
    const scoreGap = top.score - (second?.score || 0);

    if (isBroadGroup(row)) {
      review_status = "broad_group_not_directly_mappable";
      rationale.push("Programska grupa je preširoka i generička za automatsko spajanje na jedan Baltazar studij.");
      rationale.push("Potrebna je ručna ili kurikularna potvrda prije konačnog mapiranja.");
    } else if (top.score >= 40 && scoreGap >= 15) {
      review_status = "safe_single_match";
      recommended_match = top.study;
      rationale.push("Najbolji kandidat ima dovoljno visoku ocjenu i jasnu prednost nad drugim kandidatima.");
    } else if (top.score >= 15) {
      review_status = "needs_manual_review";
      rationale.push("Postoji smislen kandidat, ali prednost nije dovoljno velika za potpuno sigurno automatsko mapiranje.");
    } else {
      review_status = "insufficient_signal";
      rationale.push("Signali podudarnosti su preslabi za pouzdan zaključak.");
    }
  }

  if (top) {
    rationale.push(`Najbolji kandidat: ${top.study} (score=${top.score}).`);
  }
  if (second) {
    rationale.push(`Drugi kandidat: ${second.study} (score=${second.score}).`);
  }

  return {
    programme_group: row.programme_group,
    normalized_key: row.normalized_key,
    course_count: row.course_count,
    review_status,
    recommended_match,
    rationale: unique(rationale),
    top_candidates: candidates.slice(0, 6).map((c) => ({
      study: c.study,
      score: c.score,
      reasons: unique(c.reasons || []),
    })),
  };
}

function main() {
  const input = readJsonSafe<CandidateFile>(INPUT_FILE, { candidate_rows: [] });
  const rows = input.candidate_rows || [];

  if (!rows.length) {
    throw new Error("Nema candidate_rows u datoteci baltazar_programme_mapping_candidates.json.");
  }

  const reviewRows = rows.map(classifyRow);

  const output = {
    generated_at: new Date().toISOString(),
    input_file: INPUT_FILE,
    review_rows: reviewRows,
    summary: {
      total_programme_groups: reviewRows.length,
      safe_single_match: reviewRows.filter((r) => r.review_status === "safe_single_match").length,
      needs_manual_review: reviewRows.filter((r) => r.review_status === "needs_manual_review").length,
      broad_group_not_directly_mappable: reviewRows.filter((r) => r.review_status === "broad_group_not_directly_mappable").length,
      insufficient_signal: reviewRows.filter((r) => r.review_status === "insufficient_signal").length,
    },
  };

  writeJson(OUTPUT_FILE, output);

  console.log("======================================");
  console.log("BALTAZAR PROGRAMME MAPPING REVIEW");
  console.log("======================================");
  console.log("Input :", INPUT_FILE);
  console.log("Output:", OUTPUT_FILE);
  console.log("--------------------------------------");
  console.log("Total programme groups:", output.summary.total_programme_groups);
  console.log("safe_single_match:", output.summary.safe_single_match);
  console.log("needs_manual_review:", output.summary.needs_manual_review);
  console.log("broad_group_not_directly_mappable:", output.summary.broad_group_not_directly_mappable);
  console.log("insufficient_signal:", output.summary.insufficient_signal);
  console.log("--------------------------------------");

  for (const row of reviewRows) {
    console.log(`PROGRAMME GROUP: ${row.programme_group}`);
    console.log(`Status         : ${row.review_status}`);
    console.log(`Recommended    : ${row.recommended_match || "-"}`);
    console.log(`Course count   : ${row.course_count}`);
    console.log("Rationale      :");
    row.rationale.forEach((r, i) => {
      console.log(`  ${i + 1}. ${r}`);
    });
    console.log("Top candidates :");
    row.top_candidates.forEach((c, i) => {
      console.log(`  ${i + 1}. ${c.study} | score=${c.score}`);
    });
    console.log("--------------------------------------");
  }

  console.log("======================================");
  console.log("REVIEW BUILD FINISHED");
  console.log("======================================");
}

main();
