import "server-only";

import { FIT_LEVELS } from "@/lib/themes";

import { countPdfPages, printBasePath } from "./pages";
import { renderPdf } from "./render";

/** PDF measurement chooses the same compact formatting for both export formats, not Word's page count. */
export async function renderBaseResumePdf(fitToPage: boolean, profileId?: string): Promise<{ pdf: Uint8Array; fit: number }> {
  let fit = 0;
  let pdf = await renderPdf(profileId ? printBasePath(0, profileId) : printBasePath());
  while (fitToPage && fit < FIT_LEVELS && countPdfPages(pdf) > 1) {
    fit += 1;
    pdf = await renderPdf(profileId ? printBasePath(fit, profileId) : printBasePath(fit));
  }
  return { pdf, fit };
}
