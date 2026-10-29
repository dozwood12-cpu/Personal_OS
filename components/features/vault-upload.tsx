"use client";
import { useEffect, useRef, useState } from "react";
import { Dialog } from "./forms";
import { FileDrop } from "@/components/ui/fields";
import { requestJson, type Dataset } from "@/lib/model";
import { defaultVaultConfig } from "@/lib/storage/shared";
import {
  pendingUploadKey,
  uploadVaultFile,
  type PendingUpload,
} from "@/lib/vault-upload";
export default function VaultUpload({
  data,
  refresh,
  close,
}: {
  data: Dataset;
  refresh: () => Promise<void>;
  close: () => void;
}) {
  const [file, setFile] = useState<File | null>(null),
    [category, setCategory] = useState(""),
    [pending, setPending] = useState<PendingUpload | null>(null),
    [busy, setBusy] = useState(false),
    [progress, setProgress] = useState(0),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [limit, setLimit] = useState(defaultVaultConfig.max_upload_mb);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    try {
      const p = localStorage.getItem(pendingUploadKey);
      if (p) {
        const value = JSON.parse(p);
        if (value?.id && value?.name && Number.isFinite(value.size)) {
          setPending(value);
          setCategory(value.category_id);
        }
      }
    } catch {}
    void requestJson("/api/storage")
      .then((s) => setLimit(s.config.max_upload_mb))
      .catch(() => {});
    return () => controller.current?.abort();
  }, []);
  async function save() {
    if (!file) {
      setError("Pilih file yang akan diunggah.");
      return;
    }
    if (!category) {
      setError("Pilih kategori dokumen.");
      return;
    }
    if (!file.size || file.size > limit * 1024 * 1024) {
      setError(`File tidak boleh kosong dan maksimal ${limit} MB.`);
      return;
    }
    setBusy(true);
    setError("");
    setMessage("Mengunggah…");
    controller.current = new AbortController();
    try {
      await uploadVaultFile(file, category, {
        signal: controller.current.signal,
        resume: pending || undefined,
        onTicket: (p) => {
          setPending(p);
          try {
            localStorage.setItem(pendingUploadKey, JSON.stringify(p));
          } catch {}
        },
        onProgress: (sent, total) =>
          setProgress(Math.floor((sent / total) * 100)),
      });
      localStorage.removeItem(pendingUploadKey);
      setPending(null);
      setMessage("Tersimpan");
      await refresh();
      close();
    } catch (e) {
      if ((e as Error).name === "AbortError")
        setMessage("Unggahan dijeda. Pilih Lanjutkan untuk meneruskan.");
      else {
        setError((e as Error).message);
        setMessage("");
      }
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      title="Upload dokumen"
      close={() => {
        controller.current?.abort();
        close();
      }}
    >
      <p className="muted">
        PDF, JPG, PNG, TXT, DOCX, XLSX · Maksimal {limit} MB
      </p>
      {pending && (
        <p className="muted">
          Sesi tersimpan: {pending.name}. Pilih file asli yang sama untuk
          melanjutkan.
        </p>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <label>
          Kategori
          <select
            aria-label="Kategori"
            value={category}
            disabled={busy || !!pending}
            required
            onChange={(e) => setCategory(e.target.value)}
          >
            <option value="">Pilih</option>
            {data.categories
              .filter((c) => c.kind === "document")
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {String(c.name)}
                </option>
              ))}
          </select>
        </label>
        <label>
          File
          <FileDrop
            aria-label="File"
            type="file"
            accept="application/pdf,image/jpeg,image/png,text/plain,.docx,.xlsx"
            disabled={busy}
            onChange={(e) => setFile(e.target.files?.[0] || null)}
          />
        </label>
        {(busy || progress > 0) && (
          <div className="vault-upload-progress">
            <progress max={100} value={progress} aria-label="Progres unggah" />
            <span>{progress}%</span>
          </div>
        )}
        {message && (
          <p role="status" className="muted">
            {message}
          </p>
        )}
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <div className="toolbar action-toolbar">
          <button className="primary" type="submit" disabled={busy}>
            {pending ? "Lanjutkan" : "Simpan"}
          </button>
          {busy && (
            <button type="button" onClick={() => controller.current?.abort()}>
              Jeda
            </button>
          )}
          {!busy && pending && (
            <button
              type="button"
              onClick={() => {
                setPending(null);
                setProgress(0);
                setMessage("");
                setError("");
                localStorage.removeItem(pendingUploadKey);
              }}
            >
              Mulai baru
            </button>
          )}
        </div>
      </form>
    </Dialog>
  );
}
