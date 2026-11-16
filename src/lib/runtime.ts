/** Desktop/self-hosted installs keep their original single-process behavior. */
export function cloudRuntime(): boolean {
  return process.env.HIREME_RUNTIME === "web" || process.env.HIREME_RUNTIME === "worker";
}

export function webRuntime(): boolean {
  return process.env.HIREME_RUNTIME === "web";
}
