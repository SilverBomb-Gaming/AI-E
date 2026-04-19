import { getCachedModelResponse, setCachedModelResponse } from "./modelCache";

const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
const DEFAULT_REASONING_MODEL = "gpt-4o-mini";
const DEFAULT_LIGHT_MODEL = "gpt-4.1-nano";
const DEFAULT_LOCAL_ENDPOINT = "http://localhost:11434/api/generate";

export type ModelTaskType = "reasoning" | "formatting" | "rewrite" | "summarization" | "light_analysis";

type PromptEnvelope = {
  responseShape?: "analysis-json" | "text";
  systemPrompt?: string;
  userPrompt: string;
};

function parsePromptEnvelope(input: string): PromptEnvelope {
  try {
    const parsed = JSON.parse(input) as Partial<PromptEnvelope>;
    if (parsed && typeof parsed.userPrompt === "string") {
      return {
        responseShape: parsed.responseShape === "analysis-json" ? "analysis-json" : "text",
        systemPrompt: typeof parsed.systemPrompt === "string" ? parsed.systemPrompt : undefined,
        userPrompt: parsed.userPrompt,
      };
    }
  } catch {
    // Treat raw strings as a plain prompt.
  }

  return {
    responseShape: "text",
    userPrompt: input,
  };
}

function buildResponseFormat(responseShape: PromptEnvelope["responseShape"]) {
  if (responseShape !== "analysis-json") {
    return undefined;
  }

  return {
    type: "json_schema" as const,
    json_schema: {
      name: "unity_analysis",
      schema: {
        type: "object",
        additionalProperties: false,
        required: ["whatHappened", "whatMatters", "whatToDoNext"],
        properties: {
          whatHappened: {
            type: "string",
          },
          whatMatters: {
            type: "array",
            minItems: 3,
            maxItems: 5,
            items: {
              type: "string",
            },
          },
          whatToDoNext: {
            type: "array",
            minItems: 3,
            maxItems: 5,
            items: {
              type: "string",
            },
          },
        },
      },
    },
  };
}

async function callOpenAI(taskType: ModelTaskType, input: string, model: string): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("Missing OPENAI_API_KEY.");
  }

  const envelope = parsePromptEnvelope(input);
  const responseFormat = buildResponseFormat(envelope.responseShape);
  const response = await fetch(OPENAI_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: taskType === "reasoning" ? 0.2 : 0.1,
      ...(responseFormat ? { response_format: responseFormat } : {}),
      messages: [
        ...(envelope.systemPrompt
          ? [
              {
                role: "system" as const,
                content: envelope.systemPrompt,
              },
            ]
          : []),
        {
          role: "user" as const,
          content: envelope.userPrompt,
        },
      ],
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    const bodyText = await response.text();
    throw new Error(`OpenAI request failed with status ${response.status}: ${bodyText.slice(0, 400)}`);
  }

  const payload = (await response.json()) as {
    choices?: Array<{
      message?: {
        content?: string;
      };
    }>;
  };

  const content = payload.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("OpenAI returned an empty response.");
  }

  return content;
}

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

async function callLocalEndpoint(input: string): Promise<string> {
  const endpoint = process.env.AIE_LOCAL_ENDPOINT || DEFAULT_LOCAL_ENDPOINT;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      prompt: parsePromptEnvelope(input).userPrompt,
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    const bodyText = await response.text();
    throw new Error(`Local model request failed with status ${response.status}: ${bodyText.slice(0, 400)}`);
  }

  const payload = (await response.json()) as unknown;
  const content = normalizeLocalText(payload);
  if (!content) {
    throw new Error("Local model returned an empty response.");
  }

  return content;
}

export async function routeModel(taskType: ModelTaskType, input: string): Promise<string> {
  const cachedResponse = getCachedModelResponse(taskType, input);
  if (cachedResponse) {
    console.log("[aie/model-router] cache hit", { taskType });
    return cachedResponse;
  }

  const reasoningProvider = process.env.AIE_MODEL_REASONING || "openai";
  const lightProvider = process.env.AIE_MODEL_LIGHT || "openai";
  const reasoningModel = process.env.AIE_OPENAI_REASONING_MODEL || DEFAULT_REASONING_MODEL;
  const lightModel = process.env.AIE_OPENAI_LIGHT_MODEL || DEFAULT_LIGHT_MODEL;

  let output: string;
  if (taskType === "reasoning") {
    console.log("[aie/model-router] routing reasoning task", {
      provider: reasoningProvider,
      model: reasoningModel,
    });
    output = await callOpenAI(taskType, input, reasoningModel);
  } else if (lightProvider === "local") {
    console.log("[aie/model-router] routing light task to local endpoint", {
      taskType,
      endpoint: process.env.AIE_LOCAL_ENDPOINT || DEFAULT_LOCAL_ENDPOINT,
    });

    try {
      output = await callLocalEndpoint(input);
    } catch (error) {
      console.warn("[aie/model-router] local light task failed; falling back to OpenAI", {
        taskType,
        error: error instanceof Error ? error.message : String(error),
      });
      output = await callOpenAI(taskType, input, lightModel);
    }
  } else {
    console.log("[aie/model-router] routing light task", {
      taskType,
      provider: "openai",
      model: lightModel,
    });
    output = await callOpenAI(taskType, input, lightModel);
  }

  setCachedModelResponse(taskType, input, output);
  return output;
}
