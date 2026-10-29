import type { Dataset, Row } from "./model";

export type WorkItem = {
  key: string;
  table: "projects" | "mwbs" | "subtasks";
  record: Row;
  depth: number;
  parent?: string;
  context: string;
  statusId?: string;
  status: string;
  progress: number;
  deadline: string | null;
};

// One projection of existing records drives both views; no duplicate schedule data.
export function workItems(data: Dataset): WorkItem[] {
  const projects = new Map(data.projects.map((p) => [p.id, p]));
  const mwbs = new Map(data.mwbs.map((m) => [m.id, m]));
  const projectStatus = (p?: Row) =>
    String(
      data.categories.find((c) => c.id === p?.status_id)?.name ||
        "Belum selesai",
    );
  const items: WorkItem[] = data.projects.map((p) => ({
    key: `projects:${p.id}`,
    table: "projects",
    record: p,
    depth: 0,
    context: "",
    statusId: p.status_id as string,
    status: projectStatus(p),
    progress: Number(p.progress),
    deadline: p.deadline ? String(p.deadline) : null,
  }));
  for (const m of data.mwbs) {
    const project = projects.get(String(m.project_id));
    const tasks = data.subtasks.filter((t) => t.mwb_id === m.id);
    items.push({
      key: `mwbs:${m.id}`,
      table: "mwbs",
      record: m,
      depth: project ? 1 : 0,
      parent: project ? `projects:${project.id}` : undefined,
      context: project ? String(project.title) : "MWB mandiri",
      statusId: project?.status_id as string | undefined,
      status: m.done ? "Selesai" : "Belum selesai",
      progress: m.done
        ? 100
        : tasks.length
          ? Math.round(
              (tasks.filter((t) => t.done).length / tasks.length) * 100,
            )
          : 0,
      deadline: m.deadline ? String(m.deadline) : null,
    });
  }
  for (const t of data.subtasks) {
    const mwb = mwbs.get(String(t.mwb_id));
    if (!mwb) continue;
    const project = projects.get(String(mwb.project_id));
    items.push({
      key: `subtasks:${t.id}`,
      table: "subtasks",
      record: t,
      depth: project ? 2 : 1,
      parent: `mwbs:${mwb.id}`,
      context: [project?.title, mwb.title].filter(Boolean).join(" / "),
      statusId: project?.status_id as string | undefined,
      status: t.done ? "Selesai" : "Belum selesai",
      progress: t.done ? 100 : 0,
      // Undated legacy subtasks stay undated instead of inheriting a misleading date.
      deadline: t.deadline ? String(t.deadline) : null,
    });
  }
  return items;
}

export function filterWorkItems(
  items: WorkItem[],
  query: string,
  status: string,
) {
  const q = query.trim().toLocaleLowerCase("id-ID");
  const visible = new Set(
    items
      .filter(
        (i) =>
          (!status || i.statusId === status) &&
          (!q ||
            `${i.record.title} ${i.context}`
              .toLocaleLowerCase("id-ID")
              .includes(q)),
      )
      .map((i) => i.key),
  );
  const byKey = new Map(items.map((i) => [i.key, i]));
  for (const key of [...visible]) {
    let parent = byKey.get(key)?.parent;
    while (parent) {
      visible.add(parent);
      parent = byKey.get(parent)?.parent;
    }
  }
  return items.filter((i) => visible.has(i.key));
}

export function stackWorkItems(items: WorkItem[], sort: string) {
  const compare = (a: WorkItem, b: WorkItem) =>
    (sort === "progress"
      ? b.progress - a.progress
      : sort === "title"
        ? String(a.record.title).localeCompare(String(b.record.title), "id-ID")
        : (a.deadline || "9999").localeCompare(b.deadline || "9999")) ||
    a.key.localeCompare(b.key);
  const children = new Map<string | undefined, WorkItem[]>();
  for (const item of items) {
    const siblings = children.get(item.parent) || [];
    siblings.push(item);
    children.set(item.parent, siblings);
  }
  const result: WorkItem[] = [];
  function visit(parent?: string) {
    for (const item of (children.get(parent) || []).sort(compare)) {
      result.push(item);
      visit(item.key);
    }
  }
  visit();
  return result;
}
