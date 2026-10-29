import { authorized, db, sameOrigin } from "@/lib/server";
import { storageFailure } from "@/lib/storage/config";
import {
  connection,
  ensureFolder,
  verifyFolder,
  driveRequest,
} from "@/lib/storage/gdrive";
import { z } from "zod";
export async function POST(req: Request) {
  if (!sameOrigin(req) || !(await authorized()))
    return new Response("Forbidden", { status: 403 });
  try {
    const b = z
      .object({
        name: z.string().trim().min(1).max(100),
        parent_id: z.uuid().nullable().default(null),
      })
      .parse(await req.json());
    let parent: string | undefined;
    if (b.parent_id) {
      const p = await db()
        .from("vault_folders")
        .select("*")
        .eq("id", b.parent_id)
        .single();
      if (p.error) throw new Error("Folder induk tidak ditemukan.");
      parent = p.data.drive_folder_id || undefined;
    }
    const c = await connection(false);
    let drive_folder_id = null;
    if (c?.status === "connected") {
      const root = parent ? await verifyFolder(parent) : await ensureFolder(c);
      const f = await driveRequest("files?fields=id", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: b.name,
          mimeType: "application/vnd.google-apps.folder",
          parents: [root.id],
        }),
      });
      drive_folder_id = (await f.json()).id;
    }
    const r = await db()
      .from("vault_folders")
      .insert({ ...b, drive_folder_id });
    if (r.error)
      throw new Error(
        "Folder belum tersimpan. Jalankan migrasi 202610290004_folders_study.sql.",
      );
    return Response.json({ ok: true });
  } catch (e) {
    return storageFailure(e);
  }
}
