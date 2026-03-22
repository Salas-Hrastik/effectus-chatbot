import fs from "fs";
import path from "path";

const REGISTRY_FILE = path.join(process.cwd(),"data","baltazar_teacher_registry.json")

const MANAGEMENT_NAMES = [
  "Ivan Ružić",
  "Ivana Lacković",
  "Kristijan Čović",
  "Martina Vukašina",
  "Ivan Pokupec"
]

function normalize(s:string){
  return s.toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g,"")
}

const data = JSON.parse(fs.readFileSync(REGISTRY_FILE,"utf8"))

const teachers = data.teachers || []

console.log("================================")
console.log("CHECK MANAGEMENT IN REGISTRY")
console.log("================================")

for(const name of MANAGEMENT_NAMES){

  const found = teachers.find((t:any)=>{
    const cleanTeacher = normalize(t.name)
    const cleanName = normalize(name)

    return cleanTeacher.includes(cleanName) || cleanName.includes(cleanTeacher)
  })

  if(found){
    console.log("✔",name)
    console.log("   registry:",found.name)
    console.log("   url:",found.profile_url)
  }else{
    console.log("✖",name,"NOT FOUND")
  }

  console.log("")
}

console.log("================================")
console.log("TOTAL TEACHERS:",teachers.length)
console.log("================================")
