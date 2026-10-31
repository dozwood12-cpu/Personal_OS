import 'server-only';
import { createClient } from '@supabase/supabase-js';
import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import { cache } from 'react';
import { unseal } from './storage/crypto';
export function masterDb(){
 if(!process.env.SUPABASE_URL||!process.env.SUPABASE_SERVICE_ROLE_KEY)throw new Error('Supabase belum dikonfigurasi.');
 return createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});
}
function key(){const s=process.env.SESSION_SECRET;if(!s||s.length<32)throw new Error('SESSION_SECRET harus minimal 32 karakter.');return new TextEncoder().encode(s);}
export async function token(id?:string,version=1){return new SignJWT({role:id?'member':'admin',version}).setSubject(id||'admin').setProtectedHeader({alg:'HS256'}).setIssuedAt().setExpirationTime('8h').sign(key());}
export const identity=cache(async()=>{
 try{
 const jar=await cookies();let t=jar.get('os_session')?.value;
 // OAuth callback carries its initiating session in an authenticated encrypted cookie.
 if(!t){const oauth=jar.get('orbit_drive_oauth')?.value;if(oauth){const p=JSON.parse(unseal(JSON.parse(Buffer.from(oauth,'base64url').toString()),'orbit:gdrive:oauth:v1'));if(p.expires>Date.now())t=p.session;}}
 if(!t)return null;
 const {payload:p}=await jwtVerify(t,key(),{algorithms:['HS256']});
 if(p.role==='admin'&&(!p.sub||p.sub==='admin'))return {id:'admin',role:'admin',username:process.env.ADMIN_USERNAME||'admin',account:null};
 if(p.role!=='member'||!p.sub)return null;
 const r=await masterDb().from('workspace_accounts').select('*').eq('id',p.sub).eq('active',true).maybeSingle();
 if(r.error||!r.data||r.data.session_version!==p.version)return null;
 return {id:p.sub,role:'member',username:r.data.username,account:r.data};
 }catch{return null;}
});
export async function db(){const user=await identity();if(!user)throw new Error('Session diperlukan');if(user.role==='admin')return masterDb();const credentials=JSON.parse(unseal(user.account.credentials,'orbit:account:'+user.id));return createClient(credentials.url,credentials.key,{auth:{persistSession:false}});}
export async function authorized(){return !!(await identity());}
export function sameOrigin(req:Request){const origin=req.headers.get('origin');if(!origin)return false;try{const parsed=new URL(origin);return ['http:','https:'].includes(parsed.protocol)&&parsed.host===(req.headers.get('host')||new URL(req.url).host);}catch{return false;}}
export function failure(e:unknown){console.error(e);return Response.json({error:e instanceof Error?e.message:'Operasi gagal'},{status:400});}
