import { buildCacheKey, readCache, writeCache } from "./modelCache";

const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
const DEFAULT_REASONING_PROVIDER = "openai";
const DEFAULT_REASONING_MODEL = "gpt-4o-mini";
const DEFAULT_LIGHT_PROVIDER = "local-openai";
const DEFAULT_LIGHT_MODEL = "qwen2.5:7b-instruct";
const DEFAULT_REWRITE_PROVIDER = "openai";
const DEFAULT_REWRITE_MODEL = "gpt-4.1-nano";
const DEFAULT_LOCAL_OPENAI_BASE_URL = "http://127.0.0.1:11434/v1";
const DEFAULT_OLLAMA_BASE_URL = "http://127.0.0.1:11434";
const DEFAULT_REASONING_CACHE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_REWRITE_CACHE_TTL_MS = 10 * 60 * 1000;
const DEFAULT_LIGHT_CACHE_TTL_MS = 3 * 60 * 1000;

export type RouterMode = "standard" | "light";
export type RouterTask = "reasoning" | "rewrite";
type RouterProvider = "openai" | "local-openai" | "ollama";

type JsonSchema = {
  name?: string;
  schema: Record<string, unknown>;
};

type CompletionRequest = {
  task: RouterTask;
  mode?: RouterMode;
  system: string;
  user: string;
  temperature?: number;
  jsonSchema?: JsonSchema;
};

type CompletionResult = {
  content: string;
  provider: RouterProvider;
  model: string;
  mode: RouterMode;
  cacheHit: boolean;
};

type RoutingTarget = {
  provider: RouterProvider;
  model: string;
  ttlMs: number;
};

function normalizeLocalText(payload: unknown): string | null {
  if (typeof payload === "string") {
    return payload.trim() || null;
  }

  if (!payload || typeof payload !== "object") {
    return null;
  }

  const source = payload as Record<string, unknown>;
  const candidates = [source.response, source.text, source.output, source.generated_text, source.completion];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }

  return null;
}

