import "server-only";
import { db } from "@/lib/server";
import type { Row } from "@/lib/model";
import { z } from "zod";
import {
  connection,
  driveFile,
  driveRequest,
  ensureFolder,
  startDriveUpload,
  trashDriveFile,
} from "./gdrive";
import { vaultConfig } from "./config";
import { mimeFor, safeFileName, disposition, type Provider } from "./shared";
import {
  openSupabase,
  prepareSupabase,
  removeSupabase,
  statSupabase,
} from "./supabase";
export type VaultDocument = Row & {
  path: string;
  storage_provider?: Provider;
  drive_file_id?: string;
  mime_type?: string;
  size: number;
  deletion_state: string;
};
export async function getDocument(id: string) {
  const r = await db()
    .from("documents")
    .select("*")
    .eq("id", z.uuid().parse(id))
    .single();
  if (r.error || !r.data) throw new Error("Dokumen tidak ditemukan.");
  return r.data as VaultDocument;
}
export async function openDocument(
  doc: VaultDocument,
  range?: string | null,
  signal?: AbortSignal,
) {
  if (range && !/^bytes=(?:\d+-\d*|-\d+)$/.test(range))
    throw new Error("Header Range tidak valid.");
  if (doc.storage_provider === "gdrive") {
    if (!doc.drive_file_id) throw new Error("ID dokumen Drive tidak tersedia.");
    return driveRequest(
      `files/${encodeURIComponent(doc.drive_file_id)}?alt=media&supportsAllDrives=true`,
      { headers: range ? { Range: range } : {}, signal },
    );
  }
  return openSupabase(doc.path, range, signal);
}
export async function documentResponse(doc: VaultDocument, req: Request) {
  if (doc.deletion_state && doc.deletion_state !== "active")
    throw new Error("Dokumen menunggu penghapusan.");
  const r = await openDocument(doc, req.headers.get("range"), req.signal);
  const headers = new Headers({
    "Content-Type":
      doc.mime_type ||
      r.headers.get("content-type") ||
      "application/octet-stream",
    "Content-Disposition": disposition(
      String(doc.title),
      new URL(req.url).searchParams.get("preview") === "1",
    ),
    "Cache-Control": "private, no-store",
    "Accept-Ranges": "bytes",
    "X-Content-Type-Options": "nosniff",
  });
  for (const key of [
    "content-length",
    "content-range",
    "etag",
    "last-modified",
  ]) {
    const value = r.headers.get(key);
    if (value) headers.set(key, value);
  }
  if (req.method === "HEAD") await r.body?.cancel();
  return new Response(req.method === "HEAD" ? null : r.body, {
    status: r.status,
    headers,
  });
}
export async function removeDocumentFile(doc: VaultDocument) {
  if (doc.storage_provider === "gdrive") {
    if (!doc.drive_file_id) throw new Error("ID file Drive hilang.");
    const recovery = await db()
      .from("storage_migrations")
      .select("source_path,size,status,drive_file_id")
      .eq("document_id", doc.id)
      .maybeSingle();
    if (recovery.error)
      throw new Error(
        "Status salinan migrasi belum dapat diperiksa. Coba ulangi penghapusan.",
      );
    if (recovery.data && recovery.data.status !== "done") {
      const copy = await driveFile(doc.drive_file_id);
      if (
        copy.trashed ||
        recovery.data.drive_file_id !== doc.drive_file_id ||
        Number(copy.size) !== Number(recovery.data.size)
      )
        throw new Error(
          "Salinan migrasi belum dapat diverifikasi. Pulihkan file Drive atau izinnya sebelum menghapus dokumen ini; sumber Supabase dipertahankan.",
        );
      await removeSupabase(recovery.data.source_path);
      const cleaned = await db()
        .from("storage_migrations")
        .update({ status: "done", lease_until: null })
        .eq("document_id", doc.id);
      if (cleaned.error)
        throw new Error(
          "Pembersihan sumber selesai, tetapi status migrasi belum tersimpan. Coba hapus lagi.",
        );
    }
    await trashDriveFile(doc.drive_file_id);
  } else await removeSupabase(doc.path);
}
export async function category(id: unknown) {
  const r = await db()
    .from("categories")
    .select("kind")
    .eq("id", z.uuid().parse(id))
    .single();
  if (r.error || r.data?.kind !== "document")
    throw new Error("Kategori dokumen tidak valid.");
  return String(id);
}
export async function prepareUpload(
  input: { name: unknown; type: unknown; size: unknown; category_id: unknown },
  origin: string,
) {
  const name = z.string().trim().min(1).max(200).parse(input.name),
    mime = mimeFor(name, z.string().parse(input.type));
  const config = await vaultConfig(),
    size = z
      .number()
      .int()
      .positive()
      .max(config.max_upload_mb * 1024 * 1024)
      .parse(input.size);
  const category_id = await category(input.category_id),
    id = crypto.randomUUID(),
    path = id + "/" + safeFileName(name);
  const conn = await connection(false);
  const provider =
    config.default_provider === "gdrive" && conn?.status === "connected"
      ? "gdrive"
      : "supabase";
  let uploadUrl: string,
    drive_file_id: string | null = null,
    folder_id: string | null = null;
  if (provider === "gdrive") {
    const folder = await ensureFolder(conn);
    folder_id = folder.id;
    const upload = await startDriveUpload(
      name,
      mime,
      size,
      folder.id,
      { orbit_upload_id: id },
      origin,
    );
    drive_file_id = upload.id;
    uploadUrl = upload.url;
  } else uploadUrl = await prepareSupabase(path);
  const r = await db()
    .from("vault_uploads")
    .insert({
      id,
      provider,
      name,
      mime_type: mime,
      size,
      category_id,
      path,
      drive_file_id,
      folder_id,
      session_url: provider === "gdrive" ? uploadUrl : null,
    });
  if (r.error)
    throw new Error(
      "Sesi unggah belum dapat disimpan. Jalankan migrasi Google Drive vault.",
    );
  return { id, provider, path, uploadUrl, size, name, mime_type: mime };
}
export async function uploadTicket(id: string) {
  const r = await db()
    .from("vault_uploads")
    .select("*")
    .eq("id", z.uuid().parse(id))
    .single();
  if (r.error || !r.data)
    throw new Error("Sesi unggah tidak ditemukan. Mulai unggahan baru.");
  if (new Date(r.data.expires_at).getTime() < Date.now())
    throw new Error("Sesi unggah kedaluwarsa. Mulai unggahan baru.");
  return r.data;
}
export async function resumeUpload(id: string) {
  const t = await uploadTicket(id);
  return {
    id: t.id,
    provider: t.provider,
    path: t.path,
    uploadUrl:
      t.provider === "gdrive" ? t.session_url : await prepareSupabase(t.path),
    size: Number(t.size),
    name: t.name,
    mime_type: t.mime_type,
  };
}
export async function finishUpload(id: string) {
  const t = await uploadTicket(id);
  if (t.completed_document_id) return { ok: true, id: t.completed_document_id };
  const existing = await db()
    .from("documents")
    .select("id")
    .eq("path", t.path)
    .maybeSingle();
  if (existing.error)
    throw new Error("Metadata unggahan tidak dapat diperiksa.");
  if (existing.data) return { ok: true, id: existing.data.id };
  if (!t.category_id)
    throw new Error(
      "Kategori sesi unggah sudah dihapus. Mulai unggahan baru dan pilih kategori yang tersedia.",
    );
  await category(t.category_id);
  if (t.provider === "gdrive") {
    const f = await driveFile(t.drive_file_id);
    if (
      f.trashed ||
      Number(f.size) !== Number(t.size) ||
      f.mimeType !== t.mime_type ||
      !f.parents?.includes(t.folder_id) ||
      f.appProperties?.orbit_upload_id !== t.id
    )
      throw new Error(
        "File Drive belum lengkap atau ukuran, tipe, maupun foldernya tidak sesuai. Lanjutkan unggahan lalu coba lagi.",
      );
  } else {
    const f = await statSupabase(t.path);
    if (f.size !== Number(t.size) || mimeFor(t.name, f.type) !== t.mime_type)
      throw new Error(
        "Ukuran atau tipe file Supabase tidak sesuai dengan sesi unggah.",
      );
  }
  const docId = crypto.randomUUID();
  const r = await db().from("documents").insert({
    id: docId,
    title: t.name,
    category_id: t.category_id,
    path: t.path,
    size: t.size,
    storage_provider: t.provider,
    drive_file_id: t.drive_file_id,
    mime_type: t.mime_type,
  });
  if (r.error) {
    const retry = await db()
      .from("documents")
      .select("id")
      .eq("path", t.path)
      .maybeSingle();
    if (!retry.data)
      throw new Error(
        "File berhasil diunggah, tetapi metadata belum tersimpan. Klik lanjutkan untuk mencoba finalisasi ulang.",
      );
    return { ok: true, id: retry.data.id };
  }
  await db()
    .from("vault_uploads")
    .update({ completed_document_id: docId })
    .eq("id", t.id);
  return { ok: true, id: docId };
}
