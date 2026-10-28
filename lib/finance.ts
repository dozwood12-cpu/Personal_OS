import { type Dataset, type Row, dateToday } from "./model";
export function filterTransactions(
  data: Dataset,
  q: string,
  kind: string,
  from: string,
  to: string,
  account: string,
) {
  const cat = new Map(data.categories.map((c) => [c.id, c]));
  return data.transactions
    .filter(
      (t) =>
        (!q ||
          `${t.title} ${cat.get(String(t.category_id))?.name || ""}`
            .toLowerCase()
            .includes(q.toLowerCase())) &&
        (!kind || cat.get(String(t.category_id))?.kind === kind) &&
        (!from || String(t.date) >= from) &&
        (!to || String(t.date) <= to) &&
        (!account || t.account_id === account),
    )
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
}
export function cashflow(data: Dataset, period: number) {
  const today = dateToday(),
    end = new Date(today + "T12:00:00Z");
  const monthly = period === 12;
  return Array.from({ length: monthly ? 12 : period }, (_, i) => {
    const d = new Date(end);
    if (monthly) {
      d.setUTCDate(1);
      d.setUTCMonth(d.getUTCMonth() - (11 - i));
    } else d.setUTCDate(d.getUTCDate() - (period - 1 - i));
    const key = d.toISOString().slice(0, monthly ? 7 : 10);
    const rows = data.transactions.filter((t) =>
      String(t.date).startsWith(key),
    );
    const cats = new Map(data.categories.map((c) => [c.id, c.kind]));
    return {
      key,
      label: monthly
        ? d.toLocaleDateString("id-ID", { month: "short", timeZone: "UTC" })
        : String(d.getUTCDate()),
      income: rows
        .filter((t) => cats.get(String(t.category_id)) === "income")
        .reduce((n, t) => n + Number(t.amount), 0),
      expense: rows
        .filter((t) => cats.get(String(t.category_id)) === "expense")
        .reduce((n, t) => n + Number(t.amount), 0),
    };
  });
}
export function duplicateKey(t: Pick<Row, "id"> | Record<string, unknown>) {
  const r = t as Record<string, unknown>;
  return [
    r.account_id,
    r.category_id,
    r.date,
    Number(r.amount),
    String(r.title).trim().toLowerCase(),
  ].join("|");
}
export function monthExpense(data: Dataset, category: string, month: string) {
  return data.transactions
    .filter(
      (t) =>
        t.category_id === category &&
        String(t.date).startsWith(month.slice(0, 7)),
    )
    .reduce((n, t) => n + Number(t.amount), 0);
}
