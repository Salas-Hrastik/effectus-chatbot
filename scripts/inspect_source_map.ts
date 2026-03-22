import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const FILE = path.join(ROOT, "data", "baltazar_source_map.json");

function readJson(filePath: string) {
  if (!fs.existsSync(filePath)) {
    throw new Error("Datoteka ne postoji: " + filePath);
  }
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function count(x:any){
  if(!x) return 0;
  if(Array.isArray(x)) return x.length;
  return 0;
}

function totalStudySources(study:any){
  const s = study.sources || {};
  let total = 0;

  if (s.study_page_hr) total++;
  if (s.study_page_en) total++;

  total += count(s.curriculum_pdfs);
  total += count(s.course_catalogues);
  total += count(s.schedules);
  total += count(s.exam_dates);
  total += count(s.practice_info);
  total += count(s.final_thesis_info);
  total += count(s.faculty_pages);
  total += count(s.policies);
  total += count(s.other_sources);

  return total;
}

function main(){

  const data = readJson(FILE);

  const studies = data.studies || [];
  const institution = data.institution?.sources || {};
  const facultySources = data.faculty_sources || [];
  const sharedAcademicSources = data.shared_academic_sources || [];
  const meta = data.crawl_meta || {};

  console.log("======================================");
  console.log("BALTZAR SOURCE MAP INSPECTION");
  console.log("======================================");

  console.log("Generated:", meta.generated_at);
  console.log("Crawled pages:", meta.crawled_pages);
  console.log("Domain:", meta.domain);

  console.log("======================================");
  console.log("INSTITUTION");
  console.log("homepage:", institution.homepage);
  console.log("admissions:", institution.admissions);
  console.log("tuition:", institution.tuition);
  console.log("student_services:", count(institution.student_services));
  console.log("policies:", count(institution.policies));
  console.log("general_academic_documents:", count(institution.general_academic_documents));

  console.log("======================================");
  console.log("STUDIES:", studies.length);
  console.log("FACULTY SOURCES:", facultySources.length);
  console.log("SHARED ACADEMIC SOURCES:", sharedAcademicSources.length);

  console.log("======================================");

  for(const s of studies){
      const total = totalStudySources(s);

      console.log("STUDY:", s.study);
      console.log("TOTAL SOURCES:", total);
      console.log("--------------------------");
  }

}

main();
