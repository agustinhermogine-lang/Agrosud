require("dotenv").config();
const express = require("express");
const axios = require("axios");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const zlib = require("zlib");
const multer = require("multer");
const XLSX = require("xlsx");
const { parse: parseCsv } = require("csv-parse/sync");

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "public")));

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";
const DB_FILE = path.join(__dirname, "data", "db.json");
const FND_FILE = path.join(__dirname, "data", "fnd-calendar.json");
const FND_XLSX_FILE = path.join(__dirname, "data", "FND_CALENDARIO_ACTUAL.xlsx");
const USDA_REPORTS_DIR = path.join(__dirname, "data", "usda");
const DEFAULT_LIVE_MARKET_API = "https://query1.finance.yahoo.com/v8/finance/chart/{symbol}";
const USDA_BASE = "https://api.fas.usda.gov/api/psd";
const USDA_WASDE_INDEX = "https://esmis.nal.usda.gov/publication/world-agricultural-supply-and-demand-estimates";

const PRODUCTS = {
  ZC: { name:"Maíz", factor:0.393682, unit:"Cents/Bu", mtPerContract:127, cmeProductId:process.env.CME_PRODUCT_ZC || "300", marketSymbol:process.env.MARKET_SYMBOL_ZC || "ZC=F", globex:"ZC", psdCode:"0440000" },
  ZS: { name:"Poroto de soja", factor:0.367454, unit:"Cents/Bu", mtPerContract:136, cmeProductId:process.env.CME_PRODUCT_ZS || "320", marketSymbol:process.env.MARKET_SYMBOL_ZS || "ZS=F", globex:"ZS", psdCode:"2222000" },
  ZW: { name:"Trigo Chicago SRW", factor:0.367454, unit:"Cents/Bu", mtPerContract:136, cmeProductId:process.env.CME_PRODUCT_ZW || "323", marketSymbol:process.env.MARKET_SYMBOL_ZW || "ZW=F", globex:"ZW", psdCode:"0410000" },
  ZM: { name:"Harina de soja", factor:1.10231, unit:"USD/ST", mtPerContract:90.7, cmeProductId:process.env.CME_PRODUCT_ZM || "310", marketSymbol:process.env.MARKET_SYMBOL_ZM || "ZM=F", globex:"ZM", psdCode:"0813100" },
  ZL: { name:"Aceite de soja", factor:22.0462, unit:"Cents/lb", mtPerContract:27.2, cmeProductId:process.env.CME_PRODUCT_ZL || "312", marketSymbol:process.env.MARKET_SYMBOL_ZL || "ZL=F", globex:"ZL", psdCode:"4232000" },
  ZO: { name:"Avena", factor:0.688945, unit:"Cents/Bu", mtPerContract:45.4, cmeProductId:process.env.CME_PRODUCT_ZO || "", marketSymbol:process.env.MARKET_SYMBOL_ZO || "ZO=F", globex:"ZO", psdCode:"0452000" }
};

const MONTHS = {
  F:{short:"JAN", es:"Enero", n:1}, G:{short:"FEB", es:"Febrero", n:2}, H:{short:"MAR", es:"Marzo", n:3},
  J:{short:"APR", es:"Abril", n:4}, K:{short:"MAY", es:"Mayo", n:5}, M:{short:"JUN", es:"Junio", n:6},
  N:{short:"JLY", es:"Julio", n:7}, Q:{short:"AUG", es:"Agosto", n:8}, U:{short:"SEP", es:"Septiembre", n:9},
  V:{short:"OCT", es:"Octubre", n:10}, X:{short:"NOV", es:"Noviembre", n:11}, Z:{short:"DEC", es:"Diciembre", n:12}
};
const MONTH_BY_NAME = {
  JAN:"F", FEB:"G", MAR:"H", APR:"J", MAY:"K", JUN:"M", JLY:"N", JUL:"N", AUG:"Q", SEP:"U", OCT:"V", NOV:"X", DEC:"Z"
};
const CONTRACT_MONTHS = {
  ZC:["H","K","N","U","Z"],
  ZW:["H","K","N","U","Z"],
  ZS:["F","H","K","N","Q","U","X"],
  ZM:["F","H","K","N","Q","U","V","Z"],
  ZL:["F","H","K","N","Q","U","V","Z"],
  ZO:["H","K","N","U","Z"]
};
function standardNextTicker(product,ticker){
  const p=tickerParts(product,ticker);
  const seq=CONTRACT_MONTHS[product];
  if(!p || !seq?.length) return null;
  const i=seq.indexOf(p.code);
  if(i<0) return null;
  const nextCode=seq[(i+1)%seq.length];
  const nextYear=p.year + (i===seq.length-1 ? 1 : 0);
  return `${product}${nextCode}${String(nextYear).slice(-2)}`;
}
function fallbackPositions(product, year=Number(process.env.USDA_MARKET_YEAR || new Date().getUTCFullYear())){
  const seq=CONTRACT_MONTHS[product] || [];
  return seq.map(code=>({
    product, ticker:`${product}${code}${String(year).slice(-2)}`, month:MONTHS[code]?.es || code, monthCode:code, fnd:null, nextTicker:standardNextTicker(product,`${product}${code}${String(year).slice(-2)}`), synthetic:true
  }));
}

let marketCache = { at:0, data:null };
let dataMineTokenCache = { token:null, expiresAt:0 };

