import assert from "node:assert/strict";
import test from "node:test";

import { getApprovedAnimeCharacterProfileById } from "./animeCharacterProfileRegistry";
import {
  buildAnimeCinematicLightingSequence,
  buildAnimeCinematicLightingState,
  buildAnimeMoodPalette,
  resolveAnimeLightingMood,
  summarizeAnimeCinematicLightingDiagnostics,
} from "./animeCinematicLighting";

test("anime cinematic lighting resolves deterministic mood palettes", () => {
  const solarCrimson = getApprovedAnimeCharacterProfileById("CHARACTER_005");
  const defaultHero = getApprovedAnimeCharacterProfileById("CHARACTER_001");
  assert.ok(solarCrimson);
  assert.ok(defaultHero);

  assert.equal(resolveAnimeLightingMood(solarCrimson), "CRIMSON_HERO_CONTRAST");
  assert.equal(resolveAnimeLightingMood(defaultHero), "COOL_SCI_FI_BACKLIGHT");

  const palette = buildAnimeMoodPalette("CRIMSON_HERO_CONTRAST");
  assert.deepEqual(palette.rimLightColor, [255, 196, 62]);
  assert.deepEqual(palette.eyeGlowColor, [255, 52, 68]);
  assert.deepEqual(palette.beaconGlowColor, [72, 221, 240]);
});

test("anime cinematic lighting state is bounded and low flicker", () => {
  const profile = getApprovedAnimeCharacterProfileById("CHARACTER_005");
  assert.ok(profile);

  const sequence = buildAnimeCinematicLightingSequence({ profile, frameCount: 5 });
  const repeated = buildAnimeCinematicLightingSequence({ profile, frameCount: 5 });
  assert.deepEqual(sequence, repeated);
  assert.equal(sequence.length, 5);
  assert.equal(sequence.every((entry) => entry.mood === "CRIMSON_HERO_CONTRAST"), true);

  for (const state of sequence) {
    assert.equal(state.rimLightStrength >= 0.5 && state.rimLightStrength <= 0.68, true);
    assert.equal(state.eyeHighlightStrength >= 0.7 && state.eyeHighlightStrength <= 0.82, true);
    assert.equal(state.beaconGlowStrength >= 0.4 && state.beaconGlowStrength <= 0.5, true);
    assert.equal(state.backgroundAtmosphereStrength >= 0.5 && state.backgroundAtmosphereStrength <= 0.62, true);
    assert.equal(state.shadowStrength >= 0.45 && state.shadowStrength <= 0.5, true);
    assert.equal(state.colorContrastScore >= 90, true);
    assert.equal(state.lightingContinuityScore >= 94, true);
  }

  const diagnostics = summarizeAnimeCinematicLightingDiagnostics(sequence);
  assert.equal(diagnostics.lighting_mood, "CRIMSON_HERO_CONTRAST");
  assert.equal(diagnostics.rim_light_score >= 92, true);
  assert.equal(diagnostics.eye_highlight_score >= 94, true);
  assert.equal(diagnostics.face_lighting_score >= 94, true);
  assert.equal(diagnostics.character_background_contrast >= 94, true);
  assert.equal(diagnostics.beacon_glow_control >= 90, true);
  assert.equal(diagnostics.atmosphere_depth_score >= 92, true);
  assert.equal(diagnostics.color_mood_score >= 93, true);
  assert.equal(diagnostics.lighting_continuity_score >= 94, true);
  assert.equal(diagnostics.lighting_flicker_risk, "LOW");
});

test("anime cinematic lighting allows explicit mood override", () => {
  const profile = getApprovedAnimeCharacterProfileById("CHARACTER_001");
  assert.ok(profile);

  const state = buildAnimeCinematicLightingState({
    profile,
    frameIndex: 2,
    frameCount: 5,
    mood: "GOLDEN_ANIME_RIM",
  });

  assert.equal(state.mood, "GOLDEN_ANIME_RIM");
  assert.equal(state.rimLightStrength > 0.58, true);
  assert.equal(state.lightingContinuityScore >= 94, true);
});
