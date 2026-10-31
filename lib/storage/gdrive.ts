import "server-only";
import { db } from "@/lib/server";
import { unseal } from "./crypto";
export type Connection = {
  provider: string;
  account_email: string;
  folder_id: string | null;
  folder_name: string | null;
  token_encrypted: string;
  iv: string;
  tag: string;
  scope: string;
  status: string;
  connected_at: string;
  last_synced_at: string | null;
};
export type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  parents?: string[];
  trashed?: boolean;
  appProperties?: Record<string, string>;
  capabilities?: { canAddChildren?: boolean };
};
export class DriveError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export async function connection(required = true): Promise<Connection | null> {
  const r = await (await db())
    .from("storage_connections")
    .select("*")
    .eq("provider", "gdrive")
    .maybeSingle();
  if (r.error)
    throw new Error(
      "Penyimpanan Drive belum siap. Jalankan migrasi 202610290003_google_drive_vault.sql.",
    );
  if (!r.data && required)
    throw new Error("Hubungkan Google Drive di Settings terlebih dahulu.");
  if (r.data?.status === "reconnect" && required)
    throw new Error(
      "Izin Drive sudah dicabut atau kedaluwarsa. Hubungkan ulang Google Drive.",
    );
  return r.data;
}
const tokens = new Map<string, { token: string; until: number }>(),
  refreshing = new Map<string, Promise<string>>();
