import "server-only";

import type { AiProvider } from "@/generated/prisma/enums";
import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import type { SettingsData } from "@/lib/settings";
import { loadSettings, saveSettings } from "@/lib/settings-data";

import { applyApiKeyChange, type ApiKeyChange } from "./api-key";
import { keyStateOf, PROVIDER_DEFAULTS, resolveAiConfig } from "./config";
import { sameAiServer, type KeyState } from "./provider-options";

type Connection = SettingsData["aiConnections"][number];
type Address = { provider: AiProvider; baseUrl: string };

function matches(left: Address, right: Address): boolean {
  return left.provider === right.provider && sameAiServer(left.baseUrl, right.baseUrl);
}

function active(saved: SettingsData): Connection {
  const config = resolveAiConfig(saved, env);
  return { provider: config.provider, baseUrl: config.baseUrl, model: config.model ?? "", apiKeyEnc: saved.apiKeyEnc };
}

/** The active fields remain authoritative for existing installs and imported settings. */
export function rememberedAiConnection(saved: SettingsData, address: Address): Connection | undefined {
  const current = active(saved);
  return matches(current, address) ? current : saved.aiConnections.find((entry) => matches(entry, address));
}

function remember(entries: Connection[], entry: Connection): Connection[] {
  // Half-typed URLs must not archive a credential under an invalid server.
  if (!URL.canParse(entry.baseUrl)) return entries;
  return [...entries.filter((value) => !matches(value, entry)), entry];
}

/** Store the previous connection before activating another; keys never cross server origins. */
export async function saveAiConnection(fields: Address & { model: string }, keyChange?: ApiKeyChange): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const saved = await loadSettings(tx);
    const current = active(saved);
    const target = { ...fields, baseUrl: fields.baseUrl || PROVIDER_DEFAULTS[fields.provider].baseUrl };
    const previous = rememberedAiConnection(saved, target);
    const apiKeyEnc = keyChange ? applyApiKeyChange(previous?.apiKeyEnc ?? null, keyChange) : previous?.apiKeyEnc ?? null;
    const prior = saved.provider || env.DOSSIER_AI_PROVIDER ? remember(saved.aiConnections, current) : saved.aiConnections;
    const entries = remember(prior, { ...target, apiKeyEnc });
    await saveSettings({ ...fields, baseUrl: fields.baseUrl || null, model: fields.model || null, apiKeyEnc, aiConnections: entries }, tx);
  });
}

/** A late key-field blur updates its original server without changing the active provider. */
export async function saveAiConnectionKey(address: { provider: AiProvider; baseUrl?: string }, change: ApiKeyChange): Promise<KeyState> {
  return prisma.$transaction(async (tx) => {
    const saved = await loadSettings(tx);
    const current = active(saved);
    const baseUrl = address.baseUrl || (address.provider === current.provider ? current.baseUrl : PROVIDER_DEFAULTS[address.provider].baseUrl);
    const target = { provider: address.provider, baseUrl };
    const previous = rememberedAiConnection(saved, target);
    const connection: Connection = {
      ...target,
      model: previous?.model ?? PROVIDER_DEFAULTS[address.provider].model ?? "",
      apiKeyEnc: applyApiKeyChange(previous?.apiKeyEnc ?? null, change),
    };
    const activate = !saved.provider || matches(current, connection);
    await saveSettings({
      aiConnections: remember(saved.provider || env.DOSSIER_AI_PROVIDER ? remember(saved.aiConnections, current) : saved.aiConnections, connection),
      ...(activate ? { provider: connection.provider, baseUrl: connection.baseUrl, model: connection.model || null, apiKeyEnc: connection.apiKeyEnc } : {}),
    }, tx);
    return keyStateOf(connection, resolveAiConfig(connection, env));
  });
}
