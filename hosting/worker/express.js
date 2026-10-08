export const routes=[];
function express(){const app={use(){},listen(){}};for(const method of ['get','post','put','delete'])app[method]=(path,...handlers)=>{routes.push({method:method.toUpperCase(),path,handler:handlers.at(-1)});return app;};return app;}
express.json=()=>()=>{};express.static=()=>()=>{};
export default express;
