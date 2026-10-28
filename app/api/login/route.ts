import { timingSafeEqual } from 'node:crypto';
import { token, sameOrigin, failure } from '@/lib/server';
const attempts=new Map<string,{count:number;until:number}>();
function equal(a:string,b:string){const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y);}
export async function POST(req:Request){
 if(!sameOrigin(req))return new Response('Forbidden',{status:403});
 const ip=req.headers.get('x-forwarded-for')?.split(',')[0]||'local';const now=Date.now();
 if(attempts.size>10000)for(const [k,v] of attempts)if(v.until<now)attempts.delete(k);
 const a=attempts.get(ip);if(a&&a.until>now&&a.count>=10)return Response.json({error:'Terlalu banyak percobaan. Tunggu 15 menit.'},{status:429});
 try{const {username,password}=await req.json();if(typeof username!=='string'||typeof password!=='string')throw new Error('Isian tidak valid');
 if(!equal(username,process.env.ADMIN_USERNAME||'admin')||!equal(password,process.env.ADMIN_PASSWORD||'admin')){attempts.set(ip,{count:a&&a.until>now?a.count+1:1,until:now+900000});return Response.json({error:'Username atau password salah'},{status:401});}
 const t=await token();attempts.delete(ip);return new Response(JSON.stringify({ok:true}),{headers:{'Content-Type':'application/json','Set-Cookie':`os_session=${t}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${process.env.NODE_ENV==='production'?'; Secure':''}`}});
 }catch(e){return failure(e);}
}
