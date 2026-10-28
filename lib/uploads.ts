import { requestJson } from "./model";
export async function uploadFile(
  endpoint: string,
  file: File,
  extra: Record<string, string> = {},
) {
  const max = endpoint.includes("personalize") ? 5 : 10;
  if (!file.size || file.size > max * 1024 * 1024)
    throw new Error(`File tidak boleh kosong, maksimal ${max} MB`);
  const prep = await requestJson(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "prepare_upload",
      name: file.name,
      type: file.type,
      size: file.size,
      ...extra,
    }),
  });
  const form = new FormData();
  form.append("cacheControl", "3600");
  form.append("", file);
  const uploaded = await fetch(prep.uploadUrl, {
    method: "PUT",
    headers: { "x-upsert": "false" },
    body: form,
  });
  if (!uploaded.ok)
    throw new Error(`Upload Storage gagal: HTTP ${uploaded.status}`);
  return requestJson(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "finish_upload",
      path: prep.path,
      name: file.name,
      ...extra,
    }),
  });
}