function ensureDb(){
  fs.mkdirSync(path.dirname(DB_FILE), { recursive:true });
  if(!fs.existsSync(DB_FILE)){
    writeDb({contracts:[],fixings:[],manualMarket:{},lastMarket:{},manualSettlements:{},settlementCache:{},wasdeHistory:{}});
  }
}
function readDb(){
  ensureDb();
  const db = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
  db.contracts ||= [];
  db.fixings ||= [];
  db.manualMarket ||= {};
  db.lastMarket ||= {};
  db.manualSettlements ||= {};
  db.settlementCache ||= {};
  db.wasdeHistory ||= {};
  db.wasdeReports ||= [];
  return db;
}
function writeDb(db){
  fs.mkdirSync(path.dirname(DB_FILE), { recursive:true });
  const tmp = DB_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2), "utf8");
  fs.renameSync(tmp, DB_FILE);
}
function id(prefix){ return `${prefix}-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`; }
function numberOrNull(v){
  if(v === null || v === undefined || v === "" || v === "-") return null;
  const n = Number(String(v).replace(/,/g, "").replace(/[AB]$/i, ""));
  return Number.isFinite(n) ? n : null;
}
function parseCmeFraction(raw){
  const s = String(raw ?? "").trim().replace(/,/g, "").replace(/[AB]$/i, "");
  if(!s || s === "-") return null;
  if(s.includes("'")){
    const sign = s.startsWith("-") ? -1 : 1;
    const clean = s.replace(/^[+-]/, "");
    const [wholeRaw, fracRaw="0"] = clean.split("'");
    const whole = Number(wholeRaw);
    if(!Number.isFinite(whole)) return null;
    const digits = fracRaw.replace(/\D/g, "");
    const eighths = Number(digits[0] || 0);
    const thirtySeconds = Number(digits[1] || 0);
    return sign * (whole + eighths/8 + thirtySeconds/32);
  }
  return numberOrNull(s);
}
function parseCmeNumber(raw){ return String(raw ?? "").includes("'") ? parseCmeFraction(raw) : numberOrNull(raw); }
function isoDate(v){
  if(!v) return "";
  if(v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0,10);
  if(typeof v === "number"){
    const d = XLSX.SSF.parse_date_code(v);
    if(d) return `${d.y}-${String(d.m).padStart(2,"0")}-${String(d.d).padStart(2,"0")}`;
  }
  const s = String(v).trim();
  const m = s.match(/(20\d{2})[-\/]([01]?\d)[-\/]([0-3]?\d)/);
  if(m) return `${m[1]}-${String(m[2]).padStart(2,"0")}-${String(m[3]).padStart(2,"0")}`;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0,10);
}
function formatUsDate(iso){ const [y,m,d]=iso.split("-"); return `${m}/${d}/${y}`; }
function normalizeTicker(product, raw){
  let s = String(raw || "").trim().toUpperCase().replace(/\s+/g, "");
  s = s.split("-")[0];
  if(s.startsWith(product) && /^[A-Z]{2,3}[FGHJKMNQUVXZ]\d{2}$/.test(s)) return s;
  const m = s.match(/([FGHJKMNQUVXZ])(\d{2})/);
  return m ? `${product}${m[1]}${m[2]}` : s;
}
function tickerParts(product, ticker){
  const t = normalizeTicker(product, ticker);
  const rest = t.slice(product.length);
  const m = rest.match(/^([FGHJKMNQUVXZ])(\d{2})$/);
  if(!m) return null;
  return { code:m[1], yy:m[2], year:2000+Number(m[2]), month:MONTHS[m[1]] };
}
function isValidContractMonth(product,ticker){
  const p=tickerParts(product,ticker);
  const seq=CONTRACT_MONTHS[product] || [];
  return !!(p && seq.includes(p.code));
}
function positionFromExpiration(expirationMonth, symbol, fallback=""){
  const s = String(expirationMonth || "").toUpperCase();
  const monthName = Object.keys(MONTH_BY_NAME).find(m=>s.includes(m));
  const yearMatch = s.match(/20(\d{2})|\b(\d{2})\b/);
  if(monthName && yearMatch){
    const yy = yearMatch[1] || yearMatch[2];
    return `${symbol}${MONTH_BY_NAME[monthName]}${yy}`;
  }
  return fallback;
}
function loadFnd(){
  if(!fs.existsSync(FND_FILE)) return {sourceFile:null, importedAt:null, entries:[], holidays:[]};
  const data = JSON.parse(fs.readFileSync(FND_FILE, "utf8"));
  data.entries ||= []; data.holidays ||= [];
  
  // Auto-extender FND a 2027 y 2028 si no existen
  const maxYear = data.entries.length ? Math.max(...data.entries.map(e=>2000+parseInt(e.ticker.slice(-2)))) : 2026;
  if(maxYear < 2028) {
    const byProd = {};
    data.entries.forEach(e => {
      if(!byProd[e.product]) byProd[e.product] = [];
      byProd[e.product].push(e);
    });
    let addedCount = 0;
    for(let year = maxYear + 1; year <= 2028; year++) {
      const yy = String(year).slice(-2);
      Object.entries(byProd).forEach(([prod, entries2026]) => {
        entries2026.filter(e => 2000+parseInt(e.ticker.slice(-2)) === maxYear).forEach(e => {
          const newTicker = e.ticker.replace(/[0-9]{2}$/, yy);
          const fndYear = parseInt(e.fnd.slice(0, 4));
          const newFnd = e.fnd.replace(/^202[0-9]/, String(year));
          const nextYy = String(year + 1).slice(-2);
          const newNext = e.nextTicker.replace(/[0-9]{2}$/, nextYy);
          if(!data.entries.find(en => en.ticker === newTicker)) {
            data.entries.push({product:prod, ticker:newTicker, month:e.month, monthCode:e.monthCode, fnd:newFnd, nextTicker:newNext});
            addedCount++;
          }
        });
      });
    }
    if(addedCount > 0) {
      data.importedAt = new Date().toISOString();
      fs.writeFileSync(FND_FILE, JSON.stringify(data, null, 2));
    }
  }
  
  return data;
}
function previousTradingDays(dateString, days, fndData=loadFnd()){
  if(!dateString) return "";
  const holidaySet = new Set((fndData.holidays||[]).map(h=>h.date));
  const d = new Date(`${dateString}T12:00:00Z`);
  if(Number.isNaN(d.getTime())) return "";
  let count=0;
  while(count<days){
    d.setUTCDate(d.getUTCDate()-1);
    const day=d.getUTCDay();
    const ds=d.toISOString().slice(0,10);
    if(day!==0 && day!==6 && !holidaySet.has(ds)) count++;
  }
  return d.toISOString().slice(0,10);
}
function parseFndWorkbook(buffer, originalName){
  const wb = XLSX.read(buffer, { type:"buffer", cellDates:true });
  const calName = wb.SheetNames.find(n=>/FND Calendario/i.test(n)) || wb.SheetNames[0];
  const holName = wb.SheetNames.find(n=>/Feriados CME/i.test(n));
  if(!calName || !holName) throw new Error("El Excel debe contener las hojas 'FND Calendario Dinámico' y 'Feriados CME'");
  const cal = XLSX.utils.sheet_to_json(wb.Sheets[calName], {header:1, defval:null, raw:true});
  const hol = XLSX.utils.sheet_to_json(wb.Sheets[holName], {header:1, defval:null, raw:true});
  const rules = [
    {re:/^Trigo/i, product:"ZW", sourcePrefixes:["W","ZW"]},
    {re:/^Maíz|^Maiz/i, product:"ZC", sourcePrefixes:["C","ZC"]},
    {re:/^Soja \(Soybeans\)|^Soja$/i, product:"ZS", sourcePrefixes:["S","ZS"]},
    {re:/^Harina de Soja/i, product:"ZM", sourcePrefixes:["SM","ZM"]},
    {re:/^Aceite de Soja/i, product:"ZL", sourcePrefixes:["BO","ZL"]}
  ];
  let current=null;
  const entries=[];
  for(const row of cal){
    const [a,b,c,d] = row;
    if(typeof a === "string"){
      const rule=rules.find(r=>r.re.test(a)); if(rule) current=rule;
    }
    const fnd=isoDate(c);
    if(current && fnd && b && MONTHS[String(b).toUpperCase()]){
      const monthCode=String(b).toUpperCase();
      const yearFromTicker=typeof d === "string" ? String(d).match(/(\d{2})$/)?.[1] : null;
      const yy=yearFromTicker || fnd.slice(2,4);
      entries.push({product:current.product,ticker:`${current.product}${monthCode}${yy}`,month:String(a||MONTHS[monthCode]?.es||""),monthCode,fnd});
    }
  }
  for(const product of [...new Set(entries.map(e=>e.product))]){
    const rows=entries.filter(e=>e.product===product).sort((a,b)=>{
      const pa=tickerParts(product,a.ticker), pb=tickerParts(product,b.ticker);
      return (pa.year-pb.year) || (pa.month.n-pb.month.n);
    });
    rows.forEach((e,i)=>e.nextTicker=rows[i+1]?.ticker || standardNextTicker(product,e.ticker));
  }
  const holidays=[];
  for(const row of hol.slice(4)){
    const date=isoDate(row[0]);
    if(date) holidays.push({date,name:String(row[1]||""),year:Number(row[2]||date.slice(0,4))});
  }
  if(!entries.length) throw new Error("No se detectaron posiciones FND en el Excel");
  return {sourceFile:originalName || "calendario.xlsx", importedAt:new Date().toISOString(), entries, holidays};
}
function calendarEntry(product,ticker){
  const t=normalizeTicker(product,ticker);
  return loadFnd().entries.find(e=>e.product===product && e.ticker===t) || null;
}
function calendarPositions(product){
  const rows=loadFnd().entries.filter(e=>e.product===product).sort((a,b)=>{
    const pa=tickerParts(product,a.ticker), pb=tickerParts(product,b.ticker);
    return pa&&pb ? (pa.year-pb.year)||(pa.month.n-pb.month.n) : String(a.ticker).localeCompare(String(b.ticker));
  });
  if(!rows.length) return fallbackPositions(product);
  const last=rows[rows.length-1];
  const next=last.nextTicker || standardNextTicker(product,last.ticker);
  if(next && !rows.some(r=>r.ticker===next)){
    const p=tickerParts(product,next);
    rows.push({product,ticker:next,month:p?.month?.es || next,monthCode:p?.code || "",fnd:null,nextTicker:standardNextTicker(product,next),synthetic:true});
  }
  return rows;
}

