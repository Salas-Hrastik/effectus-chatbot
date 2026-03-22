import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const FILE = path.join(ROOT, "data", "baltazar_courses_from_general_information.json");

function main() {
  if (!fs.existsSync(FILE)) {
    throw new Error("Datoteka ne postoji: " + FILE);
  }

  const raw = fs.readFileSync(FILE, "utf8");
  const data = JSON.parse(raw);

  console.log("======================================");
  console.log("BALTAZAR COURSES FILE INSPECTION");
  console.log("======================================");
  console.log("FILE:", FILE);
  console.log("TYPE:", Array.isArray(data) ? "array" : typeof data);

  if (Array.isArray(data)) {
    console.log("LENGTH:", data.length);
    console.log("======================================");

    for (let i = 0; i < Math.min(data.length, 20); i++) {
      const item = data[i];
      console.log(`ITEM ${i + 1}:`);
      console.log("RAW:", JSON.stringify(item, null, 2));

      if (item && typeof item === "object" && !Array.isArray(item)) {
        console.log("KEYS:", Object.keys(item).join(", "));
      } else {
        console.log("KEYS: (nije objekt)");
      }

      console.log("--------------------------------------");
    }
  } else if (data && typeof data === "object") {
    console.log("TOP-LEVEL KEYS:", Object.keys(data).join(", "));
    console.log("RAW OBJECT:", JSON.stringify(data, null, 2).slice(0, 5000));
  } else {
    console.log("RAW:", String(data));
  }

  console.log("======================================");
  console.log("INSPECTION FINISHED");
  console.log("======================================");
}

main();
