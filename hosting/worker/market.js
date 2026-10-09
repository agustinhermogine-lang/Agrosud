import yahoo from '../source/market-yahoo.cjs';
const {SPECS,fetchYahooProduct}=yahoo;
function loading(symbol){return {symbol,...SPECS[symbol],positions:[],state:'CONSULTANDO',sourceMode:'Yahoo Finance · vencimientos individuales',refreshing:true,error:null};}
export async function marketResponse(url,db){
 const selected=url.searchParams.get('product')?.toUpperCase();
 if(selected&&!SPECS[selected])return Response.json({status:'error',message:'Producto inválido'},{status:400});
 if(!selected){const products={};for(const symbol of Object.keys(SPECS)){const row=await db.prepare('SELECT payload,fetched_at,lock_until FROM market_cache WHERE product=?').bind(symbol).first();products[symbol]=row?.fetched_at?JSON.parse(row.payload):loading(symbol);}return Response.json({status:'success',products,fetchedAt:new Date().toISOString(),refreshMs:15000});}
 await db.prepare('INSERT OR IGNORE INTO market_cache (product,payload,fetched_at,lock_until) VALUES (?,\'{}\',0,0)').bind(selected).run();
 const row=await db.prepare('SELECT payload,fetched_at,lock_until FROM market_cache WHERE product=?').bind(selected).first();
 const previous=row.fetched_at?JSON.parse(row.payload):null;
 const now=Date.now(),ttl=previous?.retryAfterMs||15000,force=url.searchParams.get('force')==='1';
 let data=previous;
 if(now-row.fetched_at>=ttl||(force&&ttl<=15000)){
  const lease=await db.prepare('UPDATE market_cache SET lock_until=? WHERE product=? AND lock_until<?').bind(now+120000,selected,now).run();
  if(lease.meta.changes===1){try{data=await fetchYahooProduct(selected,{previous});await db.prepare('UPDATE market_cache SET payload=?,fetched_at=?,lock_until=0 WHERE product=? AND lock_until=?').bind(JSON.stringify(data),Date.now(),selected,now+120000).run();}catch(e){await db.prepare('UPDATE market_cache SET lock_until=0 WHERE product=? AND lock_until=?').bind(selected,now+120000).run();throw e;}}
  else data=previous?{...previous,refreshing:true}:loading(selected);
 }
 return Response.json({status:'success',products:{[selected]:data||loading(selected)},fetchedAt:new Date().toISOString(),refreshMs:15000},{headers:{'Cache-Control':'no-store'}});
}
