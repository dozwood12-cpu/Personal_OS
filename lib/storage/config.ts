import "server-only";
import { db } from "@/lib/server";
import { defaultVaultConfig, type VaultConfig } from "./shared";
export async function vaultConfig(): Promise<VaultConfig> {
  const r = await (await db())
    .from("app_settings")
    .select("value")
    .eq("key", "vault_storage")
    .maybeSingle();
  if (r.error) throw new Error("Pengaturan penyimpanan tidak dapat dibaca.");
  const value = r.data?.value;
  return {
    default_provider:
      value?.default_provider === "gdrive" ? "gdrive" : "supabase",
    max_upload_mb: Math.min(
      1024,
      Math.max(
        1,
        Number(value?.max_upload_mb) || defaultVaultConfig.max_upload_mb,
      ),
    ),
  };
}
export async function saveVaultConfig(config: VaultConfig) {
  const r = await (await db())
    .from("app_settings")
    .upsert({ key: "vault_storage", value: config });
  if (r.error) throw new Error("Pengaturan penyimpanan gagal disimpan.");
}
export function storageFailure(e: unknown) {
  // Do not log OAuth payloads, refresh tokens or resumable session URLs.
  return Response.json(
    {
      error:
        e instanceof Error
          ? e.message
          : "Operasi penyimpanan gagal. Periksa koneksi dan migrasi database.",
    },
    { status: 400, headers: { "Cache-Control": "no-store" } },
  );
}
