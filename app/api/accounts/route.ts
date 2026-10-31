import { createClient } from '@supabase/supabase-js';
import { identity,masterDb,sameOrigin } from '@/lib/server';
import { hashPassword,projectUrl } from '@/lib/accounts';
import { seal } from '@/lib/storage/crypto';
import { z } from 'zod';
import { tables } from '@/lib/model';
const fields='id,username,project_url,active,created_at';
export async function GET(){const user=await identity();if(!user)return new Response(null,{status:401});if(user.role!=='admin')return Response.json({user:{username:user.username,role:user.role},accounts:[]});const r=await masterDb().from('workspace_accounts').select(fields).order('created_at');if(r.error)return Response.json({error:'Jalankan migrasi 202610310001_workspace_accounts.sql pada database admin.'},{status:400});return Response.json({user:{username:user.username,role:user.role},accounts:r.data},{headers:{'Cache-Control':'no-store'}});}
export async function POST(req:Request){if(!sameOrigin(req)||(await identity())?.role!=='admin')return new Response(null,{status:403});try{
 const b=await req.json();const c=masterDb();
 if(b.action==='create'){
 const username=z.string().trim().toLowerCase().regex(/^[a-z0-9_.-]{3,64}$/).parse(b.username);if(username===(process.env.ADMIN_USERNAME||'admin').toLowerCase())throw new Error('Username sudah digunakan');
 const password=z.string().min(10).max(128).parse(b.password);const url=projectUrl(z.string().parse(b.url));if(url===new URL(process.env.SUPABASE_URL!).origin)throw new Error('Database harus berbeda dari database admin');
 const key=z.string().min(32).max(4096).parse(b.key);const target=createClient(url,key,{auth:{persistSession:false}});
 for(const table of [...tables,'storage_connections','personalization','theme_presets','storage_oauth_states','vault_uploads','storage_migrations','storage_sync_reports']){const r=await target.from(table).select('*',{head:true,count:'exact'});if(r.error)throw new Error('Database belum siap. Jalankan seluruh migrasi ORBIT pada proyek pengguna sebelum membuat akun.');}
 const permission=await target.auth.admin.listUsers({page:1,perPage:1});if(permission.error)throw new Error('Service role key proyek pengguna tidak valid.');
 const buckets=await target.storage.listBuckets();if(buckets.error||!['vault','personalize'].every(name=>buckets.data?.some(bucket=>bucket.id===name&&!bucket.public)))throw new Error('Bucket privat vault dan personalize belum tersedia. Jalankan migrasi penyimpanan.');
 const id=crypto.randomUUID();const credentials=seal(JSON.stringify({url,key}),'orbit:account:'+id);
 const r=await c.from('workspace_accounts').insert({id,username,password_hash:hashPassword(password),credentials,project_url:url});if(r.error)throw new Error('Akun atau proyek database sudah digunakan, atau migrasi akun belum dijalankan.');
 }else{
 const id=z.uuid().parse(b.id);const old=await c.from('workspace_accounts').select('session_version').eq('id',id).single();if(old.error)throw new Error('Akun tidak ditemukan');
 const update=b.action==='password'?{password_hash:hashPassword(z.string().min(10).max(128).parse(b.password))}:b.action==='active'?{active:z.boolean().parse(b.active)}:null;if(!update)throw new Error('Aksi tidak valid');
 const r=await c.from('workspace_accounts').update({...update,session_version:old.data.session_version+1}).eq('id',id);if(r.error)throw new Error('Perubahan akun gagal');
 }
 return Response.json({ok:true});
 }catch(e){return Response.json({error:e instanceof Error?e.message:'Operasi gagal'},{status:400});}}
