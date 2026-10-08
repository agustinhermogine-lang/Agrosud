export async function loadSession(db,id){
 if(!db)throw new Error('Almacenamiento no disponible');
 await db.prepare('INSERT OR IGNORE INTO sessions (id,state,revision,updated_at) VALUES (?,?,0,?)').bind(id,'{}',new Date().toISOString()).run();
 const row=await db.prepare('SELECT state,revision FROM sessions WHERE id=?').bind(id).first();
 if(!row)throw new Error('No se pudo abrir la sesión');return {state:JSON.parse(row.state),revision:row.revision};
}
export async function saveSession(db,id,revision,state){
 const result=await db.prepare('UPDATE sessions SET state=?,revision=revision+1,updated_at=? WHERE id=? AND revision=?').bind(JSON.stringify(state),new Date().toISOString(),id,revision).run();
 return result.meta.changes===1;
}
