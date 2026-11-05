#!/usr/bin/env node
/**
 * Host bridge so Dossier in Docker can use the Claude Code CLI on this computer.
 *
 *   node scripts/claude-cli-bridge.mjs
 *
 * Then in Settings → AI provider pick Claude CLI (default address
 * http://host.docker.internal:3460). Without Docker, leave the address empty
 * or set it to the `claude` binary path and Dossier will spawn CLI itself.
 */

import { spawn } from "node:child_process";
import { createServer } from "node:http";

const PORT = Number(process.env.CLAUDE_CLI_BRIDGE_PORT || 3460);
const HOST = process.env.CLAUDE_CLI_BRIDGE_HOST || "127.0.0.1";
const BINARY = process.env.CLAUDE_CLI_BINARY || "claude";
const MODELS = [
  "sonnet",
  "opus",
  "haiku",
  "claude-sonnet-5",
  "claude-opus-5-5",
  "claude-haiku-4-5",
  "claude-fable-5-1",
];

function formatPrompt(messages) {
  return (messages ?? [])
    .map((message) => `${message.role === "assistant" ? "Assistant" : "User"}: ${message.content}`)
    .join("\n\n");
}

function runClaude({ model, system, messages, jsonSchema }) {
  const args = [
    "-p",
    "--output-format",
    "json",
    "--tools",
    "",
    "--permission-mode",
    "bypassPermissions",
    "--model",
    model || "sonnet",
    "--system-prompt",
    system || "You are a helpful assistant.",
  ];
  if (jsonSchema) args.push("--json-schema", JSON.stringify(jsonSchema));
  args.push(formatPrompt(messages));

  return new Promise((resolve, reject) => {
    const child = spawn(BINARY, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0 && !stdout.trim()) {
        reject(new Error(stderr.trim() || `claude exited ${code}`));
        return;
      }
      resolve(stdout.trim());
    });
  });
}

function parseOutput(raw, expectStructured) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { text: raw.trim(), cutOff: false };
  }
  if (parsed.is_error === true) {
    throw new Error(typeof parsed.result === "string" ? parsed.result : parsed.subtype || "claude error");
  }
  if (expectStructured && parsed.structured_output !== undefined) {
    return { text: JSON.stringify(parsed.structured_output), cutOff: false };
  }
  if (typeof parsed.result === "string") {
    return { text: parsed.result, cutOff: parsed.stop_reason === "max_tokens" };
  }
  throw new Error(`Claude CLI returned no result text (${parsed.subtype || "unknown"})`);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function send(res, status, body) {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(json),
  });
  res.end(json);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${HOST}:${PORT}`);
  if (req.method === "GET" && (url.pathname === "/health" || url.pathname === "/")) {
    send(res, 200, { ok: true, binary: BINARY });
    return;
  }
  if (req.method === "GET" && url.pathname === "/models") {
    send(res, 200, { models: MODELS });
    return;
  }
  if (req.method === "POST" && url.pathname === "/complete") {
    try {
      const body = await readBody(req);
      const raw = await runClaude(body);
      send(res, 200, parseOutput(raw, Boolean(body.jsonSchema)));
    } catch (error) {
      send(res, 500, { error: error instanceof Error ? error.message : String(error) });
    }
    return;
  }
  send(res, 404, { error: "not found" });
});

server.listen(PORT, HOST, () => {
  console.log(`Claude CLI bridge on http://${HOST}:${PORT} (binary: ${BINARY})`);
  console.log("Point Dossier's Claude CLI provider at http://host.docker.internal:3460 (Docker) or http://127.0.0.1:3460.");
});
