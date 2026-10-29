export type Row = {
  id: string;
  title?: unknown;
  name?: unknown;
  color?: unknown;
  [key: string]: unknown;
};
export type Dataset = Record<string, Row[]>;
export const tables = [
  "categories",
  "transactions",
  "projects",
  "documents",
  "vault_folders",
  "accounts",
  "transfers",
  "budgets",
  "savings_goals",
  "recurring_rules",
  "mwbs",
  "subtasks",
  "focus_sessions",
  "app_settings",
  "activity_log",
] as const;
export const dateToday = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
export const currency = (n: number) =>
  new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(n);
export function accountBalance(data: Dataset, id: string) {
  const cats = new Map((data.categories || []).map((c) => [c.id, c.kind]));
  return (
    Number(data.accounts?.find((a) => a.id === id)?.opening_balance || 0) +
    (data.transactions || [])
      .filter((t) => t.account_id === id)
      .reduce(
        (n, t) =>
          n +
          (cats.get(String(t.category_id)) === "income" ? 1 : -1) *
            Number(t.amount),
        0,
      ) +
    (data.transfers || []).reduce(
      (n, t) =>
        n +
        (t.to_account === id ? Number(t.amount) : 0) -
        (t.from_account === id ? Number(t.amount) : 0),
      0,
    )
  );
}
export async function requestJson(url: string, init?: RequestInit) {
  const r = await fetch(url, init);
  const t = await r.text();
  let d;
  try {
    d = JSON.parse(t);
  } catch {
    throw new Error(`HTTP ${r.status}: Respons server tidak valid`);
  }
  if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
  return d;
}
export const writeData = (
  table: string,
  action: string,
  data?: unknown,
  id?: string,
) =>
  requestJson("/api/data", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ table, action, data, id }),
  });
export const command = (action: string, data: unknown = {}) =>
  requestJson("/api/actions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...(data as object) }),
  });
