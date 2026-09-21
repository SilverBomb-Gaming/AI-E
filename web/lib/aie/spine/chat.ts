import { defaultReasoningModel, isLlmConfigured, resolveChatMode } from "./mode";
import { SUGGESTED_PROMPTS } from "./prompts";
import { makeToolCallRecord, looksLikePlanRequest, PLAN_BOUNDED_REQUEST_SCHEMA } from "./tools";
import type { BoundedPlan, ChatMessage, ChatResponse, ToolCallRecord } from "./types";

const MAX_MESSAGE_LENGTH = 4000;
const MAX_HISTORY = 12;

function trimHistory(messages: ChatMessage[]): ChatMessage[] {
  return messages.slice(-MAX_HISTORY).map((message) => ({
    role: message.role,
    content: message.content.slice(0, MAX_MESSAGE_LENGTH),
  }));
}

function formatPlanReply(plan: BoundedPlan, mode: ChatResponse["mode"]): string {
  const missing =
    plan.intent.missingInputs.length > 0 ? ` Missing inputs: ${plan.intent.missingInputs.join(", ")}.` : "";
  const modeLine =
    mode === "demo"
      ? "Demo mode used the local planner tool — no private LLM key."
      : "A live model called the same local planner tool.";

  return [
    plan.summary,
    `Status ${plan.status}. Engine ${plan.intent.engineTarget ?? "unspecified"}. Executed engine work: no.${missing}`,
    modeLine,
  ].join("\n");
}

function helpReply(mode: ChatResponse["mode"]): string {
  return [
    "This is the public AI-E spine: a chat UI plus one real agent tool.",
    "The tool is `plan_bounded_request`. It turns a game-dev request into a bounded, review-gated plan.",
    "It does not launch Unity, edit scenes, or apply patches. That local operator stack is separate.",
    "",
    "Try a prompt like:",
    `- ${SUGGESTED_PROMPTS[0]}`,
    `- ${SUGGESTED_PROMPTS[1]} (honest unsupported-target result)`,
    `- ${SUGGESTED_PROMPTS[2]} (honest blocked result)`,
    "",
    mode === "demo"
      ? "No OPENAI_API_KEY is configured, so replies stay on the local planner path."
      : "An LLM is configured and may call the same planner tool.",
  ].join("\n");
}

export function runDemoChat(messages: ChatMessage[]): ChatResponse {
  const mode = "demo" as const;
  const history = trimHistory(messages);
  const lastUser = [...history].reverse().find((message) => message.role === "user");
  const content = lastUser?.content.trim() ?? "";

  if (!content) {
    return { mode, reply: "Send a request and the planner will run on it.", toolCalls: [] };
  }

  if (looksLikePlanRequest(content)) {
    const toolCall = makeToolCallRecord(content);
    return {
      mode,
      reply: formatPlanReply(toolCall.result, mode),
      toolCalls: [toolCall],
    };
  }

  return { mode, reply: helpReply(mode), toolCalls: [] };
}

type OpenAIToolCall = {
  id?: string;
  function?: {
    name?: string;
    arguments?: string;
  };
};

type OpenAIMessage = {
  role?: string;
  content?: string | null;
  tool_calls?: OpenAIToolCall[];
};

async function runLiveChat(messages: ChatMessage[]): Promise<ChatResponse> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    return runDemoChat(messages);
  }

  const history = trimHistory(messages);
  const model = defaultReasoningModel();
  const openAiMessages: Array<Record<string, unknown>> = [
    {
      role: "system",
      content: [
        "You are the public AI-E spine, a constraint-aware planner for game-development requests.",
        "When the user wants to make, add, build, plan, or change something, call plan_bounded_request.",
        "Never claim you edited Unity, Godot, or Unreal. Never invent unsupported adapters.",
        "After the tool returns, explain the plan in plain language and keep the honesty of the tool result.",
        "If the user is just saying hello, explain the demo and suggest a planning prompt.",
      ].join(" "),
    },
    ...history.map((message) => ({ role: message.role, content: message.content })),
  ];

  const toolCalls: ToolCallRecord[] = [];

  for (let turn = 0; turn < 2; turn += 1) {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        tools: [PLAN_BOUNDED_REQUEST_SCHEMA],
        messages: openAiMessages,
      }),
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error(`OpenAI chat failed with status ${response.status}`);
    }

    const payload = (await response.json()) as {
      choices?: Array<{ message?: OpenAIMessage }>;
    };
    const message = payload.choices?.[0]?.message;
    if (!message) {
      throw new Error("OpenAI returned an empty chat message.");
    }

    const called = message.tool_calls ?? [];
    if (called.length === 0) {
      const reply = (message.content ?? "").trim();
      return {
        mode: "live",
        reply: reply || helpReply("live"),
        toolCalls,
      };
    }

    openAiMessages.push({
      role: "assistant",
      content: message.content ?? "",
      tool_calls: called,
    });

    for (const call of called) {
      const name = call.function?.name;
      let request = history.filter((item) => item.role === "user").slice(-1)[0]?.content ?? "";
      try {
        const parsed = JSON.parse(call.function?.arguments || "{}") as { request?: unknown };
        if (typeof parsed.request === "string" && parsed.request.trim()) {
          request = parsed.request;
        }
      } catch {
        // Keep the latest user message if the model emitted malformed arguments.
      }

      if (name !== "plan_bounded_request") {
        continue;
      }

      const record = makeToolCallRecord(request, call.id);
      toolCalls.push(record);
      openAiMessages.push({
        role: "tool",
        tool_call_id: call.id,
        content: JSON.stringify(record.result),
      });
    }
  }

  if (toolCalls.length > 0) {
    return {
      mode: "live",
      reply: formatPlanReply(toolCalls[toolCalls.length - 1].result, "live"),
      toolCalls,
    };
  }

  return runDemoChat(messages);
}

export async function runSpineChat(messages: ChatMessage[]): Promise<ChatResponse> {
  const mode = resolveChatMode();
  if (mode === "demo" || !isLlmConfigured()) {
    return runDemoChat(messages);
  }

  try {
    return await runLiveChat(messages);
  } catch (error) {
    console.error("[aie/spine] live chat failed; using demo planner", error);
    const fallback = runDemoChat(messages);
    return {
      ...fallback,
      reply: `${fallback.reply}\n\nLive LLM failed, so this reply used the local demo planner instead.`,
    };
  }
}
