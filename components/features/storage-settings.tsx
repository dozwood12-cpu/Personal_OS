"use client";
import { useEffect, useRef, useState } from "react";
import { requestJson } from "@/lib/model";
import type { VaultConfig } from "@/lib/storage/shared";
type Status = {
  configured: boolean;
  config: VaultConfig;
  connection: null | {
    email: string;
    folder_id: string | null;
    folder_name: string | null;
    status: string;
    connected_at: string;
    last_synced_at: string | null;
  };
  quota: null | {
    limit: string | null;
    used: string;
    remaining: string | null;
  };
  warning: string | null;
  migration: { remaining: number; completed: number; cleanup: number };
};
type Report = {
  id: string;
  missing: { document_id: string; name: string }[];
  untracked: { file_id: string; name: string; size: string }[];
};
const size = (n: string | number | null) =>
  n === null
    ? "Tidak dilaporkan Google"
    : `${(Number(n) / 1024 ** 3).toFixed(2)} GB`;
const post = (body: unknown) =>
  requestJson("/api/storage", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
export default function StorageSettings({
  refresh,
}: {
  refresh: () => Promise<void>;
}) {
  const [status, setStatus] = useState<Status | null>(null),
    [folder, setFolder] = useState(""),
    [config, setConfig] = useState<VaultConfig>({
      default_provider: "supabase",
      max_upload_mb: 100,
    }),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [migrating, setMigrating] = useState(false),
    [report, setReport] = useState<Report | null>(null),
    [selectedMissing, setSelectedMissing] = useState<string[]>([]),
    [selectedFiles, setSelectedFiles] = useState<string[]>([]);
  const stop = useRef(false),
    mounted = useRef(true);
  async function load() {
    const s = await requestJson("/api/storage");
    setStatus(s);
    setConfig(s.config);
    setFolder(s.connection?.folder_id || "");
  }
  useEffect(() => {
    mounted.current = true;
    void load().catch((e) => setError(e.message));
    const result = new URLSearchParams(location.search).get("drive");
    if (result)
      setMessage(
        (
          {
            connected: "Google Drive terhubung.",
            folder_required:
              "Drive terhubung. Pilih folder yang dapat ditulis.",
            cancelled: "Koneksi Google dibatalkan.",
            failed:
              "Koneksi belum berhasil. Periksa konfigurasi OAuth lalu hubungkan ulang.",
          } as Record<string, string>
        )[result] || "",
      );
    return () => {
      mounted.current = false;
      stop.current = true;
    };
  }, []);
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await action();
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function migrate() {
    stop.current = false;
    setMigrating(true);
    setError("");
    setMessage("Migrasi berjalan satu dokumen per batch.");
    try {
      while (!stop.current) {
        const progress = await post({ action: "migrate" });
        if (!mounted.current) break;
        setStatus((s) => (s ? { ...s, migration: progress } : s));
        await refresh();
        if (
          progress.idle ||
          (progress.remaining === 0 && progress.cleanup === 0)
        ) {
          setMessage(
            progress.remaining
              ? "Batch lain masih berjalan. Lanjutkan beberapa saat lagi."
              : "Migrasi selesai.",
          );
          break;
        }
      }
      if (stop.current && mounted.current)
        setMessage(
          "Migrasi dijeda setelah batch aktif selesai. Klik Lanjutkan migrasi untuk meneruskan.",
        );
      await load();
    } catch (e) {
      if (mounted.current) setError((e as Error).message);
    } finally {
      if (mounted.current) setMigrating(false);
    }
  }
  const connected = status?.connection?.status === "connected",
    disabled = busy || migrating;
  const toggle = (values: string[], id: string) =>
    values.includes(id) ? values.filter((v) => v !== id) : [...values, id];
  return (
    <section className="panel storage-settings">
      <div className="section-head">
        <h3>Penyimpanan Google Drive</h3>
        <span className="tag">
          {status?.connection?.status === "reconnect"
            ? "Perlu dihubungkan ulang"
            : connected
              ? "Terhubung"
              : "Belum terhubung"}
        </span>
      </div>
      <div className="storage-facts">
        <div>
          <small>Akun</small>
          <b>{status?.connection?.email || "—"}</b>
        </div>
        <div>
          <small>Folder</small>
          <b>{status?.connection?.folder_name || "ORBIT Vault (otomatis)"}</b>
        </div>
        <div>
          <small>Sisa kuota Drive</small>
          <b>{status?.quota ? size(status.quota.remaining) : "—"}</b>
        </div>
        <div>
          <small>Sinkron terakhir</small>
          <b>
            {status?.connection?.last_synced_at
              ? new Date(status.connection.last_synced_at).toLocaleString(
                  "id-ID",
                  { timeZone: "Asia/Jakarta" },
                )
              : "—"}
          </b>
        </div>
      </div>
      {status?.warning && <p className="warning">{status.warning}</p>}
      <div className="toolbar action-toolbar">
        <button
          className="primary"
          disabled={disabled}
          onClick={() =>
            void run(async () => {
              const r = await post({ action: "connect" });
              location.assign(r.url);
            })
          }
        >
          {status?.connection
            ? "Hubungkan ulang Google Drive"
            : "Hubungkan Google Drive"}
        </button>
        <button
          disabled={disabled || !status?.connection}
          onClick={() => {
            if (
              confirm(
                "Cabut izin Google Drive? File tetap disimpan, tetapi dokumen Drive tidak dapat dibuka sampai akun dihubungkan ulang.",
              )
            )
              void run(async () => {
                await post({ action: "disconnect" });
                setMessage("Koneksi diputuskan. File tetap tersimpan.");
              });
          }}
        >
          Putuskan koneksi
        </button>
        <button
          disabled={disabled || !connected}
          onClick={() =>
            void run(async () => {
              const r = await post({ action: "test" });
              setMessage(r.message);
            })
          }
        >
          Uji koneksi
        </button>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            await post({ action: "folder", folder });
            setMessage("Folder tersimpan.");
          });
        }}
      >
        <label>
          Link folder Google Drive
          <input
            aria-label="Link folder Google Drive"
            value={folder}
            disabled={disabled}
            maxLength={2000}
            placeholder="Link folder atau ID; kosong untuk ORBIT Vault"
            onChange={(e) => setFolder(e.target.value)}
          />
        </label>
        <button disabled={disabled || !connected}>Simpan folder</button>
      </form>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            await post({ action: "config", config });
            await refresh();
            setMessage("Pengaturan tersimpan.");
          });
        }}
      >
        <div className="settings-grid">
          <label>
            Penyedia unggahan baru
            <select
              aria-label="Penyedia unggahan baru"
              value={config.default_provider}
              disabled={disabled}
              onChange={(e) =>
                setConfig({
                  ...config,
                  default_provider: e.target
                    .value as VaultConfig["default_provider"],
                })
              }
            >
              <option value="supabase">Supabase</option>
              <option value="gdrive" disabled={!connected}>
                Google Drive
              </option>
            </select>
          </label>
          <label>
            Batas ukuran file (MB)
            <input
              type="number"
              aria-label="Batas ukuran file (MB)"
              min={1}
              max={1024}
              required
              disabled={disabled}
              value={config.max_upload_mb}
              onChange={(e) =>
                setConfig({ ...config, max_upload_mb: Number(e.target.value) })
              }
            />
          </label>
        </div>
        <p className="muted">
          Drive yang aktif dipakai sesuai pilihan di atas. Jika tidak terhubung,
          unggahan baru memakai Supabase. Batas Supabase Free dapat mencapai 50
          MB per file; batas aplikasi tidak mengubah batas paket penyedia.
        </p>
        <button disabled={disabled}>Simpan pengaturan storage</button>
      </form>
      <div className="storage-maintenance">
        <h3>File lama</h3>
        <p className="muted">
          {status?.migration.completed || 0} selesai ·{" "}
          {status?.migration.remaining || 0} menunggu ·{" "}
          {status?.migration.cleanup || 0} pembersihan. Sumber Supabase dihapus
          setelah salinan Drive terverifikasi.
        </p>
        <div className="toolbar action-toolbar">
          <button
            disabled={disabled || !connected}
            onClick={() => void migrate()}
          >
            {status?.migration.completed || status?.migration.cleanup
              ? "Lanjutkan migrasi"
              : "Pindahkan file lama ke Google Drive"}
          </button>
          {migrating && (
            <button
              onClick={() => {
                stop.current = true;
                setMessage("Menghentikan setelah batch aktif selesai…");
              }}
            >
              Hentikan setelah batch
            </button>
          )}
        </div>
        {migrating && (
          <p role="status" className="muted">
            Memindahkan satu dokumen. Jangan tutup tab sebelum batch selesai.
          </p>
        )}
      </div>
      <div className="storage-maintenance">
        <h3>Sinkronisasi</h3>
        <p className="muted">
          Pemindaian hanya membuat laporan. Pilih dan setujui tindakan sebelum
          metadata dilepas atau file dipindahkan ke sampah Drive.
        </p>
        <button
          disabled={disabled || !connected}
          onClick={() =>
            void run(async () => {
              setReport(await post({ action: "scan" }));
              setSelectedMissing([]);
              setSelectedFiles([]);
              setMessage(
                "Pemindaian selesai. Belum ada file atau metadata yang dihapus.",
              );
            })
          }
        >
          Sinkronkan
        </button>
      </div>
      {report && (
        <div className="storage-report">
          <h3>Laporan sinkronisasi</h3>
          <p className="muted">
            {report.missing.length} metadata tanpa file yang dapat diakses ·{" "}
            {report.untracked.length} file tak tercatat.
          </p>
          {report.missing.map((d) => (
            <label className="checkbox" key={d.document_id}>
              <input
                type="checkbox"
                checked={selectedMissing.includes(d.document_id)}
                disabled={disabled}
                onChange={() =>
                  setSelectedMissing(toggle(selectedMissing, d.document_id))
                }
              />
              Lepas metadata: {d.name}
            </label>
          ))}
          {report.untracked.map((f) => (
            <label className="checkbox" key={f.file_id}>
              <input
                type="checkbox"
                checked={selectedFiles.includes(f.file_id)}
                disabled={disabled}
                onChange={() =>
                  setSelectedFiles(toggle(selectedFiles, f.file_id))
                }
              />
              Pindahkan ke sampah Drive: {f.name}
            </label>
          ))}
          <button
            disabled={
              disabled || (!selectedMissing.length && !selectedFiles.length)
            }
            onClick={() => {
              if (
                confirm(
                  "Terapkan tindakan terpilih? Metadata yatim dilepas dan file tak tercatat terpilih dipindahkan ke sampah Drive.",
                )
              )
                void run(async () => {
                  const r = await post({
                    action: "apply_sync",
                    id: report.id,
                    missing: selectedMissing,
                    untracked: selectedFiles,
                  });
                  setMessage(
                    `${r.removed} metadata dilepas, ${r.trashed} file dipindahkan ke sampah.`,
                  );
                  setReport(null);
                  await refresh();
                });
            }}
          >
            Setujui tindakan terpilih
          </button>
        </div>
      )}
      {message && (
        <p role="status" className="muted storage-message">
          {message}
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <details className="storage-help">
        <summary>Setup Google Drive</summary>
        <p>
          Di Google Cloud Console, aktifkan Google Drive API. Atur OAuth consent
          screen, lalu buat OAuth Client bertipe Web application. Tambahkan URI
          callback persis seperti GOOGLE_REDIRECT_URI.
        </p>
        <p>
          Atur environment server Vercel berikut lalu redeploy. Jangan gunakan
          prefix NEXT_PUBLIC_ untuk secret.
        </p>
        <code>
          GOOGLE_CLIENT_ID
          <br />
          GOOGLE_CLIENT_SECRET
          <br />
          GOOGLE_REDIRECT_URI=https://domain-anda/api/storage/gdrive/callback
          <br />
          TOKEN_ENCRYPTION_KEY
        </code>
        <p>
          Kunci enkripsi harus 32 byte (64 karakter hex). Buat dengan{" "}
          <code>openssl rand -hex 32</code> dan simpan hanya di pengaturan
          environment.
        </p>
        <p>
          Untuk akun eksternal, ubah consent screen ke In production agar
          refresh token scope Drive tidak dibatasi masa Testing 7 hari. Google
          dapat meminta verifikasi untuk scope drive; status produksi tidak
          menggantikan persyaratan verifikasi Google.
        </p>
        <p>
          Jalankan migrasi <code>202610290003_google_drive_vault.sql</code> di
          Supabase. File lama tetap privat di Supabase. File Drive mengikuti
          kuota akun Google Anda dan akses akun/folder yang terhubung; bukan
          penyimpanan tanpa batas.
        </p>
      </details>
    </section>
  );
}
