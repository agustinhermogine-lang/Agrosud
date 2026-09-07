const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const mustExist = [
  'server.js',
  'public/index.html',
  'data/db.json',
  'data/fnd-calendar.json',
  'data/FND_CALENDARIO_ACTUAL.xlsx'
];
for (const rel of mustExist) {
  const p = path.join(root, rel);
  if (!fs.existsSync(p)) throw new Error(`Falta archivo requerido: ${rel}`);
}

JSON.parse(fs.readFileSync(path.join(root, 'data/db.json'), 'utf8'));
const fnd = JSON.parse(fs.readFileSync(path.join(root, 'data/fnd-calendar.json'), 'utf8'));
if (!Array.isArray(fnd.entries) || !fnd.entries.length) throw new Error('fnd-calendar.json no contiene posiciones');
if (!Array.isArray(fnd.holidays) || !fnd.holidays.length) throw new Error('fnd-calendar.json no contiene feriados');

const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]);
for (const s of scripts) new Function(s);

try {
  const XLSX = require('xlsx');
  const wb = XLSX.readFile(path.join(root, 'data/FND_CALENDARIO_ACTUAL.xlsx'));
  if (!wb.SheetNames.some(n => /FND Calendario/i.test(n))) throw new Error('No existe la hoja FND Calendario Dinámico');
  if (!wb.SheetNames.some(n => /Feriados CME/i.test(n))) throw new Error('No existe la hoja Feriados CME');
} catch (e) {
  if (e.code === 'MODULE_NOT_FOUND') {
    console.warn('Aviso: xlsx aún no está instalado; ejecute npm install.');
  } else throw e;
}

console.log(`OK - AGROSUD v3.2 | FND ${fnd.entries.length} posiciones | ${fnd.holidays.length} feriados`);
