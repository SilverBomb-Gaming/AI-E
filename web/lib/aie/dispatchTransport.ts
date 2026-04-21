import {
  createDispatchEnvelope,
  deserializeDispatchEnvelope,
  serializeDispatchEnvelope,
  type DispatchEnvelope,
} from "./dispatchProtocol";
import {
  createTaskDispatchAck,
  createTaskDispatchError,
  createTaskDispatchResult,
  validateDispatchEnvelopePayload,
  type TaskDispatchAckPayload,
  type TaskDispatchErrorPayload,
  type TaskDispatchRequestPayload,
  type TaskDispatchResultPayload,
} from "./dispatchMessages";

export type SimulatedDispatchRoundTrip = {
  request: DispatchEnvelope<TaskDispatchRequestPayload>;
  ack: DispatchEnvelope<TaskDispatchAckPayload>;
  result?: DispatchEnvelope<TaskDispatchResultPayload>;
  error?: DispatchEnvelope<TaskDispatchErrorPayload>;
};

export async function sendDispatchMessage<TPayload>(envelope: DispatchEnvelope<TPayload>): Promise<string> {
  if (!validateDispatchEnvelopePayload(envelope as DispatchEnvelope)) {
    throw new Error("The dispatch message payload is invalid for the declared message type.");
  }

  return serializeDispatchEnvelope(envelope);
}

export async function receiveDispatchMessage(raw: string): Promise<DispatchEnvelope | null> {
  const envelope = deserializeDispatchEnvelope(raw);
  if (!envelope || !validateDispatchEnvelopePayload(envelope)) {
    return null;
  }

  return envelope;
}

export function simulateLocalDispatchRoundTrip(params: {
  request: DispatchEnvelope<TaskDispatchRequestPayload>;
  accepted?: boolean;
  ackReason?: string;
  resultPayload?: TaskDispatchResultPayload;
  errorPayload?: TaskDispatchErrorPayload;
}): SimulatedDispatchRoundTrip {
  if (!validateDispatchEnvelopePayload(params.request)) {
    throw new Error("Cannot simulate a dispatch round trip for an invalid request payload.");
  }

  const accepted = params.accepted ?? !params.errorPayload;
  const ack = createDispatchEnvelope({
    messageType: "task-dispatch-ack",
    sourceNodeId: params.request.targetNodeId,
    targetNodeId: params.request.sourceNodeId,
    taskId: params.request.taskId,
    sessionId: params.request.sessionId,
    payload: createTaskDispatchAck({
      accepted,
      reason: params.ackReason,
    }),
  });

  if (params.errorPayload) {
    return {
      request: params.request,
      ack,
      error: createDispatchEnvelope({
        messageType: "task-dispatch-error",
        sourceNodeId: params.request.targetNodeId,
        targetNodeId: params.request.sourceNodeId,
        taskId: params.request.taskId,
        sessionId: params.request.sessionId,
        payload: createTaskDispatchError(params.errorPayload),
      }),
    };
  }

  return {
    request: params.request,
    ack,
    result: params.resultPayload
      ? createDispatchEnvelope({
          messageType: "task-dispatch-result",
          sourceNodeId: params.request.targetNodeId,
          targetNodeId: params.request.sourceNodeId,
          taskId: params.request.taskId,
          sessionId: params.request.sessionId,
          payload: createTaskDispatchResult(params.resultPayload),
        })
      : undefined,
  };
}
