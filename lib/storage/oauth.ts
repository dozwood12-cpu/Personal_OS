import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { jwtVerify } from "jose";
import { db } from "@/lib/server";
import { seal, unseal } from "./crypto";
import {
  googleConfig,
  googleFetch,
  connection,
  driveRequest,
  clearAccessTokens,
} from "./gdrive";
import { saveVaultConfig, vaultConfig } from "./config";
export const oauthCookie = "orbit_drive_oauth";
const digest = (s: string) => createHash("sha256").update(s).digest("hex");
export async function oauthStart(session: string, origin: string) {
  const config = googleConfig();
  if (new URL(config.redirect).origin !== origin)
    throw new Error(
      "Domain aplikasi harus sama dengan origin GOOGLE_REDIRECT_URI. Buka domain produksi yang dikonfigurasi.",
    );
  const state = randomBytes(32).toString("base64url"),
    verifier = randomBytes(48).toString("base64url"),
    expires = Date.now() + 600000;
  const payload = seal(
    JSON.stringify({ state, verifier, session, expires }),
    "orbit:gdrive:oauth:v1",
  );
  const r = await db()
    .from("storage_oauth_states")
    .insert({
      state_hash: digest(state),
      expires_at: new Date(expires).toISOString(),
    });
  if (r.error)
    throw new Error("OAuth belum siap. Jalankan migrasi Google Drive vault.");
  const params = new URLSearchParams({
    client_id: config.id,
    redirect_uri: config.redirect,
    response_type: "code",
    scope: "https://www.googleapis.com/auth/drive",
    access_type: "offline",
    prompt: "consent",
    state,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
  });
  return {
    url: "https://accounts.google.com/o/oauth2/v2/auth?" + params,
    cookie: Buffer.from(JSON.stringify(payload)).toString("base64url"),
  };
}
export async function consumeOAuthState(cookie: string, state: string) {
  let p: { state: string; verifier: string; session: string; expires: number };
  try {
    p = JSON.parse(
      unseal(
        JSON.parse(Buffer.from(cookie, "base64url").toString()),
        "orbit:gdrive:oauth:v1",
      ),
    );
  } catch {
    throw new Error(
      "State OAuth tidak valid. Mulai koneksi ulang dari Settings.",
    );
  }
  const a = Buffer.from(p.state || ""),
    b = Buffer.from(state);
  if (a.length !== b.length || !timingSafeEqual(a, b) || p.expires < Date.now())
    throw new Error("State OAuth tidak valid atau kedaluwarsa.");
  const verified = await jwtVerify(
    p.session,
    new TextEncoder().encode(process.env.SESSION_SECRET),
    { algorithms: ["HS256"] },
  );
  if (verified.payload.role !== "admin")
    throw new Error("Session koneksi tidak valid.");
  const consumed = await db()
    .from("storage_oauth_states")
    .delete()
    .eq("state_hash", digest(state))
    .gt("expires_at", new Date().toISOString())
    .select("state_hash");
  if (consumed.error || consumed.data?.length !== 1)
    throw new Error("State OAuth sudah digunakan atau kedaluwarsa.");
  return p.verifier;
}
export async function finishOAuth(code: string, verifier: string) {
  const c = googleConfig();
  const r = await googleFetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: c.id,
      client_secret: c.secret,
      redirect_uri: c.redirect,
      grant_type: "authorization_code",
      code,
      code_verifier: verifier,
    }),
  });
  const b = await r.json();
  if (!r.ok || !b.access_token || !b.refresh_token)
    throw new Error(
      "Google belum memberikan refresh token. Ulangi koneksi dan setujui akses Drive.",
    );
  if (
    !String(b.scope || "")
      .split(" ")
      .includes("https://www.googleapis.com/auth/drive")
  )
    throw new Error(
      "Scope Drive belum disetujui. Hubungkan ulang dan berikan akses Drive.",
    );
  const about = await googleFetch(
    "https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)",
    { headers: { Authorization: "Bearer " + b.access_token } },
  );
  if (!about.ok) throw new Error("Akun Google tidak dapat diverifikasi.");
  const profile = await about.json();
  if (!profile.user?.emailAddress)
    throw new Error("Email akun Google tidak tersedia.");
  const old = await connection(false);
  const same = old?.account_email === profile.user.emailAddress;
  const saved = await db()
    .from("storage_connections")
    .upsert({
      provider: "gdrive",
      account_email: profile.user.emailAddress,
      ...seal(b.refresh_token),
      scope: b.scope,
      status: "connected",
      connected_at: new Date().toISOString(),
      folder_id: same ? old?.folder_id : null,
      folder_name: same ? old?.folder_name : null,
      last_synced_at: null,
    });
  if (saved.error)
    throw new Error("Koneksi belum dapat disimpan. Periksa migrasi database.");
  clearAccessTokens();
  await saveVaultConfig({
    ...(await vaultConfig()),
    default_provider: "gdrive",
  });
}
export async function disconnectDrive() {
  const c = await connection(false);
  if (!c) return;
  const r = await googleFetch("https://oauth2.googleapis.com/revoke", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token: unseal(c) }),
  });
  if (!r.ok) {
    const b = await r.json().catch(() => null);
    if (!(r.status === 400 && b?.error === "invalid_token"))
      throw new Error(
        "Google belum mengonfirmasi pencabutan izin. Coba putuskan koneksi lagi.",
      );
  }
  const deleted = await db()
    .from("storage_connections")
    .delete()
    .eq("provider", "gdrive");
  if (deleted.error)
    throw new Error(
      "Izin dicabut tetapi penghapusan token lokal gagal. Coba lagi.",
    );
  clearAccessTokens();
  await db()
    .from("vault_uploads")
    .delete()
    .eq("provider", "gdrive")
    .is("completed_document_id", null);
  await saveVaultConfig({
    ...(await vaultConfig()),
    default_provider: "supabase",
  });
}
