import type { Metadata } from "next";

import { ResumeDocument } from "@/components/documents/resume-document";
import { verifyPrintAccess } from "@/lib/pdf/print-access";
import { loadProfile } from "@/lib/profile-data";
import { loadSettings } from "@/lib/settings-data";
import { loadTheme } from "@/lib/theme-data";
import { BUILT_IN_THEMES, printCss } from "@/lib/themes";

export const metadata: Metadata = { title: "Base resume", robots: { index: false } };

/** The base resume on its own, for the PDF renderer (E5-5) to print. */
export default async function PrintBaseResumePage(props: { searchParams?: Promise<{ fit?: string }> }) {
  const searchParams = props.searchParams ? await props.searchParams : undefined;
  const fit = searchParams?.fit === "1";
  await verifyPrintAccess(fit ? "/print/base?fit=1" : "/print/base");
  const [profile, settings] = await Promise.all([loadProfile(), loadSettings()]);
  const theme = (await loadTheme(settings.baseThemeId)) ?? BUILT_IN_THEMES[0];

  return (
    <>
      <style>{printCss(theme, settings.paper)}</style>
      <ResumeDocument
        theme={theme}
        profile={profile}
        paper={settings.paper}
        includeReferences={settings.includeRefs}
        language={settings.resumeLanguage}
      />
      {fit && <script dangerouslySetInnerHTML={{ __html: fitScript }} />}
    </>
  );
}

const fitScript = `(() => {
  const el = document.querySelector("article");
  if (!el) return;
  const pageH = 905;
  const checkFit = (py) => {
    const availPx = (pageH - 2 * py) * 0.328125 * (96 / 25.4);
    return el.scrollHeight <= availPx + 2;
  };
  const curPy = parseFloat(el.style.getPropertyValue("--pad-y")) || 50;
  const curPx = parseFloat(el.style.getPropertyValue("--pad-x")) || 54;
  const curGap = parseFloat(el.style.getPropertyValue("--gap")) || 20;
  const curItemGap = parseFloat(el.style.getPropertyValue("--item-gap")) || 10;
  const curFont = parseFloat(el.style.getPropertyValue("--font-size")) || 10.5;
  const curLh = parseFloat(el.style.getPropertyValue("--line-height")) || 1.5;

  let bestPy = curPy;
  let bestPx = curPx;

  if (!checkFit(curPy)) {
    for (let s = 1; s <= 12; s++) {
      bestPy = Math.max(26, curPy - s * 1.5);
      bestPx = Math.max(30, curPx - s * 1.2);
      const gap = Math.max(8, curGap - s * 0.7);
      const itemGap = Math.max(4, curItemGap - s * 0.4);
      const lh = Math.max(1.36, curLh - s * 0.015);

      el.style.setProperty("--pad-y", bestPy.toFixed(1));
      el.style.setProperty("--pad-x", bestPx.toFixed(1));
      el.style.setProperty("--gap", gap.toFixed(1));
      el.style.setProperty("--item-gap", itemGap.toFixed(1));
      el.style.setProperty("--line-height", lh.toFixed(2));

      if (checkFit(bestPy)) break;
    }

    if (!checkFit(bestPy)) {
      for (let s = 1; s <= 30; s++) {
        const font = Math.max(9.15, curFont - s * 0.05);
        const lh = Math.max(1.34, curLh - 0.12 - s * 0.005);
        el.style.setProperty("--font-size", font.toFixed(2));
        el.style.setProperty("--line-height", lh.toFixed(2));
        if (checkFit(bestPy)) break;
      }
    }
  }

  const st = Array.from(document.querySelectorAll("style")).find((s) => s.innerText.includes("@page"));
  if (st) {
    const marginY = (bestPy * 0.328125).toFixed(3);
    const marginX = (bestPx * 0.328125).toFixed(3);
    st.innerText = "@page { size: 210mm 297mm; margin: " + marginY + "mm " + marginX + "mm; }\\n:root { --u: 0.328125mm; }\\nhtml, body { background: #fff; }\\n@media print { nextjs-portal { display: none; } }";
  }
})();`;
