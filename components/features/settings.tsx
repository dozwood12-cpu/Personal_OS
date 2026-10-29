"use client";
import { EmptyState } from "@/components/ui/empty-state";
import { formatDate } from "@/components/ui/fields";
import { useState } from "react";
import { command, requestJson, type Dataset } from "@/lib/model";
export default function ExtraSettings({
  data,
  refresh,
}: {
  data: Dataset;
  refresh: () => Promise<void>;
}) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [from, setFrom] = useState(""),
    [to, setTo] = useState("");
  const auto =
    data.app_settings.find((s) => s.key === "auto_complete")?.value === true;
  async function run(f: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await f();
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <section className="panel">
        <h3>Otomasi proyek</h3>
        <label className="checkbox">
          <input
            type="checkbox"
            disabled={busy}
            checked={auto}
            onChange={(e) =>
              void run(async () => {
                await command("setting", {
                  key: "auto_complete",
                  value: e.target.checked,
                });
              })
            }
          />
          Status “Selesai” otomatis menyetel progres 100% pada penyimpanan
          proyek
        </label>
      </section>
      <section className="panel">
        <h3>Pindah massal & hapus kategori asal</h3>
        <div className="toolbar">
          <select
            aria-label="Kategori asal"
            value={from}
            onChange={(e) => {
              setFrom(e.target.value);
              setTo("");
            }}
          >
            <option value="">Kategori asal</option>
            {data.categories.map((c) => (
              <option key={c.id} value={c.id}>
                {String(c.name)} · {String(c.kind)}
              </option>
            ))}
          </select>
          <select
            aria-label="Kategori tujuan"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          >
            <option value="">Kategori tujuan</option>
            {data.categories
              .filter(
                (c) =>
                  c.id !== from &&
                  c.kind === data.categories.find((a) => a.id === from)?.kind,
              )
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {String(c.name)}
                </option>
              ))}
          </select>
          <button
            disabled={busy || !from || !to}
            onClick={() => {
              if (
                confirm(
                  "Pindahkan seluruh referensi dan hapus kategori asal? Anggaran bulan yang sama akan digabung.",
                )
              )
                void run(async () => {
                  await command("move_category", { from, to });
                  setFrom("");
                  setTo("");
                });
            }}
          >
            Pindah & hapus
          </button>
        </div>
      </section>
      <section className="panel">
        <h3>Ekspor seluruh workspace</h3>
        <p className="muted">
          Satu ZIP berisi data JSON, dokumen vault, dan gambar Personalize.
          Tidak menyertakan kredensial.
        </p>
        <div className="toolbar action-toolbar">
          <button
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const r = await fetch("/api/export");
                if (!r.ok) {
                  const d = await r.json();
                  throw new Error(d.error);
                }
                const u = URL.createObjectURL(await r.blob());
                const a = document.createElement("a");
                a.href = u;
                a.download = "orbit-workspace.zip";
                a.click();
                setTimeout(() => URL.revokeObjectURL(u), 1000);
              })
            }
          >
            Ekspor ZIP
          </button>
          <button
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await command("retry_deletions");
              })
            }
          >
            Ulangi hapus dokumen tertunda
          </button>
        </div>
      </section>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <section className="panel">
        <h3>Aktivitas terbaru</h3>
        <div className="activity-list">
          {!data.activity_log.length && (
            <EmptyState message="Aktivitas akan tercatat di sini." />
          )}
          {data.activity_log.map((a) => (
            <div className="category-row" key={a.id}>
              <span>
                {String(a.action)} · {String(a.entity)} ·{" "}
                {String(a.title || "")}
              </span>
              <small>
                {new Date(String(a.created_at)).toLocaleString("id-ID", {
                  timeZone: "Asia/Jakarta",
                })}
              </small>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
