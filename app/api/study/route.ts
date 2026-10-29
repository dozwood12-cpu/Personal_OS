import { authorized, db, sameOrigin } from "@/lib/server";
import { storageFailure } from "@/lib/storage/config";
import { z } from "zod";
const id = z.uuid(),
  page = z.number().int().min(1).max(100000),
  text = z.string().max(30000);
const schemas = {
  annotations: z.object({
    document_id: id,
    page,
    type: z.enum([
      "highlight",
      "underline",
      "strike",
      "sticky",
      "text",
      "pen",
      "rectangle",
      "arrow",
    ]),
    color: z.enum(["#f4f1ea", "#b4b0a7", "#68645d", "#44413b", "#d6442b"]),
    geometry: z.record(z.string(), z.unknown()),
    quote: text.default(""),
    comment: text.default(""),
    tags: z.array(z.string().max(40)).max(20).default([]),
  }),
  notes: z.object({ document_id: id, summary: text }),
  cards: z.object({
    document_id: id,
    page,
    type: z.enum(["qa", "cloze", "occlusion"]),
    front: text.min(1),
    back: text,
    cloze: text.default(""),
    occlusion: z.record(z.string(), z.unknown()).default({}),
  }),
  progress: z.object({
    document_id: id,
    last_page: page,
    zoom: z.number().min(0.25).max(3),
    pages_read: z.array(page).max(100000),
    total_pages: z.number().int().min(1).max(100000),
  }),
};
async function pdf(doc: string) {
  const r = await db()
    .from("documents")
    .select("title,mime_type")
    .eq("id", doc)
    .single();
  if (
    r.error ||
    !(r.data.mime_type === "application/pdf" || /\.pdf$/i.test(r.data.title))
  )
    throw new Error("Pilih PDF yang tersedia di Arsip Dokumen.");
}
export async function GET() {
  if (!(await authorized()))
    return new Response("Unauthorized", { status: 401 });
  try {
    const out: Record<string, unknown> = {};
    for (const t of ["annotations", "notes", "cards", "progress", "reviews"]) {
      let rows: unknown[] = [];
      for (let start = 0; ; start += 1000) {
        const r = await db()
          .from("study_" + t)
          .select("*")
          .order("id")
          .range(start, start + 999);
        if (r.error)
          throw new Error(
            "Modul Belajar belum siap. Jalankan migrasi 202610290004_folders_study.sql.",
          );
        rows.push(...r.data);
        if (r.data.length < 1000) break;
      }
      out[t] = rows;
    }
    return Response.json(out, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return storageFailure(e);
  }
}
export async function POST(req: Request) {
  if (!sameOrigin(req) || !(await authorized()))
    return new Response("Forbidden", { status: 403 });
  try {
    const raw = await req.text();
    if (raw.length > 500000) throw new Error("Catatan terlalu besar.");
    const b = JSON.parse(raw),
      c = db();
    if (b.action === "review") {
      const cardid = id.parse(b.id),
        rating = z.number().int().min(1).max(4).parse(b.rating);
      const card = await c
        .from("study_cards")
        .select("*")
        .eq("id", cardid)
        .single();
      if (card.error) throw new Error("Kartu tidak ditemukan.");
      const v = card.data;
      const interval =
        rating === 1
          ? 1 / 1440
          : rating === 2
            ? Math.max(1, v.difficulty * 1.2)
            : rating === 4
              ? Math.max(4, v.difficulty * v.stability * 1.3)
              : v.reps === 0
                ? 1
                : Math.max(3, v.difficulty * v.stability);
      const next = await c
        .from("study_cards")
        .update({
          reps: v.reps + 1,
          lapses: v.lapses + (rating === 1 ? 1 : 0),
          difficulty: interval,
          stability: Math.max(
            1.3,
            v.stability + (rating === 1 ? -0.2 : rating === 4 ? 0.15 : 0),
          ),
          last_review: new Date().toISOString(),
          due: new Date(Date.now() + interval * 86400000).toISOString(),
        })
        .eq("id", cardid)
        .eq("reps", v.reps)
        .select("id");
      if (next.error || !next.data.length)
        throw new Error("Kartu berubah, muat ulang review.");
      await c
        .from("study_reviews")
        .insert({ card_id: cardid, rating, interval });
      return Response.json({ ok: true });
    }
    const kind = z
      .enum(["annotations", "notes", "cards", "progress"])
      .parse(b.kind);
    if (b.action === "delete") {
      const r = await c
        .from("study_" + kind)
        .delete()
        .eq("id", id.parse(b.id));
      if (r.error) throw new Error("Data belajar belum terhapus.");
      return Response.json({ ok: true });
    }
    const value = schemas[kind].parse(b.data);
    await pdf(value.document_id);
    const r =
      kind === "notes" || kind === "progress"
        ? await c.from("study_" + kind).upsert(
            {
              ...value,
              ...(kind === "progress"
                ? { last_studied_at: new Date().toISOString() }
                : {}),
            },
            { onConflict: "document_id" },
          )
        : b.id
          ? await c
              .from("study_" + kind)
              .update({
                ...value,
                ...(kind === "annotations"
                  ? { updated_at: new Date().toISOString() }
                  : {}),
              })
              .eq("id", id.parse(b.id))
          : await c
              .from("study_" + kind)
              .insert(value as Record<string, unknown>);
    if (r.error)
      throw new Error("Data belajar gagal disimpan. Periksa migrasi database.");
    return Response.json({ ok: true });
  } catch (e) {
    return storageFailure(e);
  }
}
