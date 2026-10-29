import { z } from "zod";
const title = z.string().trim().min(1).max(200),
  id = z.uuid(),
  date = z.iso.date(),
  amount = z.coerce.number().positive().max(99999999999999),
  bool = z.boolean();
export const transactionInput = z.object({
  title,
  amount,
  category_id: id,
  account_id: id,
  date,
});
export const inputs = {
  categories: z.object({
    name: z.string().trim().min(1).max(80),
    kind: z.enum(["income", "expense", "status", "document"]),
    color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .default("#a1a1aa"),
    icon: z
      .enum([
        "Tag",
        "Wallet",
        "Briefcase",
        "Book",
        "Car",
        "Coffee",
        "Home",
        "Star",
        "Heart",
        "ShoppingBag",
      ])
      .default("Tag"),
  }),
  transactions: transactionInput,
  projects: z.object({
    title,
    status_id: id,
    progress: z.coerce.number().int().min(0).max(100),
    deadline: date,
    is_mwb: bool.default(false),
  }),
  accounts: z.object({
    name: title,
    kind: z.enum(["cash", "bank", "ewallet"]),
    opening_balance: z.coerce.number().min(-99999999999999).max(99999999999999),
  }),
  transfers: z
    .object({ title, from_account: id, to_account: id, amount, date })
    .refine(
      (d) => d.from_account !== d.to_account,
      "Akun transfer harus berbeda",
    ),
  budgets: z.object({
    category_id: id,
    month: date.refine((d) => d.endsWith("-01"), "Pilih hari pertama bulan"),
    amount,
  }),
  savings_goals: z.object({
    title,
    target: amount,
    saved: z.coerce.number().min(0),
    deadline: date,
  }),
  recurring_rules: z.object({
    title,
    amount,
    category_id: id,
    account_id: id,
    next_due: date,
    frequency: z.enum(["daily", "weekly", "monthly", "yearly"]),
    active: bool,
    anchor_day: z.coerce.number().int().min(1).max(31),
  }),
  mwbs: z.object({
    title,
    project_id: id.nullable().default(null),
    deadline: date,
    done: bool.default(false),
  }),
  subtasks: z.object({
    title,
    mwb_id: id,
    deadline: date.nullable().optional(),
    done: bool.default(false),
  }),
  focus_sessions: z.object({ mwb_id: id }),
  documents: z.object({
    title,
    category_id: id,
    tags: z.array(z.string().trim().min(1).max(40)).max(20),
    expires_on: date.nullable(),
  }),
};
export type Editable = keyof typeof inputs;
