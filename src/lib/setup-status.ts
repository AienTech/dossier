export type SetupItem = {
  id: string; title: string; status: "ready" | "attention" | "optional" | "disabled";
  detail: string; href: string; required: boolean; verification?: "live" | "configuration";
};
export const setupSummary = (items: SetupItem[]) => ({
  ready: items.filter(item => item.status === "ready").length,
  attention: items.filter(item => item.status === "attention").length,
  requiredReady: items.filter(item => item.required && item.status === "ready").length,
  requiredTotal: items.filter(item => item.required).length,
});