function getEnvNumber(rawValue: string | undefined, fallback: number): number {
  const parsed = Number(rawValue);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

export function inferRouterMode(context: string | null | undefined): RouterMode {
  const normalized = String(context ?? "").toLowerCase();
  return normalized.includes("ai-e routing hint: light") ? "light" : "standard";
}

function getRoutingTarget(task: RouterTask, mode: RouterMode): RoutingTarget {
  if (task === "rewrite") {
    return {
      provider: (process.env.AIE_REWRITE_PROVIDER ?? process.env.AIE_REASONING_PROVIDER ?? DEFAULT_REWRITE_PROVIDER) as RouterProvider,
      model: process.env.AIE_REWRITE_MODEL || DEFAULT_REWRITE_MODEL,
      ttlMs: getEnvNumber(process.env.AIE_REWRITE_CACHE_TTL_MS, DEFAULT_REWRITE_CACHE_TTL_MS),
    };
  }

  if (mode === "light") {
    return {
      provider: (process.env.AIE_LIGHT_PROVIDER ?? DEFAULT_LIGHT_PROVIDER) as RouterProvider,
      model: process.env.AIE_LIGHT_MODEL || DEFAULT_LIGHT_MODEL,
      ttlMs: getEnvNumber(process.env.AIE_LIGHT_CACHE_TTL_MS, DEFAULT_LIGHT_CACHE_TTL_MS),
    };
  }

  return {
    provider: (process.env.AIE_REASONING_PROVIDER ?? DEFAULT_REASONING_PROVIDER) as RouterProvider,
    model: process.env.AIE_REASONING_MODEL || DEFAULT_REASONING_MODEL,
    ttlMs: getEnvNumber(process.env.AIE_REASONING_CACHE_TTL_MS, DEFAULT_REASONING_CACHE_TTL_MS),
  };
}

function buildResponseFormat(jsonSchema: JsonSchema | undefined) {
  if (!jsonSchema) {
    return undefined;
  }

  return {
    type: "json_schema" as const,
    json_schema: {
      name: jsonSchema.name || "aie_completion",
      schema: jsonSchema.schema,
    },
  };
}

async function callChatCompletions(params: CompletionRequest & { baseUrl: string; apiKey?: string; model: string }): Promise<string> {
  const response = await fetch(`${params.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      ...(params.apiKey ? { Authorization: `Bearer ${params.apiKey}` } : {}),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: params.model,
      temperature: params.temperature,
      ...(params.jsonSchema ? { response_format: buildResponseFormat(params.jsonSchema) } : {}),
      messages: [
        {
          role: "system",
          content: params.system,
        },
        {
          role: "user",
          content: params.user,
        },
      ],
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    const bodyText = await response.text();
    throw new Error(`Chat completions request failed with status ${response.status}: ${bodyText.slice(0, 400)}`);
  }

  const payload = (await response.json()) as {
    choices?: Array<{
      message?: {
        content?: string;
      };
    }>;
  };

  const content = payload.choices?.[0]?.message?.content?.trim();
  if (!content) {
    throw new Error("Chat completions provider returned an empty response.");
  }

  return content;
}

async function callOllama(params: CompletionRequest & { model: string }): Promise<string> {
  const response = await fetch(`${(process.env.OLLAMA_BASE_URL || DEFAULT_OLLAMA_BASE_URL).replace(/\/+$/, "")}/api/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: params.model,
      stream: false,
      ...(params.jsonSchema ? { format: params.jsonSchema.schema } : {}),
      options: {
        temperature: params.temperature,
      },
      messages: [
        {
          role: "system",
          content: params.system,
        },
        {
          role: "user",
          content: params.user,
        },
      ],
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    const bodyText = await response.text();
    throw new Error(`Ollama request failed with status ${response.status}: ${bodyText.slice(0, 400)}`);
  }

  const payload = (await response.json()) as unknown;
  const source = payload as { message?: { content?: unknown } } | null;
  const content = normalizeLocalText(source?.message?.content ?? payload);
  if (!content) {
    throw new Error("Ollama returned an empty response.");
  }

  return content;
}

async function executeProvider(request: CompletionRequest, target: RoutingTarget): Promise<string> {
  switch (target.provider) {
    case "openai": {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) {
        throw new Error("Missing OPENAI_API_KEY.");
      }

      return callChatCompletions({
        ...request,
        baseUrl: OPENAI_API_URL.replace(/\/chat\/completions$/, ""),
        apiKey,
        model: target.model,
      });
    }
    case "local-openai":
      return callChatCompletions({
        ...request,
        baseUrl: process.env.AIE_LOCAL_OPENAI_BASE_URL || DEFAULT_LOCAL_OPENAI_BASE_URL,
        model: target.model,
      });
    case "ollama":
      return callOllama({
        ...request,
        model: target.model,
      });
    default:
      throw new Error(`Unsupported model provider: ${target.provider}`);
  }
}

export async function completeJson(request: CompletionRequest): Promise<CompletionResult> {
  const mode = request.mode ?? inferRouterMode(`${request.system}\n${request.user}`);
  const inferredMode = inferRouterMode(`${request.system}\n${request.user}`);
  const finalMode = inferredMode === "light" ? inferredMode : mode;
  const target = getRoutingTarget(request.task, finalMode);
  const cacheKey = buildCacheKey([request.system, request.user, target.model, finalMode]);
  const cached = readCache(cacheKey);
  if (cached) {
    return {
      content: cached,
      provider: target.provider,
      model: target.model,
      mode: finalMode,
      cacheHit: true,
    };
  }

  const content = await executeProvider(request, target);
  writeCache(cacheKey, content, target.ttlMs);

  return {
    content,
    provider: target.provider,
    model: target.model,
    mode: finalMode,
    cacheHit: false,
  };
}
