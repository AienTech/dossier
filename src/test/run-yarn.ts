import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * Runs Yarn from the test and end-to-end setup. `execFileSync("yarn")` fails
 * on Windows: Corepack's `yarn` is `yarn.cmd`, which `execFile` does not
 * resolve, and `corepack enable` may not have installed that shim. Corepack's
 * own JavaScript entry runs under Node on every platform.
 */

export type YarnCommand = { command: string; args: string[] };

const COREPACK_JS = ["node_modules", "corepack", "dist", "corepack.js"];

/** Node and `corepack.js` quoted in the POSIX shim Yarn sets as `npm_execpath`. */
export function parseYarnShim(source: string): { node: string; script: string } | undefined {
  const quoted = [...source.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
  const node = quoted.find((entry) => /(?:^|[\\/])node(?:\.exe)?$/i.test(entry));
  const script = quoted.find((entry) => entry.replaceAll("\\", "/").endsWith("corepack/dist/corepack.js"));
  return node && script ? { node, script } : undefined;
}

function corepackBeside(nodePath: string | undefined): YarnCommand | undefined {
  if (!nodePath) return undefined;
  const script = path.join(path.dirname(nodePath), ...COREPACK_JS);
  if (!existsSync(script)) return undefined;
  return { command: nodePath, args: [script, "yarn"] };
}

/** How to invoke Yarn in `env`. Prefers Corepack beside the Node that launched us. */
export function yarnCommand(env: NodeJS.ProcessEnv = process.env): YarnCommand {
  const execpath = env.npm_execpath;
  if (typeof execpath === "string" && existsSync(execpath)) {
    const parsed = parseYarnShim(readFileSync(execpath, "utf8"));
    if (parsed && existsSync(parsed.node) && existsSync(parsed.script)) {
      return { command: parsed.node, args: [parsed.script, "yarn"] };
    }
  }

  const beside = corepackBeside(env.npm_node_execpath) ?? corepackBeside(process.execPath);
  if (beside) return beside;

  // Linux CI runs `corepack enable`, which puts a `yarn` binary on PATH.
  return { command: "yarn", args: [] };
}

function captured(value: unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof Uint8Array) return Buffer.from(value).toString("utf8");
  return "";
}

/** Hides connection strings; Prisma prints `DATABASE_URL` when a migration fails. */
function redact(text: string): string {
  return text.replace(/postgres(?:ql)?:\/\/\S+/gi, "postgresql://***");
}

/** Runs `yarn <args>` and throws, with the command's output, when it exits non-zero. */
export function runYarn(args: string[], env: NodeJS.ProcessEnv = process.env): void {
  const { command, args: prefix } = yarnCommand(env);
  try {
    execFileSync(command, [...prefix, ...args], { env, stdio: "pipe", windowsHide: true });
  } catch (error) {
    const stderr = error && typeof error === "object" && "stderr" in error ? captured(error.stderr) : "";
    const stdout = error && typeof error === "object" && "stdout" in error ? captured(error.stdout) : "";
    const detail = redact(`${stderr}\n${stdout}`).trim().slice(0, 4000);
    const failure = new Error(`yarn ${args.join(" ")} failed.${detail ? `\n${detail}` : ""}`);
    failure.cause = error;
    throw failure;
  }
}
