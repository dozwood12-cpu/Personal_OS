// Do not expose raw response bodies: platform HTML or upstream errors may contain sensitive data.
export async function loginReport(response: Response): Promise<string | null> {
 let payload: Record<string, unknown> | null = null;
 try { payload = await response.json(); } catch { /* handled as non-JSON below */ }
 if (response.ok && payload?.ok === true) return null;
 const messages: Record<string, string> = {
  LOGIN_ORIGIN_REJECTED: 'Origin permintaan login ditolak.',
  LOGIN_RATE_LIMITED: 'Terlalu banyak percobaan login.',
  LOGIN_INVALID_REQUEST: 'Isian atau format permintaan login tidak valid.',
  LOGIN_INVALID_CREDENTIALS: 'Username atau password salah.',
  LOGIN_SESSION_CONFIG: 'SESSION_SECRET belum diatur atau kurang dari 32 karakter.',
  LOGIN_SESSION_FAILED: 'Server gagal membuat session login.',
 };
 const hints: Record<string, string> = {
  LOGIN_ORIGIN_REJECTED: 'Buka domain deployment secara langsung, lalu coba lagi.',
  LOGIN_RATE_LIMITED: 'Tunggu 15 menit sebelum mencoba lagi.',
  LOGIN_INVALID_REQUEST: 'Refresh halaman dan isi ulang form.',
  LOGIN_INVALID_CREDENTIALS: 'Periksa ADMIN_USERNAME / ADMIN_PASSWORD di Vercel, kemudian Redeploy jika berubah.',
  LOGIN_SESSION_CONFIG: 'Atur SESSION_SECRET minimal 32 karakter di scope Production/Preview yang sesuai, lalu Redeploy.',
  LOGIN_SESSION_FAILED: 'Periksa Vercel function logs menggunakan Request ID di bawah.',
 };
 const code = typeof payload?.code === 'string' && Object.hasOwn(messages, payload.code) ? payload.code : payload ? 'LOGIN_UNEXPECTED_RESPONSE' : 'LOGIN_NON_JSON_RESPONSE';
 const id = typeof payload?.requestId === 'string' && /^[0-9a-f-]{36}$/i.test(payload.requestId) ? payload.requestId : 'tidak tersedia';
 return [
  'ORBIT — Laporan error login',
  `Waktu: ${new Date().toISOString()}`,
  'Endpoint: POST /api/login',
  `HTTP: ${response.status}`,
  `Kode: ${code}`,
  `Pesan: ${messages[code] || 'Server mengembalikan respons yang tidak dikenali (mungkin halaman error/proteksi Vercel).'}`,
  `Saran: ${hints[code] || 'Pastikan deployment berstatus Ready. Periksa Deployment Protection dan function logs Vercel.'}`,
  `Request ID: ${id}`,
 ].join('\n');
}
export const networkLoginReport = () => [
 'ORBIT — Laporan error login', `Waktu: ${new Date().toISOString()}`,
 'Endpoint: POST /api/login', 'HTTP: tidak ada respons', 'Kode: LOGIN_NETWORK_ERROR',
 'Pesan: Browser tidak berhasil menghubungi server login.',
 'Saran: Periksa koneksi internet, status deployment, dan coba refresh halaman.',
].join('\n');
