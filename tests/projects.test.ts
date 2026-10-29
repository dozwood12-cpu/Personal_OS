import { test } from "node:test";
import assert from "node:assert/strict";
import { filterWorkItems, stackWorkItems, workItems } from "../lib/projects";
import type { Dataset } from "../lib/model";
const data: Dataset = {
  categories: [{ id: "active", name: "Berjalan" }],
  projects: [
    {
      id: "p",
      title: "Oprec",
      deadline: "2026-11-21",
      status_id: "active",
      progress: 20,
    },
  ],
  mwbs: [
    {
      id: "m",
      title: "Persiapan",
      project_id: "p",
      deadline: "2026-11-20",
      done: false,
    },
    {
      id: "solo",
      title: "Mandiri",
      project_id: null,
      deadline: "2026-11-01",
      done: false,
    },
  ],
  subtasks: [
    {
      id: "a",
      title: "Interview",
      mwb_id: "m",
      deadline: "2026-11-07",
      done: true,
    },
    {
      id: "b",
      title: "Presentasi",
      mwb_id: "m",
      deadline: "2026-11-03",
      done: false,
    },
    { id: "c", title: "Riset", mwb_id: "m", done: false },
    {
      id: "d",
      title: "Baca",
      mwb_id: "solo",
      deadline: "2026-11-02",
      done: false,
    },
  ],
};
test("Tabel menyusun stack hierarki dan kalender mengambil tanggal setiap record", () => {
  const items = workItems(data);
  assert.deepEqual(
    stackWorkItems(items, "deadline").map((i) => i.key),
    [
      "mwbs:solo",
      "subtasks:d",
      "projects:p",
      "mwbs:m",
      "subtasks:b",
      "subtasks:a",
      "subtasks:c",
    ],
  );
  assert.equal(items.find((i) => i.key === "subtasks:c")?.deadline, null);
  assert.equal(
    items.find((i) => i.key === "subtasks:a")?.deadline,
    "2026-11-07",
  );
  assert.equal(items.find((i) => i.key === "subtasks:a")?.progress, 100);
  assert.equal(items.find((i) => i.key === "mwbs:m")?.progress, 33);
  assert.equal(items.find((i) => i.key === "subtasks:d")?.context, "Mandiri");
});
test("Pencarian subtask mempertahankan induk, filter status dan urutan nama", () => {
  const items = workItems(data);
  assert.deepEqual(
    stackWorkItems(filterWorkItems(items, "Interview", "active"), "title").map(
      (i) => i.key,
    ),
    ["projects:p", "mwbs:m", "subtasks:a"],
  );
  assert.equal(filterWorkItems(items, "Mandiri", "active").length, 0);
  assert.equal(filterWorkItems(items, "Oprec", "active").length, 5);
});
