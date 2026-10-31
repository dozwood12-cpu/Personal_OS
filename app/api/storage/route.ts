import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { authorized, db, sameOrigin } from "@/lib/server";
import {
  vaultConfig,
  saveVaultConfig,
  storageFailure,
} from "@/lib/storage/config";
import {
  connection,
  driveRequest,
  ensureFolder,
  verifyFolder,
} from "@/lib/storage/gdrive";
import { disconnectDrive, oauthCookie, oauthStart } from "@/lib/storage/oauth";
import { folderId } from "@/lib/storage/shared";
import {
  applySync,
  migrateOne,
  migrationProgress,
  scanStorage,
  testDrive,
} from "@/lib/storage/maintenance";
import { setSupabaseLimit } from "@/lib/storage/supabase";
export const runtime = "nodejs";
export const maxDuration = 300;
export async function GET() {
  if (!(await authorized()))
    return new Response("Unauthorized", { status: 401 });
  try {
    const config = await vaultConfig(),
      c = await connection(false);
    let quota = null,
      warning = null;
    if (c?.status === "connected")
      try {
        const about = await (
          await driveRequest(
            "about?fields=user(emailAddress),storageQuota",
            {},
            c,
          )
        ).json();
        const q = about.storageQuota;
        quota = q
          ? {
              limit: q.limit || null,
              used: q.usage || "0",
              remaining: q.limit
                ? String(Math.max(0, Number(q.limit) - Number(q.usage || 0)))
                : null,
            }
          : null;
      } catch (e) {
        warning = (e as Error).message;
      }
    const latest = await connection(false);
    return Response.json(
      {
        config,
        configured: !!(
          process.env.GOOGLE_CLIENT_ID &&
          process.env.GOOGLE_CLIENT_SECRET &&
          process.env.GOOGLE_REDIRECT_URI &&
          process.env.TOKEN_ENCRYPTION_KEY
        ),
        connection: latest
          ? {
              email: latest.account_email,
              folder_id: latest.folder_id,
              folder_name: latest.folder_name,
              status: latest.status,
              connected_at: latest.connected_at,
              last_synced_at: latest.last_synced_at,
            }
          : null,
        quota,
        warning,
        migration: await migrationProgress(),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return storageFailure(e);
  }
}
export async function POST(req: Request) {
  if (!sameOrigin(req) || !(await authorized()))
    return new Response("Forbidden", { status: 403 });
  try {
    const b = await req.json(),
      origin = new URL(req.headers.get("origin")!).origin;
    if (b.action === "connect") {
      const session = (await cookies()).get("os_session")?.value;
      if (!session) throw new Error("Session tidak tersedia. Login ulang.");
      const start = await oauthStart(session, origin);
      const r = NextResponse.json({ url: start.url });
      r.cookies.set(oauthCookie, start.cookie, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/api/storage/gdrive/callback",
        maxAge: 600,
      });
      r.headers.set("Cache-Control", "no-store");
      return r;
    }
    if (b.action === "disconnect") {
      await disconnectDrive();
      return Response.json({ ok: true });
    }
    if (b.action === "folder") {
      const id = folderId(z.string().max(2000).parse(b.folder));
      const folder = id
        ? await verifyFolder(id)
        : await (async () => {
            const r = await connection();
            if (r?.folder_id) {
              const old = r.folder_id;
              const changed = await (await db())
                .from("storage_connections")
                .update({ folder_id: null, folder_name: null })
                .eq("provider", "gdrive");
              if (changed.error)
                throw new Error("Folder tidak dapat diperbarui.");
              try {
                return await ensureFolder();
              } catch (e) {
                await (await db())
                  .from("storage_connections")
                  .update({ folder_id: old, folder_name: r.folder_name })
                  .eq("provider", "gdrive");
                throw e;
              }
            }
            return ensureFolder();
          })();
      const r = await (await db())
        .from("storage_connections")
        .update({ folder_id: folder.id, folder_name: folder.name })
        .eq("provider", "gdrive");
      if (r.error) throw new Error("Folder tidak dapat disimpan.");
      return Response.json({ ok: true });
    }
    if (b.action === "config") {
      const config = z
        .object({
          default_provider: z.enum(["supabase", "gdrive"]),
          max_upload_mb: z.number().int().min(1).max(1024),
        })
        .parse(b.config);
      if (config.default_provider === "gdrive") await connection();
      if (config.default_provider === "supabase")
        await setSupabaseLimit(config.max_upload_mb * 1024 * 1024);
      await saveVaultConfig(config);
      return Response.json({ ok: true });
    }
    if (b.action === "test") return Response.json(await testDrive(origin));
    if (b.action === "migrate") return Response.json(await migrateOne(origin));
    if (b.action === "scan") return Response.json(await scanStorage());
    if (b.action === "apply_sync")
      return Response.json(
        await applySync(
          z.uuid().parse(b.id),
          z.array(z.uuid()).max(500).parse(b.missing),
          z
            .array(z.string().regex(/^[A-Za-z0-9_-]+$/))
            .max(500)
            .parse(b.untracked),
        ),
      );
    throw new Error("Aksi penyimpanan tidak valid.");
  } catch (e) {
    return storageFailure(e);
  }
}
