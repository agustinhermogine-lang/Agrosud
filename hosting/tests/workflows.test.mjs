import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import worker from '../dist/server/index.js';
const sqlite=new DatabaseSync(':memory:');
sqlite.exec(readFileSync(new URL('../drizzle/0000_outstanding_overlord.sql',import.meta.url),'utf8'));
sqlite.exec(readFileSync(new URL('../drizzle/0001_fancy_pepper_potts.sql',import.meta.url),'utf8'));
const DB={prepare(sql){let params=[];return {bind(...p){params=p;return this;},async run(){const r=sqlite.prepare(sql).run(...params);return {meta:{changes:Number(r.changes)}};},async first(){return sqlite.prepare(sql).get(...params)||null;}};}};
const origin='https://agrosud.test';
let cookie;
async function request(path,method='GET',body,session=cookie,extra={}){
 const headers={Cookie:session||'',Origin:origin,...extra};let payload;
 if(body instanceof FormData)payload=body;else if(body!==undefined){headers['content-type']='application/json';payload=JSON.stringify(body);}
 const response=await worker.fetch(new Request(origin+path,{method,headers,body:payload}),{DB});
 return {response,body:response.headers.get('content-type')?.includes('json')?await response.json():await response.text()};
}
test('contratos, fijaciones, separación por visitante, importación y validación',async()=>{
 const home=await request('/');assert.equal(home.response.status,200);assert.match(home.body,/Mercado argentino/);assert.match(home.body,/Versión pública de prueba/);
 cookie=home.response.headers.get('set-cookie').split(';')[0];assert.match(home.response.headers.get('set-cookie'),/HttpOnly; SameSite=Strict/);
 const health=await request('/api/health');assert.equal(health.body.status,'success');assert.ok(health.body.fndPositions>0);
 assert.equal((await request('/api/factors')).body.products.ZC.factor,0.393682);
 assert.equal((await request('/api/a3/market')).body.configured,false);
 const contract={id:'TEST-001',product:'ZC',totalMt:254,premiumNative:15,contractPosition:'ZCZ26',minTolerancePercent:0,maxTolerancePercent:0};
 assert.equal((await request('/api/contracts','POST',{...contract,totalMt:-1})).response.status,400);
 assert.equal((await request('/api/contracts','POST',{...contract,premiumNative:'abc'})).response.status,400);
 assert.equal((await request('/api/contracts','POST',{...contract,contractPosition:'ZSZ26'})).response.status,400);
 assert.equal((await request('/api/contracts','POST',contract)).response.status,201);
 assert.equal((await request('/api/contracts','POST',contract)).response.status,409);
 assert.equal((await request('/api/contracts')).body.data.length,1);
 const other=(await request('/','GET',undefined,'')).response.headers.get('set-cookie').split(';')[0];assert.equal((await request('/api/contracts','GET',undefined,other)).body.data.length,0);
 assert.equal((await request('/api/contracts/TEST-001/fixings','POST',{contracts:1,priceNative:'abc'})).response.status,400);
 const fixing=await request('/api/contracts/TEST-001/fixings','POST',{contracts:1,priceNative:400,position:'ZCZ26'});assert.equal(fixing.response.status,201);assert.equal(fixing.body.data.fixedMt,127);assert.ok(Math.abs(fixing.body.data.flatPriceUsdMt-415*0.393682)<1e-9);
 assert.equal((await request('/api/contracts/TEST-001/fixings','POST',{contracts:2,priceNative:400})).response.status,400);
 assert.equal((await request('/api/contracts/TEST-001/close','POST',{})).body.data.status,'COMPLETO');
 assert.equal((await request('/api/contracts/TEST-001/fixings','POST',{contracts:1,priceNative:400})).response.status,400);
 assert.equal((await request('/api/contracts/TEST-001/reopen','POST',{})).body.data.status,'ABIERTO');
 assert.equal((await request('/api/fixings/'+fixing.body.data.id,'DELETE')).body.deleted,1);
 assert.equal((await request('/api/contracts/TEST-001','DELETE')).body.deleted,1);
 const workbook=readFileSync(new URL('../source/seed.json',import.meta.url),'utf8');const file=Buffer.from(JSON.parse(workbook)['/app/data/FND_CALENDARIO_ACTUAL.xlsx'],'base64');const form=new FormData();form.append('file',new Blob([file]),'calendario.xlsx');
 const imported=await request('/api/fnd/import','POST',form);assert.equal(imported.response.status,200);assert.ok(imported.body.data.positions>0);
 const rejected=await worker.fetch(new Request(origin+'/api/contracts',{method:'POST',headers:{Origin:'https://otro.test','content-type':'application/json'},body:JSON.stringify(contract)}),{DB});assert.equal(rejected.status,403);
 assert.equal((await request('/api/desconocida')).response.status,404);
});
test('Yahoo consulta contratos individuales, usa el último precio y comparte la caché',async()=>{
 const originalFetch=globalThis.fetch;
 let calls=0;
 globalThis.fetch=async url=>{
  calls++;if(!String(url).includes('ZCZ26.CBT'))return new Response('',{status:404});
  return Response.json({chart:{result:[{meta:{symbol:'ZCZ26.CBT',regularMarketPrice:400,chartPreviousClose:390,regularMarketTime:1791464400,regularMarketDayHigh:405,regularMarketDayLow:389},timestamp:[1791464100],indicators:{quote:[{close:[395],high:[399],low:[389]}]}}]}});
 };
 try{const result=await request('/api/market?product=ZC');assert.equal(result.response.status,200);const product=result.body.products.ZC;assert.equal(product.positions.length,1);assert.equal(product.positions[0].position,'ZCZ26');assert.equal(product.positions[0].last,400);assert.equal(product.positions[0].high,405);assert.equal(product.positions[0].settle,null);assert.equal(product.positions[0].previousClose,390);assert.equal(product.error,null);const before=calls;await request('/api/market?product=ZC');assert.equal(calls,before);await request('/api/market?product=ZC&force=1');assert.ok(calls>before);const refreshed=calls;await request('/api/market?product=ZC');assert.equal(calls,refreshed);}
 finally{globalThis.fetch=originalFetch;}
});
test('el refresco manual respeta la pausa cuando Yahoo limita las consultas',async()=>{
 const originalFetch=globalThis.fetch;let calls=0;
 globalThis.fetch=async()=>{calls++;return new Response('',{status:429});};
 try{const limited=await request('/api/market?product=ZC&force=1');assert.equal(limited.body.products.ZC.retryAfterMs,60000);assert.equal(limited.body.products.ZC.positions[0].state,'ULTIMO DATO');const afterLimit=calls;await request('/api/market?product=ZC&force=1');assert.equal(calls,afterLimit);}
 finally{globalThis.fetch=originalFetch;}
});
test('A3 interpreta cotizaciones del proveedor y oculta las credenciales',async()=>{
 const originalFetch=globalThis.fetch;
 globalThis.fetch=async(url,options)=>{assert.equal(options.headers.get('X-Auth-Token'),'fixture-token');if(String(url).includes('/instruments/all'))return Response.json({status:'OK',instruments:[{instrumentId:{marketId:'ROFX',symbol:'SOJ.ROS/MAY27'}}]});return Response.json({status:'OK',marketData:{LA:{price:330,date:1791464400000},BI:[{price:329}],OF:[{price:331}],SE:{price:328},CL:{price:327}}});};
 try{const response=await worker.fetch(new Request(origin+'/api/a3/market',{headers:{Cookie:cookie}}),{DB,A3_API_BASE_URL:'https://a3-provider.test',A3_AUTH_TOKEN:'fixture-token'});const result=await response.json();assert.equal(response.status,200);assert.equal(result.positions[0].last,330);assert.equal(result.positions[0].change,3);assert.equal(result.positions[0].bid,329);assert.equal(result.positions[0].ask,331);assert.equal(JSON.stringify(result).includes('fixture-token'),false);}
 finally{globalThis.fetch=originalFetch;}
});
test('dos escrituras concurrentes no sobrescriben contratos silenciosamente',async()=>{
 const base={product:'ZC',totalMt:254,premiumNative:15,contractPosition:'ZCZ26'};
 const results=await Promise.all([request('/api/contracts','POST',{...base,id:'RACE-1'}),request('/api/contracts','POST',{...base,id:'RACE-2'})]);
 assert.ok(results.every(r=>[201,409].includes(r.response.status)));
 assert.equal((await request('/api/contracts')).body.data.length,results.filter(r=>r.response.status===201).length);
});