export function clearAccessTokens() {
  tokens.clear();
  refreshing.clear();
}
export function googleConfig() {
  const id = process.env.GOOGLE_CLIENT_ID,
    secret = process.env.GOOGLE_CLIENT_SECRET,
    redirect = process.env.GOOGLE_REDIRECT_URI;
  if (!id || !secret || !redirect)
    throw new Error(
      "Atur GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI, dan TOKEN_ENCRYPTION_KEY di Vercel.",
    );
  const uri = new URL(redirect);
  if (
    uri.pathname !== "/api/storage/gdrive/callback" ||
    (uri.protocol !== "https:" &&
      !(
        uri.protocol === "http:" &&
        ["localhost", "127.0.0.1"].includes(uri.hostname)
      ))
  )
    throw new Error(
      "GOOGLE_REDIRECT_URI harus URL callback HTTPS aplikasi: /api/storage/gdrive/callback.",
    );
  return { id, secret, redirect };
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export async function googleFetch(
  url: string,
  init: RequestInit = {},
  retry = true,
) {
  for (let attempt = 0; ; attempt++) {
    let response: Response;
    try {
      response = await fetch(url, { ...init, cache: "no-store" });
    } catch {
      if (retry && attempt < 3) {
        await sleep(300 * 2 ** attempt + Math.random() * 100);
        continue;
      }
      throw new DriveError(
        "NETWORK",
        "Google Drive tidak dapat dihubungi. Periksa jaringan lalu coba lagi.",
      );
    }
    let rate = false;
    if (response.status === 403) {
      const e = await response
        .clone()
        .json()
        .catch(() => null);
      rate = ["rateLimitExceeded", "userRateLimitExceeded"].includes(
        e?.error?.errors?.[0]?.reason,
      );
    }
    if (
      retry &&
      attempt < 3 &&
      (rate || [429, 500, 502, 503, 504].includes(response.status))
    ) {
      await response.body?.cancel();
      const delay = Number(response.headers.get("retry-after")) * 1000;
      await sleep(
        Math.min(5000, delay || 300 * 2 ** attempt + Math.random() * 100),
      );
      continue;
    }
    return response;
  }
}
export async function accessToken(c?: Connection | null): Promise<string> {
  const conn = c || (await connection());
  if (!conn) throw new Error("Drive belum terhubung.");
  const cacheKey = conn.token_encrypted,
    existing = tokens.get(cacheKey);
  if (existing && existing.until > Date.now()) return existing.token;
  if (refreshing.has(cacheKey)) return refreshing.get(cacheKey)!;
  const promise = (async () => {
    const config = googleConfig();
    const r = await googleFetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: config.id,
        client_secret: config.secret,
        refresh_token: unseal(conn),
        grant_type: "refresh_token",
      }),
    });
    const b = await r.json();
    if (!r.ok) {
      if (b.error === "invalid_grant") {
        await (await db())
          .from("storage_connections")
          .update({ status: "reconnect" })
          .eq("provider", "gdrive");
        tokens.delete(cacheKey);
        throw new DriveError(
          "RECONNECT",
          "Izin Google Drive kedaluwarsa atau dicabut. Hubungkan ulang di Settings.",
        );
      }
      throw new Error(
        "Google menolak pembaruan izin. Periksa OAuth Client lalu hubungkan ulang Drive.",
      );
    }
    if (typeof b.access_token !== "string")
      throw new Error("Respons izin Google tidak valid.");
    tokens.clear();
    tokens.set(cacheKey, {
      token: b.access_token,
      until:
        Date.now() + Math.max(0, (Number(b.expires_in) || 3600) - 60) * 1000,
    });
    return b.access_token as string;
  })();
  refreshing.set(cacheKey, promise);
  try {
    return await promise;
  } finally {
    refreshing.delete(cacheKey);
  }
}
export async function driveRequest(
  path: string,
  init: RequestInit = {},
  conn?: Connection | null,
) {
  const current = conn || (await connection());
  const headers = new Headers(init.headers);
  headers.set("Authorization", "Bearer " + (await accessToken(current)));
  let r = await googleFetch("https://www.googleapis.com/drive/v3/" + path, {
    ...init,
    headers,
  });
  if (r.status === 401 && current) {
    await r.body?.cancel();
    tokens.delete(current.token_encrypted);
    headers.set("Authorization", "Bearer " + (await accessToken(current)));
    r = await googleFetch("https://www.googleapis.com/drive/v3/" + path, {
      ...init,
      headers,
    });
    if (r.status === 401)
      await (await db())
        .from("storage_connections")
        .update({ status: "reconnect" })
        .eq("provider", "gdrive");
  }
  if (r.ok || r.status === 206 || r.status === 416) return r;
  const b = await r.json().catch(() => null);
  const reason = b?.error?.errors?.[0]?.reason;
  if (r.status === 404)
    throw new DriveError(
      "NOT_FOUND",
      "File atau folder Drive tidak ditemukan, dipindahkan, dihapus, atau aksesnya hilang.",
    );
  if (reason === "storageQuotaExceeded")
    throw new DriveError(
      "QUOTA",
      "Kuota Google Drive penuh. Kosongkan penyimpanan atau gunakan akun lain.",
    );
  if (r.status === 403)
    throw new DriveError(
      "PERMISSION",
      "Izin Google Drive tidak cukup. Periksa akses folder atau hubungkan ulang akun.",
    );
  if (r.status === 401)
    throw new DriveError(
      "RECONNECT",
      "Google menolak izin akses. Hubungkan ulang Drive di Settings.",
    );
  throw new DriveError(
    "GOOGLE",
    `Google Drive gagal merespons (HTTP ${r.status}). Coba lagi beberapa saat.`,
  );
}
export async function driveFile(
  id: string,
  conn?: Connection | null,
): Promise<DriveFile> {
  if (!/^[A-Za-z0-9_-]+$/.test(id))
    throw new Error("ID file Drive tidak valid.");
  const r = await driveRequest(
    `files/${id}?supportsAllDrives=true&fields=id,name,mimeType,size,parents,trashed,appProperties,capabilities(canAddChildren)`,
    {},
    conn,
  );
  return r.json();
}
export async function verifyFolder(id: string, conn?: Connection | null) {
  const f = await driveFile(id, conn);
  if (f.trashed || f.mimeType !== "application/vnd.google-apps.folder")
    throw new Error("Pilihan tersebut bukan folder Drive aktif.");
  if (!f.capabilities?.canAddChildren)
    throw new Error(
      "Folder hanya dapat dibaca. Berikan izin menambahkan file pada akun yang terhubung.",
    );
  return f;
}
export async function ensureFolder(conn?: Connection | null) {
  const c = conn || (await connection());
  if (!c) throw new Error("Drive belum terhubung.");
  if (c.folder_id) return verifyFolder(c.folder_id, c);
  const r = await driveRequest(
    "files?fields=id,name",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "ORBIT Vault",
        mimeType: "application/vnd.google-apps.folder",
      }),
    },
    c,
  );
  const f = await r.json();
  const saved = await (await db())
    .from("storage_connections")
    .update({ folder_id: f.id, folder_name: f.name })
    .eq("provider", "gdrive");
  if (saved.error)
    throw new Error("Folder dibuat tetapi pengaturannya gagal disimpan.");
  return f as DriveFile;
}
export function validSessionUrl(raw: string) {
  const u = new URL(raw);
  if (
    u.protocol !== "https:" ||
    !["www.googleapis.com", "upload.googleapis.com"].includes(u.hostname) ||
    !u.pathname.startsWith("/upload/drive/")
  )
    throw new Error("URL sesi unggah Drive tidak valid.");
  return raw;
}
export async function startDriveUpload(
  name: string,
  mime: string,
  size: number,
  folder: string,
  properties: Record<string, string>,
  origin: string,
) {
  const ids = await (
    await driveRequest("files/generateIds?count=1&space=drive&type=files")
  ).json();
  const id = ids.ids?.[0];
  if (!id) throw new Error("Google tidak mengembalikan ID file.");
  const r = await googleFetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true&fields=id,size,mimeType,parents,appProperties",
    {
      method: "POST",
      headers: {
        Authorization: "Bearer " + (await accessToken()),
        "Content-Type": "application/json",
        "X-Upload-Content-Type": mime,
        "X-Upload-Content-Length": String(size),
        Origin: origin,
      },
      body: JSON.stringify({
        id,
        name,
        mimeType: mime,
        parents: [folder],
        appProperties: properties,
      }),
    },
  );
  if (!r.ok)
    throw new Error(
      `Sesi unggah Drive gagal dibuat (HTTP ${r.status}). Periksa kuota dan izin folder.`,
    );
  const url = r.headers.get("location");
  if (!url) throw new Error("Google tidak mengembalikan sesi unggah.");
  return { id, url: validSessionUrl(url) };
}
export async function trashDriveFile(id: string) {
  try {
    await driveRequest(`files/${id}?supportsAllDrives=true`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ trashed: true }),
    });
  } catch (e) {
    if (!(e instanceof DriveError && e.code === "NOT_FOUND")) throw e;
  }
}
export async function listFolder(folder: string) {
  const files: DriveFile[] = [];
  let page = "";
  do {
    const p = new URLSearchParams({
      q: `'${folder.replace(/'/g, "\\'")}' in parents and trashed = false`,
      fields:
        "nextPageToken,files(id,name,mimeType,size,parents,trashed,appProperties)",
      pageSize: "100",
      supportsAllDrives: "true",
      includeItemsFromAllDrives: "true",
    });
    if (page) p.set("pageToken", page);
    const b = await (await driveRequest("files?" + p)).json();
    files.push(...(b.files || []));
    page = b.nextPageToken || "";
  } while (page);
  return files;
}
