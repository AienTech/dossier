"use server";
import { z } from "zod";
import { action } from "@/lib/action";
import { ensureDriveSync, readDriveSync } from "./drive-sync";
export const startDriveAutoSync = action(z.object({ id: z.string().min(1), retry: z.boolean().optional() }), ({ id, retry }) => ensureDriveSync(id, retry));
export const getDriveAutoSync = action(z.object({ id: z.string().min(1) }), ({ id }) => readDriveSync(id));
