import 'server-only';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
export function hashPassword(password:string){const salt=randomBytes(16).toString('hex');return salt+':'+scryptSync(password,salt,64).toString('hex');}
export function verifyPassword(password:string,hash:string){try{const [salt,h]=hash.split(':');const actual=scryptSync(password,salt,64);const expected=Buffer.from(h,'hex');return actual.length===expected.length&&timingSafeEqual(actual,expected);}catch{return false;}}
export function projectUrl(raw:string){const u=new URL(raw);if(u.protocol!=='https:'||!/^([a-z0-9-]+)\.supabase\.co$/.test(u.hostname)||u.username||u.password||u.port||u.search||u.hash||u.pathname!=='/')throw new Error('Gunakan URL proyek https://PROJECT.supabase.co');return u.origin;}
