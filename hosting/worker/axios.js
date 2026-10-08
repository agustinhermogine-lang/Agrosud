import { Buffer } from 'node:buffer';
async function request(method,url,data,options={}){
  const target=new URL(url);for(const [k,v] of Object.entries(options.params||{}))target.searchParams.set(k,String(v));
  const headers=new Headers(options.headers||{});
  if(options.auth)headers.set('Authorization','Basic '+Buffer.from(options.auth.username+':'+options.auth.password).toString('base64'));
  const response=await fetch(target,{method,headers,body:method==='GET'?undefined:data,signal:AbortSignal.timeout(options.timeout||15000)});
  const responseHeaders=Object.fromEntries(response.headers);
  responseHeaders['set-cookie']=response.headers.getSetCookie?.()||[];
  if(!response.ok){const e=new Error('Fuente respondió HTTP '+response.status);e.response={status:response.status};throw e;}
  let result;
  if(options.responseType==='arraybuffer')result=Buffer.from(await response.arrayBuffer());
  else {const text=await response.text();try{result=JSON.parse(text)}catch{result=text}}
  return {data:result,headers:responseHeaders,status:response.status};
}
export default {get:(u,o)=>request('GET',u,null,o),post:(u,d,o)=>request('POST',u,d,o)};
