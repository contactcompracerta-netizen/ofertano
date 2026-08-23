import { EditorialError } from "./errors";
import { extrairJsonDesconhecido } from "./json";
import {
  montarPromptDoUsuario,
  PROMPT_SISTEMA_EDITORIAL,
} from "./prompts";
import type {
  EditorialProviderKind,
  NormalizedEditorialInput,
} from "./types";

export type EditorialAiProvider = {
  kind: EditorialProviderKind;
  gerar(input: NormalizedEditorialInput): Promise<unknown>;
};

type OpenAiCompatibleConfig = {
  apiKey: string;
  model?: string;
  baseUrl?: string;
};

type ChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string | null;
    };
  }>;
  error?: {
    message?: string;
  };
};

export function criarProviderOpenAiCompativel(
  config: OpenAiCompatibleConfig,
): EditorialAiProvider {
  const apiKey = config.apiKey.trim();
  const model =
    config.model?.trim() || "gpt-4o-mini";
  const baseUrl = (
    config.baseUrl?.trim() || "https://api.openai.com/v1"
  ).replace(/\/+$/, "");

  return {
    kind: "ai",
    async gerar(input) {
      let response: Response;

      try {
        response = await fetch(
          `${baseUrl}/chat/completions`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
              model,
              temperature: 0.4,
              response_format: {
                type: "json_object",
              },
              messages: [
                {
                  role: "system",
                  content: PROMPT_SISTEMA_EDITORIAL,
                },
                {
                  role: "user",
                  content: montarPromptDoUsuario(input),
                },
              ],
            }),
          },
        );
      } catch {
        throw new EditorialError(
          "PROVIDER_UNAVAILABLE",
          "Não foi possível conectar ao provider de IA editorial.",
        );
      }

      const payload =
        (await response
          .json()
          .catch(() => null)) as ChatCompletionResponse | null;

      if (!response.ok) {
        throw new EditorialError(
          "PROVIDER_UNAVAILABLE",
          payload?.error?.message?.trim() ||
            "O provider de IA recusou a geração editorial.",
        );
      }

      const content = payload?.choices?.[0]?.message?.content;

      if (typeof content !== "string" || !content.trim()) {
        throw new EditorialError(
          "INVALID_JSON",
          "O provider de IA não devolveu um JSON editorial.",
        );
      }

      return extrairJsonDesconhecido(content);
    },
  };
}

export function resolverProviderPadrao(options?: {
  deterministicProvider: EditorialAiProvider;
}): EditorialAiProvider {
  const apiKey =
    process.env.EDITORIAL_AI_API_KEY?.trim() ||
    process.env.OPENAI_API_KEY?.trim();

  if (!apiKey) {
    return options!.deterministicProvider;
  }

  return criarProviderOpenAiCompativel({
    apiKey,
    model: process.env.EDITORIAL_AI_MODEL?.trim(),
    baseUrl: process.env.EDITORIAL_AI_BASE_URL?.trim(),
  });
}
