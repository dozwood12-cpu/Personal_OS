import "server-only";
import { db } from "@/lib/server";
import { type VaultDocument } from "./vault";
import {
  connection,
  driveFile,
  driveRequest,
  DriveError,
  ensureFolder,
  googleFetch,
  listFolder,
  startDriveUpload,
  trashDriveFile,
  validSessionUrl,
} from "./gdrive";
import { openSupabase, removeSupabase, statSupabase } from "./supabase";
import { mimeFor } from "./shared";
export async function migrationProgress() {
  const pending = await (await db())
    .from("documents")
    .select("id", { count: "exact", head: true })
    .eq("storage_provider", "supabase")
    .eq("deletion_state", "active");
  const done = await (await db())
    .from("storage_migrations")
    .select("document_id", { count: "exact", head: true })
    .eq("status", "done");
  const cleanup = await (await db())
    .from("storage_migrations")
    .select("document_id", { count: "exact", head: true })
    .eq("status", "cleanup");
  if (pending.error || done.error || cleanup.error)
    throw new Error(
      "Progres migrasi belum dapat dibaca. Jalankan migrasi Google Drive vault.",
    );
  return {
    remaining: pending.count || 0,
    completed: done.count || 0,
    cleanup: cleanup.count || 0,
  };
}
export async function migrateOne(origin: string) {
  await connection();
  const claimed = await (await db()).rpc("claim_vault_migration");
  if (claimed.error)
    throw new Error(
      "Antrean migrasi belum tersedia. Jalankan migrasi SQL Google Drive.",
    );
  const job = claimed.data?.[0];
  if (!job) return { ...(await migrationProgress()), idle: true };
  async function update(value: Record<string, unknown>) {
    const r = await (await db())
      .from("storage_migrations")
      .update({ ...value, updated_at: new Date().toISOString() })
      .eq("document_id", job.document_id);
    if (r.error) throw new Error("Status migrasi gagal disimpan.");
    Object.assign(job, value);
  }
  try {
    const loaded = await (await db())
      .from("documents")
      .select("*")
      .eq("id", job.document_id)
      .single();
    if (loaded.error) throw new Error("Dokumen migrasi tidak ditemukan.");
    const doc = loaded.data as VaultDocument;
    if (doc.storage_provider === "supabase") {
      const source = await statSupabase(job.source_path);
      const mime = mimeFor(String(doc.title), source.type);
      if (!job.drive_file_id) {
        const folder = await ensureFolder();
        const session = await startDriveUpload(
          String(doc.title),
          mime,
          source.size,
          folder.id,
          { orbit_document_id: doc.id },
          origin,
        );
        await update({
          drive_file_id: session.id,
          folder_id: folder.id,
          session_url: session.url,
          size: source.size,
          status: "copying",
        });
      }
      let complete = false;
      try {
        const f = await driveFile(job.drive_file_id);
        complete = !f.trashed && Number(f.size) === source.size;
      } catch (e) {
        if (!(e instanceof DriveError && e.code === "NOT_FOUND")) throw e;
      }
      if (!complete) {
        const session = validSessionUrl(job.session_url);
        const check = await googleFetch(
          session,
          {
            method: "PUT",
            headers: {
              "Content-Length": "0",
              "Content-Range": `bytes */${source.size}`,
            },
          },
          false,
        );
        let offset = 0;
        if (check.status === 308) {
          const range = check.headers.get("range");
          if (range) offset = Number(range.match(/(\d+)$/)?.[1]) + 1;
        } else if (check.ok) offset = source.size;
        else if ([404, 410].includes(check.status)) {
          await update({
            drive_file_id: null,
            session_url: null,
            status: "queued",
            lease_until: null,
          });
          throw new Error(
            "Sesi migrasi kedaluwarsa. Klik lanjutkan untuk membuat sesi baru. File sumber tetap tersimpan.",
          );
        } else
          throw new Error(
            `Sesi migrasi Drive tidak dapat dibaca (HTTP ${check.status}).`,
          );
        if (offset < source.size) {
          const sourceResponse = await openSupabase(
            job.source_path,
            offset ? `bytes=${offset}-` : null,
          );
          if (offset && sourceResponse.status !== 206)
            throw new Error(
              "Storage sumber tidak mendukung melanjutkan transfer. Coba ulangi migrasi.",
            );
          const uploaded = await googleFetch(
            session,
            {
              method: "PUT",
              headers: {
                "Content-Type": mime,
                "Content-Length": String(source.size - offset),
                "Content-Range": `bytes ${offset}-${source.size - 1}/${source.size}`,
              },
              body: sourceResponse.body,
              duplex: "half",
            } as RequestInit,
            false,
          );
          if (!uploaded.ok)
            throw new Error(
              `Salinan Drive belum selesai (HTTP ${uploaded.status}). Sumber tidak dihapus; lanjutkan migrasi untuk mencoba lagi.`,
            );
        }
      }
      const verified = await driveFile(job.drive_file_id);
      if (
        verified.trashed ||
        verified.mimeType !== mime ||
        Number(verified.size) !== source.size ||
        !verified.parents?.includes(job.folder_id) ||
        verified.appProperties?.orbit_document_id !== doc.id
      )
        throw new Error(
          "Salinan Drive gagal diverifikasi. File sumber tetap dipertahankan.",
        );
      const changed = await (await db())
        .from("documents")
        .update({
          storage_provider: "gdrive",
          drive_file_id: job.drive_file_id,
          mime_type: mime,
          size: source.size,
        })
        .eq("id", doc.id)
        .eq("storage_provider", "supabase")
        .eq("deletion_state", "active")
        .select("id");
      if (changed.error || changed.data?.length !== 1)
        throw new Error(
          "Dokumen berubah saat migrasi. File sumber belum dihapus.",
        );
      await update({ status: "cleanup" });
    }
    // Retryable cleanup also handles a crash after metadata was switched to Drive.
    const current = await (await db())
      .from("documents")
      .select("storage_provider,drive_file_id")
      .eq("id", job.document_id)
      .single();
    if (
      current.error ||
      current.data.storage_provider !== "gdrive" ||
      current.data.drive_file_id !== job.drive_file_id
    )
      throw new Error("Metadata migrasi tidak sesuai. Sumber tidak dihapus.");
    const checked = await driveFile(job.drive_file_id);
    if (
      checked.trashed ||
      Number(checked.size) !== Number(job.size) ||
      checked.appProperties?.orbit_document_id !== job.document_id
    )
      throw new Error(
        "Salinan tidak lagi cocok. Sumber Supabase dipertahankan.",
      );
    await removeSupabase(job.source_path);
    await update({ status: "done", lease_until: null, last_error: null });
    return { ...(await migrationProgress()), idle: false };
  } catch (e) {
    await update({
      status: job.status === "cleanup" ? "cleanup" : "error",
      lease_until: null,
      last_error: e instanceof Error ? e.message : "Migrasi gagal",
    });
    throw e;
  }
}
type SyncReport = {
  missing: { document_id: string; name: string; file_id: string }[];
  untracked: { file_id: string; name: string; size: string }[];
};
export async function scanStorage() {
  const folder = await ensureFolder();
  const files = await listFolder(folder.id);
  const documents: VaultDocument[] = [];
  let start = 0;
  while (true) {
    const r = await (await db())
      .from("documents")
      .select("*")
      .eq("storage_provider", "gdrive")
      .range(start, start + 499);
    if (r.error) throw new Error("Metadata Drive tidak dapat dibaca.");
    documents.push(...r.data);
    if (r.data.length < 500) break;
    start += 500;
  }
  const tracked = new Set(documents.map((d) => d.drive_file_id));
  const active = await (await db())
    .from("vault_uploads")
    .select("drive_file_id")
    .gt("expires_at", new Date().toISOString());
  if (active.error) throw new Error("Sesi unggah aktif tidak dapat diperiksa.");
  const jobs = await (await db())
    .from("storage_migrations")
    .select("drive_file_id")
    .neq("status", "done");
  if (jobs.error) throw new Error("Antrean migrasi tidak dapat diperiksa.");
  for (const item of [...(active.data || []), ...(jobs.data || [])])
    if (item.drive_file_id) tracked.add(item.drive_file_id);
  const report: SyncReport = {
    missing: [],
    untracked: files
      .filter(
        (f) =>
          f.mimeType !== "application/vnd.google-apps.folder" &&
          !tracked.has(f.id),
      )
      .map((f) => ({ file_id: f.id, name: f.name, size: f.size || "0" })),
  };
  for (const doc of documents) {
    try {
      const file = await driveFile(doc.drive_file_id!);
      if (file.trashed)
        report.missing.push({
          document_id: doc.id,
          name: String(doc.title),
          file_id: doc.drive_file_id!,
        });
    } catch (e) {
      if (e instanceof DriveError && e.code === "NOT_FOUND")
        report.missing.push({
          document_id: doc.id,
          name: String(doc.title),
          file_id: doc.drive_file_id!,
        });
      else throw e;
    }
  }
  const id = crypto.randomUUID();
  const saved = await (await db())
    .from("storage_sync_reports")
    .insert({ id, folder_id: folder.id, report });
  if (saved.error) throw new Error("Laporan sinkronisasi gagal disimpan.");
  await (await db())
    .from("storage_connections")
    .update({ last_synced_at: new Date().toISOString() })
    .eq("provider", "gdrive");
  return { id, ...report };
}
export async function applySync(
  id: string,
  missingIds: string[],
  untrackedIds: string[],
) {
  const r = await (await db())
    .from("storage_sync_reports")
    .select("*")
    .eq("id", id)
    .gt("expires_at", new Date().toISOString())
    .single();
  if (r.error)
    throw new Error("Laporan sudah kedaluwarsa. Jalankan sinkronisasi ulang.");
  const report = r.data.report as SyncReport;
  let removed = 0,
    trashed = 0;
  for (const id of missingIds) {
    const entry = report.missing.find((e) => e.document_id === id);
    if (!entry)
      throw new Error("Pilihan metadata tidak tercantum dalam laporan.");
    const recovering = await (await db())
      .from("storage_migrations")
      .select("document_id")
      .eq("document_id", id)
      .neq("status", "done");
    if (recovering.error || recovering.data?.length)
      throw new Error(
        "Dokumen masih memiliki salinan migrasi yang belum selesai. Selesaikan atau pulihkan migrasi sebelum melepas metadata.",
      );
    let absent = false;
    try {
      absent = !!(await driveFile(entry.file_id)).trashed;
    } catch (e) {
      if (e instanceof DriveError && e.code === "NOT_FOUND") absent = true;
      else throw e;
    }
    if (!absent) continue;
    const d = await (await db())
      .from("documents")
      .delete()
      .eq("id", id)
      .eq("drive_file_id", entry.file_id)
      .select("id");
    if (d.error) throw new Error("Metadata yatim belum dapat dilepas.");
    removed += d.data?.length || 0;
  }
  for (const id of untrackedIds) {
    if (!report.untracked.some((e) => e.file_id === id))
      throw new Error("File tidak tercantum dalam laporan.");
    const tracked = await (await db())
      .from("documents")
      .select("id")
      .eq("drive_file_id", id)
      .maybeSingle();
    if (tracked.error)
      throw new Error("Metadata file tidak dapat diverifikasi.");
    if (tracked.data) continue;
    const active = await (await db())
      .from("vault_uploads")
      .select("id")
      .eq("drive_file_id", id)
      .gt("expires_at", new Date().toISOString());
    if (active.error || active.data.length) continue;
    const jobs = await (await db())
      .from("storage_migrations")
      .select("document_id")
      .eq("drive_file_id", id)
      .neq("status", "done");
    if (jobs.error || jobs.data?.length) continue;
    const file = await driveFile(id);
    if (
      file.trashed ||
      !file.parents?.includes(r.data.folder_id) ||
      file.mimeType === "application/vnd.google-apps.folder"
    )
      continue;
    await trashDriveFile(id);
    trashed++;
  }
  return { removed, trashed };
}
export async function testDrive(origin: string) {
  const folder = await ensureFolder(),
    body = new TextEncoder().encode("ORBIT connection test");
  const upload = await startDriveUpload(
    ".orbit-connection-test.txt",
    "text/plain",
    body.byteLength,
    folder.id,
    { orbit_test: "true" },
    origin,
  );
  try {
    const r = await googleFetch(
      upload.url,
      {
        method: "PUT",
        headers: {
          "Content-Type": "text/plain",
          "Content-Range": `bytes 0-${body.byteLength - 1}/${body.byteLength}`,
        },
        body,
      },
      false,
    );
    if (!r.ok)
      throw new Error("Uji tulis Drive gagal. Periksa izin dan kuota folder.");
    const file = await driveFile(upload.id);
    if (Number(file.size) !== body.byteLength)
      throw new Error("Ukuran file uji tidak sesuai.");
  } finally {
    // Only a small, application-created probe is permanently removed; documents use trash.
    try {
      await driveRequest(`files/${upload.id}?supportsAllDrives=true`, {
        method: "DELETE",
      });
    } catch (e) {
      if (!(e instanceof DriveError && e.code === "NOT_FOUND")) throw e;
    }
  }
  return { ok: true, message: "Unggah dan hapus file uji berhasil." };
}
