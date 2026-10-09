import '../source/server.js';
import html from '../source/public/index.html';
import seed from '../source/seed.json';
import {routes} from './express.js';
import {context} from './context.js';
import {loadSession,saveSession} from './storage.js';
import {Buffer} from 'node:buffer';
import {marketResponse} from './market.js';
const cookieName='__Host-agrosud';
function json(body,status=200){return Response.json(body,{status});}
function match(route,pathname){
 if(route==='*')return {};
 const names=[];const pattern=route.split('/').map(s=>s.startsWith(':')?(names.push(s.slice(1)),'([^/]+)'):s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('/');
 const m=pathname.match(new RegExp('^'+pattern+'$'));if(!m)return null;return Object.fromEntries(names.map((k,i)=>[k,decodeURIComponent(m[i+1])]));
}
export default {async fetch(request,env){
 const url=new URL(request.url);const headers=new Headers({'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin','X-Frame-Options':'DENY'});
 let token=request.headers.get('Cookie')?.split(';').map(s=>s.trim()).find(s=>s.startsWith(cookieName+'='))?.slice(cookieName.length+1);
 if(!token||!/^[a-f0-9]{64}$/.test(token)){token=Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('hex');headers.set('Set-Cookie',`${cookieName}=${token}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=31536000`);}
 if(!url.pathname.startsWith('/api/')){
  if(url.pathname!=='/'&&url.pathname!=='/index.html')return new Response('No encontrado',{status:404,headers});
  headers.set('Content-Type','text/html; charset=utf-8');return new Response(html,{headers});
 }
 if(!['GET','HEAD'].includes(request.method)&&request.headers.get('Origin')!==url.origin)return json({status:'error',message:'Origen de solicitud inválido'},403);
 const route=routes.find(r=>r.method===request.method&&r.path!=='*'&&match(r.path,url.pathname));
 if(!route)return json({status:'error',message:'Ruta no encontrada'},404);
 try{
 if(url.pathname==='/api/market'&&request.method==='GET')return await marketResponse(url,env.DB);
 const sessionId=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token))).toString('hex');
 const {state,revision}=await loadSession(env.DB,sessionId);
 const files={...seed,...state.files};
 const c={env:{MARKET_API_URL:'https://query1.finance.yahoo.com/v8/finance/chart/{symbol}',...env},files,dirty:false,marketCache:state.marketCache||{at:0,data:null},wasdeReportCache:state.wasdeReportCache||{checkedAt:0,report:null}};
 return await context.run(c,async()=>{
  const req={query:Object.fromEntries(url.searchParams),params:match(route.path,url.pathname),body:{}};
  if(!['GET','HEAD'].includes(request.method)){
   const type=request.headers.get('content-type')||'';
   const bytes=await request.arrayBuffer();if(bytes.byteLength>7*1024*1024)return json({status:'error',message:'Archivo demasiado grande'},413);
   if(type.includes('multipart/form-data')){const form=await new Response(bytes,{headers:{'content-type':type}}).formData();const file=form.get('file');if(file&&typeof file!=='string'){if(file.size>5*1024*1024)return json({status:'error',message:'El Excel debe pesar menos de 5 MB'},413);req.file={buffer:Buffer.from(await file.arrayBuffer()),originalname:file.name};}}
   else if(bytes.byteLength){if(bytes.byteLength>2*1024*1024)return json({status:'error',message:'Solicitud demasiado grande'},413);req.body=JSON.parse(new TextDecoder().decode(bytes));}
  }
  let status=200,payload;const res={status(n){status=n;return this;},json(v){payload=v;return this;}};
  await route.handler(req,res);
  if(payload===undefined)throw new Error('Respuesta vacía');
  if(c.dirty){
   const changes={};for(const [k,v] of Object.entries(files))if(v!==seed[k]&&!k.endsWith('.pdf'))changes[k]=v;
   const saved=await saveSession(env.DB,sessionId,revision,{files:changes,marketCache:c.marketCache,wasdeReportCache:c.wasdeReportCache});
   if(!saved){headers.set('Content-Type','application/json');return new Response(JSON.stringify({status:'error',message:'Los datos cambiaron en otra pestaña. Actualizá y reintentá.'}),{status:409,headers});}
  }
  headers.set('Content-Type','application/json; charset=utf-8');return new Response(JSON.stringify(payload),{status,headers});
 });
 }catch(e){console.error('AGROSUD request failed',url.pathname,e.message);headers.set('Content-Type','application/json');return new Response(JSON.stringify({status:'error',message:e instanceof SyntaxError?'Solicitud JSON inválida':'No se pudo completar la solicitud. Reintentá en unos segundos.'}),{status:e instanceof SyntaxError?400:503,headers});}
}};
