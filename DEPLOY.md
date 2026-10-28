# Deploy: GitHub → Supabase → Vercel

Kode siap diimpor sebagai project Next.js. Tidak ada perubahan source code yang diperlukan untuk memasukkan konfigurasi deployment.

## 1. Supabase

1. Buat project (atau gunakan project kosong) pada dashboard Supabase.
2. Buka **SQL Editor**, tempel seluruh isi [`supabase/schema.sql`](supabase/schema.sql), lalu **Run** satu kali. Ini membuat empat tabel, kategori awal dan bucket private `vault`.
3. Salin Project URL dan server key dari pengaturan API project untuk dimasukkan langsung ke Vercel. Gunakan service_role key atau secret key server, bukan anon/publishable key.

## 2. Vercel

1. **Add New → Project**, impor `dozwood12-cpu/Personal_OS` dari GitHub.
2. Pilih branch `main`, Root Directory `./`, Framework Next.js. File `vercel.json` sudah mengatur install dan build; Node.js 22 ditentukan dalam `package.json`.
3. Masukkan Environment Variables untuk Production:

| Nama | Nilai |
| --- | --- |
| `SUPABASE_URL` | Project URL Supabase, misalnya `https://PROJECT_REF.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Server secret key / service_role key Supabase |
| `SESSION_SECRET` | String acak minimal 32 karakter; buat lokal dengan `openssl rand -hex 32` |
| `ADMIN_USERNAME` | `admin` |
| `ADMIN_PASSWORD` | `admin` sesuai login awal yang diminta; ganti untuk data nyata |

Jangan pakai prefix `NEXT_PUBLIC_` pada secret. Jangan commit secret ke GitHub. Untuk Preview deployment, tambahkan variable di scope Preview juga, sebaiknya dengan project database uji.

4. Klik **Deploy**. Setelah berhasil buka domain HTTPS Vercel dan login.
5. Jika variable berubah, **Redeploy** agar nilai baru diterapkan.

## 3. Checklist setelah konfigurasi

- Login `admin` / `admin` (atau password yang Anda tentukan).
- Tambah pemasukan dan pengeluaran. Refresh halaman dan pastikan saldo tetap benar.
- Edit dan hapus transaksi uji.
- Buat proyek MWB, ubah progres, cek proyek muncul pada tanggal tenggat di kalender.
- Tambah/edit kategori. Kategori yang sedang dipakai tidak boleh terhapus.
- Upload PDF uji, refresh, download dan pastikan isinya sama, lalu hapus.
- Logout; buka ulang halaman dan pastikan kembali ke login.

Build dan smoke test autentikasi telah dijalankan di lingkungan pengembangan. Checklist database/storage di atas memerlukan konfigurasi Supabase Anda; belum dapat diklaim lulus sebelum dilakukan pada project nyata.

## Troubleshooting

- **Supabase belum dikonfigurasi:** cek dua variable Supabase, lalu redeploy.
- **relation does not exist / bucket not found:** jalankan SQL bootstrap pada project yang URL-nya Anda konfigurasi.
- **Invalid API key:** gunakan server key dari project yang sama dengan URL.
- **SESSION_SECRET harus minimal 32 karakter:** perbaiki variable dan redeploy.
- **Foreign key saat hapus kategori:** ubah/hapus item yang memakai kategori tersebut lebih dahulu.

Arsitektur lengkap dan batasan operasional ada di [README.md](README.md). Login dibatasi per proses; gunakan Vercel Firewall untuk rate limiting terdistribusi sebelum publikasi luas.
