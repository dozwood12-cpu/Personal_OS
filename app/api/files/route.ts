import { authorized, db, failure, sameOrigin } from "@/lib/server";
import { z } from "zod";
const allowed = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "text/plain",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
];
export async function POST(req: Request) {
  if (!sameOrigin(req) || !(await authorized()))
    return new Response("Forbidden", { status: 403 });
  try {
    const c = db();
    async function category(id: unknown) {
      const r = await c
        .from("categories")
        .select("kind")
        .eq("id", z.uuid().parse(id))
        .single();
      if (r.error || r.data.kind !== "document")
        throw new Error("Kategori dokumen tidak valid");
    }
    async function insert(
      path: string,
      name: string,
      category_id: string,
      size: number,
    ) {
      const r = await c
        .from("documents")
        .insert({ title: name, category_id, path, size });
      if (r.error) {
        await c.storage.from("vault").remove([path]);
        throw r.error;
      }
      return Response.json({ ok: true });
    }
    if (req.headers.get("content-type")?.includes("application/json")) {
      const b = await req.json();
      await category(b.category_id);
      if (b.action === "prepare_upload") {
        if (!allowed.includes(b.type))
          throw new Error("Format file tidak didukung");
        z.number().positive().max(10485760).parse(b.size);
        const name = z.string().min(1).max(200).parse(b.name);
        const path =
          crypto.randomUUID() + "/" + name.replace(/[^a-zA-Z0-9._-]/g, "_");
        const r = await c.storage.from("vault").createSignedUploadUrl(path);
        if (r.error) throw r.error;
        return Response.json({ path, uploadUrl: r.data.signedUrl });
      }
      if (b.action === "finish_upload") {
        const path = z
          .string()
          .regex(/^[a-f0-9-]+\/[a-zA-Z0-9._-]+$/)
          .parse(b.path);
        const name = z.string().min(1).max(200).parse(b.name);
        const exists = await c
          .from("documents")
          .select("id")
          .eq("path", path)
          .maybeSingle();
        if (exists.error) throw exists.error;
        if (exists.data) return Response.json({ ok: true });
        const file = await c.storage.from("vault").download(path);
        if (file.error) throw file.error;
        if (
          !file.data.size ||
          file.data.size > 10485760 ||
          !allowed.includes(file.data.type)
        ) {
          await c.storage.from("vault").remove([path]);
          throw new Error(
            "File kosong, terlalu besar, atau format tidak didukung",
          );
        }
        return insert(path, name, b.category_id, file.data.size);
      }
      throw new Error("Aksi upload tidak valid");
    }
    const f = await req.formData(),
      file = f.get("file"),
      category_id = f.get("category_id");
    if (
      !(file instanceof File) ||
      !file.size ||
      file.size > 10485760 ||
      !allowed.includes(file.type)
    )
      throw new Error(
        "PDF/PNG/JPG/TXT/DOCX/XLSX, tidak kosong, maksimal 10 MB",
      );
    await category(category_id);
    const path =
      crypto.randomUUID() + "/" + file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const u = await c.storage
      .from("vault")
      .upload(path, file, { contentType: file.type });
    if (u.error) throw u.error;
    return insert(path, file.name, String(category_id), file.size);
  } catch (e) {
    return failure(e);
  }
}
export async function GET(req: Request) {
  if (!(await authorized()))
    return new Response("Unauthorized", { status: 401 });
  try {
    const c = db();
    const r = await c
      .from("documents")
      .select("path,title,deletion_state")
      .eq("id", new URL(req.url).searchParams.get("id"))
      .single();
    if (r.error) throw r.error;
    if (r.data.deletion_state !== "active")
      throw new Error("Dokumen menunggu penghapusan");
    const inline = new URL(req.url).searchParams.get("preview") === "1";
    const u = await c.storage
      .from("vault")
      .createSignedUrl(
        r.data.path,
        60,
        inline ? {} : { download: r.data.title },
      );
    if (u.error) throw u.error;
    return Response.redirect(u.data.signedUrl);
  } catch (e) {
    return failure(e);
  }
}
