import { authorized, db, failure, sameOrigin } from '@/lib/server';
export async function GET(){if(!await authorized())return new Response('Unauthorized',{status:401});try{const client=db();const names=['categories','transactions','projects','documents'];const results=await Promise.all(names.map(n=>client.from(n).select('*')));for(const r of results)if(r.error)throw new Error(r.error.message);return Response.json(Object.fromEntries(names.map((n,i)=>[n,results[i].data])),{headers:{'Cache-Control':'no-store'}});}catch(e){return failure(e);}}
export async function POST(req:Request){if(!sameOrigin(req)||!await authorized())return new Response('Forbidden',{status:403});try{
 const {table,action,id,data}=await req.json();if(!['categories','transactions','projects','documents'].includes(table))throw new Error('Tabel tidak valid');
 const client=db();if(action==='delete'){if(typeof id!=='string')throw new Error('ID diperlukan');if(table==='documents'){const {data:doc,error}=await client.from(table).select('path').eq('id',id).single();if(error)throw error;const r=await client.storage.from('vault').remove([doc.path]);if(r.error)throw r.error;}
 const r=await client.from(table).delete().eq('id',id);if(r.error)throw r.error;return Response.json({ok:true});}
 if(!['create','update'].includes(action)||table==='documents')throw new Error('Aksi tidak valid');
 const title=String(data.title||'').trim();let clean:Record<string,unknown>;
 if(table==='categories'){if(!['income','expense','status','document'].includes(data.kind)||!String(data.name||'').trim())throw new Error('Kategori tidak valid');clean={name:String(data.name).trim().slice(0,80),kind:data.kind};}
 else{if(!title||title.length>200)throw new Error('Nama wajib diisi (maksimal 200 karakter)');
 const categoryId=table==='projects'?data.status_id:data.category_id;const r=await client.from('categories').select('kind').eq('id',categoryId).single();if(r.error)throw r.error;
 if(table==='projects'){if(r.data.kind!=='status'||!Number.isInteger(Number(data.progress))||Number(data.progress)<0||Number(data.progress)>100||!/^\d{4}-\d{2}-\d{2}$/.test(data.deadline))throw new Error('Data proyek tidak valid');clean={title,status_id:categoryId,progress:Number(data.progress),deadline:data.deadline,is_mwb:!!data.is_mwb};}
 else{if(!['income','expense'].includes(r.data.kind)||!Number.isFinite(Number(data.amount))||Number(data.amount)<=0||!/^\d{4}-\d{2}-\d{2}$/.test(data.date))throw new Error('Data transaksi tidak valid');clean={title,category_id:categoryId,amount:Number(data.amount),date:data.date};}}
 if(action==='update'&&typeof id!=='string')throw new Error('ID diperlukan');
 if(table==='categories'&&action==='update'){const old=await client.from('categories').select('kind').eq('id',id).single();if(old.error)throw old.error;if(old.data.kind!==clean.kind)throw new Error('Jenis kategori tidak dapat diubah. Buat kategori baru.');}
 const result=action==='update'?await client.from(table).update(clean).eq('id',id):await client.from(table).insert(clean);if(result.error)throw result.error;return Response.json({ok:true});
 }catch(e){return failure(e);}}
