"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { action, ActionError } from "@/lib/action";
import { cancelJob, findUnfinishedJobs } from "@/lib/jobs/runner";
import { prisma } from "@/lib/prisma";

// Archiving and deleting an application (E9-5, LST-8), from its page, a
// card or a table row.

const GONE = "That application no longer exists.";

// The list, the dashboard and the application all show it.
const refreshEverything = () => revalidatePath("/", "layout");

/**
 * Archives an application, or brings it back. Archived ones leave the board
 * but still count on the dashboard. Tidying up isn't news, so "Updated"
 * stays as it was.
 */
export const setArchived = action(z.object({ id: z.string().min(1), archived: z.boolean() }), async ({ id, archived }) => {
  const current = await prisma.application.findUnique({ where: { id }, select: { updatedAt: true } });
  if (!current) throw new ActionError(GONE);
  await prisma.application.update({
    where: { id },
    data: { archivedAt: archived ? new Date() : null, updatedAt: current.updatedAt },
  });
  refreshEverything();
  return null;
});

/**
 * Deletes an application with its documents, chat, notes and status
 * history (the database cascades), and its background jobs, whose inputs
 * and results hold the posting and the documents too.
 */
export const deleteApplication = action(z.object({ id: z.string().min(1) }), async ({ id }) => {
  const keys = [`application:${id}`, `units:${id}`, `refine:${id}`];
  for (const key of keys) {
    for (const job of await findUnfinishedJobs(key)) await cancelJob(job.id);
  }
  const deleted = await prisma.$transaction(async (tx) => {
    const application = await tx.application.findUnique({ where: { id }, select: { id: true } });
    if (!application) return false;
    await tx.job.deleteMany({ where: { key: { in: keys } } });
    await tx.application.delete({ where: { id } });
    return true;
  });
  if (!deleted) throw new ActionError(GONE);
  refreshEverything();
  return null;
});
