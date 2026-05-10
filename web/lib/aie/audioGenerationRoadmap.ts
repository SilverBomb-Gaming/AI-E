export type AudioGenerationStatus = "NOT_YET_IMPLEMENTED";

export type SoundtrackIntentSchema = {
  mood: "ambient" | "cinematic" | "anime-vocal-theme";
  tempoHint: "slow" | "medium" | "fast";
  intensityCurve: "soft-build" | "steady" | "rise-and-resolve";
  syncTargets: Array<"character-pose" | "camera-motion" | "gif-loop" | "scene-transition">;
};

export type AudioGenerationRoadmap = {
  status: AudioGenerationStatus;
  fakeAudioGenerationAllowed: false;
  governedArchitecturePlan: string[];
  soundtrackIntentSchema: SoundtrackIntentSchema;
  voiceDialogueFutureRouting: string[];
  ambienceCategories: string[];
  cinematicSyncPlanning: string[];
  audioReviewPipelinePlanning: string[];
  plannedCapabilities: string[];
};

export function buildAudioGenerationRoadmap(): AudioGenerationRoadmap {
  return {
    status: "NOT_YET_IMPLEMENTED",
    fakeAudioGenerationAllowed: false,
    governedArchitecturePlan: [
      "Keep audio generation behind explicit operator approval.",
      "Bind audio outputs to the same sandbox review package as PNG/GIF artifacts.",
      "Record prompt, timing, model/provider, and review metadata before exposing generated audio.",
    ],
    soundtrackIntentSchema: {
      mood: "cinematic",
      tempoHint: "medium",
      intensityCurve: "soft-build",
      syncTargets: ["character-pose", "camera-motion", "gif-loop"],
    },
    voiceDialogueFutureRouting: [
      "Keep dialogue and voice acting disabled for current anime character previews.",
      "Route future voice requests through separate consent, script, speaker, and lip-sync governance.",
      "Block accidental voice generation from visual-only anime prompts.",
    ],
    ambienceCategories: [
      "ambient sci-fi chamber tone",
      "soft neon electrical bed",
      "cinematic low pulse",
      "anime vocal theme placeholder category only",
    ],
    cinematicSyncPlanning: [
      "Map audio beats to character pose holds and GIF loop timing.",
      "Keep soundtrack duration bounded to preview duration.",
      "Require visible timing diagnostics before any audio export can pass review.",
    ],
    audioReviewPipelinePlanning: [
      "Export audio manifest beside visual review package when implemented.",
      "Show waveform, duration, sync targets, and moderation status before approval.",
      "Require operator audio review before final PASS can include generated sound.",
    ],
    plannedCapabilities: [
      "ambient sci-fi audio",
      "cinematic soundtrack layers",
      "anime vocal themes",
      "motion-sync audio timing",
      "dialogue routing",
    ],
  };
}
