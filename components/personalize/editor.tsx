"use client";
import { useState, useRef, useEffect } from "react";
import { uploadFile } from "@/lib/uploads";
import {
  animationOptions,
  blankTheme,
  slotInfo,
  slots,
  type Slot,
  type ThemeConfig,
  type Visual,
} from "@/lib/personalization";
import { configFromRows, usePersonalization } from "./provider";
import { Artwork } from "./artwork";
export default function PersonalizeEditor() {
  const { catalog, reload } = usePersonalization();
  const [id, setId] = useState(""),
    [name, setName] = useState("Tema baru"),
    [slot, setSlot] = useState<Slot>("login"),
    [draft, setDraft] = useState<ThemeConfig>(blankTheme),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [uploads, setUploads] = useState<string[]>([]),
    [notice, setNotice] = useState("");
  const pending = useRef<string[]>([]);
  useEffect(() => {
    pending.current = uploads;
  }, [uploads]);
  useEffect(
    () => () => {
      if (pending.current.length)
        void fetch("/api/personalize", {
          method: "POST",
          keepalive: true,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "discard",
            paths: pending.current.slice(0, 40),
          }),
        });
    },
    [],
  );
  const c = draft[slot];
  function patch(p: Partial<Visual>) {
    setDraft((d) => ({ ...d, [slot]: { ...d[slot], ...p } }));
  }
  async function api(body: unknown) {
    const r = await fetch("/api/personalize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || "Operasi gagal");
    return d;
  }
  async function action(run: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await run();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function discard() {
    if (uploads.length) await api({ action: "discard", paths: uploads });
    setUploads([]);
  }
  return (
    <section className="personalize-editor">
      <div className="panel">
        <div className="toolbar">
          <select
            aria-label="Preset tema"
            value={id}
            onChange={(e) => {
              const value = e.target.value;
              void action(async () => {
                await discard();
                setId(value);
                const preset = catalog.presets.find((p) => p.id === value);
                setName(preset?.name || "Tema baru");
                setDraft(
                  value
                    ? configFromRows(
                        catalog.rows.filter((r) => r.preset === value),
                      )
                    : blankTheme(),
                );
              });
            }}
          >
            <option value="">Tema baru</option>
            {catalog.presets.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.is_active ? " · Aktif" : ""}
              </option>
            ))}
          </select>
          <input
            aria-label="Nama preset"
            maxLength={80}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <button
            className="primary"
            disabled={busy}
            onClick={() =>
              void action(async () => {
                const d = await api({
                  action: "save",
                  id: id || null,
                  name,
                  theme: draft,
                });
                setId(d.id);
                const paths = uploads;
                setUploads([]);
                await api({ action: "discard", paths });
                await reload();
                setNotice("Preset disimpan");
              })
            }
          >
            Simpan preset
          </button>
          <button
            disabled={busy}
            onClick={() =>
              void action(async () => {
                const d = await api({
                  action: "save",
                  id: id || null,
                  name,
                  theme: draft,
                  activate: true,
                });
                setId(d.id);
                const paths = uploads;
                setUploads([]);
                await api({ action: "discard", paths });
                await reload();
                setNotice("Tema diaktifkan");
              })
            }
          >
            Simpan & aktifkan
          </button>
          <button
            disabled={!id || busy}
            onClick={() =>
              void action(async () => {
                await api({ action: "activate", id });
                await reload();
                setNotice("Preset aktif");
              })
            }
          >
            Aktifkan tersimpan
          </button>
          <button
            disabled={!id || busy}
            onClick={() => {
              if (confirm("Hapus preset ini?"))
                void action(async () => {
                  await discard();
                  await api({ action: "delete", id });
                  setId("");
                  setDraft(blankTheme());
                  setName("Tema baru");
                  await reload();
                });
            }}
          >
            Hapus preset
          </button>
          <button
            disabled={busy}
            onClick={() =>
              void action(async () => {
                await discard();
                await api({ action: "reset" });
                setDraft(blankTheme());
                setId("");
                setName("Tema baru");
                await reload();
                setNotice("Tema default aktif");
              })
            }
          >
            Reset ke default
          </button>
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {notice && <p role="status">{notice}</p>}
      </div>
      <div className="personalize-grid">
        <div className="panel slot-list">
          {slots.map((s) => (
            <button
              key={s}
              className={s === slot ? "selected" : ""}
              onClick={() => setSlot(s)}
            >
              {slotInfo[s].name}
              <small>
                {slotInfo[s].size} · {slotInfo[s].ratio}
              </small>
            </button>
          ))}
        </div>
        <div className="panel">
          <h3>{slotInfo[slot].name}</h3>
          <p className="muted">
            {slotInfo[slot].size} · {slotInfo[slot].ratio} ·{" "}
            {slotInfo[slot].max} gambar maksimal · JPG/PNG/WebP ≤ 5 MB
          </p>
          <div
            className={`art-preview preview-${slot}`}
            style={{
              aspectRatio: slot === "sidebar" ? "3/5" : slotInfo[slot].ratio,
            }}
          >
            <Artwork config={c} login={slot === "login"} />
            {slot === "login" && (
              <div className="preview-login-card">
                Login
                <input
                  aria-label="Pratinjau username"
                  disabled
                  placeholder="Username"
                />
                <input
                  aria-label="Pratinjau password"
                  disabled
                  placeholder="Password"
                />
                <button disabled className="primary">
                  Masuk
                </button>
              </div>
            )}
          </div>
          <div className="image-strip">
            {c.images.map((image, i) => (
              <div key={image.path}>
                <img alt={`Gambar ${i + 1}`} loading="lazy" src={image.url} />
                <button
                  disabled={busy}
                  onClick={() =>
                    setDraft((d) => ({
                      ...d,
                      [slot]: {
                        ...d[slot],
                        images: d[slot].images.filter((_, n) => n !== i),
                      },
                    }))
                  }
                >
                  Hapus {i + 1}
                </button>
                <label>
                  Ganti
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    disabled={busy}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (!f) return;
                      void action(async () => {
                        const item = await uploadFile("/api/personalize", f);
                        setUploads((v) => [...v, item.path]);
                        setDraft((d) => ({
                          ...d,
                          [slot]: {
                            ...d[slot],
                            images: d[slot].images.map((a, n) =>
                              n === i ? item : a,
                            ),
                          },
                        }));
                      });
                      e.target.value = "";
                    }}
                  />
                </label>
              </div>
            ))}
          </div>
          <label>
            Tambah gambar
            <input
              type="file"
              disabled={busy || c.images.length >= slotInfo[slot].max}
              accept="image/jpeg,image/png,image/webp"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                void action(async () => {
                  const item = await uploadFile("/api/personalize", f);
                  setUploads((v) => [...v, item.path]);
                  setDraft((d) => ({
                    ...d,
                    [slot]: { ...d[slot], images: [...d[slot].images, item] },
                  }));
                });
                e.target.value = "";
              }}
            />
          </label>
          <div className="control-grid">
            {(
              [
                ["x", "Posisi horizontal", 0, 100, 1],
                ["y", "Posisi vertikal", 0, 100, 1],
                ["zoom", "Zoom", 1, 2.5, 0.05],
                ["overlay", "Overlay gelap", 0, 0.95, 0.05],
                ["blur", "Blur (px)", 0, 20, 1],
                ["opacity", "Opasitas", 0, 1, 0.05],
                ["speed", "Kecepatan / interval (detik)", 3, 30, 1],
                ["intensity", "Intensitas", 0, 1, 0.05],
              ] as const
            ).map(([key, label, min, max, step]) => (
              <label key={key}>
                {label} <output>{c[key]}</output>
                <input
                  aria-label={label}
                  type="range"
                  min={min}
                  max={max}
                  step={step}
                  value={c[key]}
                  onChange={(e) => patch({ [key]: Number(e.target.value) })}
                />
              </label>
            ))}
            <label>
              Animasi
              <select
                aria-label="Animasi"
                value={c.animation}
                onChange={(e) =>
                  patch({ animation: e.target.value as Visual["animation"] })
                }
              >
                {animationOptions
                  .filter((a) => a !== "glow" || slot === "avatar")
                  .map((a) => (
                    <option key={a} value={a}>
                      {
                        {
                          none: "Nonaktif",
                          kenburns: "Ken Burns",
                          crossfade: "Crossfade slideshow",
                          parallax: "Parallax",
                          drift: "Drift",
                          glow: "Glow pulse",
                          entrance: "Fade / blur-to-sharp",
                        }[a]
                      }
                    </option>
                  ))}
              </select>
            </label>
          </div>
          <button
            disabled={busy}
            onClick={() =>
              void action(async () => {
                await discard();
                setDraft(
                  id
                    ? configFromRows(
                        catalog.rows.filter((r) => r.preset === id),
                      )
                    : blankTheme(),
                );
                setNotice("Perubahan dibatalkan");
              })
            }
          >
            Batalkan perubahan
          </button>
        </div>
      </div>
    </section>
  );
}
