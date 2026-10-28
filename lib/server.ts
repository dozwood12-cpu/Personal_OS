import 'server-only';
import { createClient } from '@supabase/supabase-js';
import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
export function db() {
 if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('Supabase belum dikonfigurasi. Ikuti README.');
 return createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});
}
function key(){const s=process.env.SESSION_SECRET;if(!s || s.length<32) throw new Error('SESSION_SECRET harus minimal 32 karakter.');return new TextEncoder().encode(s);}
export async function token(){return new SignJWT({role:'admin'}).setProtectedHeader({alg:'HS256'}).setIssuedAt().setExpirationTime('8h').sign(key());}
export async function authorized(){try {const t=(await cookies()).get('os_session')?.value;if(!t)return false;const r=await jwtVerify(t,key(),{algorithms:['HS256']});return r.payload.role==='admin';}catch{return false;}}
export function sameOrigin(req:Request){const origin=req.headers.get('origin');if(!origin)return false;try{const parsed=new URL(origin);return ['http:','https:'].includes(parsed.protocol)&&parsed.host===(req.headers.get('host')||new URL(req.url).host);}catch{return false;}}
export function failure(e:unknown){console.error(e);return Response.json({error:e instanceof Error?e.message:'Operasi gagal'},{status:400});}
