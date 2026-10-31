import { authorized, db, failure, sameOrigin } from "@/lib/server";
import { themeSchema } from "@/lib/personalization";
import sharp from "sharp";
import { z } from "zod";
export const runtime = "nodejs";
export async function GET() {
  if (!(await authorized()))
    return new Response("Unauthorized", { status: 401 });
  try {
    const c = (await db());
    const [p, r] = await Promise.all([
      c.from("theme_presets").select("*").order("created_at"),
      c.from("personalization").select("*").order("sort_order"),
    ]);
    if (p.error) throw p.error;
    if (r.error) throw r.error;
    const rows = await Promise.all(
      (r.data || []).map(async (item) => {
        const u = await c.storage
          .from("personalize")
          .createSignedUrl(item.path, 3600);
        if (u.error) throw u.error;
        return { ...item, url: u.data.signedUrl };
      }),
    );
    return Response.json(
      { presets: p.data, rows },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return failure(e);
  }
}
export async function POST(req: Request) {
  if (!sameOrigin(req) || !(await authorized()))
    return new Response("Forbidden", { status: 403 });
  try {
    const c = (await db());
    if (req.headers.get("content-type")?.includes("multipart/form-data")) {
      const f = await req.formData();
      const file = f.get("file");
      if (
        !(file instanceof File) ||
        !file.size ||
        file.size > 5 * 1024 * 1024 ||
        !["image/jpeg", "image/png", "image/webp"].includes(file.type)
      )
        throw new Error("JPG/PNG/WebP tidak kosong, maksimal 5 MB");
      const input = Buffer.from(await file.arrayBuffer());
      const meta = await sharp(input, {
        limitInputPixels: 40000000,
      }).metadata();
      if (!["jpeg", "png", "webp"].includes(meta.format || ""))
        throw new Error("Format gambar tidak didukung");
      const bytes = await sharp(input, { limitInputPixels: 40000000 })
        .rotate()
        .resize(1920, 1920, { fit: "inside", withoutEnlargement: true })
        .webp({ quality: 82 })
        .toBuffer();
      const path = crypto.randomUUID() + ".webp";
      const up = await c.storage
        .from("personalize")
        .upload(path, bytes, { contentType: "image/webp" });
      if (up.error) throw up.error;
      const u = await c.storage.from("personalize").createSignedUrl(path, 3600);
      if (u.error) throw u.error;
      return Response.json({ path, url: u.data.signedUrl });
    }
    const b = await req.json();
    if (b.action === "prepare_upload") {
      const type = z
        .enum(["image/jpeg", "image/png", "image/webp"])
        .parse(b.type);
      z.number().positive().max(5242880).parse(b.size);
      const ext = type === "image/jpeg" ? "jpg" : type.split("/")[1];
      const path = "staging/" + crypto.randomUUID() + "." + ext;
      const r = await c.storage.from("personalize").createSignedUploadUrl(path);
      if (r.error) throw r.error;
      return Response.json({ path, uploadUrl: r.data.signedUrl });
    }
    if (b.action === "finish_upload") {
      const raw = z
        .string()
        .regex(/^staging\/[a-f0-9-]+\.(jpg|png|webp)$/)
        .parse(b.path);
      try {
        const download = await c.storage.from("personalize").download(raw);
        if (download.error) throw download.error;
        if (!download.data.size || download.data.size > 5242880)
          throw new Error("Maksimal 5 MB, tidak boleh kosong");
        const input = Buffer.from(await download.data.arrayBuffer());
        const meta = await sharp(input, {
          limitInputPixels: 40000000,
        }).metadata();
        if (!["jpeg", "png", "webp"].includes(meta.format || ""))
          throw new Error("Format gambar tidak valid");
        const bytes = await sharp(input, { limitInputPixels: 40000000 })
          .rotate()
          .resize(1920, 1920, { fit: "inside", withoutEnlargement: true })
          .webp({ quality: 82 })
          .toBuffer();
        const path = crypto.randomUUID() + ".webp";
        const r = await c.storage
          .from("personalize")
          .upload(path, bytes, { contentType: "image/webp" });
        if (r.error) throw r.error;
        const u = await c.storage
          .from("personalize")
          .createSignedUrl(path, 3600);
        if (u.error) throw u.error;
        return Response.json({ path, url: u.data.signedUrl });
      } finally {
        await c.storage.from("personalize").remove([raw]);
      }
    }
    if (b.action === "save") {
      const theme = themeSchema.parse(b.theme);
      for (const [s, v] of Object.entries(theme)) {
        if (v.animation === "glow" && s !== "avatar")
          throw new Error("Glow pulse hanya untuk avatar");
      }
      const id = b.id ? z.uuid().parse(b.id) : null;
      const old = id
        ? await c.from("personalization").select("path").eq("preset", id)
        : { data: [], error: null };
      if (old.error) throw old.error;
      const name = z.string().trim().min(1).max(80).parse(b.name);
      const r = await c.rpc("save_theme", {
        p_id: id,
        p_name: name,
        p_theme: theme,
        p_activate: !!b.activate,
      });
      if (r.error) throw r.error;
      await cleanup((old.data || []).map((v) => v.path));
      return Response.json({ id: r.data });
    }
    if (b.action === "activate" || b.action === "reset") {
      const id = b.action === "reset" ? null : z.uuid().parse(b.id);
      const r = await c.rpc("activate_theme", { p_id: id });
      if (r.error) throw r.error;
      return Response.json({ ok: true });
    }
    if (b.action === "discard") {
      const paths = z
        .array(z.string().regex(/^[a-f0-9-]+\.webp$/))
        .max(40)
        .parse(b.paths);
      if (paths.length) {
        const used = await c
          .from("personalization")
          .select("path")
          .in("path", paths);
        if (used.error) throw used.error;
        const keep = new Set(used.data.map((v) => v.path));
        const remove = paths.filter((v) => !keep.has(v));
        if (remove.length) {
          const r = await c.storage.from("personalize").remove(remove);
          if (r.error) throw r.error;
        }
      }
      return Response.json({ ok: true });
    }
    if (b.action === "delete") {
      const id = z.uuid().parse(b.id);
      const old = await c
        .from("personalization")
        .select("path")
        .eq("preset", id);
      if (old.error) throw old.error;
      const r = await c.from("theme_presets").delete().eq("id", id);
      if (r.error) throw r.error;
      await cleanup(old.data.map((v) => v.path));
      return Response.json({ ok: true });
    }
    throw new Error("Aksi tidak valid");
  } catch (e) {
    return failure(e);
  }
}

async function cleanup(paths: string[]) {
  if (!paths.length) return;
  const c = (await db());
  const used = await c.from("personalization").select("path").in("path", paths);
  if (used.error) throw used.error;
  const keep = new Set(used.data.map((v) => v.path));
  const unused = paths.filter((v) => !keep.has(v));
  if (unused.length) {
    const r = await c.storage.from("personalize").remove(unused);
    if (r.error) console.error("Personalize cleanup pending");
  }
}
