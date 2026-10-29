import { test } from "node:test";
import assert from "node:assert/strict";
import { accountBalance, dateToday, type Dataset } from "../lib/model";
import {
  filterTransactions,
  cashflow,
  duplicateKey,
  monthExpense,
} from "../lib/finance";
import { blankTheme, themeSchema } from "../lib/personalization";
import { inputs } from "../lib/validation";
const data: Dataset = {
  categories: [
    { id: "in", name: "Gaji", kind: "income" },
    { id: "out", name: "Makan", kind: "expense" },
  ],
  accounts: [
    { id: "cash", opening_balance: 1000 },
    { id: "bank", opening_balance: 500 },
  ],
  transactions: [
    {
      id: "a",
      title: "Gaji Oktober",
      date: dateToday(),
      category_id: "in",
      account_id: "bank",
      amount: 5000,
    },
    {
      id: "b",
      title: "Siang",
      date: dateToday(),
      category_id: "out",
      account_id: "cash",
      amount: 200,
    },
  ],
  transfers: [
    { id: "t", from_account: "bank", to_account: "cash", amount: 800 },
  ],
};
test("Saldo awal + arus kas + transfer menjaga saldo gabungan", () => {
  assert.equal(accountBalance(data, "cash"), 1600);
  assert.equal(accountBalance(data, "bank"), 4700);
  assert.equal(
    data.accounts.reduce((n, a) => n + accountBalance(data, a.id), 0),
    6300,
  );
});
test("Filter kategori, akun, rentang tanggal bersifat gabungan", () => {
  assert.equal(
    filterTransactions(
      data,
      "makan",
      "expense",
      dateToday(),
      dateToday(),
      "cash",
    ).length,
    1,
  );
  assert.equal(
    filterTransactions(data, "makan", "income", "", "", "").length,
    0,
  );
  assert.equal(filterTransactions(data, "gaji", "", "", "", "bank").length, 1);
});
test("Grafik 7 hari, 30 hari, 12 bulan dan total pengeluaran", () => {
  for (const p of [7, 30, 12]) {
    const result = cashflow(data, p);
    assert.equal(result.length, p);
    assert.equal(result.at(-1)?.income, 5000);
    assert.equal(result.at(-1)?.expense, 200);
  }
  assert.equal(monthExpense(data, "out", dateToday().slice(0, 7) + "-01"), 200);
});
test("Kunci duplikat stabil untuk nominal dan kapitalisasi deskripsi", () => {
  assert.equal(
    duplicateKey({
      title: " Gaji ",
      amount: "1000",
      account_id: "a",
      category_id: "c",
      date: "2026-10-29",
    }),
    duplicateKey({
      title: "gaji",
      amount: 1000,
      account_id: "a",
      category_id: "c",
      date: "2026-10-29",
    }),
  );
});
test("Batas slot, rentang animasi, path dan schema tema", () => {
  const t = blankTheme();
  assert.equal(themeSchema.safeParse(t).success, true);
  t.login.images = Array.from({ length: 6 }, () => ({
    path: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.webp",
    url: "",
  }));
  assert.equal(themeSchema.safeParse(t).success, false);
  t.login.images = [];
  t.avatar.zoom = 5;
  assert.equal(themeSchema.safeParse(t).success, false);
  t.avatar.zoom = 1;
  t.login.images = [{ path: "../../private.webp", url: "" }];
  assert.equal(themeSchema.safeParse(t).success, false);
});
test("Input menolak tanggal/nominal/progres/transfer tidak valid", () => {
  assert.equal(
    inputs.transactions.safeParse({
      title: "X",
      amount: -2,
      date: "2026-02-30",
      category_id: "x",
      account_id: "x",
    }).success,
    false,
  );
  assert.equal(
    inputs.projects.safeParse({
      title: "X",
      progress: 101,
      deadline: "2026-10-29",
      status_id: "00000000-0000-4000-8000-000000000001",
    }).success,
    false,
  );
  const id = "00000000-0000-4000-8000-000000000001";
  assert.equal(
    inputs.transfers.safeParse({
      title: "T",
      from_account: id,
      to_account: id,
      amount: 5,
      date: "2026-10-29",
    }).success,
    false,
  );
});

test("Tanggal subtask opsional, tetapi wajib valid ketika diisi", () => {
  const task = {
    title: "Interview",
    mwb_id: "00000000-0000-4000-8000-000000000001",
    done: false,
  };
  assert.equal(inputs.subtasks.safeParse(task).success, true);
  assert.equal(
    inputs.subtasks.safeParse({ ...task, deadline: null }).success,
    true,
  );
  assert.equal(
    inputs.subtasks.parse({ ...task, deadline: "2026-11-07" }).deadline,
    "2026-11-07",
  );
  assert.equal(
    inputs.subtasks.safeParse({ ...task, deadline: "2026-02-30" }).success,
    false,
  );
});
