export type Provider = "supabase" | "gdrive";
export type VaultConfig = { default_provider: Provider; max_upload_mb: number };
export const defaultVaultConfig: VaultConfig = {
  default_provider: "supabase",
  max_upload_mb: 100,
};
export const fileTypes: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  txt: "text/plain",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};
export function mimeFor(name: string, supplied?: string | null) {
  const expected = fileTypes[name.split(".").at(-1)?.toLowerCase() || ""];
  if (
    !expected ||
    (supplied &&
      supplied !== expected &&
      supplied !== "application/octet-stream")
  )
    throw new Error(
      "Format harus PDF, JPG, PNG, TXT, DOCX, atau XLSX dengan tipe file yang sesuai.",
    );
  return expected;
}
export function folderId(input: string) {
  const raw = input.trim();
  if (!raw) return null;
  if (/^[A-Za-z0-9_-]{10,200}$/.test(raw)) return raw;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error("Link folder Google Drive tidak valid.");
  }
  if (
    u.protocol !== "https:" ||
    !["drive.google.com", "www.drive.google.com"].includes(u.hostname)
  )
    throw new Error(
      "Gunakan link folder dari drive.google.com atau ID folder.",
    );
  const id =
    u.pathname.match(/\/folders\/([A-Za-z0-9_-]+)/)?.[1] ||
    u.searchParams.get("id");
  if (!id || !/^[A-Za-z0-9_-]{10,200}$/.test(id))
    throw new Error("ID folder tidak ditemukan dalam link.");
  return id;
}
export const safeFileName = (s: string) =>
  s.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 200) || "document";
export function disposition(name: string, inline: boolean) {
  return `${inline ? "inline" : "attachment"}; filename="${safeFileName(name)}"; filename*=UTF-8''${encodeURIComponent(name).replace(/['()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase())}`;
}
