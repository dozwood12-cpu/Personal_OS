import { timingSafeEqual } from 'node:crypto';
import { token, sameOrigin } from '@/lib/server';
const attempts = new Map<string, { count: number; until: number }>();
function equal(a: string, b: string) {
 const x = Buffer.from(a), y = Buffer.from(b);
 return x.length === y.length && timingSafeEqual(x, y);
}
export async function POST(req: Request) {
 const requestId = crypto.randomUUID();
 const fail = (status: number, code: string, error: string, hint: string) =>
  Response.json({ error, code, hint, requestId }, { status, headers: { 'Cache-Control': 'no-store' } });
 if (!sameOrigin(req)) return fail(403, 'LOGIN_ORIGIN_REJECTED', 'Origin permintaan login ditolak.', 'Buka aplikasi langsung dari domain deployment Vercel atau domain custom yang benar, lalu coba lagi.');
 const ip = req.headers.get('x-forwarded-for')?.split(',')[0] || 'local';
 const now = Date.now();
 if (attempts.size > 10000) for (const [k, v] of attempts) if (v.until < now) attempts.delete(k);
 const a = attempts.get(ip);
 if (a && a.until > now && a.count >= 10) return fail(429, 'LOGIN_RATE_LIMITED', 'Terlalu banyak percobaan login.', 'Tunggu 15 menit sebelum mencoba kembali.');
 let body: unknown;
 try { body = await req.json(); } catch {
  return fail(400, 'LOGIN_INVALID_REQUEST', 'Permintaan login bukan JSON yang valid.', 'Refresh halaman lalu coba lagi.');
 }
 const { username, password } = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
 if (typeof username !== 'string' || typeof password !== 'string' || username.length > 200 || password.length > 1024)
  return fail(400, 'LOGIN_INVALID_REQUEST', 'Isian login tidak valid.', 'Isi username dan password pada form login.');
 if (!equal(username, process.env.ADMIN_USERNAME || 'admin') || !equal(password, process.env.ADMIN_PASSWORD || 'admin')) {
  attempts.set(ip, { count: a && a.until > now ? a.count + 1 : 1, until: now + 900000 });
  return fail(401, 'LOGIN_INVALID_CREDENTIALS', 'Username atau password salah.', 'Cocokkan dengan ADMIN_USERNAME dan ADMIN_PASSWORD pada environment Vercel. Setelah mengubah variable, lakukan Redeploy.');
 }
 if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32)
  return fail(500, 'LOGIN_SESSION_CONFIG', 'SESSION_SECRET belum diatur atau kurang dari 32 karakter.', 'Atur SESSION_SECRET di Vercel untuk environment deployment ini (Production/Preview), lalu Redeploy.');
 try {
  const t = await token();
  attempts.delete(ip);
  return Response.json({ ok: true }, { headers: { 'Cache-Control': 'no-store', 'Set-Cookie': `os_session=${t}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${process.env.NODE_ENV === 'production' ? '; Secure' : ''}` } });
 } catch {
  console.error('LOGIN_SESSION_FAILED', requestId);
  return fail(500, 'LOGIN_SESSION_FAILED', 'Server gagal membuat session login.', 'Salin laporan ini untuk diagnosis. Request ID dapat dicocokkan dengan function logs di Vercel.');
 }
}
