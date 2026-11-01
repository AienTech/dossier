import type { ApplicationRow } from "./applications-data";

/**
 * The order inside a board column (#60): cards given a position come
 * first, in that order; cards never reordered keep newest-first after
 * them, so existing columns look exactly as they did before.
 */
export function boardOrder(a: ApplicationRow, b: ApplicationRow) {
  if (a.boardSort !== null && b.boardSort !== null) return a.boardSort - b.boardSort;
  if (a.boardSort !== null) return -1;
  if (b.boardSort !== null) return 1;
  return b.updatedAt - a.updatedAt;
}

/** One column's cards, in board order. */
export function orderedColumn(rows: ApplicationRow[], status: ApplicationRow["status"]) {
  return rows.filter((row) => row.status === status).sort(boardOrder);
}

/**
 * The column's cards after dragging `activeId` onto `overId`, or null
 * when the two cards aren't in the same column. The caller writes the
 * returned order back as boardSort values.
 */
export function reorderColumn(rows: ApplicationRow[], activeId: string, overId: string) {
  const active = rows.find((row) => row.id === activeId);
  const over = rows.find((row) => row.id === overId);
  if (!active || !over || active.status !== over.status) return null;
  const column = orderedColumn(rows, active.status);
  const from = column.findIndex((row) => row.id === activeId);
  const to = column.findIndex((row) => row.id === overId);
  if (from < 0 || to < 0 || from === to) return null;
  const [moved] = column.splice(from, 1);
  column.splice(to, 0, moved);
  return column;
}

/** The column's cards after moving `id` one step up or down, or null at an edge. */
export function moveColumn(rows: ApplicationRow[], id: string, direction: "up" | "down") {
  const row = rows.find((entry) => entry.id === id);
  if (!row) return null;
  const column = orderedColumn(rows, row.status);
  const index = column.findIndex((entry) => entry.id === id);
  const target = direction === "up" ? index - 1 : index + 1;
  if (index < 0 || target < 0 || target >= column.length) return null;
  [column[index], column[target]] = [column[target], column[index]];
  return column;
}
