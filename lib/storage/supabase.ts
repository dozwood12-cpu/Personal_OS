import "server-only";
import { db } from "@/lib/server";
export async function prepareSupabase(path: string) {
  const r = await (await db())
    .storage.from("vault")
    .createSignedUploadUrl(path, { upsert: true });
  if (r.error)
    throw new Error(
      "Sesi unggah Supabase gagal dibuat. Periksa kuota bucket vault.",
    );
  return r.data.signedUrl;
}
export async function openSupabase(
  path: string,
  range?: string | null,
  signal?: AbortSignal,
) {
  const r = await (await db()).storage.from("vault").createSignedUrl(path, 300);
  if (r.error) throw new Error("Dokumen Supabase tidak dapat dibaca.");
  const response = await fetch(r.data.signedUrl, {
    headers: range ? { Range: range } : {},
    cache: "no-store",
    signal,
  });
  if (!response.ok && response.status !== 416)
    throw new Error(
      `Dokumen Supabase tidak tersedia (HTTP ${response.status}).`,
    );
  return response;
}
export async function statSupabase(path: string) {
  const signed = await (await db()).storage.from("vault").createSignedUrl(path, 60);
  if (signed.error) throw new Error("File Supabase tidak ditemukan.");
  const r = await fetch(signed.data.signedUrl, {
    method: "HEAD",
    cache: "no-store",
  });
  if (!r.ok) throw new Error("File unggahan tidak ditemukan di Supabase.");
  const size = Number(r.headers.get("content-length"));
  if (!Number.isSafeInteger(size) || size <= 0)
    throw new Error("Ukuran file Supabase tidak dapat diverifikasi.");
  return { size, type: r.headers.get("content-type")?.split(";")[0] || "" };
}
export async function removeSupabase(path: string) {
  const r = await (await db()).storage.from("vault").remove([path]);
  if (r.error)
    throw new Error(
      "File Supabase belum terhapus. Coba ulangi penghapusan tertunda.",
    );
}
export async function setSupabaseLimit(bytes: number) {
  const r = await (await db()).storage.updateBucket("vault", {
    public: false,
    fileSizeLimit: bytes,
  });
  if (r.error)
    throw new Error(
      "Batas bucket Supabase gagal diperbarui. Periksa batas per file paket Supabase Anda.",
    );
}
