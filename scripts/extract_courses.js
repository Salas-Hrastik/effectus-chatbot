const fs = require("fs");
const path = require("path");
const axios = require("axios");
const cheerio = require("cheerio");

const input = path.join(process.cwd(),"data","baltazar_academic_sources.json")
const outputCourses = path.join(process.cwd(),"data","baltazar_courses.json")
const outputFaculty = path.join(process.cwd(),"data","baltazar_faculty_candidates.json")

const data = JSON.parse(fs.readFileSync(input,"utf8"))

function normalize(text=""){
return text
.toLowerCase()
.normalize("NFD")
.replace(/[\u0300-\u036f]/g,"")
}

async function fetch(url){
try{
const res = await axios.get(url,{timeout:20000})
return res.data
}catch(e){
return null
}
}

const courses=[]
const facultySet=new Set()

async function processStudy(study){

const courseLinks = study.sources.course || []
if(courseLinks.length===0) return

const url = courseLinks[0].url

const html = await fetch(url)
if(!html) return

const $ = cheerio.load(html)

$("table tr").each((i,row)=>{

const cells=$(row).find("td")
if(cells.length<2) return

const name=$(cells[0]).text().trim()
const ects=$(cells[1]).text().trim()

if(name.length<3) return

courses.push({
study:study.study,
course:name,
ects:ects
})

})

$("body").text().split("\n").forEach(line=>{
const l=line.trim()

if(l.includes("prof.")||l.includes("dr.")||l.includes("doc.")){
facultySet.add(l)
}

})

}

async function run(){

for(const study of data){
console.log("Processing:",study.study)
await processStudy(study)
}

fs.writeFileSync(outputCourses,JSON.stringify(courses,null,2))

const faculty=[...facultySet]
fs.writeFileSync(outputFaculty,JSON.stringify(faculty,null,2))

console.log("")
console.log("COURSES:",courses.length)
console.log("FACULTY CANDIDATES:",faculty.length)
console.log("")
console.log("Saved:",outputCourses)
console.log("Saved:",outputFaculty)

}

run()
