import { AiProvider } from "@/generated/prisma/enums";

/** The three provider cards in Settings → AI provider (SET-1), as in the prototype's `PROVIDERS`. */
export const PROVIDER_OPTIONS: readonly {
  value: AiProvider;
  name: string;
  description: string;
  tag: string;
  /** Filled in when the card is picked; empty means "type your server's address". */
  defaultUrl: string;
  urlPlaceholder: string;
  defaultModel: string;
  needsKey: boolean;
}[] = [
  {
    value: AiProvider.LOCAL,
    name: "Local model",
    description: "Runs on your own hardware through Ollama or llama.cpp.",
    tag: "Private · free · slower",
    defaultUrl: "http://localhost:11434",
    urlPlaceholder: "http://localhost:11434",
    defaultModel: "",
    needsKey: false,
  },
  {
    value: AiProvider.OPENAI,
    name: "OpenAI-compatible",
    description: "Any server that speaks the OpenAI API, hosted or on your network.",
    tag: "Bring your own endpoint",
    defaultUrl: "",
    urlPlaceholder: "https://api.openai.com/v1",
    defaultModel: "",
    needsKey: true,
  },
  {
    value: AiProvider.ANTHROPIC,
    name: "Anthropic",
    description: "Claude models through your own API key.",
    tag: "Hosted · pay per use",
    defaultUrl: "https://api.anthropic.com",
    urlPlaceholder: "https://api.anthropic.com",
    defaultModel: "claude-sonnet-5",
    needsKey: true,
  },
];

export function providerOption(provider: AiProvider) {
  return PROVIDER_OPTIONS.find((option) => option.value === provider)!;
}

/** What people see when a saved key can't be decrypted, e.g. after DOSSIER_SECRET changed. */
export const API_KEY_UNREADABLE = "Your saved API key can't be read. Please enter it again.";

/** What Settings may know about the API key: never the key itself. */
export type KeyState = "none" | "set" | "unreadable" | "env";

/** What the AI provider section starts from. */
export type AiSettingsView = {
  provider: AiProvider;
  baseUrl: string;
  model: string;
  keyState: KeyState;
};