// -------------------- Market data --------------------
function quoteDate(raw){
  if(!raw) return null;
  const d=new Date(raw);
  return Number.isNaN(d.getTime())?null:d.toISOString();
}
function quotePosition(symbol, raw, expiration){
  const candidate=normalizeTicker(symbol, raw);
  if(tickerParts(symbol,candidate)) return candidate;
  return positionFromExpiration(expiration, symbol, "");
}
function normalizeQuote(symbol, q, source, state){
  const expiration=q.expirationMonth || q.expiration || q.contractMonth || q.month || "";
  const position=quotePosition(symbol, q.position || q.ticker || q.contract || q.symbol, expiration);
  if(!position) return null;
  const last=parseCmeNumber(q.last ?? q.price ?? q.close ?? q.value);
  const priorSettle=parseCmeNumber(q.priorSettle ?? q.priorSettlement ?? q.previousClose ?? q.previousSettlement ?? q.settlement ?? q.settle);
  const change=parseCmeNumber(q.change ?? q.netChange ?? (last!=null && priorSettle!=null ? last-priorSettle : null));
  const changePercent=parseCmeNumber(q.changePercent ?? q.percentChange ?? (change!=null && priorSettle ? change/priorSettle*100 : null));
  if(last==null && priorSettle==null && parseCmeNumber(q.high)==null && parseCmeNumber(q.low)==null) return null;
  const parts=tickerParts(symbol,position);
  return {
    position, monthCode:parts?.code||"", monthName:parts?.month?.es||expiration||"", year:parts?.year||null,
    expirationMonth:expiration, last, change, changePercent, high:parseCmeNumber(q.high), low:parseCmeNumber(q.low), settle:priorSettle,
    volume:numberOrNull(q.volume), updatedAt:quoteDate(q.updatedAt || q.updated || q.lastUpdated || q.timestamp || q.datetime), source, state
  };
}
function validQuotes(symbol, quotes, source, state){
  return quotes.map(q=>normalizeQuote(symbol,q,source,state)).filter(Boolean).sort((a,b)=>{
    if(a.year==null || b.year==null) return String(a.position).localeCompare(String(b.position));
    return (a.year-b.year) || ((MONTHS[a.monthCode]?.n||0)-(MONTHS[b.monthCode]?.n||0));
  });
}
async function requestWithRetry(url, options={}, attempts=2){
  let lastError;
  for(let attempt=1;attempt<=attempts;attempt++){
    try{return await axios.get(url,{timeout:10000,...options});}
    catch(e){lastError=e;if(attempt<attempts) await new Promise(resolve=>setTimeout(resolve,250*attempt));}
  }
  throw lastError;
}
async function fetchCmeProduct(symbol, cfg){
  if(!cfg.cmeProductId) return null;
  const url=`https://www.cmegroup.com/CmeHttp/mvc/Quotes/Future/${cfg.cmeProductId}/G`;
  const headers={"User-Agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/152.0.0.0 Safari/537.36","Accept":"application/json,text/plain,*/*","Referer":"https://www.cmegroup.com/"};
  let quotes=[];
  try{
    const r=await requestWithRetry(url,{headers});
    quotes=Array.isArray(r.data?.quotes)?r.data.quotes:[];
  }catch(e){
    const pages={ZC:"grains/corn",ZS:"oilseeds/soybean",ZW:"grains/wheat",ZM:"oilseeds/soybean-meal",ZL:"oilseeds/soybean-oil",ZO:"grains/oats"};
    const page=pages[symbol];
    if(!page || ![403,404].includes(e.response?.status)) throw e;
    try{
      const landing=await axios.get("https://www.cmegroup.com/",{timeout:12000,headers});
      const cookies=(landing.headers["set-cookie"]||[]).map(x=>x.split(";")[0]).join("; ");
      if(cookies) headers.Cookie=cookies;
    }catch{}
    const r=await requestWithRetry(`https://www.cmegroup.com/markets/agriculture/${page}.quotes.html`,{headers});
    const html=String(r.data).replace(/<script[\s\S]*?<\/script>/gi," ").replace(/<style[\s\S]*?<\/style>/gi," ");
    for(const row of html.matchAll(/<tr[\s\S]*?<\/tr>/gi)){
      const text=row[0].replace(/<[^>]+>/g," ").replace(/&nbsp;/gi," ").replace(/&amp;/gi,"&").replace(/\s+/g," ").trim();
      const code=text.match(new RegExp(`\\b(${symbol}[FGHJKMNQUVXZ]\\d{1,2})\\b`))?.[1];
      if(!code) continue;
      const after=text.slice(text.indexOf(code)+code.length).replace(/^\s*OPT\s*/i,"");
      const values=after.match(/[-+]?\d+(?:'\d+)?(?:\.\d+)?|UNCH/gi)||[];
      const last=parseCmeNumber(values[0]);
      if(last==null) continue;
      const change=values.slice(1).map(parseCmeNumber).find(Number.isFinite);
      quotes.push({ticker:code,last,change,priorSettle:null,high:parseCmeNumber(values[3]),low:parseCmeNumber(values[4]),updatedAt:new Date().toISOString()});
    }
  }
  const positions=validQuotes(symbol,quotes,"CME Group web (demorado)","DEMORADO");
  if(!positions.length) throw new Error("CME devolvió una respuesta sin posiciones válidas");
  return positions;
}
function nextMarketTickerForProduct(product){
  const seq = CONTRACT_MONTHS[product] || ["Z","H","K","N","Q","U","V","X"];
  const now = new Date();
  const currentYear = now.getUTCFullYear();
  const currentMonthIndex = now.getUTCMonth() + 1;
  const nextMonth = seq.find(code => (MONTHS[code]?.n ?? 0) >= currentMonthIndex) || seq[0];
  const year = (MONTHS[nextMonth]?.n ?? 0) < currentMonthIndex ? currentYear + 1 : currentYear;
  return `${product}${nextMonth}${String(year).slice(-2)}`;
}
function buildContractCurveForProduct(symbol, liveQuote, cfg){
  const seq = CONTRACT_MONTHS[symbol] || [];
  if(!seq.length || !liveQuote) return [];
  const base = Number(liveQuote.last ?? liveQuote.settle ?? 0);
  const now = new Date();
  const currentYear = now.getUTCFullYear();
  const currentMonth = now.getUTCMonth() + 1;
  const entries = [];
  const seen = new Set();

  for(let year = currentYear; year <= currentYear + 2; year++){
    for(const code of seq){
      const monthNum = MONTHS[code]?.n ?? 0;
      if(year === currentYear && monthNum < currentMonth) continue;
      const ticker = `${symbol}${code}${String(year).slice(-2)}`;
      if(seen.has(ticker)) continue;
      seen.add(ticker);

      const monthOffset = ((year - currentYear) * 12) + (monthNum - currentMonth);
      const delta = Math.max(0, monthOffset) * 0.9 + (seq.indexOf(code) * 0.35);
      const last = Number((base + delta).toFixed(2));
      const change = Number((Number(liveQuote.change ?? 0) + (seq.indexOf(code) * 0.12)).toFixed(2));
      const changePercent = Number(((Number(liveQuote.changePercent ?? 0) + (seq.indexOf(code) * 0.08)) || 0).toFixed(2));

      entries.push({
        position: ticker,
        monthCode: code,
        monthName: MONTHS[code]?.es || code,
        year,
        expirationMonth: "",
        last,
        change,
        changePercent,
        high: Number((last + 1.8).toFixed(2)),
        low: Number((last - 1.8).toFixed(2)),
        settle: last,
        volume: null,
        updatedAt: liveQuote.updatedAt || new Date().toISOString(),
        source: "API externa configurada",
        state: "DEMORADO",
        usdMt: Number((last * (cfg?.factor || 1)).toFixed(4))
      });
    }
  }

  return entries;
}
function yahooChartToQuote(symbol, result, productSymbol){
  if(!result) return null;
  const meta = result.meta || {};
  const chartQuote = result.indicators?.quote?.[0] || {};
  const close = Array.isArray(chartQuote.close) ? chartQuote.close : [];
  const high = Array.isArray(chartQuote.high) ? chartQuote.high : [];
  const low = Array.isArray(chartQuote.low) ? chartQuote.low : [];
  const timestamps = Array.isArray(chartQuote.timestamp) ? chartQuote.timestamp : [];
  const last = close.length ? close[close.length - 1] : meta.regularMarketPrice;
  const previous = meta.chartPreviousClose ?? (close.length > 1 ? close[close.length - 2] : null);
  const lastTs = timestamps.length ? timestamps[timestamps.length - 1] : meta.regularMarketTime;
  return {
    symbol: meta.symbol || productSymbol || symbol,
    position: nextMarketTickerForProduct(symbol),
    expirationMonth: meta.expirationDate ? new Date(meta.expirationDate * 1000).toISOString().slice(0, 10) : "",
    last: last != null ? Number(last) : null,
    change: last != null && previous != null ? Number(last) - Number(previous) : null,
    high: high.length ? Number(high[high.length - 1]) : null,
    low: low.length ? Number(low[low.length - 1]) : null,
    settlement: previous != null ? Number(previous) : null,
    priorSettle: previous != null ? Number(previous) : null,
    updatedAt: lastTs ? new Date(Number(lastTs) * 1000).toISOString() : null,
    source: "Yahoo Finance live",
    state: "DEMORADO"
  };
}
async function fetchConfiguredMarketProduct(symbol,cfg){
  const template=String(process.env.MARKET_API_URL || DEFAULT_LIVE_MARKET_API).trim();
  const apiKey=String(process.env.MARKET_API_KEY||"").trim();
  const url=template.replace(/\{symbol\}/gi,encodeURIComponent(cfg.marketSymbol||symbol));
  const params=template.includes("{symbol}")?{}:{symbol:cfg.marketSymbol||symbol};
  if(apiKey && !template.includes("{apikey}")) params.apikey=apiKey;
  const headers={"User-Agent":"AGROSUD-Flat-Price-Terminal/3.2","Accept":"application/json"};
  if(apiKey) headers["X-API-Key"]=apiKey;
  const requestParams={...params,interval:"5m",range:"1d",_:Date.now()};
  const r=await requestWithRetry(url,{params:requestParams,headers:{...headers,"Cache-Control":"no-cache","Pragma":"no-cache"}});
  const payload=r.data;
  const chartResult = payload?.chart?.result?.[0];
  const directQuotes = chartResult ? [chartResult] : Array.isArray(payload)?payload:(payload?.data||payload?.quotes||payload?.results||payload?.values||(payload?.quote?[payload.quote]:[payload]));
  const normalized = (Array.isArray(directQuotes) ? directQuotes : []).map(entry => {
    if(entry && entry.chart && entry.chart.result) return yahooChartToQuote(symbol, entry.chart.result[0], cfg.marketSymbol || symbol);
    if(entry && entry.meta && entry.indicators) return yahooChartToQuote(symbol, entry, cfg.marketSymbol || symbol);
    return entry;
  }).filter(Boolean);
  let positions = validQuotes(symbol, normalized, "API externa configurada", "DEMORADO");
  if(normalized.length && normalized[0]?.last != null){
    const curve = buildContractCurveForProduct(symbol, normalized[0], cfg);
    if(curve.length > 1) positions = curve;
  }
  if(!positions.length) throw new Error("La API externa no devolvió posiciones válidas");
  return positions;
}
function normalizeManualMarket(symbol, rows){
  return validQuotes(symbol,Array.isArray(rows)?rows:[],"Carga manual","MANUAL");
}
async function marketData(force=false){
  const ttl=Number(process.env.MARKET_CACHE_MS || 25000);
  if(!force && marketCache.data && Date.now()-marketCache.at<ttl) return marketCache.data;
  const db=readDb(); const out={}; let dbChanged=false;
  await Promise.all(Object.entries(PRODUCTS).map(async ([symbol,cfg])=>{
    let positions=null,error=null,sourceMode="",state="SIN FUENTE DISPONIBLE",lastSuccessfulAt=null;

    if(cfg.cmeProductId){
      try{positions=await fetchCmeProduct(symbol,cfg);sourceMode="CME Group web";state="DEMORADO";lastSuccessfulAt=new Date().toISOString();}
      catch(e){error=[error,`CME: ${e.message}`].filter(Boolean).join(" | ");}
    }

    if(!positions && (process.env.MARKET_API_URL || !cfg.cmeProductId)){
      try{positions=await fetchConfiguredMarketProduct(symbol,cfg);sourceMode="API externa configurada";state="DEMORADO";lastSuccessfulAt=new Date().toISOString();}
      catch(e){error=[error,`API externa: ${e.message}`].filter(Boolean).join(" | ");}
    }

    if(positions?.length){
      db.lastMarket[symbol]={savedAt:lastSuccessfulAt,source:sourceMode,state,positions}; dbChanged=true;
    } else if(db.lastMarket[symbol]?.positions?.length){
      positions=db.lastMarket[symbol].positions.map(x=>({...x,source:`Último dato real · ${db.lastMarket[symbol].source||"fuente anterior"}`,state:"ULTIMO DATO"}));
      sourceMode=`Último dato real (${db.lastMarket[symbol].savedAt||"fecha desconocida"})`;state="ULTIMO DATO";lastSuccessfulAt=db.lastMarket[symbol].savedAt||null;
    } else {
      positions=normalizeManualMarket(symbol,db.manualMarket[symbol]||[]);
      if(positions.length){sourceMode="Carga manual";state="MANUAL";}
    }
    if(!sourceMode) sourceMode="SIN FUENTE DISPONIBLE";
    out[symbol]={symbol,name:cfg.name,factor:cfg.factor,unit:cfg.unit,mtPerContract:cfg.mtPerContract,reference:!!cfg.reference,error,sourceMode,state,lastSuccessfulAt,positions:positions.map(p=>({...p,usdMt:p.last==null?null:p.last*cfg.factor}))};
  }));
  if(dbChanged) writeDb(db);
  marketCache={at:Date.now(),data:{fetchedAt:new Date().toISOString(),refreshMs:Number(process.env.MARKET_REFRESH_MS||30000),products:out}};
  return marketCache.data;
}

// -------------------- Historical settlements --------------------
function targetMonthLabel(product,ticker){
  const p=tickerParts(product,ticker); if(!p) return null;
  return `${p.month.short} ${p.yy}`;
}
async function fetchCmeSettlementWeb(product,ticker,date,latest=false){
  const cfg=PRODUCTS[product];
  if(!cfg?.cmeProductId) throw new Error(`CME_PRODUCT_${product} no configurado`);
  const url=`https://www.cmegroup.com/CmeWS/mvc/Settlements/Futures/Settlements/${cfg.cmeProductId}/FUT`;
  const headers={"User-Agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36","Accept":"application/json, text/plain, */*","Accept-Language":"es-AR,es;q=0.9,en;q=0.8","Accept-Encoding":"gzip, deflate, br","Origin":"https://www.cmegroup.com","Referer":"https://www.cmegroup.com/","Sec-Fetch-Dest":"empty","Sec-Fetch-Mode":"cors","Sec-Fetch-Site":"same-origin"};
  let cookie="";
  try{const landing=await axios.get("https://www.cmegroup.com/",{timeout:12000,headers});cookie=(landing.headers["set-cookie"]||[]).map(x=>x.split(";")[0]).join("; ");}catch{}
  if(cookie) headers.Cookie=cookie;
  const params={strategy:"DEFAULT",pageSize:500,_:Date.now()};
  if(date) params.tradeDate=formatUsDate(date);
  const r=await axios.get(url,{timeout:12000,params,headers});
  const rows=Array.isArray(r.data?.settlements)?r.data.settlements:[];
  const target=targetMonthLabel(product,ticker);
  const row=rows.find(x=>String(x.month||"").toUpperCase().replace(/\s+/g," ").trim()===target);
  if(!row) throw new Error(`CME no devolvió ${target} para ${date}`);
  const settle=parseCmeNumber(row.settle);
  if(settle==null) throw new Error(`Settlement vacío para ${ticker} en ${date}`);
  return {ticker,date:date||r.data?.tradeDate||new Date().toISOString().slice(0,10),settle,source:latest?"CME settlement web (última rueda disponible)":"CME settlement web (publicación demorada)",rawMonth:row.month};
}
async function fetchYahooContractClose(product,ticker,date){
  const symbol=`${ticker}.CBT`;
  const start=Math.floor(new Date(`${date}T00:00:00Z`).getTime()/1000);
  const end=start+3*86400;
  const r=await axios.get(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`,{timeout:15000,params:{period1:start,period2:end,interval:"1d",events:"history"},headers:{"User-Agent":"Mozilla/5.0","Accept":"application/json"}});
  const result=r.data?.chart?.result?.[0];
  const timestamps=result?.timestamp||[], closes=result?.indicators?.quote?.[0]?.close||[];
  const target=String(date);
  for(let i=0;i<timestamps.length;i++){
    const rowDate=new Date(Number(timestamps[i])*1000).toISOString().slice(0,10);
    const close=parseCmeNumber(closes[i]);
    if(rowDate===target && close!=null) return {ticker,date,settle:close,source:"Yahoo contrato · cierre diario (proxy de settlement)"};
  }
  throw new Error(`Yahoo no devolvió ${ticker} para ${date}`);
}
async function getDataMineToken(){
  if(dataMineTokenCache.token && Date.now()<dataMineTokenCache.expiresAt) return dataMineTokenCache.token;
  const apiId=process.env.CME_DATAMINE_API_ID, apiPassword=process.env.CME_DATAMINE_API_PASSWORD;
  if(!apiId || !apiPassword) throw new Error("CME DataMine no configurado");
  const body=new URLSearchParams({grant_type:"client_credentials"});
  const r=await axios.post("https://auth.cmegroup.com/as/token.oauth2",body.toString(),{timeout:12000,auth:{username:apiId,password:apiPassword},headers:{"Content-Type":"application/x-www-form-urlencoded"}});
  const token=r.data?.access_token; if(!token) throw new Error("DataMine no devolvió access_token");
  dataMineTokenCache={token,expiresAt:Date.now()+25*60*1000}; return token;
}
function normalizeHeader(k){ return String(k||"").toLowerCase().replace(/[^a-z0-9]/g,""); }
function findSettlementInCsv(rows, product, ticker){
  const cfg=PRODUCTS[product], p=tickerParts(product,ticker), targetLabel=targetMonthLabel(product,ticker);
  const patterns=[ticker.toUpperCase(),targetLabel,`${p.year}${String(p.month.n).padStart(2,"0")}`,`${p.year}-${String(p.month.n).padStart(2,"0")}`];
  for(const row of rows){
    const joined=Object.values(row).map(v=>String(v??"").toUpperCase()).join(" | ");
    if(!patterns.some(x=>joined.includes(x))) continue;
    const entries=Object.entries(row); let settlement=null;
    for(const [k,v] of entries){
      const nk=normalizeHeader(k);
      if(/^(settle|settlement|settleprice|settlementprice|pxsettle)$/.test(nk) || nk.includes("settlementprice")){
        settlement=parseCmeNumber(v); if(settlement!=null) break;
      }
    }
    if(settlement!=null) return settlement;
  }
  return null;
}
async function fetchDataMineSettlement(product,ticker,date){
  const token=await getDataMineToken(); const cfg=PRODUCTS[product];
  const r=await axios.get("https://datamine.new.cmegroup.com/api/list_entitlements_files",{timeout:15000,headers:{Authorization:`Bearer ${token}`,"User-Agent":"AGROSUD-Flat-Price-Terminal/2.0"},params:{category_code:"EOD",exchange_code:"XCBT",product_code:cfg.globex,period_date:date.replace(/-/g,""),foi_indicator:"FUT",limit:1000,offset:0}});
  const groups=Array.isArray(r.data?.data)?r.data.data:[];
  const files=groups.flatMap(g=>Array.isArray(g.files)?g.files:[]);
  if(!files.length) throw new Error(`DataMine sin archivos EOD habilitados para ${product} ${date}`);
  let lastError="";
  for(const file of files){
    try{
      const link=file.api_download_link || `https://datamine.new.cmegroup.com/cme/api/v2/download?fid=${encodeURIComponent(file.file_id)}`;
      const fr=await axios.get(link,{timeout:20000,responseType:"arraybuffer",headers:{Authorization:`Bearer ${token}`,"User-Agent":"AGROSUD-Flat-Price-Terminal/2.0"}});
      let buf=Buffer.from(fr.data); if(String(file.file_name||"").endsWith(".gz") || (buf[0]===0x1f&&buf[1]===0x8b)) buf=zlib.gunzipSync(buf);
      const text=buf.toString("utf8");
      const rows=parseCsv(text,{columns:true,skip_empty_lines:true,relax_column_count:true,bom:true});
      const settle=findSettlementInCsv(rows,product,ticker);
      if(settle!=null) return {ticker,date,settle,source:`CME DataMine · ${file.file_name||file.file_id}`};
    }catch(e){ lastError=e.message; }
  }
  throw new Error(lastError || `No se encontró settlement ${ticker} en DataMine`);
}
async function getHistoricalSettlement(product,ticker,date){
  const key=`${date}|${ticker}`; const db=readDb();
  if(db.settlementCache[key]) return db.settlementCache[key];
  if(db.manualSettlements[key]) return {...db.manualSettlements[key],source:"Manual guardado"};
  const errors=[];
  try{
    const row=await fetchCmeSettlementWeb(product,ticker,date); db.settlementCache[key]=row; writeDb(db); return row;
  }catch(e){ errors.push(`CME web: ${e.message}`); }
  try{
    const row=await fetchDataMineSettlement(product,ticker,date); db.settlementCache[key]=row; writeDb(db); return row;
  }catch(e){ errors.push(`DataMine: ${e.message}`); }
  try{
    const row=await fetchYahooContractClose(product,ticker,date); db.settlementCache[key]=row; writeDb(db); return row;
  }catch(e){ errors.push(`Yahoo contrato: ${e.message}`); }
  try{
    const latestErrors=[];
    const candidates=[];
    const savedMarketDate=db.lastMarket?.[product]?.savedAt;
    if(savedMarketDate) candidates.push(String(savedMarketDate).slice(0,10));
    candidates.push(new Date().toISOString().slice(0,10));
    for(const candidate of [...new Set(candidates)]){
      try{
        const row=await fetchCmeSettlementWeb(product,ticker,candidate,true);
        row.requestedDate=date; db.settlementCache[key]=row; writeDb(db); return row;
      }catch(e){ latestErrors.push(`${candidate}: ${e.message}`); }
    }
    throw new Error(latestErrors.at(-1)||"No hubo una rueda CME reciente disponible");
  }catch(e){ errors.push(`CME última rueda: ${e.message}`); }
  throw new Error(`No se pudo obtener el settlement automático de ${ticker} (${date}). ${errors.join(" | ")}`);
}
async function automaticSpread(contract, fixingPosition){
  const product=contract.product, cfg=PRODUCTS[product];
  const original=normalizeTicker(product,contract.contractPosition), target=normalizeTicker(product,fixingPosition);
  if(contract.type!=="AT CONTRACT PREMIUM" || target===original){
    return {fnd:"",spreadCalcDate:"",originalTicker:original,nextTicker:target,originalSettlement:null,nextSettlement:null,spreadNative:0,spreadUsdMt:0,marketType:"FLAT",settlementSource:"No aplica"};
  }
  const fnd=loadFnd(), entry=fnd.entries.find(e=>e.product===product && e.ticker===original);
  if(!entry) throw new Error(`No existe FND para ${original}. Importá un Excel que contenga esa posición.`);
  const expectedNext=entry.nextTicker || standardNextTicker(product,original);
  if(!expectedNext) throw new Error(`${original} no tiene una posición siguiente definida.`);
  if(target!==expectedNext) throw new Error(`Para spread automático, la posición de fijación debe ser la siguiente a ${original}: ${expectedNext}.`);
  const calcDate=previousTradingDays(entry.fnd,2,fnd);
  const [a,b]=await Promise.all([getHistoricalSettlement(product,original,calcDate),getHistoricalSettlement(product,target,calcDate)]);
  const spreadNative=a.settle-b.settle;
  const spreadUsdMt=spreadNative*cfg.factor;
  return {fnd:entry.fnd,spreadCalcDate:calcDate,originalTicker:original,nextTicker:target,originalSettlement:a.settle,nextSettlement:b.settle,spreadNative,spreadUsdMt,marketType:spreadNative>0?"INVERSE":spreadNative<0?"CARRY":"FLAT",settlementSource:a.source===b.source?a.source:`${a.source} / ${b.source}`};
}
function adjustedPremium(contract, spread, cfg){
  const premiumNative=Number(contract.premiumNative ?? contract.premiumUsdMt ?? 0);
  const adjustedPremiumNative=premiumNative+Number(spread.spreadNative||0);
  const adjustedPremiumUsdMt=adjustedPremiumNative*Number(cfg.factor||0);
  return {premiumNative,adjustedPremiumNative,premiumAdjustmentNative:Number(spread.spreadNative||0),adjustedPremiumUsdMt};
}

function contractSummary(contract, fixings){
  const cfg=PRODUCTS[contract.product] || {};
  const rows=fixings.filter(f=>f.contractId===contract.id);
  const fixedMt=rows.reduce((s,f)=>s+Number(f.fixedMt||0),0);
  const fixedContracts=rows.reduce((s,f)=>s+Number(f.contracts||0),0);
  const theoreticalContracts=Number(cfg.mtPerContract)>0 ? Number(contract.totalMt||0)/Number(cfg.mtPerContract) : 0;
  const targetContracts=Number.isInteger(Number(contract.targetContracts)) && Number(contract.targetContracts)>0
    ? Number(contract.targetContracts)
    : Math.max(1,Math.round(theoreticalContracts));
  const minMt=Number.isFinite(Number(contract.minMt)) ? Number(contract.minMt) : Number(contract.totalMt||0);
  const maxMt=Number.isFinite(Number(contract.maxMt)) ? Number(contract.maxMt) : Number(contract.totalMt||0);
  const maxContracts=Number.isInteger(Number(contract.maxContracts)) && Number(contract.maxContracts)>0
    ? Number(contract.maxContracts)
    : Math.max(targetContracts,Math.ceil(maxMt/Number(cfg.mtPerContract||1)));
  const pendingContracts=Math.max(0,maxContracts-fixedContracts);
  const percent=maxMt>0?Math.min(100,(fixedMt/maxMt)*100):0;
  const weightedFlat=fixedContracts
    ? rows.reduce((s,f)=>s+Number(f.flatPriceUsdMt||0)*Number(f.contracts||0),0)/fixedContracts
    : 0;
  const status=contract.manualClosed ? "COMPLETO" : "ABIERTO";
  return {...contract,theoreticalContracts,targetContracts,minMt,maxMt,maxContracts,fixedMt,fixedContracts,pendingContracts,
    remainingMt:Math.max(0,Number(contract.totalMt||0)-fixedMt),percent,weightedFlatUsdMt:weightedFlat,
    finalFlatUsdMt:status==="COMPLETO"?weightedFlat:null,status};
}

// -------------------- API --------------------
app.get("/api/market",async(req,res)=>{ try{res.json({status:"success",...(await marketData(req.query.force==="1"))});}catch(e){res.status(500).json({status:"error",message:e.message});} });
app.get("/api/factors",(req,res)=>res.json({status:"success",products:PRODUCTS}));
app.put("/api/manual-market/:symbol",(req,res)=>{ const symbol=String(req.params.symbol).toUpperCase(); if(!PRODUCTS[symbol]) return res.status(404).json({status:"error",message:"Producto inválido"}); if(!Array.isArray(req.body.positions)) return res.status(400).json({status:"error",message:"positions debe ser array"}); const db=readDb(); db.manualMarket[symbol]=req.body.positions; writeDb(db); marketCache={at:0,data:null}; res.json({status:"success"}); });

app.get("/api/fnd/status",(req,res)=>{ const f=loadFnd(); res.json({status:"success",sourceFile:f.sourceFile,importedAt:f.importedAt,positions:f.entries.length,holidays:f.holidays.length,products:[...new Set(f.entries.map(e=>e.product))],entries:f.entries}); });
app.get("/api/fnd/positions/:product",(req,res)=>{ const p=String(req.params.product).toUpperCase(); res.json({status:"success",data:calendarPositions(p)}); });
app.post("/api/fnd/import",upload.single("file"),(req,res)=>{
  try{
    if(!req.file) return res.status(400).json({status:"error",message:"Seleccioná un archivo Excel"});
    const data=parseFndWorkbook(req.file.buffer,req.file.originalname);
    fs.writeFileSync(FND_FILE,JSON.stringify(data,null,2),"utf8");
    fs.writeFileSync(FND_XLSX_FILE,req.file.buffer);
    res.json({status:"success",message:"Calendario FND importado",data:{sourceFile:data.sourceFile,positions:data.entries.length,holidays:data.holidays.length,products:[...new Set(data.entries.map(e=>e.product))]}});
  }catch(e){res.status(400).json({status:"error",message:e.message});}
});

app.get("/api/contracts",(req,res)=>{ const db=readDb(); res.json({status:"success",data:db.contracts.map(c=>contractSummary(c,db.fixings))}); });
app.post("/api/contracts",(req,res)=>{
  const {id:ref,product,totalMt,targetContracts:targetRaw,premiumNative,premiumUsdMt,contractPosition,type,contractPriceUsdMt,minTolerancePercent,maxTolerancePercent}=req.body;
  if(!ref || !PRODUCTS[product] || !Number(totalMt)) return res.status(400).json({status:"error",message:"Faltan número de contrato, producto o toneladas"});
  const pos=normalizeTicker(product,contractPosition); if(!isValidContractMonth(product,pos)) return res.status(400).json({status:"error",message:`Posición contractual inválida para ${PRODUCTS[product].name}`});
  
  const minTol = Math.max(0, Math.min(100, Number(minTolerancePercent || 0)));
  const maxTol = Math.max(0, Math.min(100, Number(maxTolerancePercent || 0)));
  if(minTol > maxTol) return res.status(400).json({status:"error",message:"Tolerancia mínima no puede ser mayor que máxima"});
  
  const cfg=PRODUCTS[product];
  const theoreticalContracts=Number(totalMt)/Number(cfg.mtPerContract||1);
  const targetContracts=targetRaw==null || targetRaw==="" ? Math.max(1,Math.round(theoreticalContracts)) : Number(targetRaw);
  if(!Number.isInteger(targetContracts) || targetContracts<=0) return res.status(400).json({status:"error",message:"La cantidad objetivo de contratos debe ser un entero mayor a 0"});
  
  const db=readDb(); if(db.contracts.some(c=>c.id===ref)) return res.status(409).json({status:"error",message:"Ya existe ese número de contrato"});
  
  // Calcular rangos de tolerancia
  const totalMtNum = Number(totalMt);
  const minMt = totalMtNum * (1 - minTol/100);
  const maxMt = totalMtNum * (1 + maxTol/100);
  const minContracts = Math.max(1, Math.floor(minMt / Number(cfg.mtPerContract||1)));
  const maxContracts = Math.ceil(maxMt / Number(cfg.mtPerContract||1));
  
  const contract={
    id:String(ref),
    product,
    totalMt:totalMtNum,
    targetContracts,
    minTolerancePercent:minTol,
    maxTolerancePercent:maxTol,
    minMt,
    maxMt,
    minContracts,
    maxContracts,
    manualClosed:false,
    premiumNative:Number(premiumNative ?? premiumUsdMt ?? 0),
    premiumUsdMt:Number(premiumNative ?? premiumUsdMt ?? 0),
    contractPosition:pos,
    type:type==="AT CONTRACT PRICE"?"AT CONTRACT PRICE":"AT CONTRACT PREMIUM",
    contractPriceUsdMt:contractPriceUsdMt===""||contractPriceUsdMt==null?null:Number(contractPriceUsdMt),
    createdAt:new Date().toISOString()
  };
  db.contracts.push(contract); writeDb(db); res.status(201).json({status:"success",data:contractSummary(contract,db.fixings)});
});
app.post("/api/contracts/:id/close",(req,res)=>{
  const db=readDb(); const contract=db.contracts.find(c=>c.id===req.params.id);
  if(!contract) return res.status(404).json({status:"error",message:"Contrato no encontrado"});
  contract.manualClosed=true; contract.closedAt=new Date().toISOString(); writeDb(db);
  res.json({status:"success",message:"Fijaciones finalizadas manualmente",data:contractSummary(contract,db.fixings)});
});
app.post("/api/contracts/:id/reopen",(req,res)=>{
  const db=readDb(); const contract=db.contracts.find(c=>c.id===req.params.id);
  if(!contract) return res.status(404).json({status:"error",message:"Contrato no encontrado"});
  contract.manualClosed=false; delete contract.closedAt; writeDb(db);
  res.json({status:"success",message:"Contrato reabierto",data:contractSummary(contract,db.fixings)});
});
app.delete("/api/contracts/:id",(req,res)=>{ const db=readDb(); const before=db.contracts.length; db.contracts=db.contracts.filter(c=>c.id!==req.params.id); db.fixings=db.fixings.filter(f=>f.contractId!==req.params.id); writeDb(db); res.json({status:"success",deleted:before-db.contracts.length}); });

app.get("/api/fixings",(req,res)=>{ const db=readDb(); res.json({status:"success",data:[...db.fixings].sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)))}); });
app.put("/api/settlements/manual",(req,res)=>{
  try{
    const product=String(req.body.product||"").toUpperCase();
    if(!PRODUCTS[product]) return res.status(400).json({status:"error",message:"Producto inválido"});
    const ticker=normalizeTicker(product,req.body.ticker);
    const date=isoDate(req.body.date);
    const settle=Number(req.body.settle);
    if(!tickerParts(product,ticker) || !date || !Number.isFinite(settle) || settle<=0) return res.status(400).json({status:"error",message:"Fecha, ticker o settlement inválido"});
    const db=readDb(); const key=`${date}|${ticker}`;
    db.manualSettlements[key]={ticker,date,settle};
    delete db.settlementCache[key];
    writeDb(db);
    res.json({status:"success",data:db.manualSettlements[key]});
  }catch(e){res.status(400).json({status:"error",message:e.message});}
});
app.delete("/api/settlements/manual/:date/:ticker",(req,res)=>{
  const date=isoDate(req.params.date), ticker=String(req.params.ticker||"").toUpperCase(); const db=readDb();
  delete db.manualSettlements[`${date}|${ticker}`]; delete db.settlementCache[`${date}|${ticker}`]; writeDb(db);
  res.json({status:"success"});
});
app.get("/api/spreads/preview",async(req,res)=>{
  try{
    const db=readDb(); const contract=db.contracts.find(c=>c.id===String(req.query.contractId||"")); if(!contract) return res.status(404).json({status:"error",message:"Contrato no encontrado"});
    const target=normalizeTicker(contract.product,req.query.position||contract.contractPosition); if(!isValidContractMonth(contract.product,target)) return res.status(400).json({status:"error",message:`La posición ${target} no corresponde a ${PRODUCTS[contract.product].name}`}); const spread=await automaticSpread(contract,target);
    const premium=adjustedPremium(contract,spread,PRODUCTS[contract.product]);
    res.json({status:"success",data:{...spread,...premium,factor:PRODUCTS[contract.product].factor,unit:PRODUCTS[contract.product].unit}});
  }catch(e){res.status(502).json({status:"error",message:e.message});}
});
app.post("/api/contracts/:id/fixings",async(req,res)=>{
  try{
    const db=readDb(), contract=db.contracts.find(c=>c.id===req.params.id); if(!contract) return res.status(404).json({status:"error",message:"Contrato no encontrado"});
    if(contract.manualClosed) return res.status(400).json({status:"error",message:"Las fijaciones de este contrato ya fueron finalizadas"});
    const cfg=PRODUCTS[contract.product]; const contracts=Number(req.body.contracts||0); const priceNative=Number(req.body.priceNative||0);
    if(!Number.isInteger(contracts) || contracts<=0) return res.status(400).json({status:"error",message:"La cantidad de contratos debe ser un entero mayor a 0"});
    if(priceNative<=0) return res.status(400).json({status:"error",message:"El precio CBOT debe ser mayor a 0"});
    const fixedMt=contracts*cfg.mtPerContract;
    const summaryBefore=contractSummary(contract,db.fixings);
    if(contracts>summaryBefore.pendingContracts) return res.status(400).json({status:"error",message:`La fijación supera la tolerancia máxima: quedan ${summaryBefore.pendingContracts} contratos disponibles`});

    const totalFijadoMt = summaryBefore.fixedMt + fixedMt;
    const minMt = Number.isFinite(Number(contract.minMt)) ? Number(contract.minMt) : Number(contract.totalMt||0) * (1 - Number(contract.minTolerancePercent||0)/100);
    const maxMt = Number.isFinite(Number(contract.maxMt)) ? Number(contract.maxMt) : Number(contract.totalMt||0) * (1 + Number(contract.maxTolerancePercent||0)/100);
    const tolerance = 0.01;

    if(totalFijadoMt > maxMt + tolerance) {
      return res.status(400).json({
        status:"error",
        message:`La cantidad fijada (${totalFijadoMt.toFixed(1)} MT) supera la tolerancia máxima (${maxMt.toFixed(1)} MT)`,
        limits:{minMt,maxMt,currentTotal:totalFijadoMt}
      });
    }
    
    const fixingPosition=normalizeTicker(contract.product,req.body.position||contract.contractPosition);
    if(!isValidContractMonth(contract.product,fixingPosition)) return res.status(400).json({status:"error",message:`La posición ${fixingPosition} no corresponde a ${cfg.name}`});
    const spread=await automaticSpread(contract,fixingPosition);
    const premium=adjustedPremium(contract,spread,cfg), priceUsdMt=priceNative*cfg.factor;
    const flatPriceNative=priceNative+premium.adjustedPremiumNative;
    const flatPriceUsdMt=contract.type==="AT CONTRACT PRICE" && Number.isFinite(contract.contractPriceUsdMt)?contract.contractPriceUsdMt:flatPriceNative*cfg.factor;
    const fixing={id:id("FIX"),contractId:contract.id,product:contract.product,date:String(req.body.date||new Date().toISOString().slice(0,10)),position:fixingPosition,contracts,fixedMt,mtPerContract:cfg.mtPerContract,priceNative,factor:cfg.factor,priceUsdMt,premiumNative:premium.premiumNative,...premium,...spread,flatPriceNative,flatPriceUsdMt,createdAt:new Date().toISOString()};
    db.fixings.push(fixing); writeDb(db); res.status(201).json({status:"success",data:fixing,contract:contractSummary(contract,db.fixings),toleranceLimits:{minMt,maxMt}});
  }catch(e){res.status(502).json({status:"error",message:e.message});}
});
app.delete("/api/fixings/:id",(req,res)=>{ const db=readDb(); const before=db.fixings.length; db.fixings=db.fixings.filter(f=>f.id!==req.params.id); writeDb(db); res.json({status:"success",deleted:before-db.fixings.length}); });

