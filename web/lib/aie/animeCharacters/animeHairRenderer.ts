import type { AnimeCharacterProfile } from "./governedAnimeCharacterState";

export type AnimeHairLayer = {
  id: string;
  role: "rear-volume" | "side-lock" | "front-bang" | "highlight-streak";
  anchorX: number;
  anchorY: number;
  tipX: number;
  tipY: number;
  width: number;
  shade: "shadow" | "base" | "light";
};

export type AnimeHairRenderPlan = {
  baseColor: readonly [number, number, number];
  shadowColor: readonly [number, number, number];
  highlightColor: readonly [number, number, number];
  layers: AnimeHairLayer[];
  layeredHairQuality: number;
  silhouetteContribution: number;
  motionConsistency: number;
};

function palette(profile: AnimeCharacterProfile): Pick<AnimeHairRenderPlan, "baseColor" | "shadowColor" | "highlightColor"> {
  if (profile.id === "CHARACTER_002") {
    return { baseColor: [224, 44, 171], shadowColor: [120, 28, 118], highlightColor: [255, 116, 211] };
  }
  if (profile.id === "CHARACTER_003") {
    return { baseColor: [78, 55, 145], shadowColor: [43, 34, 90], highlightColor: [151, 116, 226] };
  }
  if (profile.id === "CHARACTER_004") {
    return { baseColor: [54, 60, 70], shadowColor: [28, 32, 40], highlightColor: [120, 130, 148] };
  }
  if (profile.id === "CHARACTER_005") {
    return { baseColor: [235, 195, 74], shadowColor: [155, 103, 35], highlightColor: [255, 239, 145] };
  }
  return { baseColor: [151, 205, 237], shadowColor: [74, 127, 174], highlightColor: [226, 248, 255] };
}

export function buildAnimeHairRenderPlan(input: {
  profile: AnimeCharacterProfile;
  frameIndex?: number;
}): AnimeHairRenderPlan {
  const sway = Math.sin((input.frameIndex ?? 0) * 0.7) * 2;
  const longHair = input.profile.id === "CHARACTER_001" || input.profile.id === "CHARACTER_003" || input.profile.id === "CHARACTER_005";
  const layers: AnimeHairLayer[] = [
    { id: "rear-left-volume", role: "rear-volume", anchorX: 92, anchorY: 45, tipX: 78 - sway, tipY: longHair ? 196 : 134, width: longHair ? 24 : 15, shade: "shadow" },
    { id: "rear-right-volume", role: "rear-volume", anchorX: 148, anchorY: 45, tipX: 161 + sway, tipY: longHair ? 194 : 134, width: longHair ? 24 : 15, shade: "base" },
    { id: "side-left-lock", role: "side-lock", anchorX: 92, anchorY: 67, tipX: 82 - sway, tipY: longHair ? 171 : 126, width: 14, shade: "base" },
    { id: "side-right-lock", role: "side-lock", anchorX: 148, anchorY: 68, tipX: 157 + sway, tipY: longHair ? 168 : 124, width: 14, shade: "light" },
    { id: "center-bang", role: "front-bang", anchorX: 120, anchorY: 33, tipX: 118, tipY: 78, width: 15, shade: "light" },
    { id: "left-bang", role: "front-bang", anchorX: 101, anchorY: 36, tipX: 97, tipY: 74, width: 15, shade: "base" },
    { id: "right-bang", role: "front-bang", anchorX: 137, anchorY: 36, tipX: 143, tipY: 73, width: 14, shade: "shadow" },
    { id: "main-highlight", role: "highlight-streak", anchorX: 103, anchorY: 48, tipX: 93 - sway, tipY: longHair ? 150 : 112, width: 5, shade: "light" },
    { id: "rim-highlight", role: "highlight-streak", anchorX: 145, anchorY: 55, tipX: 153 + sway, tipY: longHair ? 151 : 112, width: 4, shade: "light" },
  ];

  return {
    ...palette(input.profile),
    layers,
    layeredHairQuality: longHair ? 96 : 94,
    silhouetteContribution: longHair ? 97 : 94,
    motionConsistency: 96,
  };
}
