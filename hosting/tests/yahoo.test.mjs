import {test} from 'node:test';
import assert from 'node:assert/strict';
import yahoo from '../source/market-yahoo.cjs';
test('el calendario incluye meses correctos, cambio de año y cinco años de búsqueda',()=>{
 const rows=yahoo.candidates('ZC',new Date('2026-10-08T13:00:00Z'));assert.equal(rows[0],'ZCZ26');assert.ok(rows.includes('ZCH27'));assert.ok(rows.includes('ZCU31'));assert.ok(!rows.includes('ZCF27'));assert.ok(!rows.includes('ZCZ31'));
});
test('rechaza símbolos de otro producto y contratos vencidos',()=>{
 assert.equal(yahoo.normalize('ZC','ZCZ26',{meta:{symbol:'ZSZ26.CBT',regularMarketPrice:400,regularMarketTime:1791464400}}),null);
 assert.equal(yahoo.normalize('ZC','ZCZ26',{meta:{symbol:'ZCZ26.CBT',regularMarketPrice:400,regularMarketTime:1791464400,expirationDate:1}}),null);
});
test('un límite 429 conserva precios anteriores y aplica una pausa',async()=>{
 const now=Date.parse('2026-10-08T13:00:00Z');let calls=0;
 const result=await yahoo.fetchYahooProduct('ZC',{now,previous:{positions:[{position:'ZCZ26',monthCode:'Z',year:2026,last:400,updatedAt:'2026-10-08T12:00:00Z'}]},fetchImpl:async()=>{calls++;return new Response('',{status:429});}});
 assert.ok(calls<=3);assert.equal(result.retryAfterMs,60000);assert.equal(result.positions[0].last,400);assert.equal(result.positions[0].state,'ULTIMO DATO');assert.ok(result.warning);
});
test('contratos inexistentes se excluyen y se vuelven a descubrir tras seis horas',async()=>{
 const now=Date.parse('2026-10-08T13:00:00Z');let calls=0;
 const missing=yahoo.candidates('ZC',new Date(now));
 const previous={positions:[],missing,discoveredAt:now-1000};
 const result=await yahoo.fetchYahooProduct('ZC',{now,previous,fetchImpl:async()=>{calls++;return new Response('',{status:404});}});assert.equal(calls,0);assert.equal(result.discoveredAt,previous.discoveredAt);
 await yahoo.fetchYahooProduct('ZC',{now:now+7*3600000,previous,fetchImpl:async()=>{calls++;return new Response('',{status:404});}});assert.ok(calls>0);
});
