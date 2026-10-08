// Cotizaciones por contrato recibido de Yahoo. No calcula curvas ni precios faltantes.
const MONTHS={F:[1,'Enero'],G:[2,'Febrero'],H:[3,'Marzo'],J:[4,'Abril'],K:[5,'Mayo'],M:[6,'Junio'],N:[7,'Julio'],Q:[8,'Agosto'],U:[9,'Septiembre'],V:[10,'Octubre'],X:[11,'Noviembre'],Z:[12,'Diciembre']};
const SPECS={
 ZC:{name:'Maíz',factor:0.393682,unit:'Cents/Bu',mtPerContract:127,months:['H','K','N','U','Z']},
 ZS:{name:'Poroto de soja',factor:0.367454,unit:'Cents/Bu',mtPerContract:136,months:['F','H','K','N','Q','U','X']},
 ZW:{name:'Trigo Chicago SRW',factor:0.367454,unit:'Cents/Bu',mtPerContract:136,months:['H','K','N','U','Z']},
 ZM:{name:'Harina de soja',factor:1.10231,unit:'USD/ST',mtPerContract:90.7,months:['F','H','K','N','Q','U','V','Z']},
 ZL:{name:'Aceite de soja',factor:22.0462,unit:'Cents/lb',mtPerContract:27.2,months:['F','H','K','N','Q','U','V','Z']},
 ZO:{name:'Avena',factor:0.688945,unit:'Cents/Bu',mtPerContract:45.4,months:['H','K','N','U','Z']}
};
const numeric=v=>v==null||v===''||!Number.isFinite(Number(v))?null:Number(v);
function candidates(product,now=new Date()){
 const spec=SPECS[product];if(!spec)return [];
 const min=now.getUTCFullYear()*12+now.getUTCMonth();const max=min+60;
 const result=[];for(let y=now.getUTCFullYear();y<=now.getUTCFullYear()+5;y++)for(const code of spec.months){const index=y*12+MONTHS[code][0]-1;if(index>=min&&index<=max)result.push(`${product}${code}${String(y).slice(-2)}`);}
 return result;
}
function normalize(product,ticker,result,now=Date.now()){
 const meta=result?.meta;if(!meta||meta.symbol?.toUpperCase()!==`${ticker}.CBT`)return null;
 if(meta.expirationDate&&meta.expirationDate*1000<now)return null;
 const bars=result.indicators?.quote?.[0]||{};const timestamps=result.timestamp||[];
 let idx=-1;for(let i=(bars.close?.length||0)-1;i>=0;i--)if(numeric(bars.close[i])!=null){idx=i;break;}
 const quoteTime=numeric(meta.regularMarketTime)||0;const barTime=idx>=0?numeric(timestamps[idx])||0:0;
 const useQuote=numeric(meta.regularMarketPrice)!=null&&quoteTime>=barTime;
 const last=useQuote?numeric(meta.regularMarketPrice):idx>=0?numeric(bars.close[idx]):null;
 if(last==null)return null;
 const previous=numeric(meta.previousClose??meta.chartPreviousClose);
 const code=ticker.slice(product.length,product.length+1),year=2000+Number(ticker.slice(-2));
 const timestamp=useQuote?quoteTime:barTime;
 return {position:ticker,monthCode:code,monthName:MONTHS[code][1],year,last,change:previous==null?null:last-previous,changePercent:previous?((last-previous)/previous)*100:null,high:numeric(meta.regularMarketDayHigh),low:numeric(meta.regularMarketDayLow),settle:null,previousClose:previous,volume:numeric(meta.regularMarketVolume),updatedAt:timestamp?new Date(timestamp*1000).toISOString():null,delayMinutes:numeric(meta.exchangeDataDelayedBy),source:'Yahoo Finance · contrato individual',state:'DEMORADO',usdMt:last*SPECS[product].factor};
}
async function fetchYahooProduct(product,{previous=null,fetchImpl=fetch,now=Date.now()}={}){
 const spec=SPECS[product];if(!spec)throw new Error('Producto inválido');
 const all=candidates(product,new Date(now));
 const prior=new Map((previous?.positions||[]).filter(x=>all.includes(x.position)).map(x=>[x.position,x]));
 const discoveryFresh=previous?.discoveredAt&&now-previous.discoveredAt<6*60*60*1000;
 const missing=discoveryFresh?new Set(previous.missing||[]):new Set();
 const targets=all.filter(t=>!missing.has(t));const positions=[];let cursor=0,failures=0,limited=false;
 async function run(){while(cursor<targets.length&&!limited){const ticker=targets[cursor++];try{
  const response=await fetchImpl(`https://query1.finance.yahoo.com/v8/finance/chart/${ticker}.CBT?interval=1m&range=1d`,{headers:{Accept:'application/json'},signal:AbortSignal.timeout(8000)});
  if(response.status===429){limited=true;throw new Error('RATE_LIMIT');}
  if(response.status===404||response.status===422){missing.add(ticker);continue;}
  if(!response.ok)throw new Error('HTTP '+response.status);
  const payload=await response.json();const result=payload.chart?.result?.[0];
  if(payload.chart?.error){if(/not found|delisted|no data/i.test(payload.chart.error.description||'')){missing.add(ticker);continue;}throw new Error('Respuesta de fuente inválida');}
  const quote=normalize(product,ticker,result,now);if(quote){positions.push(quote);missing.delete(ticker);}else{failures++;if(prior.has(ticker))positions.push({...prior.get(ticker),state:'ULTIMO DATO'});}
 }catch{failures++;if(prior.has(ticker))positions.push({...prior.get(ticker),state:'ULTIMO DATO'});}}
 }
 await Promise.all(Array.from({length:3},run));
 if(limited)for(const ticker of targets.slice(cursor))if(prior.has(ticker))positions.push({...prior.get(ticker),state:'ULTIMO DATO'});
 positions.sort((a,b)=>a.year-b.year||MONTHS[a.monthCode][0]-MONTHS[b.monthCode][0]);
 const fresh=positions.filter(p=>p.state==='DEMORADO').length;
 return {symbol:product,name:spec.name,factor:spec.factor,unit:spec.unit,mtPerContract:spec.mtPerContract,reference:false,positions,state:fresh?'DEMORADO':positions.length?'ULTIMO DATO':'SIN FUENTE DISPONIBLE',sourceMode:'Yahoo Finance · vencimientos individuales',error:positions.length?null:limited?'Yahoo limitó temporalmente las consultas. Se reintentará con una pausa.':'Yahoo no devolvió cotizaciones para los contratos consultados.',warning:limited?'Límite de consultas del proveedor; se conservan los datos anteriores.':failures?`${failures} consultas sin respuesta válida; las cotizaciones recibidas se mantienen.`:null,lastSuccessfulAt:fresh?new Date(now).toISOString():previous?.lastSuccessfulAt||null,queriedContracts:targets.length,checkedContracts:Math.min(cursor,targets.length),searchThrough:new Date(now+60*30.4375*86400000).toISOString().slice(0,7),discoveredAt:limited?previous?.discoveredAt||null:discoveryFresh?previous.discoveredAt:now,missing:[...missing],retryAfterMs:limited?60000:15000};
}
module.exports={SPECS,candidates,normalize,fetchYahooProduct};
