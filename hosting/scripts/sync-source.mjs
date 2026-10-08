import fs from 'node:fs';
const source=new URL('../../',import.meta.url);
fs.mkdirSync('source/public',{recursive:true});fs.mkdirSync('source/data',{recursive:true});
let server=fs.readFileSync(new URL('server.js',source),'utf8');
const imports={express:'express',axios:'axios',cors:'cors',fs:'fs',path:'node:path',crypto:'node:crypto',zlib:'node:zlib',multer:'multer',XLSX:'xlsx'};
server=server.replace('require("dotenv").config();','');
for(const [name,mod] of Object.entries(imports))server=server.replace(new RegExp(`const ${name} = require\\("[^"]+"\\);`),`import ${name} from '${mod}';`);
server=server.replace("import XLSX from 'xlsx';","import * as XLSX from 'xlsx';");
server=server.replace('const { parse: parseCsv } = require("csv-parse/sync");',"import {parse as parseCsv} from 'csv-parse/sync';");
server=server.replace('let marketCache = { at:0, data:null };','').replace('let wasdeReportCache = { checkedAt: 0, report: null };','');
server=server.replace(/\bmarketCache\b/g,'current().marketCache').replace(/\bwasdeReportCache\b/g,'current().wasdeReportCache');
server="import {runtimeProcess as process,current} from '../worker/context.js';\nconst __dirname='/app';\n"+server;
server=server.slice(0,server.lastIndexOf('\nensureDb();'))+'\nexport default app;\n';
fs.writeFileSync('source/server.js',server);
let html=fs.readFileSync(new URL('public/index.html',source),'utf8');
html=html.replace('<main class="content">','<main class="content"><div class="note">Versión pública de prueba. Tus contratos se guardan separados de los de otros visitantes y se recuperan desde este navegador. Al borrar sus cookies perdés el acceso a esos datos. No incluye los contratos del proyecto local.</div>');
fs.writeFileSync('source/public/index.html',html);
const files={};
for(const name of ['fnd-calendar.json','FND_CALENDARIO_ACTUAL.xlsx'])files['/app/data/'+name]=fs.readFileSync(new URL('data/'+name,source)).toString('base64');
const empty={contracts:[],fixings:[],manualMarket:{},lastMarket:{},manualSettlements:{},settlementCache:{},wasdeHistory:{},wasdeReports:[]};
for(const name of fs.readdirSync(new URL('data/usda/',source)).filter(n=>n.endsWith('.txt'))){
 files['/app/data/usda/'+name]=fs.readFileSync(new URL('data/usda/'+name,source)).toString('base64');
 const match=name.match(/wasde(\d{2})(\d{2})/);if(match)empty.wasdeReports.push({release:`20${match[2]}-${match[1]}`,textFile:name,pdfFile:name.replace('.txt','.pdf'),source:'USDA WASDE · archivo de referencia',downloadedAt:null});
}
files['/app/data/db.json']=Buffer.from(JSON.stringify(empty)).toString('base64');
fs.writeFileSync('source/seed.json',JSON.stringify(files));
console.log('Código sincronizado; contratos locales excluidos');