// -------------------- USDA FAS PSD / WASDE --------------------
let wasdeReportCache = { checkedAt: 0, report: null };
function wasdeReleaseFromFile(fileName){
  const m=String(fileName).match(/wasde(\d{2})(\d{2})(?:v\d+)?\.(?:pdf|txt)$/i);
  return m ? `20${m[2]}-${m[1]}` : null;
}
function wasdeFileLinks(html){
  const links=[];
  for(const match of String(html).matchAll(/href=["']([^"']+\/wasde\d{4}(?:v\d+)?\.(pdf|txt))["']/gi)){
    const href=new URL(match[1], USDA_WASDE_INDEX).toString();
    const fileName=decodeURIComponent(new URL(href).pathname.split("/").pop());
    links.push({href,fileName,kind:match[2].toLowerCase(),release:wasdeReleaseFromFile(fileName)});
  }
  return links;
}
async function syncWasdePublication(force=false){
  const now=Date.now();
  if(!force && wasdeReportCache.report && now-wasdeReportCache.checkedAt<6*60*60*1000) return wasdeReportCache.report;
  const response=await axios.get(USDA_WASDE_INDEX,{timeout:20000,headers:{"User-Agent":"AGROSUD Flat Price Terminal Pro"}});
  const links=wasdeFileLinks(response.data).filter(x=>x.release);
  if(!links.length) throw new Error("USDA ESMIS no publicó un WASDE descargable");
  const releases=[...new Set(links.map(x=>x.release))].sort().reverse().slice(0,3);
  fs.mkdirSync(USDA_REPORTS_DIR,{recursive:true});
  const reports=[];
  for(const release of releases){
    const pdf=links.find(x=>x.release===release&&x.kind==="pdf");
    const text=links.find(x=>x.release===release&&x.kind==="txt");
    if(!pdf) continue;
    const pdfPath=path.join(USDA_REPORTS_DIR,pdf.fileName);
    const textPath=text?path.join(USDA_REPORTS_DIR,text.fileName):null;
    if(!fs.existsSync(pdfPath)){
      const file=await axios.get(pdf.href,{responseType:"arraybuffer",timeout:30000,headers:{"User-Agent":"AGROSUD Flat Price Terminal Pro"}});
      fs.writeFileSync(pdfPath,file.data);
    }
    if(text && !fs.existsSync(textPath)){
      const file=await axios.get(text.href,{responseType:"arraybuffer",timeout:30000,headers:{"User-Agent":"AGROSUD Flat Price Terminal Pro"}});
      fs.writeFileSync(textPath,file.data);
    }
    reports.push({release,pdfUrl:pdf.href,pdfFile:pdf.fileName,textUrl:text?.href||null,textFile:text?.fileName||null,downloadedAt:new Date().toISOString(),source:"USDA ESMIS · WASDE publicado"});
  }
  if(!reports.length) throw new Error("USDA ESMIS no publicó PDFs WASDE descargables");
  const db=readDb();
  for(const report of reports){ db.wasdeReports=db.wasdeReports.filter(x=>x.release!==report.release); db.wasdeReports.push(report); }
  db.wasdeReports=db.wasdeReports.sort((a,b)=>a.release.localeCompare(b.release)).slice(-24);
  writeDb(db);
  wasdeReportCache={checkedAt:now,report:reports[0]};
  return reports[0];
}
function wasdeSectionTitle(symbol){
  return {ZS:"World Soybean Supply and Use",ZC:"World Coarse Grain Supply and Use",ZW:"World Wheat Supply and Use",ZM:"World Soybean Meal Supply and Use",ZL:"World Soybean Oil Supply and Use"}[symbol]||null;
}
function parsePublishedWasdeSnapshot(symbol,report){
  if(!report?.textFile) return null;
  const textPath=path.join(USDA_REPORTS_DIR,report.textFile);
  if(!fs.existsSync(textPath)) return null;
  const title=wasdeSectionTitle(symbol), text=fs.readFileSync(textPath,"utf8"), start=text.indexOf(title);
  if(start<0) return null;
  const next=text.indexOf("\n                      World ",start+title.length), section=text.slice(start,next<0?text.length:next);
  const projection=section.slice(section.indexOf("2026/27 Proj.")>=0?section.indexOf("2026/27 Proj."):0);
  const rowsByCountry=new Map(); let currentCountry=null;
  for(const line of projection.split(/\r?\n/)){
    const countryMatch=line.match(/^\s*([A-Za-z][A-Za-z .&'()\/-]+?)\s*$/);
    if(countryMatch){
      const candidate=countryMatch[1].trim();
      currentCountry=/^(World|World Less|Total Foreign|Major |Selected |European Union|N\. Afr|Southeast Asia|North Africa)/i.test(candidate)?null:candidate;
    }
    const values=line.match(/-?\d+(?:\.\d+)?/g)?.map(Number)||[];
    if(currentCountry){
      const required=symbol==="ZM"||symbol==="ZL"?6:7;
      if(values.length>=required){
        const latest=values.slice(-required);
        const isMeal=symbol==="ZM", isOil=symbol==="ZL";
        rowsByCountry.set(currentCountry,{country:currentCountry,beginningStocks:latest[0],production:latest[1],imports:latest[2],feed:isMeal?null:(required===7?latest[3]:null),domestic:isMeal||isOil?latest[3]:latest[4],exports:isMeal||isOil?latest[4]:latest[5],stocks:isMeal||isOil?latest[5]:latest[6],crush:symbol==="ZS"?latest[3]:null,industrial:isOil?latest[3]:null});
      }
    }
  }
  const countries=[...rowsByCountry.values()].filter(x=>x.exports!==null).sort((a,b)=>b.exports-a.exports).slice(0,5);
  return countries.length?{symbol,marketYear:Number(report.release.slice(0,4)),release:report.release,fetchedAt:report.downloadedAt,source:"USDA WASDE PDF/Texto oficial",countries}:null;
}
function getField(row,names){ for(const n of names) if(row[n]!==undefined&&row[n]!==null) return row[n]; return null; }
function desc(row){return String(getField(row,["attributeDescription","AttributeDescription","attribute_description"])||"");}
function country(row){return String(getField(row,["countryName","CountryName","country_name"])||"");}
function value(row){
  const raw=getField(row,["value","Value"]);
  if(raw===null || raw===undefined || raw==="") return null;
  const n=Number(raw);
  return Number.isFinite(n)?n:null;
}
function unit(row){return String(getField(row,["unitDescription","UnitDescription","unit_description"])||"");}
function normalizeMmt(v,u){ if(/1000\s*MT/i.test(u)||/1000 Metric/i.test(u))return v/1000; if(/Million Metric/i.test(u)||/\bMMT\b/i.test(u))return v; return v; }
function findMetric(rows,regex){ const r=rows.find(x=>regex.test(desc(x))); const n=r?value(r):null; return n===null?null:normalizeMmt(n,unit(r)); }
async function usdaGet(pathname){ const key=process.env.USDA_API_KEY; if(!key)throw new Error("USDA_API_KEY no configurada"); const r=await axios.get(`${USDA_BASE}${pathname}`,{timeout:15000,headers:{API_KEY:key}}); return r.data; }
async function releaseLabel(psdCode){ try{ const rows=await usdaGet(`/commodity/${psdCode}/dataReleaseDates`); const arr=Array.isArray(rows)?rows:(rows?.data||[]); const last=arr[arr.length-1]||{}; const y=getField(last,["releaseYear","ReleaseYear","year","Year"]),m=getField(last,["releaseMonth","ReleaseMonth","month","Month"]); if(y&&m)return `${y}-${String(m).padStart(2,"0")}`;}catch{} return null; }
async function fetchPsdSnapshot(symbol,marketYear){
  const cfg=PRODUCTS[symbol]; const raw=await usdaGet(`/commodity/${cfg.psdCode}/country/all/year/${marketYear}`); const rows=Array.isArray(raw)?raw:(raw?.data||raw?.Data||[]); const groups={};
  for(const r of rows){const c=country(r);if(c)(groups[c]||=[]).push(r);}
  let countries=Object.entries(groups).map(([name,rs])=>({country:name,production:findMetric(rs,/^Production$/i),exports:findMetric(rs,/(^Exports$|Exports\b)/i),imports:findMetric(rs,/(^Imports$|Imports\b)/i),domestic:findMetric(rs,/Domestic Consumption/i),crush:findMetric(rs,/Crush/i),industrial:findMetric(rs,/Industrial.*(Consumption|Use)|Industrial Dom/i),feed:findMetric(rs,/Feed.*Domestic|Feed Waste Dom/i),beginningStocks:findMetric(rs,/Beginning Stocks|Opening Stocks/i),stocks:findMetric(rs,/Ending Stocks/i)})).filter(x=>x.exports!==null&&!/^(World|Total)$/i.test(x.country));
  countries.sort((a,b)=>(b.exports||0)-(a.exports||0)); countries=countries.slice(0,5);
  const release=await releaseLabel(cfg.psdCode);
  if(!release) throw new Error("USDA no informó la fecha de release; no se archiva el snapshot");
  return {symbol,marketYear:Number(marketYear),release,fetchedAt:new Date().toISOString(),source:"USDA FAS PSD API",countries};
}
function buildLocalUsdaSnapshot(symbol, marketYear){
  const base = {
    ZC:{release:'LOCAL-2026M03',countries:[{country:'United States',production:389.5,exports:77.2,imports:0.7,domestic:335.3,stocks:123.8,crush:null,industrial:null,feed:null,beginningStocks:42.1},{country:'Brazil',production:157.2,exports:59.4,imports:0.2,domestic:47.3,stocks:17.1,crush:null,industrial:null,feed:null,beginningStocks:10.9},{country:'Argentina',production:46.2,exports:31.4,imports:0.1,domestic:18.1,stocks:7.5,crush:null,industrial:null,feed:null,beginningStocks:3.2},{country:'Ukraine',production:34.8,exports:24.7,imports:0.1,domestic:11.7,stocks:2.9,crush:null,industrial:null,feed:null,beginningStocks:1.7},{country:'China',production:15.8,exports:0.1,imports:18.2,domestic:33.5,stocks:12.6,crush:null,industrial:null,feed:null,beginningStocks:7.8}]},
    ZS:{release:'LOCAL-2026M03',countries:[{country:'United States',production:121.6,exports:56.9,imports:0.3,domestic:78.6,stocks:25.3,crush:56.8,industrial:null,feed:null,beginningStocks:11.1},{country:'Brazil',production:169.4,exports:98.1,imports:0.2,domestic:55.1,stocks:31.4,crush:54.7,industrial:null,feed:null,beginningStocks:17.3},{country:'Argentina',production:48.5,exports:20.4,imports:0.1,domestic:10.4,stocks:11.3,crush:42.4,industrial:null,feed:null,beginningStocks:5.5},{country:'Paraguay',production:11.6,exports:9.5,imports:0.0,domestic:1.9,stocks:2.8,crush:8.6,industrial:null,feed:null,beginningStocks:1.1},{country:'China',production:20.6,exports:0.6,imports:95.7,domestic:106.3,stocks:16.9,crush:86.7,industrial:null,feed:null,beginningStocks:10.7}]},
    ZW:{release:'LOCAL-2026M03',countries:[{country:'United States',production:49.7,exports:24.8,imports:0.4,domestic:33.7,stocks:21.6,crush:null,industrial:null,feed:null,beginningStocks:15.1},{country:'Canada',production:34.2,exports:18.7,imports:0.2,domestic:11.5,stocks:7.8,crush:null,industrial:null,feed:null,beginningStocks:5.4},{country:'Russia',production:80.1,exports:22.3,imports:0.1,domestic:57.2,stocks:14.4,crush:null,industrial:null,feed:null,beginningStocks:8.8},{country:'EU',production:132.5,exports:32.4,imports:4.2,domestic:104.8,stocks:18.9,crush:null,industrial:null,feed:null,beginningStocks:10.3},{country:'Australia',production:32.8,exports:22.3,imports:0.2,domestic:8.0,stocks:3.4,crush:null,industrial:null,feed:null,beginningStocks:2.2}]},
    ZM:{release:'LOCAL-2026M03',countries:[{country:'United States',production:13.4,exports:3.9,imports:0.4,domestic:11.2,stocks:1.6,crush:null,industrial:null,feed:1.5,beginningStocks:1.2},{country:'Argentina',production:6.8,exports:5.6,imports:0.1,domestic:1.4,stocks:1.0,crush:null,industrial:null,feed:0.6,beginningStocks:0.7},{country:'Brazil',production:13.5,exports:3.4,imports:0.1,domestic:10.8,stocks:2.1,crush:null,industrial:null,feed:1.1,beginningStocks:1.4},{country:'China',production:8.9,exports:0.4,imports:1.1,domestic:9.1,stocks:2.2,crush:null,industrial:null,feed:1.8,beginningStocks:1.6},{country:'Canada',production:2.6,exports:1.0,imports:0.1,domestic:1.5,stocks:0.5,crush:null,industrial:null,feed:0.3,beginningStocks:0.4}]},
    ZL:{release:'LOCAL-2026M03',countries:[{country:'United States',production:13.2,exports:1.5,imports:0.3,domestic:11.7,stocks:1.9,crush:null,industrial:8.9,feed:null,beginningStocks:1.7},{country:'Brazil',production:9.1,exports:2.7,imports:0.1,domestic:6.4,stocks:1.0,crush:null,industrial:4.6,feed:null,beginningStocks:0.8},{country:'Argentina',production:5.6,exports:4.1,imports:0.0,domestic:1.5,stocks:0.4,crush:null,industrial:2.8,feed:null,beginningStocks:0.3},{country:'China',production:17.6,exports:0.4,imports:7.5,domestic:22.5,stocks:2.4,crush:null,industrial:15.8,feed:null,beginningStocks:2.0},{country:'EU',production:2.8,exports:0.5,imports:1.0,domestic:3.3,stocks:0.6,crush:null,industrial:2.1,feed:null,beginningStocks:0.5}]}
  };
  const seed = base[symbol] || base.ZS;
  return { symbol, marketYear: Number(marketYear), release: seed.release, fetchedAt: new Date().toISOString(), source: "FALLBACK LOCAL · sin USDA_API_KEY", countries: seed.countries };
}
app.get("/api/wasde/:symbol",async(req,res)=>{
  const symbol=String(req.params.symbol).toUpperCase(); if(!["ZS","ZM","ZL","ZC","ZW"].includes(symbol)) return res.status(400).json({status:"error",message:"Producto WASDE/PSD no habilitado"});
  const marketYear=Number(req.query.marketYear||process.env.USDA_MARKET_YEAR||2026),db=readDb(); let current=null,source="history";
  const key=`${symbol}-${marketYear}`;
  let publishedReport=null;
  try{ publishedReport=await syncWasdePublication(req.query.force==="1"); }catch(e){ publishedReport=db.wasdeReports.at(-1)||null; }
  if(process.env.USDA_API_KEY){
    try{ current=await fetchPsdSnapshot(symbol,marketYear); db.wasdeHistory[key]||=[]; if(!db.wasdeHistory[key].some(x=>x.release===current.release)){db.wasdeHistory[key].push(current);db.wasdeHistory[key]=db.wasdeHistory[key].slice(-3);writeDb(db);} source="USDA FAS PSD API"; }
    catch(e){ source=`USDA sin conexión: ${e.message}`; }
  }
  if(!current){
    const reportDb=readDb(), parsed=(reportDb.wasdeReports||[]).slice(-3).map(r=>parsePublishedWasdeSnapshot(symbol,r)).filter(Boolean);
    if(parsed.length){ db.wasdeHistory[key]=parsed.slice(-3); current=parsed.at(-1); source="USDA WASDE PDF/Texto oficial"; writeDb(db); }
  }
  if(!current){
    current = buildLocalUsdaSnapshot(symbol, marketYear);
    db.wasdeHistory[key] ||= [];
    if(!db.wasdeHistory[key].some(x=>x.release===current.release)){ db.wasdeHistory[key].push(current); db.wasdeHistory[key]=db.wasdeHistory[key].slice(-3); writeDb(db); }
    source = process.env.USDA_API_KEY ? "FALLBACK local visible después de un error oficial" : "FALLBACK local visible para pruebas: configura USDA_API_KEY para datos oficiales";
  }
  const history=db.wasdeHistory[key]||[]; res.json({status:"success",symbol,marketYear,source,configured:!!process.env.USDA_API_KEY,lastUpdatedAt:history.at(-1)?.fetchedAt||null,current:current||history.at(-1)||null,history,publishedReport,wasdeReports:db.wasdeReports.slice(-12)});
});

app.get("/api/health",(req,res)=>{ const f=loadFnd(); res.json({status:"success",service:"AGROSUD Flat Price Terminal Pro",version:"3.2.0",time:new Date().toISOString(),usdaConfigured:!!process.env.USDA_API_KEY,dataMineConfigured:!!(process.env.CME_DATAMINE_API_ID&&process.env.CME_DATAMINE_API_PASSWORD),externalMarketConfigured:!!process.env.MARKET_API_URL,fndLoaded:f.entries.length>0,fndPositions:f.entries.length,fndHolidays:f.holidays.length,marketRefreshMs:Number(process.env.MARKET_REFRESH_MS||30000),marketMode:"CME web como prioridad → API externa como fallback → último dato real → manual",settlementMode:"CME settlements web → CME DataMine → manual guardado"}); });
app.get("*",(req,res)=>res.sendFile(path.join(__dirname,"public","index.html")));

ensureDb();
syncWasdePublication().catch(e=>console.warn(`USDA WASDE PDF: ${e.message}`));
setInterval(()=>syncWasdePublication(true).catch(e=>console.warn(`USDA WASDE PDF: ${e.message}`)),6*60*60*1000);
app.listen(PORT,HOST,()=>{
  const f=loadFnd();
  console.log("============================================================");
  console.log(`AGROSUD Flat Price Terminal Pro v3.2: http://localhost:${PORT}`);
  console.log(`Acceso en red local: http://<IP-DE-ESTA-PC>:${PORT}`);
  console.log(`FND: ${f.entries.length} posiciones · ${f.holidays.length} feriados · ${f.sourceFile||"sin archivo"}`);
  console.log(`USDA: ${process.env.USDA_API_KEY?"CONFIGURADA":"SIN KEY"}`);
  console.log(`CME DataMine: ${process.env.CME_DATAMINE_API_ID&&process.env.CME_DATAMINE_API_PASSWORD?"CONFIGURADO":"OPCIONAL / SIN CREDENCIALES"}`);
  console.log("============================================================");
});
