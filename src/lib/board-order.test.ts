import { describe, expect, it } from "vitest";

import type { ApplicationRow } from "./applications-data";
import { boardOrder, moveColumn, orderedColumn, reorderColumn } from "./board-order";

const row = (id: string, extra: Partial<ApplicationRow> = {}): ApplicationRow => ({
  id,
  company: "Acme",
  role: "Engineer",
  location: "",
  mode: "",
  status: "SENT",
  archived: false,
  deadline: null,
  match: null,
  sent: null,
  updated: "Today",
  updatedAt: 100,
  boardSort: null,
  ...extra,
});

const rows = [
  row("old", { updatedAt: 300 }),
  row("mid", { updatedAt: 200 }),
  row("new", { updatedAt: 100 }),
];

describe("board order (#60)", () => {
  it("keeps newest-first when nothing was reordered", () => {
    expect(orderedColumn(rows, "SENT").map((entry) => entry.id)).toEqual(["old", "mid", "new"]);
  });

  it("puts positioned cards first, in position order, then the rest newest-first", () => {
    const mixed = [row("a", { updatedAt: 300, boardSort: 1 }), row("b", { updatedAt: 100, boardSort: 0 }), row("c", { updatedAt: 200 })];
    expect(orderedColumn(mixed, "SENT").map((entry) => entry.id)).toEqual(["b", "a", "c"]);
  });

  it("moves a card onto another card's place in the same column", () => {
    expect(reorderColumn(rows, "new", "old")!.map((entry) => entry.id)).toEqual(["new", "old", "mid"]);
  });

  it("refuses a reorder across columns", () => {
    expect(reorderColumn([...rows, row("other", { status: "DRAFT" })], "new", "other")).toBeNull();
  });

  it("moves a card one step up and down, and stops at the edges", () => {
    expect(moveColumn(rows, "mid", "up")!.map((entry) => entry.id)).toEqual(["mid", "old", "new"]);
    expect(moveColumn(rows, "mid", "down")!.map((entry) => entry.id)).toEqual(["old", "new", "mid"]);
    expect(moveColumn(rows, "old", "up")).toBeNull();
    expect(moveColumn(rows, "new", "down")).toBeNull();
  });

  it("sorts by boardSort, not updatedAt, once a column is ordered", () => {
    expect(boardOrder(row("a", { updatedAt: 1, boardSort: 1 }), row("b", { updatedAt: 999, boardSort: 0 }))).toBeGreaterThan(0);
  });
});
