import { createContinuousRuntimeProofSeedPayload } from "./continuousRuntimeProofSeed";

const seeded = createContinuousRuntimeProofSeedPayload(process.env.AIE_OPERATOR_PROOF_RUNTIME_ID);

process.stdout.write(JSON.stringify({
  runtimeId: seeded.runtimeId,
  store: {
    records: seeded.store.records,
    stale_after_ms: seeded.store.stale_after_ms,
  },
}));