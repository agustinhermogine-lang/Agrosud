import { AsyncLocalStorage } from 'node:async_hooks';
export const context = new AsyncLocalStorage();
export function current(){ const c=context.getStore();if(!c)throw new Error('No request context');return c; }
export const runtimeProcess = { env: new Proxy({}, {get:(_,k)=>context.getStore()?.env[k]}) };
