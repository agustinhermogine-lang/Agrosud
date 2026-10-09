import { current } from './context.js';
import { Buffer } from 'node:buffer';
const key=p=>String(p).replaceAll('\\','/');
export default {
  mkdirSync(){},
  existsSync(p){return Object.hasOwn(current().files,key(p));},
  readFileSync(p,encoding){const v=current().files[key(p)];if(v===undefined)throw new Error('Archivo no disponible: '+p);const b=Buffer.from(v,'base64');return encoding?b.toString(encoding):b;},
  writeFileSync(p,value,encoding){current().files[key(p)]=Buffer.from(value,encoding).toString('base64');current().dirty=true;},
  renameSync(a,b){const f=current().files;f[key(b)]=f[key(a)];delete f[key(a)];current().dirty=true;},
};
