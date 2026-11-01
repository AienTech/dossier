"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { ApplicationStatus } from "@/generated/prisma/enums";
import { action } from "@/lib/action";
import { FILTERS, SORT_KEYS, VIEWS } from "@/lib/applications-list";
import { prisma } from "@/lib/prisma";
import { saveSettings } from "@/lib/settings-data";

/** Remembers how the Applications screen was left (LST-7), for the next visit. */
export const rememberListView = action(
  z.object({
    view: z.enum(VIEWS),
    filter: z.enum(FILTERS.map((filter) => filter.value)),
    sort: z.object({ key: z.enum(SORT_KEYS), reversed: z.boolean() }),
  }),
  async ({ view, filter, sort }) => {
    await saveSettings({
      applicationsView: view,
      applicationsFilter: filter,
      applicationsSort: `${sort.reversed ? "-" : ""}${sort.key}`,
    });
    return null;
  },
);

/**
 * Writes a board column's new order (#60): the position is the card's
 * index in the order the client shows, so reordering is one write per
 * card and nothing else in the row changes.
 */
export const reorderBoard = action(
  z.object({
    status: z.enum(ApplicationStatus),
    ids: z.array(z.string().min(1)).min(1),
  }),
  async ({ status, ids }) => {
    const ordered = [...new Set(ids)];
    await prisma.$transaction(
      ordered.map((id, index) => prisma.application.updateMany({ where: { id, status }, data: { boardSort: index } })),
    );
    revalidatePath("/", "layout");
    return null;
  },
);
