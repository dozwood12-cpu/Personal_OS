"use client";
import { requestJson } from "./model";
import { mimeFor } from "./storage/shared";
export type PendingUpload = {
  id: string;
  name: string;
  size: number;
  lastModified: number;
  category_id: string;
};
export const pendingUploadKey = "orbit-vault-upload-v1";
type Ticket = {
  id: string;
  provider: "supabase" | "gdrive";
  path: string;
  uploadUrl: string;
  size: number;
  name: string;
  mime_type: string;
};
export type UploadOptions = {
  folderId?: string | null;
  signal?: AbortSignal;
  resume?: PendingUpload;
  onTicket?: (pending: PendingUpload) => void;
  onProgress?: (sent: number, total: number) => void;
};
const json = (body: unknown) =>
  requestJson("/api/files", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
function send(
  url: string,
  body: Blob | FormData | null,
  headers: Record<string, string>,
  signal?: AbortSignal,
  onProgress?: (n: number) => void,
): Promise<{ status: number; range: string | null }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const abort = () => xhr.abort();
    if (signal?.aborted) {
      reject(new DOMException("Dijeda", "AbortError"));
      return;
    }
    xhr.open("PUT", url);
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => onProgress?.(e.loaded);
    xhr.onload = () => {
      signal?.removeEventListener("abort", abort);
      resolve({ status: xhr.status, range: xhr.getResponseHeader("Range") });
    };
    xhr.onerror = () => {
      signal?.removeEventListener("abort", abort);
      reject(
        new Error(
          "Koneksi unggah terputus. Pilih Lanjutkan untuk meneruskan sesi.",
        ),
      );
    };
    xhr.onabort = () => {
      signal?.removeEventListener("abort", abort);
      reject(new DOMException("Dijeda", "AbortError"));
    };
    signal?.addEventListener("abort", abort, { once: true });
    xhr.send(body);
  });
}
const wait = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const id = setTimeout(() => {
      signal?.removeEventListener("abort", cancel);
      resolve();
    }, ms);
    const cancel = () => {
      clearTimeout(id);
      reject(new DOMException("Dijeda", "AbortError"));
    };
    signal?.addEventListener("abort", cancel, { once: true });
    if (signal?.aborted) cancel();
  });
export async function uploadVaultFile(
  file: File,
  category_id: string,
  options: UploadOptions = {},
) {
  const mime = mimeFor(file.name, file.type);
  const resume = options.resume;
  if (
    resume &&
    (resume.name !== file.name ||
      resume.size !== file.size ||
      resume.lastModified !== file.lastModified ||
      resume.category_id !== category_id)
  )
    throw new Error(
      "Pilih file asli yang sama untuk melanjutkan unggahan, atau mulai unggahan baru.",
    );
  const ticket: Ticket = resume
    ? await json({ action: "resume_upload", id: resume.id })
    : await json({
        action: "prepare_upload",
        name: file.name,
        type: mime,
        size: file.size,
        category_id,
        vault_folder_id: options.folderId || null,
      });
  const pending = {
    id: ticket.id,
    name: file.name,
    size: file.size,
    lastModified: file.lastModified,
    category_id,
  };
  options.onTicket?.(pending);
  if (ticket.provider === "supabase") {
    // Supabase signed PUT restarts the file on resume; Drive resumes from its acknowledged offset.
    const form = new FormData();
    form.append("cacheControl", "3600");
    form.append("", file);
    const r = await send(
      ticket.uploadUrl,
      form,
      { "x-upsert": "true" },
      options.signal,
      (n) => options.onProgress?.(Math.min(n, file.size), file.size),
    );
    if (r.status < 200 || r.status >= 300)
      throw new Error(
        `Unggah Supabase gagal (HTTP ${r.status}). Periksa kuota; paket Free dapat membatasi 50 MB per file. Gunakan Drive untuk file besar.`,
      );
  } else {
    const chunkSize = 8 * 1024 * 1024; // A multiple of Drive's 256 KiB chunk unit.
    async function offset() {
      const r = await send(
        ticket.uploadUrl,
        null,
        { "Content-Range": `bytes */${file.size}` },
        options.signal,
      );
      if (r.status === 200 || r.status === 201) return file.size;
      if (r.status === 308) {
        if (!r.range) return 0;
        const end = r.range.match(/(\d+)$/);
        if (!end) throw new Error("Posisi sesi unggah tidak valid.");
        return Number(end[1]) + 1;
      }
      if ([404, 410].includes(r.status))
        throw new Error("Sesi Drive kedaluwarsa. Mulai unggahan baru.");
      throw new Error(
        `Status sesi Drive tidak dapat dibaca (HTTP ${r.status}).`,
      );
    }
    let sent = await offset(),
      failures = 0;
    options.onProgress?.(sent, file.size);
    while (sent < file.size) {
      if (options.signal?.aborted)
        throw new DOMException("Dijeda", "AbortError");
      const start = sent,
        end = Math.min(start + chunkSize, file.size);
      let r;
      try {
        r = await send(
          ticket.uploadUrl,
          file.slice(start, end, mime),
          {
            "Content-Type": mime,
            "Content-Range": `bytes ${start}-${end - 1}/${file.size}`,
          },
          options.signal,
          (n) =>
            options.onProgress?.(Math.min(start + n, file.size), file.size),
        );
      } catch (e) {
        if ((e as Error).name === "AbortError") throw e;
        if (++failures > 4) throw e;
        await wait(400 * 2 ** failures, options.signal);
        sent = await offset();
        continue;
      }
      if (r.status === 200 || r.status === 201) {
        sent = file.size;
        break;
      }
      if (r.status === 308) {
        const acknowledged = r.range
          ? Number(r.range.match(/(\d+)$/)?.[1]) + 1
          : await offset();
        if (!Number.isFinite(acknowledged) || acknowledged <= start) {
          if (++failures > 4)
            throw new Error(
              "Drive belum mengakui potongan unggahan. Jeda lalu lanjutkan sesi.",
            );
          await wait(400 * 2 ** failures, options.signal);
          sent = await offset();
        } else {
          sent = acknowledged;
          options.onProgress?.(sent, file.size);
          failures = 0;
        }
        continue;
      }
      if ([429, 500, 502, 503, 504].includes(r.status) && ++failures <= 4) {
        await wait(400 * 2 ** failures, options.signal);
        sent = await offset();
        continue;
      }
      throw new Error(
        `Unggah Drive gagal (HTTP ${r.status}). Periksa izin, kuota Drive, atau lanjutkan sesi beberapa saat lagi.`,
      );
    }
  }
  options.onProgress?.(file.size, file.size);
  return json({ action: "finish_upload", id: ticket.id });
}
