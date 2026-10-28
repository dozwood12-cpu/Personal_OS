"use client";
import { useState } from "react";
import {
  command,
  dateToday,
  writeData,
  type Dataset,
  type Row,
} from "@/lib/model";
import { Actions, Dialog, RecordForm } from "./forms";
export default function Documents({
  data,
  refresh,
  upload,
}: {
  data: Dataset;
  refresh: () => Promise<void>;
  upload: () => void;
}) {
  const [q, setQ] = useState(""),
    [category, setCategory] = useState(""),
    [preview, setPreview] = useState<Row | null>(null),
    [edit, setEdit] = useState<Row | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const rows = data.documents.filter(
    (d) =>
      `${d.title} ${((d.tags as string[]) || []).join(" ")}`
        .toLowerCase()
        .includes(q.toLowerCase()) &&
      (!category || d.category_id === category),
  );
  async function remove(d: Row) {
    if (!confirm("Hapus dokumen ini?")) return;
    setBusy(true);
    setError("");
    try {
      await writeData("documents", "delete", undefined, d.id);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
      await refresh();
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel">
      <div className="section-head">
        <h3>Dokumen · {rows.length}</h3>
        <button className="primary" onClick={upload}>
          Upload dokumen
        </button>
      </div>
      <p className="muted">PDF, JPG, PNG, TXT, DOCX, XLSX · Maksimal 10 MB</p>
      <div className="toolbar">
        <input
          placeholder="Cari nama / tag"
          aria-label="Cari dokumen"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select
          aria-label="Kategori dokumen"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        >
          <option value="">Semua kategori</option>
          {data.categories
            .filter((c) => c.kind === "document")
            .map((c) => (
              <option key={c.id} value={c.id}>
                {String(c.name)}
              </option>
            ))}
        </select>
        {data.documents.some((d) => d.deletion_state === "pending") && (
          <button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await command("retry_deletions");
                await refresh();
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            Ulangi penghapusan tertunda
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <div className="document-grid">
        {rows.map((d) => {
          const image = /\.(png|jpe?g)$/i.test(String(d.title)),
            pdf = /\.pdf$/i.test(String(d.title));
          return (
            <article className="document" key={d.id}>
              <span className="file-icon">
                {String(d.title).split(".").at(-1)?.toUpperCase()}
              </span>
              <h3>{String(d.title)}</h3>
              <span className="tag">
                {String(
                  data.categories.find((c) => c.id === d.category_id)?.name,
                )}
              </span>
              <p>
                {new Date(String(d.created_at)).toLocaleDateString("id-ID", {
                  timeZone: "Asia/Jakarta",
                })}{" "}
                · {(Number(d.size) / 1024).toFixed(0)} KB
              </p>
              <div>
                {((d.tags as string[]) || []).map((t) => (
                  <span className="tag" key={t}>
                    {t}
                  </span>
                ))}
              </div>
              {!!d.expires_on && (
                <p
                  className={
                    String(d.expires_on) <= dateToday() ? "danger" : "muted"
                  }
                >
                  {String(d.expires_on) <= dateToday()
                    ? "Kedaluwarsa"
                    : "Berlaku hingga"}{" "}
                  {String(d.expires_on)}
                </p>
              )}
              {d.deletion_state === "pending" ? (
                <p className="warning">Penghapusan tertunda</p>
              ) : (
                <div className="toolbar">
                  <a className="download" href={"/api/files?id=" + d.id}>
                    Unduh
                  </a>
                  {(image || pdf) && (
                    <button onClick={() => setPreview(d)}>Pratinjau</button>
                  )}
                </div>
              )}
              <Actions edit={() => setEdit(d)} remove={() => void remove(d)} />
            </article>
          );
        })}
      </div>
      {!rows.length && <p className="empty">Belum ada dokumen</p>}
      {edit && (
        <RecordForm
          table="documents"
          record={edit}
          data={data}
          refresh={refresh}
          close={() => setEdit(null)}
        />
      )}
      {preview && (
        <Dialog title={String(preview.title)} close={() => setPreview(null)}>
          {/\.pdf$/i.test(String(preview.title)) ? (
            <iframe
              className="document-preview"
              title={String(preview.title)}
              src={"/api/files?id=" + preview.id + "&preview=1"}
            />
          ) : (
            <img
              className="document-preview"
              alt={String(preview.title)}
              src={"/api/files?id=" + preview.id + "&preview=1"}
            />
          )}
        </Dialog>
      )}
    </section>
  );
}
