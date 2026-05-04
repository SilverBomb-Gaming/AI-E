import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

import { inspectGameProject, type GameProjectSnapshot } from "./gameProjectInspector";

export type UnitySceneWiringSnapshot = {
  projectPath: string;
  scenePath: string;
  mainCameraFound: boolean;
  playerCandidateFound: boolean;
  cameraFollowAlreadyAttached: boolean;
  safeToWire: boolean;
  recommendedActions: string[];
  safety: {
    readOnly: true;
    noUnityExecution: true;
  };
};

export type UnitySceneWiringApplyResult = {
  applied: boolean;
  scenePath: string;
  sceneAbsolutePath: string;
  backupPath: string;
  cameraFollowAttached: boolean;
  targetAssigned: boolean;
  safeToOpenUnityForCompileOrPlaytest: boolean;
  blockedReasons: string[];
  safety: {
    noUnityExecution: true;
    backupCreated: boolean;
    sceneWritten: boolean;
  };
};

export type UnitySceneWiringRepairResult = {
  repaired: boolean;
  scenePath: string;
  sceneAbsolutePath: string;
  backupPath: string;
  cameraFollowAttached: boolean;
  targetAssigned: boolean;
  safeToOpenUnityForCompileOrPlaytest: boolean;
  blockedReasons: string[];
  safety: {
    noUnityExecution: true;
    backupCreated: boolean;
    sceneWritten: boolean;
  };
};

export type UnitySceneWiringStatus = {
  scenePath: string;
  sceneAbsolutePath: string;
  backupPath: string;
  cameraFollowAttached: boolean;
  cameraFollowComponentVisibleToUnity: boolean;
  mainCameraComponentListLinked: boolean;
  monoBehaviourBlockExists: boolean;
  scriptGuidMatchesMeta: boolean;
  playerTargetAssigned: boolean;
  backupExists: boolean;
  safeToOpenUnityForCompileOrPlaytest: boolean;
  brokenLinks: string[];
  safety: {
    readOnly: true;
    noUnityExecution: true;
  };
};

export type UnitySceneWiringRollbackResult = {
  restored: boolean;
  scenePath: string;
  sceneAbsolutePath: string;
  backupPath: string;
  blockedReasons: string[];
  safety: {
    noUnityExecution: true;
    backupRetained: true;
  };
};

export type UnityVisualDebugStatus = {
  scenePath: string;
  sceneAbsolutePath: string;
  floorName: string | null;
  floorDetected: boolean;
  materialAssigned: boolean;
  debugMaterialPresent: boolean;
  backupExists: boolean;
  safeToOpenUnityForCompileOrPlaytest: boolean;
  details: string[];
  safety: {
    readOnly: true;
    noUnityExecution: true;
  };
};

export type UnityVisualDebugApplyResult = {
  applied: boolean;
  scenePath: string;
  sceneAbsolutePath: string;
  floorName: string | null;
  materialPath: string;
  backupPath: string;
  floorDetected: boolean;
  materialAssigned: boolean;
  debugMaterialPresent: boolean;
  safeToOpenUnityForCompileOrPlaytest: boolean;
  blockedReasons: string[];
  safety: {
    noUnityExecution: true;
    backupCreated: boolean;
    sceneWritten: boolean;
  };
};

export type UnityVisualDebugRollbackResult = {
  restored: boolean;
  scenePath: string;
  sceneAbsolutePath: string;
  backupPath: string;
  floorName: string | null;
  materialAssigned: boolean;
  debugMaterialPresent: boolean;
  safeToOpenUnityForCompileOrPlaytest: boolean;
  blockedReasons: string[];
  safety: {
    noUnityExecution: true;
    backupRetained: true;
  };
};

export type UnityFallRecoveryStatus = {
  scenePath: string;
  sceneAbsolutePath: string;
  playerName: string | null;
  respawnTargetName: string | null;
  fallRecoveryScriptExists: boolean;
  fallRecoveryAttached: boolean;
  respawnTargetAssigned: boolean;
  fallThresholdPresent: boolean;
  backupExists: boolean;
  safeToOpenUnityForCompileOrPlaytest: boolean;
  details: string[];
  safety: {
    readOnly: true;
    noUnityExecution: true;
  };
};

export type UnityFallRecoveryApplyResult = {
  applied: boolean;
  scenePath: string;
  sceneAbsolutePath: string;
  playerName: string | null;
  respawnTargetName: string | null;
  scriptPath: string;
  backupPath: string;
  fallRecoveryScriptExists: boolean;
  fallRecoveryAttached: boolean;
  respawnTargetAssigned: boolean;
  fallThresholdPresent: boolean;
  safeToOpenUnityForCompileOrPlaytest: boolean;
  blockedReasons: string[];
  safety: {
    noUnityExecution: true;
    backupCreated: boolean;
    sceneWritten: boolean;
  };
};

export type UnityFallRecoveryRollbackResult = {
  restored: boolean;
  scenePath: string;
  sceneAbsolutePath: string;
  playerName: string | null;
  respawnTargetName: string | null;
  scriptPath: string;
  backupPath: string;
  fallRecoveryAttached: boolean;
  respawnTargetAssigned: boolean;
  fallRecoveryScriptExists: boolean;
  safeToOpenUnityForCompileOrPlaytest: boolean;
  blockedReasons: string[];
  safety: {
    noUnityExecution: true;
    backupRetained: true;
    scriptRemoved: boolean;
  };
};

export type UnityBasicEnemyStatus = {
  scenePath: string;
  sceneAbsolutePath: string;
  enemyName: string | null;
  basicEnemyScriptExists: boolean;
  enemyExists: boolean;
  scriptAttached: boolean;
  positionedOnGround: boolean;
  backupExists: boolean;
  safeToOpenUnityForCompileOrPlaytest: boolean;
  details: string[];
  safety: {
    readOnly: true;
    noUnityExecution: true;
  };
};

export type UnityBasicEnemyApplyResult = {
  applied: boolean;
  scenePath: string;
  sceneAbsolutePath: string;
  enemyName: string | null;
  scriptPath: string;
  backupPath: string;
  basicEnemyScriptExists: boolean;
  enemyExists: boolean;
  scriptAttached: boolean;
  positionedOnGround: boolean;
  safeToOpenUnityForCompileOrPlaytest: boolean;
  blockedReasons: string[];
  safety: {
    noUnityExecution: true;
    backupCreated: boolean;
    sceneWritten: boolean;
  };
};

export type UnityBasicEnemyRollbackResult = {
  restored: boolean;
  scenePath: string;
  sceneAbsolutePath: string;
  enemyName: string | null;
  scriptPath: string;
  backupPath: string;
  basicEnemyScriptExists: boolean;
  enemyExists: boolean;
  scriptAttached: boolean;
  positionedOnGround: boolean;
  safeToOpenUnityForCompileOrPlaytest: boolean;
  blockedReasons: string[];
  safety: {
    noUnityExecution: true;
    backupRetained: true;
    scriptRemoved: boolean;
  };
};

export type UnityPlayerAttackStatus = {
  scenePath: string;
  sceneAbsolutePath: string;
  playerName: string | null;
  enemyName: string | null;
  playerAttackScriptExists: boolean;
  playerAttackAttached: boolean;
  attackKeyConfigured: boolean;
  backupExists: boolean;
  safeToOpenUnityForCompileOrPlaytest: boolean;
  details: string[];
  safety: {
    readOnly: true;
    noUnityExecution: true;
  };
};

export type UnityPlayerAttackApplyResult = {
  applied: boolean;
  scenePath: string;
  sceneAbsolutePath: string;
  playerName: string | null;
  enemyName: string | null;
  scriptPath: string;
  backupPath: string;
  playerAttackScriptExists: boolean;
  playerAttackAttached: boolean;
  attackKeyConfigured: boolean;
  safeToOpenUnityForCompileOrPlaytest: boolean;
  blockedReasons: string[];
  safety: {
    noUnityExecution: true;
    backupCreated: boolean;
    sceneWritten: boolean;
  };
};

export type UnityPlayerAttackRollbackResult = {
  restored: boolean;
  scenePath: string;
  sceneAbsolutePath: string;
  playerName: string | null;
  enemyName: string | null;
  scriptPath: string;
  backupPath: string;
  playerAttackScriptExists: boolean;
  playerAttackAttached: boolean;
  attackKeyConfigured: boolean;
  safeToOpenUnityForCompileOrPlaytest: boolean;
  blockedReasons: string[];
  safety: {
    noUnityExecution: true;
    backupRetained: true;
    scriptRemoved: boolean;
  };
};

type SceneBlock = {
  typeId: string;
  fileId: string;
  raw: string;
  body: string;
};

type SceneObject = {
  gameObjectFileId: string;
  name: string;
  tag: string;
  componentFileIds: string[];
};

type UnityMaterialReference = {
  fileId: string;
  guid: string | null;
  type: string | null;
  raw: string;
};

type FloorRendererDetection = {
  sceneObject: SceneObject;
  rendererFileId: string;
  rendererBlock: SceneBlock;
  currentMaterial: UnityMaterialReference | null;
};

type FallRecoveryVerification = {
  componentFileId: string | null;
  componentListLinked: boolean;
  monoBehaviourBlockExists: boolean;
  scriptGuidMatchesMeta: boolean;
  respawnTargetAssigned: boolean;
  fallThresholdPresent: boolean;
  fallbackSpawnSerialized: boolean;
  componentVisibleToUnity: boolean;
  brokenLinks: string[];
};

type BasicEnemyVerification = {
  componentFileId: string | null;
  componentListLinked: boolean;
  monoBehaviourBlockExists: boolean;
  scriptGuidMatchesMeta: boolean;
  expectedFieldsPresent: boolean;
  positionedOnGround: boolean;
  componentVisibleToUnity: boolean;
  brokenLinks: string[];
};

type PlayerAttackVerification = {
  componentFileId: string | null;
  componentListLinked: boolean;
  monoBehaviourBlockExists: boolean;
  scriptGuidMatchesMeta: boolean;
  attackKeyConfigured: boolean;
  expectedFieldsPresent: boolean;
  componentVisibleToUnity: boolean;
  brokenLinks: string[];
};

type CameraFollowVerification = {
  componentFileId: string | null;
  componentListLinked: boolean;
  monoBehaviourBlockExists: boolean;
  scriptGuidMatchesMeta: boolean;
  playerTargetAssigned: boolean;
  componentVisibleToUnity: boolean;
  brokenLinks: string[];
};

type ParsedScene = {
  rootPath: string;
  scenePath: string;
  sceneAbsolutePath: string;
  source: string;
  blocks: SceneBlock[];
  objects: SceneObject[];
  scriptGuid: string | null;
  mainCamera: SceneObject | null;
  playerCandidate: SceneObject | null;
  playerTransformFileId: string | null;
  verification: CameraFollowVerification;
};

const CAMERA_SCRIPT_PATH = "Assets/Scripts/CameraFollow.cs";
const CAMERA_META_PATH = `${CAMERA_SCRIPT_PATH}.meta`;
const FALL_RECOVERY_SCRIPT_PATH = "Assets/Scripts/FallRecovery.cs";
const FALL_RECOVERY_META_PATH = `${FALL_RECOVERY_SCRIPT_PATH}.meta`;
const FALL_RECOVERY_SCENE_BACKUP_TAG = "fall-recovery";
const FALL_RECOVERY_STATE_DIR = ".aie-state/fall-recovery";
const FALL_RECOVERY_CREATED_SCRIPT_MARKER = `${FALL_RECOVERY_STATE_DIR}/FallRecovery.cs.created`;
const FALL_RECOVERY_CREATED_META_MARKER = `${FALL_RECOVERY_STATE_DIR}/FallRecovery.cs.meta.created`;
const BASIC_ENEMY_NAME = "Enemy";
const BASIC_ENEMY_SCRIPT_PATH = "Assets/Scripts/BasicEnemy.cs";
const BASIC_ENEMY_META_PATH = `${BASIC_ENEMY_SCRIPT_PATH}.meta`;
const BASIC_ENEMY_SCENE_BACKUP_TAG = "basic-enemy";
const BASIC_ENEMY_STATE_DIR = ".aie-state/basic-enemy";
const BASIC_ENEMY_CREATED_SCRIPT_MARKER = `${BASIC_ENEMY_STATE_DIR}/BasicEnemy.cs.created`;
const BASIC_ENEMY_CREATED_META_MARKER = `${BASIC_ENEMY_STATE_DIR}/BasicEnemy.cs.meta.created`;
const PLAYER_ATTACK_SCRIPT_PATH = "Assets/Scripts/PlayerAttack.cs";
const PLAYER_ATTACK_META_PATH = `${PLAYER_ATTACK_SCRIPT_PATH}.meta`;
const PLAYER_ATTACK_SCENE_BACKUP_TAG = "player-attack";
const PLAYER_ATTACK_STATE_DIR = ".aie-state/player-attack";
const PLAYER_ATTACK_CREATED_SCRIPT_MARKER = `${PLAYER_ATTACK_STATE_DIR}/PlayerAttack.cs.created`;
const PLAYER_ATTACK_CREATED_META_MARKER = `${PLAYER_ATTACK_STATE_DIR}/PlayerAttack.cs.meta.created`;
const VISUAL_DEBUG_MATERIAL_DIR = "Assets/Materials";
const VISUAL_DEBUG_MATERIAL_PATH = `${VISUAL_DEBUG_MATERIAL_DIR}/AIE_DebugFloor.mat`;
const VISUAL_DEBUG_SCENE_BACKUP_TAG = "visual-debug-floor";
const MAX_SAFE_UNITY_SCENE_FILE_ID = 2147483647;

function sceneBackupPathFor(sceneAbsolutePath: string, backupTag?: string): string {
  return backupTag ? `${sceneAbsolutePath}.aie-backup-${backupTag}` : `${sceneAbsolutePath}.aie-backup`;
}

async function fileExists(targetPath: string): Promise<boolean> {
  try {
    await stat(targetPath);
    return true;
  } catch {
    return false;
  }
}

function normalizeGuidSource(value: string): string {
  return value.replace(/\\/g, "/").toLowerCase();
}

function buildDeterministicMetaGuid(projectRoot: string, targetFile: string): string {
  return createHash("sha256").update(normalizeGuidSource(path.join(projectRoot, targetFile))).digest("hex").slice(0, 32);
}

async function ensureCameraFollowMeta(projectRoot: string): Promise<string> {
  const scriptAbsolutePath = path.join(projectRoot, CAMERA_SCRIPT_PATH);
  if (!(await fileExists(scriptAbsolutePath))) {
    throw new Error(`CameraFollow script does not exist: ${CAMERA_SCRIPT_PATH}`);
  }

  const metaAbsolutePath = path.join(projectRoot, CAMERA_META_PATH);
  if (await fileExists(metaAbsolutePath)) {
    const metaSource = await readFile(metaAbsolutePath, "utf-8");
    const existingGuidMatch = metaSource.match(/^guid: ([0-9a-f]{32})$/m);
    if (existingGuidMatch) {
      return existingGuidMatch[1];
    }
  }

  const guid = buildDeterministicMetaGuid(projectRoot, CAMERA_SCRIPT_PATH);
  await writeFile(metaAbsolutePath, `fileFormatVersion: 2\nguid: ${guid}\n`, "utf-8");
  return guid;
}

function buildFallRecoverySource(): string {
  return [
    "using UnityEngine;",
    "",
    "namespace EnemyAIDemo",
    "{",
    "    /// <summary>",
    "    /// Resets the player to a safe point when they fall out of the local playtest area.",
    "    /// </summary>",
    "    [DisallowMultipleComponent]",
    "    public sealed class FallRecovery : MonoBehaviour",
    "    {",
    "        [SerializeField] private Transform respawnPoint;",
    "        [SerializeField] private float fallThresholdY = -10f;",
    "        [SerializeField] private bool debugRecovery = true;",
    "        [SerializeField] private Vector3 fallbackSpawnPosition = new Vector3(0f, 1f, -8f);",
    "",
    "        private CharacterController characterController;",
    "        private Rigidbody attachedRigidbody;",
    "",
    "        private void Awake()",
    "        {",
    "            characterController = GetComponent<CharacterController>();",
    "            attachedRigidbody = GetComponent<Rigidbody>();",
    "        }",
    "",
    "        private void Update()",
    "        {",
    "            if (transform.position.y >= fallThresholdY)",
    "            {",
    "                return;",
    "            }",
    "",
    "            RecoverPlayer();",
    "        }",
    "",
    "        private void RecoverPlayer()",
    "        {",
    "            Vector3 respawnPosition = respawnPoint != null ? respawnPoint.position : fallbackSpawnPosition;",
    "",
    "            if (characterController != null)",
    "            {",
    "                characterController.enabled = false;",
    "            }",
    "",
    "            transform.position = respawnPosition;",
    "",
    "            if (characterController != null)",
    "            {",
    "                characterController.enabled = true;",
    "            }",
    "",
    "            if (attachedRigidbody != null)",
    "            {",
    "                attachedRigidbody.velocity = Vector3.zero;",
    "                attachedRigidbody.angularVelocity = Vector3.zero;",
    "            }",
    "",
    "            if (debugRecovery)",
    "            {",
    "                Debug.Log($\"[AIE Fall Recovery] Player reset to {respawnPosition} after crossing Y={fallThresholdY:F2}.\", this);",
    "            }",
    "        }",
    "    }",
    "}",
    "",
  ].join("\n");
}

async function ensureFallRecoveryScript(projectRoot: string): Promise<{ scriptExisted: boolean; metaExisted: boolean; guid: string; }> {
  const scriptAbsolutePath = path.join(projectRoot, FALL_RECOVERY_SCRIPT_PATH);
  const metaAbsolutePath = path.join(projectRoot, FALL_RECOVERY_META_PATH);
  const stateDirectoryAbsolutePath = path.join(projectRoot, FALL_RECOVERY_STATE_DIR);
  const scriptExisted = await fileExists(scriptAbsolutePath);
  const metaExisted = await fileExists(metaAbsolutePath);

  await mkdir(stateDirectoryAbsolutePath, { recursive: true });

  if (!scriptExisted) {
    await writeFile(scriptAbsolutePath, buildFallRecoverySource(), "utf-8");
    await writeFile(path.join(projectRoot, FALL_RECOVERY_CREATED_SCRIPT_MARKER), "created\n", "utf-8");
  }

  let guid = await readGuidFromMeta(metaAbsolutePath);
  if (!guid) {
    guid = buildDeterministicMetaGuid(projectRoot, FALL_RECOVERY_SCRIPT_PATH);
    await writeFile(metaAbsolutePath, `fileFormatVersion: 2\nguid: ${guid}\n`, "utf-8");
    if (!metaExisted) {
      await writeFile(path.join(projectRoot, FALL_RECOVERY_CREATED_META_MARKER), "created\n", "utf-8");
    }
  }

  return {
    scriptExisted,
    metaExisted,
    guid,
  };
}

function buildBasicEnemySource(): string {
  return [
    "using UnityEngine;",
    "",
    "namespace EnemyAIDemo",
    "{",
    "    /// <summary>",
    "    /// Adds a simple visible idle behavior to a scene enemy for local playtests.",
    "    /// </summary>",
    "    [DisallowMultipleComponent]",
    "    public sealed class BasicEnemy : MonoBehaviour",
    "    {",
    "        [SerializeField] private float rotationSpeedDegrees = 24f;",
    "        [SerializeField] private bool debugSpawn = true;",
    "        [SerializeField] private float hitPulseScale = 1.12f;",
    "        [SerializeField] private float hitPulseDuration = 0.12f;",
    "",
    "        private Vector3 baseScale;",
    "        private Coroutine hitPulseRoutine;",
    "",
    "        private void Awake()",
    "        {",
    "            baseScale = transform.localScale;",
    "        }",
    "",
    "        private void Start()",
    "        {",
    "            if (debugSpawn)",
    "            {",
    "                Debug.Log($\"[AIE Basic Enemy] Spawned {name} at {transform.position}.\", this);",
    "            }",
    "        }",
    "",
    "        private void Update()",
    "        {",
    "            if (Mathf.Abs(rotationSpeedDegrees) <= Mathf.Epsilon)",
    "            {",
    "                return;",
    "            }",
    "",
    "            transform.Rotate(0f, rotationSpeedDegrees * Time.deltaTime, 0f, Space.World);",
    "        }",
    "",
    "        public void ReceiveHit()",
    "        {",
    "            Debug.Log(\"Enemy hit\", this);",
    "",
    "            if (hitPulseRoutine != null)",
    "            {",
    "                StopCoroutine(hitPulseRoutine);",
    "            }",
    "",
    "            hitPulseRoutine = StartCoroutine(PlayHitPulse());",
    "        }",
    "",
    "        private System.Collections.IEnumerator PlayHitPulse()",
    "        {",
    "            float duration = Mathf.Max(0.01f, hitPulseDuration);",
    "            Vector3 pulseScale = baseScale * Mathf.Max(1f, hitPulseScale);",
    "            float elapsed = 0f;",
    "",
    "            while (elapsed < duration)",
    "            {",
    "                elapsed += Time.deltaTime;",
    "                float progress = Mathf.Clamp01(elapsed / duration);",
    "                float blend = progress < 0.5f ? progress / 0.5f : 1f - ((progress - 0.5f) / 0.5f);",
    "                transform.localScale = Vector3.Lerp(baseScale, pulseScale, blend);",
    "                yield return null;",
    "            }",
    "",
    "            transform.localScale = baseScale;",
    "            hitPulseRoutine = null;",
    "        }",
    "    }",
    "}",
    "",
  ].join("\n");
}

async function ensureBasicEnemyScript(projectRoot: string): Promise<{ scriptExisted: boolean; metaExisted: boolean; guid: string; }> {
  const scriptAbsolutePath = path.join(projectRoot, BASIC_ENEMY_SCRIPT_PATH);
  const metaAbsolutePath = path.join(projectRoot, BASIC_ENEMY_META_PATH);
  const stateDirectoryAbsolutePath = path.join(projectRoot, BASIC_ENEMY_STATE_DIR);
  const scriptExisted = await fileExists(scriptAbsolutePath);
  const metaExisted = await fileExists(metaAbsolutePath);

  await mkdir(stateDirectoryAbsolutePath, { recursive: true });

  if (!scriptExisted) {
    await writeFile(scriptAbsolutePath, buildBasicEnemySource(), "utf-8");
    await writeFile(path.join(projectRoot, BASIC_ENEMY_CREATED_SCRIPT_MARKER), "created\n", "utf-8");
  }

  let guid = await readGuidFromMeta(metaAbsolutePath);
  if (!guid) {
    guid = buildDeterministicMetaGuid(projectRoot, BASIC_ENEMY_SCRIPT_PATH);
    await writeFile(metaAbsolutePath, `fileFormatVersion: 2\nguid: ${guid}\n`, "utf-8");
    if (!metaExisted) {
      await writeFile(path.join(projectRoot, BASIC_ENEMY_CREATED_META_MARKER), "created\n", "utf-8");
    }
  }

  return {
    scriptExisted,
    metaExisted,
    guid,
  };
}

function buildPlayerAttackSource(): string {
  return [
    "using System.Collections.Generic;",
    "using UnityEngine;",
    "",
    "namespace EnemyAIDemo",
    "{",
    "    /// <summary>",
    "    /// Performs a simple short-range attack against nearby enemies during local playtests.",
    "    /// </summary>",
    "    [DisallowMultipleComponent]",
    "    public sealed class PlayerAttack : MonoBehaviour",
    "    {",
    "        [SerializeField] private float attackRange = 2.5f;",
    "        [SerializeField] private float attackCooldown = 0.35f;",
    "        [SerializeField] private float attackRadius = 1.1f;",
    "        [SerializeField] private KeyCode attackKey = KeyCode.E;",
    "        [SerializeField] private bool allowMouse0 = true;",
    "        [SerializeField] private bool debugHits = true;",
    "",
    "        private float nextAttackTime;",
    "",
    "        private void Update()",
    "        {",
    "            if (!ShouldAttack() || Time.time < nextAttackTime)",
    "            {",
    "                return;",
    "            }",
    "",
    "            nextAttackTime = Time.time + attackCooldown;",
    "            PerformAttack();",
    "        }",
    "",
    "        private bool ShouldAttack()",
    "        {",
    "            return Input.GetKeyDown(attackKey) || (allowMouse0 && Input.GetMouseButtonDown(0));",
    "        }",
    "",
    "        private void PerformAttack()",
    "        {",
    "            Vector3 attackOrigin = transform.position + Vector3.up + (transform.forward * Mathf.Min(attackRange * 0.6f, 1.5f));",
    "            Collider[] hits = Physics.OverlapSphere(attackOrigin, attackRadius, ~0, QueryTriggerInteraction.Ignore);",
    "            HashSet<BasicEnemy> hitEnemies = new HashSet<BasicEnemy>();",
    "            bool hitAny = false;",
    "",
    "            foreach (Collider hit in hits)",
    "            {",
    "                BasicEnemy enemy = hit.GetComponentInParent<BasicEnemy>();",
    "                if (enemy == null || !hitEnemies.Add(enemy))",
    "                {",
    "                    continue;",
    "                }",
    "",
    "                if (Vector3.Distance(transform.position, enemy.transform.position) > attackRange + 0.75f)",
    "                {",
    "                    continue;",
    "                }",
    "",
    "                enemy.ReceiveHit();",
    "                hitAny = true;",
    "",
    "                if (debugHits)",
    "                {",
    "                    Debug.Log($\"[AIE Player Attack] Hit {enemy.name}.\", enemy);",
    "                }",
    "            }",
    "",
    "            if (!hitAny && debugHits)",
    "            {",
    "                Debug.Log(\"[AIE Player Attack] Attack missed.\", this);",
    "            }",
    "        }",
    "",
    "        private void OnDrawGizmosSelected()",
    "        {",
    "            Vector3 attackOrigin = transform.position + Vector3.up + (transform.forward * Mathf.Min(attackRange * 0.6f, 1.5f));",
    "            Gizmos.color = Color.red;",
    "            Gizmos.DrawWireSphere(attackOrigin, attackRadius);",
    "        }",
    "    }",
    "}",
    "",
  ].join("\n");
}

async function ensurePlayerAttackScript(projectRoot: string): Promise<{ scriptExisted: boolean; metaExisted: boolean; guid: string; }> {
  const scriptAbsolutePath = path.join(projectRoot, PLAYER_ATTACK_SCRIPT_PATH);
  const metaAbsolutePath = path.join(projectRoot, PLAYER_ATTACK_META_PATH);
  const stateDirectoryAbsolutePath = path.join(projectRoot, PLAYER_ATTACK_STATE_DIR);
  const scriptExisted = await fileExists(scriptAbsolutePath);
  const metaExisted = await fileExists(metaAbsolutePath);

  await mkdir(stateDirectoryAbsolutePath, { recursive: true });

  if (!scriptExisted) {
    await writeFile(scriptAbsolutePath, buildPlayerAttackSource(), "utf-8");
    await writeFile(path.join(projectRoot, PLAYER_ATTACK_CREATED_SCRIPT_MARKER), "created\n", "utf-8");
  }

  let guid = await readGuidFromMeta(metaAbsolutePath);
  if (!guid) {
    guid = buildDeterministicMetaGuid(projectRoot, PLAYER_ATTACK_SCRIPT_PATH);
    await writeFile(metaAbsolutePath, `fileFormatVersion: 2\nguid: ${guid}\n`, "utf-8");
    if (!metaExisted) {
      await writeFile(path.join(projectRoot, PLAYER_ATTACK_CREATED_META_MARKER), "created\n", "utf-8");
    }
  }

  return {
    scriptExisted,
    metaExisted,
    guid,
  };
}

async function readGuidFromMeta(metaAbsolutePath: string): Promise<string | null> {
  if (!(await fileExists(metaAbsolutePath))) {
    return null;
  }

  const metaSource = await readFile(metaAbsolutePath, "utf-8");
  return metaSource.match(/^guid: ([0-9a-f]{32})$/m)?.[1] ?? null;
}

function buildFolderMetaSource(guid: string): string {
  return [
    "fileFormatVersion: 2",
    `guid: ${guid}`,
    "folderAsset: yes",
    "DefaultImporter:",
    "  externalObjects: {}",
    "  userData: ",
    "  assetBundleName: ",
    "  assetBundleVariant: ",
    "",
  ].join("\n");
}

function buildMaterialMetaSource(guid: string): string {
  return [
    "fileFormatVersion: 2",
    `guid: ${guid}`,
    "NativeFormatImporter:",
    "  externalObjects: {}",
    "  mainObjectFileID: 2100000",
    "  userData: ",
    "  assetBundleName: ",
    "  assetBundleVariant: ",
    "",
  ].join("\n");
}

function buildVisualDebugMaterialSource(): string {
  return [
    "%YAML 1.1",
    "%TAG !u! tag:unity3d.com,2011:",
    "--- !u!21 &2100000",
    "Material:",
    "  serializedVersion: 8",
    "  m_ObjectHideFlags: 0",
    "  m_CorrespondingSourceObject: {fileID: 0}",
    "  m_PrefabInstance: {fileID: 0}",
    "  m_PrefabAsset: {fileID: 0}",
    "  m_Name: AIE_DebugFloor",
    "  m_Shader: {fileID: 46, guid: 0000000000000000f000000000000000, type: 0}",
    "  m_Parent: {fileID: 0}",
    "  m_ModifiedSerializedProperties: 0",
    "  m_ValidKeywords: []",
    "  m_InvalidKeywords: []",
    "  m_LightmapFlags: 4",
    "  m_EnableInstancingVariants: 0",
    "  m_DoubleSidedGI: 0",
    "  m_CustomRenderQueue: -1",
    "  stringTagMap: {}",
    "  disabledShaderPasses: []",
    "  m_LockedProperties: ",
    "  m_SavedProperties:",
    "    serializedVersion: 3",
    "    m_TexEnvs:",
    "    - _MainTex:",
    "        m_Texture: {fileID: 0}",
    "        m_Scale: {x: 8, y: 8}",
    "        m_Offset: {x: 0, y: 0}",
    "    m_Ints: []",
    "    m_Floats:",
    "    - _Glossiness: 0.08",
    "    - _Metallic: 0",
    "    - _Mode: 0",
    "    - _SrcBlend: 1",
    "    - _DstBlend: 0",
    "    - _ZWrite: 1",
    "    m_Colors:",
    "    - _Color: {r: 0.09, g: 0.18, b: 0.36, a: 1}",
    "",
  ].join("\n");
}

async function ensureVisualDebugMaterial(projectRoot: string): Promise<{ relativePath: string; absolutePath: string; guid: string; }> {
  const materialDirectoryAbsolutePath = path.join(projectRoot, VISUAL_DEBUG_MATERIAL_DIR);
  const materialAbsolutePath = path.join(projectRoot, VISUAL_DEBUG_MATERIAL_PATH);
  const materialMetaAbsolutePath = `${materialAbsolutePath}.meta`;
  const directoryMetaAbsolutePath = `${materialDirectoryAbsolutePath}.meta`;

  await mkdir(materialDirectoryAbsolutePath, { recursive: true });

  if (!(await fileExists(directoryMetaAbsolutePath))) {
    const directoryGuid = buildDeterministicMetaGuid(projectRoot, VISUAL_DEBUG_MATERIAL_DIR);
    await writeFile(directoryMetaAbsolutePath, buildFolderMetaSource(directoryGuid), "utf-8");
  }

  if (!(await fileExists(materialAbsolutePath))) {
    await writeFile(materialAbsolutePath, buildVisualDebugMaterialSource(), "utf-8");
  }

  let materialGuid = await readGuidFromMeta(materialMetaAbsolutePath);
  if (!materialGuid) {
    materialGuid = buildDeterministicMetaGuid(projectRoot, VISUAL_DEBUG_MATERIAL_PATH);
    await writeFile(materialMetaAbsolutePath, buildMaterialMetaSource(materialGuid), "utf-8");
  }

  return {
    relativePath: VISUAL_DEBUG_MATERIAL_PATH,
    absolutePath: materialAbsolutePath,
    guid: materialGuid,
  };
}

function parseSceneBlocks(source: string): SceneBlock[] {
  const pattern = /^--- !u!(\d+) &(\d+)\r?\n([\s\S]*?)(?=^--- !u!|(?![\s\S]))/gm;
  const blocks: SceneBlock[] = [];
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(source)) !== null) {
    blocks.push({
      typeId: match[1],
      fileId: match[2],
      raw: match[0],
      body: match[3],
    });
  }

  return blocks;
}

function findBlock(blocks: readonly SceneBlock[], fileId: string | null): SceneBlock | null {
  if (!fileId) {
    return null;
  }

  return blocks.find((block) => block.fileId === fileId) ?? null;
}

function extractSceneObjects(blocks: readonly SceneBlock[]): SceneObject[] {
  return blocks
    .filter((block) => block.typeId === "1")
    .map((block) => ({
      gameObjectFileId: block.fileId,
      name: block.body.match(/^  m_Name: (.*)$/m)?.[1] ?? "",
      tag: block.body.match(/^  m_TagString: (.*)$/m)?.[1] ?? "",
      componentFileIds: Array.from(block.body.matchAll(/component: \{fileID: (\d+)\}/g), (match) => match[1]),
    }));
}

function findComponentFileIdByType(blocks: readonly SceneBlock[], sceneObject: SceneObject, typeId: string): string | null {
  return sceneObject.componentFileIds.find((componentFileId) => findBlock(blocks, componentFileId)?.typeId === typeId) ?? null;
}

function extractRendererMaterial(block: SceneBlock | null): UnityMaterialReference | null {
  const match = block?.body.match(/^  m_Materials:\r?\n  - \{fileID: (\d+)(?:, guid: ([0-9a-f]{32}), type: (\d+))?\}$/m);
  if (!match) {
    return null;
  }

  return {
    fileId: match[1],
    guid: match[2] ?? null,
    type: match[3] ?? null,
    raw: match[0].split(/\r?\n/)[1].trim(),
  };
}

function replaceRendererMaterial(rendererBlock: SceneBlock, newMaterialReference: string): string {
  if (/(  m_Materials:\r?\n  - )[^\r\n]+/.test(rendererBlock.raw)) {
    return rendererBlock.raw.replace(/(  m_Materials:\r?\n  - )[^\r\n]+/, `$1${newMaterialReference}`);
  }

  return rendererBlock.raw.replace(/  m_Materials:\r?\n/, `  m_Materials:\n  - ${newMaterialReference}\n`);
}

function buildSceneMaterialReference(guid: string): string {
  return `{fileID: 2100000, guid: ${guid}, type: 2}`;
}

function isDebugMaterialAssigned(material: UnityMaterialReference | null, debugMaterialGuid: string | null): boolean {
  return material !== null && debugMaterialGuid !== null && material.fileId === "2100000" && material.guid === debugMaterialGuid;
}

function scoreGroundCandidate(blocks: readonly SceneBlock[], sceneObject: SceneObject): number {
  const normalizedName = sceneObject.name.trim().toLowerCase();
  const hasRenderer = findComponentFileIdByType(blocks, sceneObject, "23") !== null;
  const hasMeshFilter = findComponentFileIdByType(blocks, sceneObject, "33") !== null;
  const hasMeshCollider = findComponentFileIdByType(blocks, sceneObject, "64") !== null;
  const meshFilterBlock = findBlock(blocks, findComponentFileIdByType(blocks, sceneObject, "33"));
  const usesBuiltinPlaneMesh = meshFilterBlock?.body.includes("m_Mesh: {fileID: 10209") ?? false;

  if (!hasRenderer) {
    return Number.NEGATIVE_INFINITY;
  }

  let score = 0;
  if (["ground", "floor", "plane"].includes(normalizedName)) {
    score += 100;
  } else if (/(ground|floor|plane)/.test(normalizedName)) {
    score += 80;
  }
  if (hasMeshCollider) {
    score += 25;
  }
  if (hasMeshFilter) {
    score += 15;
  }
  if (usesBuiltinPlaneMesh) {
    score += 10;
  }
  if (sceneObject.tag.toLowerCase() === "untagged") {
    score += 1;
  }
  return score;
}

function detectPrimaryGroundRenderer(blocks: readonly SceneBlock[], objects: readonly SceneObject[]): FloorRendererDetection | null {
  const rankedObjects = [...objects]
    .map((sceneObject) => ({ sceneObject, score: scoreGroundCandidate(blocks, sceneObject) }))
    .filter((candidate) => Number.isFinite(candidate.score))
    .sort((left, right) => right.score - left.score || left.sceneObject.name.localeCompare(right.sceneObject.name));

  const bestCandidate = rankedObjects[0]?.sceneObject ?? null;
  if (!bestCandidate) {
    return null;
  }

  const rendererFileId = findComponentFileIdByType(blocks, bestCandidate, "23");
  const rendererBlock = findBlock(blocks, rendererFileId);
  if (!rendererFileId || !rendererBlock) {
    return null;
  }

  return {
    sceneObject: bestCandidate,
    rendererFileId,
    rendererBlock,
    currentMaterial: extractRendererMaterial(rendererBlock),
  };
}

function selectScene(snapshot: GameProjectSnapshot): string {
  if (snapshot.structure.scenes.length === 0) {
    throw new Error("No Unity scene files were found under Assets.");
  }

  return [...snapshot.structure.scenes].sort((left, right) => left.localeCompare(right))[0];
}

function extractBlockGameObjectFileId(block: SceneBlock | null): string | null {
  return block?.body.match(/^  m_GameObject: \{fileID: (\d+)\}$/m)?.[1] ?? null;
}

function extractBlockScriptGuid(block: SceneBlock | null): string | null {
  return block?.body.match(/^  m_Script: \{fileID: 11500000, guid: ([0-9a-f]{32}), type: 3\}$/m)?.[1] ?? null;
}

function extractBlockTargetFileId(block: SceneBlock | null): string | null {
  return block?.body.match(/^  target: \{fileID: (\d+)\}$/m)?.[1] ?? null;
}

function extractNamedTransformFileId(block: SceneBlock | null, fieldName: string): string | null {
  const escapedFieldName = fieldName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return block?.body.match(new RegExp(`^  ${escapedFieldName}: \\{fileID: (\\d+)\\}$`, "m"))?.[1] ?? null;
}

function hasExpectedCameraSerializedFields(block: SceneBlock | null): boolean {
  if (!block) {
    return false;
  }

  return /^  m_EditorClassIdentifier:\s*$/m.test(block.body)
    && /^  target: \{fileID: \d+\}$/m.test(block.body)
    && /^  offset: \{x: 0, y: 4, z: -7\}$/m.test(block.body)
    && /^  smoothTime: 0.12$/m.test(block.body)
    && /^  lookAtHeight: 1.5$/m.test(block.body)
    && /^  debugFollow: 0$/m.test(block.body)
    && !/^  followSmoothTime:/m.test(block.body)
    && !/^  lookAtTarget:/m.test(block.body);
}

function isSafeSceneFileId(fileId: string | null): boolean {
  if (!fileId || !/^\d+$/.test(fileId)) {
    return false;
  }

  return Number(fileId) > 0 && Number(fileId) <= MAX_SAFE_UNITY_SCENE_FILE_ID;
}

function isCameraFollowCandidateBlock(block: SceneBlock, mainCameraGameObjectId: string | null, scriptGuid: string | null): boolean {
  if (block.typeId !== "114") {
    return false;
  }

  if (mainCameraGameObjectId && extractBlockGameObjectFileId(block) !== mainCameraGameObjectId) {
    return false;
  }

  const blockScriptGuid = extractBlockScriptGuid(block);
  if (scriptGuid && blockScriptGuid === scriptGuid) {
    return true;
  }

  return /CameraFollow/.test(block.body)
    || /^  target: \{fileID: \d+\}$/m.test(block.body)
    || /^  smoothTime:/m.test(block.body)
    || /^  followSmoothTime:/m.test(block.body)
    || /^  lookAtHeight:/m.test(block.body)
    || /^  lookAtTarget:/m.test(block.body)
    || /^  debugFollow:/m.test(block.body);
}

function isFallRecoveryCandidateBlock(block: SceneBlock, playerGameObjectId: string | null, scriptGuid: string | null): boolean {
  if (block.typeId !== "114") {
    return false;
  }

  if (playerGameObjectId && extractBlockGameObjectFileId(block) !== playerGameObjectId) {
    return false;
  }

  const blockScriptGuid = extractBlockScriptGuid(block);
  if (scriptGuid && blockScriptGuid === scriptGuid) {
    return true;
  }

  return /FallRecovery/.test(block.body)
    || /^  respawnPoint: \{fileID: \d+\}$/m.test(block.body)
    || /^  fallThresholdY:/m.test(block.body)
    || /^  debugRecovery:/m.test(block.body)
    || /^  fallbackSpawnPosition:/m.test(block.body);
}

function buildCameraFollowVerification(blocks: readonly SceneBlock[], mainCamera: SceneObject | null, playerTransformFileId: string | null, scriptGuid: string | null): CameraFollowVerification {
  if (!mainCamera) {
    return {
      componentFileId: null,
      componentListLinked: false,
      monoBehaviourBlockExists: false,
      scriptGuidMatchesMeta: false,
      playerTargetAssigned: false,
      componentVisibleToUnity: false,
      brokenLinks: ["Main Camera GameObject was not found."],
    };
  }

  const brokenLinks: string[] = [];
  const linkedComponentIds = mainCamera.componentFileIds.filter((componentFileId) => {
    const block = findBlock(blocks, componentFileId);
    return block !== null && isCameraFollowCandidateBlock(block, mainCamera.gameObjectFileId, scriptGuid);
  });
  const componentFileId = linkedComponentIds[0] ?? null;
  const linkedComponentBlock = findBlock(blocks, componentFileId);
  const componentListLinked = componentFileId !== null && isSafeSceneFileId(componentFileId);
  const monoBehaviourBlockExists = linkedComponentBlock?.typeId === "114" && extractBlockGameObjectFileId(linkedComponentBlock) === mainCamera.gameObjectFileId;
  const scriptGuidMatchesMeta = scriptGuid !== null && extractBlockScriptGuid(linkedComponentBlock) === scriptGuid;
  const playerTargetAssigned = playerTransformFileId !== null && extractBlockTargetFileId(linkedComponentBlock) === playerTransformFileId;
  const serializedFieldsMatch = hasExpectedCameraSerializedFields(linkedComponentBlock);
  const componentVisibleToUnity = componentListLinked && monoBehaviourBlockExists && scriptGuidMatchesMeta && playerTargetAssigned && serializedFieldsMatch;

  if (linkedComponentIds.length === 0) {
    brokenLinks.push("Main Camera m_Component list does not link a CameraFollow MonoBehaviour block.");
  }

  if (componentFileId !== null && !isSafeSceneFileId(componentFileId)) {
    brokenLinks.push(`Main Camera references CameraFollow with unsafe scene fileID ${componentFileId}.`);
  }

  if (!monoBehaviourBlockExists) {
    brokenLinks.push("Referenced CameraFollow MonoBehaviour block is missing or not linked back to Main Camera.");
  }

  if (scriptGuid === null) {
    brokenLinks.push("CameraFollow.cs.meta is missing, so Unity cannot resolve the script GUID.");
  } else if (!scriptGuidMatchesMeta) {
    brokenLinks.push("CameraFollow MonoBehaviour block does not reference the CameraFollow.cs.meta GUID.");
  }

  if (!playerTargetAssigned) {
    brokenLinks.push("CameraFollow MonoBehaviour block does not assign the Player Transform target.");
  }

  if (linkedComponentBlock && !serializedFieldsMatch) {
    brokenLinks.push("CameraFollow MonoBehaviour block uses stale or incomplete serialized fields and is not in the expected Unity-visible shape.");
  }

  return {
    componentFileId,
    componentListLinked,
    monoBehaviourBlockExists,
    scriptGuidMatchesMeta,
    playerTargetAssigned,
    componentVisibleToUnity,
    brokenLinks,
  };
}

function hasExpectedFallRecoverySerializedFields(
  block: SceneBlock | null,
  expectedRespawnTargetFileId: string | null,
  fallbackSpawnPosition: { x: number; y: number; z: number },
): { respawnTargetAssigned: boolean; fallThresholdPresent: boolean; fallbackSpawnSerialized: boolean } {
  if (!block) {
    return {
      respawnTargetAssigned: false,
      fallThresholdPresent: false,
      fallbackSpawnSerialized: false,
    };
  }

  const actualRespawnTargetFileId = extractNamedTransformFileId(block, "respawnPoint");
  const respawnTargetAssigned = expectedRespawnTargetFileId !== null
    ? actualRespawnTargetFileId === expectedRespawnTargetFileId
    : /^  respawnPoint: \{fileID: 0\}$/m.test(block.body);
  const fallThresholdPresent = /^  fallThresholdY: -10$/m.test(block.body);
  const fallbackSpawnSerialized = new RegExp(
    `^  fallbackSpawnPosition: \\{x: ${fallbackSpawnPosition.x}, y: ${fallbackSpawnPosition.y}, z: ${fallbackSpawnPosition.z}\\}$`,
    "m",
  ).test(block.body);

  return {
    respawnTargetAssigned,
    fallThresholdPresent,
    fallbackSpawnSerialized,
  };
}

function buildFallRecoveryVerification(
  blocks: readonly SceneBlock[],
  playerCandidate: SceneObject | null,
  respawnTargetFileId: string | null,
  scriptGuid: string | null,
  fallbackSpawnPosition: { x: number; y: number; z: number } | null,
): FallRecoveryVerification {
  if (!playerCandidate || !fallbackSpawnPosition) {
    return {
      componentFileId: null,
      componentListLinked: false,
      monoBehaviourBlockExists: false,
      scriptGuidMatchesMeta: false,
      respawnTargetAssigned: false,
      fallThresholdPresent: false,
      fallbackSpawnSerialized: false,
      componentVisibleToUnity: false,
      brokenLinks: ["Player GameObject or fallback spawn position was not found."],
    };
  }

  const brokenLinks: string[] = [];
  const linkedComponentIds = playerCandidate.componentFileIds.filter((componentFileId) => {
    const block = findBlock(blocks, componentFileId);
    return block !== null && isFallRecoveryCandidateBlock(block, playerCandidate.gameObjectFileId, scriptGuid);
  });
  const componentFileId = linkedComponentIds[0] ?? null;
  const linkedComponentBlock = findBlock(blocks, componentFileId);
  const componentListLinked = componentFileId !== null && isSafeSceneFileId(componentFileId);
  const monoBehaviourBlockExists = linkedComponentBlock?.typeId === "114" && extractBlockGameObjectFileId(linkedComponentBlock) === playerCandidate.gameObjectFileId;
  const scriptGuidMatchesMeta = scriptGuid !== null && extractBlockScriptGuid(linkedComponentBlock) === scriptGuid;
  const serializedFields = hasExpectedFallRecoverySerializedFields(linkedComponentBlock, respawnTargetFileId, fallbackSpawnPosition);
  const componentVisibleToUnity = componentListLinked
    && monoBehaviourBlockExists
    && scriptGuidMatchesMeta
    && serializedFields.respawnTargetAssigned
    && serializedFields.fallThresholdPresent
    && serializedFields.fallbackSpawnSerialized;

  if (linkedComponentIds.length === 0) {
    brokenLinks.push("Player m_Component list does not link a FallRecovery MonoBehaviour block.");
  }

  if (componentFileId !== null && !isSafeSceneFileId(componentFileId)) {
    brokenLinks.push(`Player references FallRecovery with unsafe scene fileID ${componentFileId}.`);
  }

  if (!monoBehaviourBlockExists) {
    brokenLinks.push("Referenced FallRecovery MonoBehaviour block is missing or not linked back to Player.");
  }

  if (scriptGuid === null) {
    brokenLinks.push("FallRecovery.cs.meta is missing, so Unity cannot resolve the script GUID.");
  } else if (!scriptGuidMatchesMeta) {
    brokenLinks.push("FallRecovery MonoBehaviour block does not reference the FallRecovery.cs.meta GUID.");
  }

  if (!serializedFields.respawnTargetAssigned) {
    brokenLinks.push(respawnTargetFileId !== null
      ? "FallRecovery MonoBehaviour block does not assign the FarResetPoint respawn target."
      : "FallRecovery MonoBehaviour block does not preserve the fallback respawn mode.");
  }

  if (!serializedFields.fallThresholdPresent) {
    brokenLinks.push("FallRecovery MonoBehaviour block does not serialize the expected fall threshold.");
  }

  if (!serializedFields.fallbackSpawnSerialized) {
    brokenLinks.push("FallRecovery MonoBehaviour block does not serialize the expected fallback spawn position.");
  }

  return {
    componentFileId,
    componentListLinked,
    monoBehaviourBlockExists,
    scriptGuidMatchesMeta,
    respawnTargetAssigned: serializedFields.respawnTargetAssigned,
    fallThresholdPresent: serializedFields.fallThresholdPresent,
    fallbackSpawnSerialized: serializedFields.fallbackSpawnSerialized,
    componentVisibleToUnity,
    brokenLinks,
  };
}

async function parseProjectScene(projectPath: string): Promise<ParsedScene> {
  const snapshot = await inspectGameProject(projectPath);
  if (snapshot.engine !== "unity") {
    throw new Error("Camera scene wiring requires a Unity project.");
  }

  const scenePath = selectScene(snapshot);
  const sceneAbsolutePath = path.join(snapshot.rootPath, scenePath);
  const source = await readFile(sceneAbsolutePath, "utf-8");
  const blocks = parseSceneBlocks(source);
  const objects = extractSceneObjects(blocks);
  const mainCamera = objects.find((sceneObject) => sceneObject.name === "Main Camera" || sceneObject.tag === "MainCamera") ?? null;
  const playerCandidate = objects.find((sceneObject) => sceneObject.tag === "Player")
    ?? objects.find((sceneObject) => sceneObject.name === "Player")
    ?? objects.find((sceneObject) => sceneObject.componentFileIds.some((componentFileId) => {
      const block = findBlock(blocks, componentFileId);
      return block?.typeId === "114" && /SimpleKeyboardPlayerMover/.test(block.body);
    }))
    ?? null;
  const playerTransformFileId = playerCandidate
    ? playerCandidate.componentFileIds.find((componentFileId) => findBlock(blocks, componentFileId)?.typeId === "4") ?? null
    : null;
  const scriptMetaAbsolutePath = path.join(snapshot.rootPath, CAMERA_META_PATH);
  let scriptGuid: string | null = null;

  if (await fileExists(scriptMetaAbsolutePath)) {
    const metaSource = await readFile(scriptMetaAbsolutePath, "utf-8");
    scriptGuid = metaSource.match(/^guid: ([0-9a-f]{32})$/m)?.[1] ?? null;
  }

  return {
    rootPath: snapshot.rootPath,
    scenePath,
    sceneAbsolutePath,
    source,
    blocks,
    objects,
    scriptGuid,
    mainCamera,
    playerCandidate,
    playerTransformFileId,
    verification: buildCameraFollowVerification(blocks, mainCamera, playerTransformFileId, scriptGuid),
  };
}

function buildRecommendedActions(parsedScene: ParsedScene): string[] {
  const actions: string[] = [];
  if (!parsedScene.mainCamera) {
    actions.push("Main Camera GameObject must exist in the selected scene.");
  }

  if (!parsedScene.playerCandidate || !parsedScene.playerTransformFileId) {
    actions.push("A Player-tagged GameObject with a Transform must exist before scene wiring can assign the target.");
  }

  if (parsedScene.verification.brokenLinks.length > 0) {
    actions.push(...parsedScene.verification.brokenLinks);
  } else {
    actions.push("CameraFollow is already attached with a Unity-visible component link.");
  }

  return actions;
}

function findSceneObjectByName(objects: readonly SceneObject[], name: string): SceneObject | null {
  return objects.find((sceneObject) => sceneObject.name === name) ?? null;
}

function parseVector3FromTransformBlock(block: SceneBlock | null): { x: number; y: number; z: number } | null {
  return parseNamedVector3FromBlock(block, "m_LocalPosition");
}

function parseNamedVector3FromBlock(block: SceneBlock | null, fieldName: string): { x: number; y: number; z: number } | null {
  const match = block?.body.match(/^  m_LocalPosition: \{x: (-?\d+(?:\.\d+)?), y: (-?\d+(?:\.\d+)?), z: (-?\d+(?:\.\d+)?)\}$/m);
  if (!match) {
    return null;
  }

  return {
    x: Number(match[1]),
    y: Number(match[2]),
    z: Number(match[3]),
  };
}

function parseTransformScaleFromBlock(block: SceneBlock | null): { x: number; y: number; z: number } | null {
  const match = block?.body.match(/^  m_LocalScale: \{x: (-?\d+(?:\.\d+)?), y: (-?\d+(?:\.\d+)?), z: (-?\d+(?:\.\d+)?)\}$/m);
  if (!match) {
    return null;
  }

  return {
    x: Number(match[1]),
    y: Number(match[2]),
    z: Number(match[3]),
  };
}

function replaceNamedVector3(blockRaw: string, fieldName: string, value: { x: number; y: number; z: number }): string {
  const fieldPattern = new RegExp(`^  ${fieldName}: \\{x: -?\\d+(?:\\.\\d+)?, y: -?\\d+(?:\\.\\d+)?, z: -?\\d+(?:\\.\\d+)?\\}$`, "m");
  const replacement = `  ${fieldName}: {x: ${value.x}, y: ${value.y}, z: ${value.z}}`;
  return fieldPattern.test(blockRaw)
    ? blockRaw.replace(fieldPattern, replacement)
    : blockRaw;
}

function isEnemyGrounded(
  enemyPosition: { x: number; y: number; z: number } | null,
  enemyScale: { x: number; y: number; z: number } | null,
  groundPosition: { x: number; y: number; z: number } | null,
): boolean {
  if (!enemyPosition || !enemyScale || !groundPosition) {
    return false;
  }

  return Math.abs((enemyPosition.y - enemyScale.y) - groundPosition.y) <= 0.35;
}

function buildFallRecoveryComponentBlock(
  componentFileId: string,
  playerGameObjectFileId: string,
  scriptGuid: string,
  respawnTargetFileId: string | null,
  fallbackSpawnPosition: { x: number; y: number; z: number },
): string {
  return [
    `--- !u!114 &${componentFileId}`,
    "MonoBehaviour:",
    "  m_ObjectHideFlags: 0",
    "  m_CorrespondingSourceObject: {fileID: 0}",
    "  m_PrefabInstance: {fileID: 0}",
    "  m_PrefabAsset: {fileID: 0}",
    `  m_GameObject: {fileID: ${playerGameObjectFileId}}`,
    "  m_Enabled: 1",
    "  m_EditorHideFlags: 0",
    `  m_Script: {fileID: 11500000, guid: ${scriptGuid}, type: 3}`,
    "  m_Name: ",
    "  m_EditorClassIdentifier:",
    `  respawnPoint: {fileID: ${respawnTargetFileId ?? "0"}}`,
    "  fallThresholdY: -10",
    "  debugRecovery: 1",
    `  fallbackSpawnPosition: {x: ${fallbackSpawnPosition.x}, y: ${fallbackSpawnPosition.y}, z: ${fallbackSpawnPosition.z}}`,
    "",
  ].join("\n");
}

function buildBasicEnemyComponentBlock(componentFileId: string, enemyGameObjectFileId: string, scriptGuid: string): string {
  return [
    `--- !u!114 &${componentFileId}`,
    "MonoBehaviour:",
    "  m_ObjectHideFlags: 0",
    "  m_CorrespondingSourceObject: {fileID: 0}",
    "  m_PrefabInstance: {fileID: 0}",
    "  m_PrefabAsset: {fileID: 0}",
    `  m_GameObject: {fileID: ${enemyGameObjectFileId}}`,
    "  m_Enabled: 1",
    "  m_EditorHideFlags: 0",
    `  m_Script: {fileID: 11500000, guid: ${scriptGuid}, type: 3}`,
    "  m_Name: ",
    "  m_EditorClassIdentifier:",
    "  rotationSpeedDegrees: 24",
    "  debugSpawn: 1",
    "",
  ].join("\n");
}

function buildBasicEnemyBlocks(
  gameObjectFileId: string,
  transformFileId: string,
  rendererFileId: string,
  colliderFileId: string,
  meshFilterFileId: string,
  basicEnemyComponentFileId: string,
  scriptGuid: string,
  spawnPosition: { x: number; y: number; z: number },
): string {
  return [
    `--- !u!1 &${gameObjectFileId}`,
    "GameObject:",
    "  m_ObjectHideFlags: 0",
    "  m_CorrespondingSourceObject: {fileID: 0}",
    "  m_PrefabInstance: {fileID: 0}",
    "  m_PrefabAsset: {fileID: 0}",
    "  serializedVersion: 6",
    "  m_Component:",
    `  - component: {fileID: ${transformFileId}}`,
    `  - component: {fileID: ${rendererFileId}}`,
    `  - component: {fileID: ${colliderFileId}}`,
    `  - component: {fileID: ${meshFilterFileId}}`,
    `  - component: {fileID: ${basicEnemyComponentFileId}}`,
    "  m_Layer: 0",
    `  m_Name: ${BASIC_ENEMY_NAME}`,
    "  m_TagString: Untagged",
    "  m_Icon: {fileID: 0}",
    "  m_NavMeshLayer: 0",
    "  m_StaticEditorFlags: 0",
    "  m_IsActive: 1",
    buildBasicEnemyComponentBlock(basicEnemyComponentFileId, gameObjectFileId, scriptGuid).trimEnd(),
    `--- !u!23 &${rendererFileId}`,
    "MeshRenderer:",
    "  m_ObjectHideFlags: 0",
    "  m_CorrespondingSourceObject: {fileID: 0}",
    "  m_PrefabInstance: {fileID: 0}",
    "  m_PrefabAsset: {fileID: 0}",
    `  m_GameObject: {fileID: ${gameObjectFileId}}`,
    "  m_Enabled: 1",
    "  m_CastShadows: 1",
    "  m_ReceiveShadows: 1",
    "  m_DynamicOccludee: 1",
    "  m_StaticShadowCaster: 0",
    "  m_MotionVectors: 1",
    "  m_LightProbeUsage: 1",
    "  m_ReflectionProbeUsage: 1",
    "  m_RayTracingMode: 2",
    "  m_RayTraceProcedural: 0",
    "  m_RayTracingAccelStructBuildFlagsOverride: 0",
    "  m_RayTracingAccelStructBuildFlags: 1",
    "  m_SmallMeshCulling: 1",
    "  m_ForceMeshLod: -1",
    "  m_MeshLodSelectionBias: 0",
    "  m_RenderingLayerMask: 1",
    "  m_RendererPriority: 0",
    "  m_Materials:",
    "  - {fileID: 10303, guid: 0000000000000000f000000000000000, type: 0}",
    "  m_StaticBatchInfo:",
    "    firstSubMesh: 0",
    "    subMeshCount: 0",
    "  m_StaticBatchRoot: {fileID: 0}",
    "  m_ProbeAnchor: {fileID: 0}",
    "  m_LightProbeVolumeOverride: {fileID: 0}",
    "  m_ScaleInLightmap: 1",
    "  m_ReceiveGI: 1",
    "  m_PreserveUVs: 1",
    "  m_IgnoreNormalsForChartDetection: 0",
    "  m_ImportantGI: 0",
    "  m_StitchLightmapSeams: 1",
    "  m_SelectedEditorRenderState: 3",
    "  m_MinimumChartSize: 4",
    "  m_AutoUVMaxDistance: 0.5",
    "  m_AutoUVMaxAngle: 89",
    "  m_LightmapParameters: {fileID: 0}",
    "  m_GlobalIlluminationMeshLod: 0",
    "  m_SortingLayerID: 0",
    "  m_SortingLayer: 0",
    "  m_SortingOrder: 0",
    "  m_AdditionalVertexStreams: {fileID: 0}",
    `--- !u!136 &${colliderFileId}`,
    "CapsuleCollider:",
    "  m_ObjectHideFlags: 0",
    "  m_CorrespondingSourceObject: {fileID: 0}",
    "  m_PrefabInstance: {fileID: 0}",
    "  m_PrefabAsset: {fileID: 0}",
    `  m_GameObject: {fileID: ${gameObjectFileId}}`,
    "  m_Material: {fileID: 0}",
    "  m_IncludeLayers:",
    "    serializedVersion: 2",
    "    m_Bits: 0",
    "  m_ExcludeLayers:",
    "    serializedVersion: 2",
    "    m_Bits: 0",
    "  m_LayerOverridePriority: 0",
    "  m_IsTrigger: 0",
    "  m_ProvidesContacts: 0",
    "  m_Enabled: 1",
    "  serializedVersion: 2",
    "  m_Radius: 0.5",
    "  m_Height: 2",
    "  m_Direction: 1",
    "  m_Center: {x: 0, y: 0, z: 0}",
    `--- !u!33 &${meshFilterFileId}`,
    "MeshFilter:",
    "  m_ObjectHideFlags: 0",
    "  m_CorrespondingSourceObject: {fileID: 0}",
    "  m_PrefabInstance: {fileID: 0}",
    "  m_PrefabAsset: {fileID: 0}",
    `  m_GameObject: {fileID: ${gameObjectFileId}}`,
    "  m_Mesh: {fileID: 10208, guid: 0000000000000000e000000000000000, type: 0}",
    `--- !u!4 &${transformFileId}`,
    "Transform:",
    "  m_ObjectHideFlags: 0",
    "  m_CorrespondingSourceObject: {fileID: 0}",
    "  m_PrefabInstance: {fileID: 0}",
    "  m_PrefabAsset: {fileID: 0}",
    `  m_GameObject: {fileID: ${gameObjectFileId}}`,
    "  serializedVersion: 2",
    "  m_LocalRotation: {x: 0, y: 0, z: 0, w: 1}",
    `  m_LocalPosition: {x: ${spawnPosition.x}, y: ${spawnPosition.y}, z: ${spawnPosition.z}}`,
    "  m_LocalScale: {x: 1.25, y: 1.25, z: 1.25}",
    "  m_ConstrainProportionsScale: 0",
    "  m_Children: []",
    "  m_Father: {fileID: 0}",
    "  m_LocalEulerAnglesHint: {x: 0, y: 0, z: 0}",
    "",
  ].join("\n");
}

async function loadFallRecoveryContext(projectPath: string): Promise<{
  parsedScene: ParsedScene;
  playerObject: SceneObject | null;
  playerTransformFileId: string | null;
  playerSpawnPosition: { x: number; y: number; z: number } | null;
  farResetPointObject: SceneObject | null;
  farResetPointTransformFileId: string | null;
  scriptGuid: string | null;
  verification: FallRecoveryVerification;
}> {
  const parsedScene = await parseProjectScene(projectPath);
  const playerObject = parsedScene.playerCandidate;
  const playerTransformFileId = parsedScene.playerTransformFileId;
  const playerSpawnPosition = parseVector3FromTransformBlock(findBlock(parsedScene.blocks, playerTransformFileId));
  const farResetPointObject = findSceneObjectByName(parsedScene.objects, "FarResetPoint");
  const farResetPointTransformFileId = farResetPointObject
    ? findComponentFileIdByType(parsedScene.blocks, farResetPointObject, "4")
    : null;
  const scriptGuid = await readGuidFromMeta(path.join(parsedScene.rootPath, FALL_RECOVERY_META_PATH));
  const verification = buildFallRecoveryVerification(
    parsedScene.blocks,
    playerObject,
    farResetPointTransformFileId,
    scriptGuid,
    playerSpawnPosition,
  );

  return {
    parsedScene,
    playerObject,
    playerTransformFileId,
    playerSpawnPosition,
    farResetPointObject,
    farResetPointTransformFileId,
    scriptGuid,
    verification,
  };
}

function collectStaleFallRecoveryComponentIds(
  parsedScene: ParsedScene,
  playerObject: SceneObject,
  scriptGuid: string | null,
): string[] {
  const candidateIds = parsedScene.blocks
    .filter((block) => isFallRecoveryCandidateBlock(block, playerObject.gameObjectFileId, scriptGuid))
    .map((block) => block.fileId);

  const playerExtraIds = playerObject.componentFileIds.filter((componentFileId) => {
    const block = findBlock(parsedScene.blocks, componentFileId);
    if (!block) {
      return true;
    }

    return isFallRecoveryCandidateBlock(block, playerObject.gameObjectFileId, scriptGuid);
  });

  return [...new Set([...candidateIds, ...playerExtraIds])];
}

function isBasicEnemyCandidateBlock(block: SceneBlock, enemyGameObjectId: string | null, scriptGuid: string | null): boolean {
  if (block.typeId !== "114") {
    return false;
  }

  if (enemyGameObjectId && extractBlockGameObjectFileId(block) !== enemyGameObjectId) {
    return false;
  }

  const blockScriptGuid = extractBlockScriptGuid(block);
  if (scriptGuid && blockScriptGuid === scriptGuid) {
    return true;
  }

  return /BasicEnemy/.test(block.body)
    || /^  rotationSpeedDegrees:/m.test(block.body)
    || /^  debugSpawn:/m.test(block.body);
}

function hasExpectedBasicEnemySerializedFields(block: SceneBlock | null): boolean {
  if (!block) {
    return false;
  }

  return /^  rotationSpeedDegrees: 24$/m.test(block.body)
    && /^  debugSpawn: 1$/m.test(block.body);
}

function buildBasicEnemyVerification(
  blocks: readonly SceneBlock[],
  enemyObject: SceneObject | null,
  scriptGuid: string | null,
  groundPosition: { x: number; y: number; z: number } | null,
): BasicEnemyVerification {
  if (!enemyObject) {
    return {
      componentFileId: null,
      componentListLinked: false,
      monoBehaviourBlockExists: false,
      scriptGuidMatchesMeta: false,
      expectedFieldsPresent: false,
      positionedOnGround: false,
      componentVisibleToUnity: false,
      brokenLinks: ["Enemy GameObject was not found."],
    };
  }

  const brokenLinks: string[] = [];
  const transformBlock = findBlock(blocks, findComponentFileIdByType(blocks, enemyObject, "4"));
  const enemyPosition = parseVector3FromTransformBlock(transformBlock);
  const enemyScale = parseTransformScaleFromBlock(transformBlock);
  const positionedOnGround = isEnemyGrounded(enemyPosition, enemyScale, groundPosition);
  const linkedComponentIds = enemyObject.componentFileIds.filter((componentFileId) => {
    const block = findBlock(blocks, componentFileId);
    return block !== null && isBasicEnemyCandidateBlock(block, enemyObject.gameObjectFileId, scriptGuid);
  });
  const componentFileId = linkedComponentIds[0] ?? null;
  const linkedComponentBlock = findBlock(blocks, componentFileId);
  const componentListLinked = componentFileId !== null && isSafeSceneFileId(componentFileId);
  const monoBehaviourBlockExists = linkedComponentBlock?.typeId === "114" && extractBlockGameObjectFileId(linkedComponentBlock) === enemyObject.gameObjectFileId;
  const scriptGuidMatchesMeta = scriptGuid !== null && extractBlockScriptGuid(linkedComponentBlock) === scriptGuid;
  const expectedFieldsPresent = hasExpectedBasicEnemySerializedFields(linkedComponentBlock);
  const componentVisibleToUnity = componentListLinked && monoBehaviourBlockExists && scriptGuidMatchesMeta && expectedFieldsPresent;

  if (linkedComponentIds.length === 0) {
    brokenLinks.push("Enemy m_Component list does not link a BasicEnemy MonoBehaviour block.");
  }

  if (componentFileId !== null && !isSafeSceneFileId(componentFileId)) {
    brokenLinks.push(`Enemy references BasicEnemy with unsafe scene fileID ${componentFileId}.`);
  }

  if (!monoBehaviourBlockExists) {
    brokenLinks.push("Referenced BasicEnemy MonoBehaviour block is missing or not linked back to Enemy.");
  }

  if (scriptGuid === null) {
    brokenLinks.push("BasicEnemy.cs.meta is missing, so Unity cannot resolve the script GUID.");
  } else if (!scriptGuidMatchesMeta) {
    brokenLinks.push("BasicEnemy MonoBehaviour block does not reference the BasicEnemy.cs.meta GUID.");
  }

  if (!expectedFieldsPresent) {
    brokenLinks.push("BasicEnemy MonoBehaviour block does not serialize the expected rotation/debug fields.");
  }

  if (!positionedOnGround) {
    brokenLinks.push("Enemy Transform is not positioned on the detected ground plane.");
  }

  return {
    componentFileId,
    componentListLinked,
    monoBehaviourBlockExists,
    scriptGuidMatchesMeta,
    expectedFieldsPresent,
    positionedOnGround,
    componentVisibleToUnity,
    brokenLinks,
  };
}

async function loadBasicEnemyContext(projectPath: string): Promise<{
  parsedScene: ParsedScene;
  playerObject: SceneObject | null;
  playerSpawnPosition: { x: number; y: number; z: number } | null;
  enemyObject: SceneObject | null;
  enemyTransformFileId: string | null;
  groundObject: SceneObject | null;
  groundPosition: { x: number; y: number; z: number } | null;
  scriptGuid: string | null;
  verification: BasicEnemyVerification;
}> {
  const parsedScene = await parseProjectScene(projectPath);
  const playerObject = parsedScene.playerCandidate;
  const playerSpawnPosition = parseVector3FromTransformBlock(findBlock(parsedScene.blocks, parsedScene.playerTransformFileId));
  const enemyObject = findSceneObjectByName(parsedScene.objects, BASIC_ENEMY_NAME);
  const enemyTransformFileId = enemyObject ? findComponentFileIdByType(parsedScene.blocks, enemyObject, "4") : null;
  const groundDetection = detectPrimaryGroundRenderer(parsedScene.blocks, parsedScene.objects);
  const groundObject = groundDetection?.sceneObject ?? null;
  const groundTransformFileId = groundObject ? findComponentFileIdByType(parsedScene.blocks, groundObject, "4") : null;
  const groundPosition = parseVector3FromTransformBlock(findBlock(parsedScene.blocks, groundTransformFileId));
  const scriptGuid = await readGuidFromMeta(path.join(parsedScene.rootPath, BASIC_ENEMY_META_PATH));
  const verification = buildBasicEnemyVerification(parsedScene.blocks, enemyObject, scriptGuid, groundPosition);

  return {
    parsedScene,
    playerObject,
    playerSpawnPosition,
    enemyObject,
    enemyTransformFileId,
    groundObject,
    groundPosition,
    scriptGuid,
    verification,
  };
}

function collectStaleBasicEnemyComponentIds(parsedScene: ParsedScene, enemyObject: SceneObject, scriptGuid: string | null): string[] {
  const candidateIds = parsedScene.blocks
    .filter((block) => isBasicEnemyCandidateBlock(block, enemyObject.gameObjectFileId, scriptGuid))
    .map((block) => block.fileId);

  const enemyExtraIds = enemyObject.componentFileIds.filter((componentFileId) => {
    const block = findBlock(parsedScene.blocks, componentFileId);
    if (!block) {
      return true;
    }

    return isBasicEnemyCandidateBlock(block, enemyObject.gameObjectFileId, scriptGuid);
  });

  return [...new Set([...candidateIds, ...enemyExtraIds])];
}

function isPlayerAttackCandidateBlock(block: SceneBlock, playerGameObjectId: string | null, scriptGuid: string | null): boolean {
  if (block.typeId !== "114") {
    return false;
  }

  if (playerGameObjectId && extractBlockGameObjectFileId(block) !== playerGameObjectId) {
    return false;
  }

  const blockScriptGuid = extractBlockScriptGuid(block);
  if (scriptGuid && blockScriptGuid === scriptGuid) {
    return true;
  }

  return /PlayerAttack/.test(block.body)
    || /^  attackRange:/m.test(block.body)
    || /^  attackCooldown:/m.test(block.body)
    || /^  attackRadius:/m.test(block.body)
    || /^  attackKey:/m.test(block.body)
    || /^  allowMouse0:/m.test(block.body)
    || /^  debugHits:/m.test(block.body);
}

function hasExpectedPlayerAttackSerializedFields(block: SceneBlock | null): {
  attackKeyConfigured: boolean;
  expectedFieldsPresent: boolean;
} {
  if (!block) {
    return {
      attackKeyConfigured: false,
      expectedFieldsPresent: false,
    };
  }

  const attackKeyConfigured = /^  attackKey: \d+$/m.test(block.body) && /^  allowMouse0: 1$/m.test(block.body);
  const expectedFieldsPresent = /^  attackRange: 2.5$/m.test(block.body)
    && /^  attackCooldown: 0.35$/m.test(block.body)
    && /^  attackRadius: 1.1$/m.test(block.body)
    && /^  debugHits: 1$/m.test(block.body)
    && attackKeyConfigured;

  return {
    attackKeyConfigured,
    expectedFieldsPresent,
  };
}

function buildPlayerAttackVerification(
  blocks: readonly SceneBlock[],
  playerObject: SceneObject | null,
  scriptGuid: string | null,
): PlayerAttackVerification {
  if (!playerObject) {
    return {
      componentFileId: null,
      componentListLinked: false,
      monoBehaviourBlockExists: false,
      scriptGuidMatchesMeta: false,
      attackKeyConfigured: false,
      expectedFieldsPresent: false,
      componentVisibleToUnity: false,
      brokenLinks: ["Player GameObject was not found."],
    };
  }

  const brokenLinks: string[] = [];
  const linkedComponentIds = playerObject.componentFileIds.filter((componentFileId) => {
    const block = findBlock(blocks, componentFileId);
    return block !== null && isPlayerAttackCandidateBlock(block, playerObject.gameObjectFileId, scriptGuid);
  });
  const componentFileId = linkedComponentIds[0] ?? null;
  const linkedComponentBlock = findBlock(blocks, componentFileId);
  const componentListLinked = componentFileId !== null && isSafeSceneFileId(componentFileId);
  const monoBehaviourBlockExists = linkedComponentBlock?.typeId === "114" && extractBlockGameObjectFileId(linkedComponentBlock) === playerObject.gameObjectFileId;
  const scriptGuidMatchesMeta = scriptGuid !== null && extractBlockScriptGuid(linkedComponentBlock) === scriptGuid;
  const serializedFields = hasExpectedPlayerAttackSerializedFields(linkedComponentBlock);
  const componentVisibleToUnity = componentListLinked && monoBehaviourBlockExists && scriptGuidMatchesMeta && serializedFields.expectedFieldsPresent;

  if (linkedComponentIds.length === 0) {
    brokenLinks.push("Player m_Component list does not link a PlayerAttack MonoBehaviour block.");
  }

  if (componentFileId !== null && !isSafeSceneFileId(componentFileId)) {
    brokenLinks.push(`Player references PlayerAttack with unsafe scene fileID ${componentFileId}.`);
  }

  if (!monoBehaviourBlockExists) {
    brokenLinks.push("Referenced PlayerAttack MonoBehaviour block is missing or not linked back to Player.");
  }

  if (scriptGuid === null) {
    brokenLinks.push("PlayerAttack.cs.meta is missing, so Unity cannot resolve the script GUID.");
  } else if (!scriptGuidMatchesMeta) {
    brokenLinks.push("PlayerAttack MonoBehaviour block does not reference the PlayerAttack.cs.meta GUID.");
  }

  if (!serializedFields.attackKeyConfigured) {
    brokenLinks.push("PlayerAttack MonoBehaviour block does not serialize the expected Mouse0/E attack key configuration.");
  }

  if (!serializedFields.expectedFieldsPresent) {
    brokenLinks.push("PlayerAttack MonoBehaviour block does not serialize the expected attack range/cooldown fields.");
  }

  return {
    componentFileId,
    componentListLinked,
    monoBehaviourBlockExists,
    scriptGuidMatchesMeta,
    attackKeyConfigured: serializedFields.attackKeyConfigured,
    expectedFieldsPresent: serializedFields.expectedFieldsPresent,
    componentVisibleToUnity,
    brokenLinks,
  };
}

function buildPlayerAttackComponentBlock(componentFileId: string, playerGameObjectFileId: string, scriptGuid: string): string {
  return [
    `--- !u!114 &${componentFileId}`,
    "MonoBehaviour:",
    "  m_ObjectHideFlags: 0",
    "  m_CorrespondingSourceObject: {fileID: 0}",
    "  m_PrefabInstance: {fileID: 0}",
    "  m_PrefabAsset: {fileID: 0}",
    `  m_GameObject: {fileID: ${playerGameObjectFileId}}`,
    "  m_Enabled: 1",
    "  m_EditorHideFlags: 0",
    `  m_Script: {fileID: 11500000, guid: ${scriptGuid}, type: 3}`,
    "  m_Name: ",
    "  m_EditorClassIdentifier:",
    "  attackRange: 2.5",
    "  attackCooldown: 0.35",
    "  attackRadius: 1.1",
    "  attackKey: 101",
    "  allowMouse0: 1",
    "  debugHits: 1",
    "",
  ].join("\n");
}

async function loadPlayerAttackContext(projectPath: string): Promise<{
  parsedScene: ParsedScene;
  playerObject: SceneObject | null;
  enemyObject: SceneObject | null;
  scriptGuid: string | null;
  verification: PlayerAttackVerification;
}> {
  const parsedScene = await parseProjectScene(projectPath);
  const playerObject = parsedScene.playerCandidate;
  const enemyObject = findSceneObjectByName(parsedScene.objects, BASIC_ENEMY_NAME);
  const scriptGuid = await readGuidFromMeta(path.join(parsedScene.rootPath, PLAYER_ATTACK_META_PATH));
  const verification = buildPlayerAttackVerification(parsedScene.blocks, playerObject, scriptGuid);

  return {
    parsedScene,
    playerObject,
    enemyObject,
    scriptGuid,
    verification,
  };
}

function collectStalePlayerAttackComponentIds(parsedScene: ParsedScene, playerObject: SceneObject, scriptGuid: string | null): string[] {
  const candidateIds = parsedScene.blocks
    .filter((block) => isPlayerAttackCandidateBlock(block, playerObject.gameObjectFileId, scriptGuid))
    .map((block) => block.fileId);

  const playerExtraIds = playerObject.componentFileIds.filter((componentFileId) => {
    const block = findBlock(parsedScene.blocks, componentFileId);
    if (!block) {
      return true;
    }

    return isPlayerAttackCandidateBlock(block, playerObject.gameObjectFileId, scriptGuid);
  });

  return [...new Set([...candidateIds, ...playerExtraIds])];
}

export async function inspectUnityFallRecoveryStatus(projectPath: string, recoverySafe: boolean): Promise<UnityFallRecoveryStatus> {
  const context = await loadFallRecoveryContext(projectPath);
  const scriptAbsolutePath = path.join(context.parsedScene.rootPath, FALL_RECOVERY_SCRIPT_PATH);
  const scriptMetaAbsolutePath = path.join(context.parsedScene.rootPath, FALL_RECOVERY_META_PATH);
  const fallRecoveryScriptExists = await fileExists(scriptAbsolutePath);
  const fallRecoveryMetaExists = await fileExists(scriptMetaAbsolutePath);
  const backupPath = sceneBackupPathFor(context.parsedScene.sceneAbsolutePath, FALL_RECOVERY_SCENE_BACKUP_TAG);
  const backupExists = await fileExists(backupPath);
  const details: string[] = [];

  if (!context.playerObject) {
    details.push("No Player object was detected in the selected scene.");
  } else {
    details.push(`Detected player object: ${context.playerObject.name}`);
  }

  if (context.farResetPointObject && context.farResetPointTransformFileId) {
    details.push(`Using FarResetPoint as respawn target: ${context.farResetPointObject.name}`);
  } else if (context.playerSpawnPosition) {
    details.push(`FarResetPoint not found; fallback spawn position will be used: {x: ${context.playerSpawnPosition.x}, y: ${context.playerSpawnPosition.y}, z: ${context.playerSpawnPosition.z}}`);
  } else {
    details.push("Neither FarResetPoint nor a fallback player spawn position could be resolved.");
  }

  if (!fallRecoveryScriptExists) {
    details.push(`Fall recovery script asset is missing: ${FALL_RECOVERY_SCRIPT_PATH}`);
  } else if (!fallRecoveryMetaExists) {
    details.push(`Fall recovery script meta is missing: ${FALL_RECOVERY_META_PATH}`);
  }

  details.push(`Fall threshold serialized: ${context.verification.fallThresholdPresent ? "YES" : "NO"}`);

  const respawnTargetAssigned = context.verification.respawnTargetAssigned && context.verification.fallbackSpawnSerialized;
  const safeToOpenUnityForCompileOrPlaytest = recoverySafe
    && fallRecoveryScriptExists
    && fallRecoveryMetaExists
    && context.verification.componentVisibleToUnity;

  return {
    scenePath: context.parsedScene.scenePath,
    sceneAbsolutePath: context.parsedScene.sceneAbsolutePath,
    playerName: context.playerObject?.name ?? null,
    respawnTargetName: context.farResetPointObject?.name ?? null,
    fallRecoveryScriptExists,
    fallRecoveryAttached: context.verification.componentVisibleToUnity,
    respawnTargetAssigned,
    fallThresholdPresent: context.verification.fallThresholdPresent,
    backupExists,
    safeToOpenUnityForCompileOrPlaytest,
    details,
    safety: {
      readOnly: true,
      noUnityExecution: true,
    },
  };
}

export async function applyUnityFallRecovery(projectPath: string, recoverySafe: boolean): Promise<UnityFallRecoveryApplyResult> {
  const contextBefore = await loadFallRecoveryContext(projectPath);
  const backupPath = sceneBackupPathFor(contextBefore.parsedScene.sceneAbsolutePath, FALL_RECOVERY_SCENE_BACKUP_TAG);
  const backupExists = await fileExists(backupPath);
  const blockedReasons: string[] = [];

  if (!recoverySafe) {
    blockedReasons.push("Unity recovery guard did not report a safe state for fall recovery mutation.");
  }

  if (!contextBefore.playerObject || !contextBefore.playerTransformFileId || !contextBefore.playerSpawnPosition) {
    blockedReasons.push("A Player object with a Transform and fallback spawn position was not found in the selected scene.");
  }

  if (blockedReasons.length > 0) {
    return {
      applied: false,
      scenePath: contextBefore.parsedScene.scenePath,
      sceneAbsolutePath: contextBefore.parsedScene.sceneAbsolutePath,
      playerName: contextBefore.playerObject?.name ?? null,
      respawnTargetName: contextBefore.farResetPointObject?.name ?? null,
      scriptPath: FALL_RECOVERY_SCRIPT_PATH,
      backupPath,
      fallRecoveryScriptExists: await fileExists(path.join(contextBefore.parsedScene.rootPath, FALL_RECOVERY_SCRIPT_PATH)),
      fallRecoveryAttached: false,
      respawnTargetAssigned: false,
      fallThresholdPresent: false,
      safeToOpenUnityForCompileOrPlaytest: false,
      blockedReasons,
      safety: {
        noUnityExecution: true,
        backupCreated: backupExists,
        sceneWritten: false,
      },
    };
  }

  const ensuredScript = await ensureFallRecoveryScript(contextBefore.parsedScene.rootPath);
  const contextAfterScript = await loadFallRecoveryContext(projectPath);
  if (contextAfterScript.verification.componentVisibleToUnity) {
    const status = await inspectUnityFallRecoveryStatus(projectPath, recoverySafe);
    return {
      applied: false,
      scenePath: status.scenePath,
      sceneAbsolutePath: status.sceneAbsolutePath,
      playerName: status.playerName,
      respawnTargetName: status.respawnTargetName,
      scriptPath: FALL_RECOVERY_SCRIPT_PATH,
      backupPath,
      fallRecoveryScriptExists: status.fallRecoveryScriptExists,
      fallRecoveryAttached: status.fallRecoveryAttached,
      respawnTargetAssigned: status.respawnTargetAssigned,
      fallThresholdPresent: status.fallThresholdPresent,
      safeToOpenUnityForCompileOrPlaytest: status.safeToOpenUnityForCompileOrPlaytest,
      blockedReasons: ["FallRecovery is already attached to Player with the expected serialized fields."],
      safety: {
        noUnityExecution: true,
        backupCreated: backupExists,
        sceneWritten: !ensuredScript.scriptExisted || !ensuredScript.metaExisted,
      },
    };
  }

  if (!backupExists) {
    await copyFile(contextAfterScript.parsedScene.sceneAbsolutePath, backupPath);
  }

  const playerObject = contextAfterScript.playerObject;
  const playerSpawnPosition = contextAfterScript.playerSpawnPosition;
  if (!playerObject || !playerSpawnPosition) {
    throw new Error("Fall recovery prerequisites were not present during apply.");
  }

  const playerBlock = findBlock(contextAfterScript.parsedScene.blocks, playerObject.gameObjectFileId);
  if (!playerBlock) {
    throw new Error("Player GameObject block was not found during fall recovery apply.");
  }

  let updatedSource = contextAfterScript.parsedScene.source;
  const staleComponentIds = collectStaleFallRecoveryComponentIds(contextAfterScript.parsedScene, playerObject, ensuredScript.guid);
  const filteredComponentIds = playerObject.componentFileIds.filter((componentFileId) => !staleComponentIds.includes(componentFileId));
  const filteredBlocks = contextAfterScript.parsedScene.blocks.filter((block) => !staleComponentIds.includes(block.fileId));
  const newComponentFileId = nextSafeSceneFileId(filteredBlocks);
  const updatedPlayerBlock = replaceGameObjectComponentList(playerBlock, [...filteredComponentIds, newComponentFileId]);
  updatedSource = updatedSource.replace(playerBlock.raw, updatedPlayerBlock);

  for (const staleComponentId of staleComponentIds) {
    const staleBlock = findBlock(contextAfterScript.parsedScene.blocks, staleComponentId);
    if (staleBlock) {
      updatedSource = updatedSource.replace(staleBlock.raw, "");
    }
  }

  updatedSource = `${updatedSource.trimEnd()}\n${buildFallRecoveryComponentBlock(
    newComponentFileId,
    playerObject.gameObjectFileId,
    ensuredScript.guid,
    contextAfterScript.farResetPointTransformFileId,
    playerSpawnPosition,
  )}`;
  await writeFile(contextAfterScript.parsedScene.sceneAbsolutePath, updatedSource, "utf-8");

  const status = await inspectUnityFallRecoveryStatus(projectPath, recoverySafe);
  return {
    applied: status.fallRecoveryAttached,
    scenePath: status.scenePath,
    sceneAbsolutePath: status.sceneAbsolutePath,
    playerName: status.playerName,
    respawnTargetName: status.respawnTargetName,
    scriptPath: FALL_RECOVERY_SCRIPT_PATH,
    backupPath,
    fallRecoveryScriptExists: status.fallRecoveryScriptExists,
    fallRecoveryAttached: status.fallRecoveryAttached,
    respawnTargetAssigned: status.respawnTargetAssigned,
    fallThresholdPresent: status.fallThresholdPresent,
    safeToOpenUnityForCompileOrPlaytest: status.safeToOpenUnityForCompileOrPlaytest,
    blockedReasons: status.fallRecoveryAttached ? [] : ["FallRecovery was not attached to Player with the expected serialized fields."],
    safety: {
      noUnityExecution: true,
      backupCreated: true,
      sceneWritten: true,
    },
  };
}

export async function rollbackUnityFallRecovery(projectPath: string, recoverySafe: boolean): Promise<UnityFallRecoveryRollbackResult> {
  const contextBefore = await loadFallRecoveryContext(projectPath);
  const backupPath = sceneBackupPathFor(contextBefore.parsedScene.sceneAbsolutePath, FALL_RECOVERY_SCENE_BACKUP_TAG);
  const scriptCreatedMarkerPath = path.join(contextBefore.parsedScene.rootPath, FALL_RECOVERY_CREATED_SCRIPT_MARKER);
  const metaCreatedMarkerPath = path.join(contextBefore.parsedScene.rootPath, FALL_RECOVERY_CREATED_META_MARKER);
  const createdScriptByAie = await fileExists(scriptCreatedMarkerPath);
  const createdMetaByAie = await fileExists(metaCreatedMarkerPath);

  if (!(await fileExists(backupPath))) {
    const status = await inspectUnityFallRecoveryStatus(projectPath, recoverySafe);
    return {
      restored: false,
      scenePath: status.scenePath,
      sceneAbsolutePath: status.sceneAbsolutePath,
      playerName: status.playerName,
      respawnTargetName: status.respawnTargetName,
      scriptPath: FALL_RECOVERY_SCRIPT_PATH,
      backupPath,
      fallRecoveryAttached: status.fallRecoveryAttached,
      respawnTargetAssigned: status.respawnTargetAssigned,
      fallRecoveryScriptExists: status.fallRecoveryScriptExists,
      safeToOpenUnityForCompileOrPlaytest: status.safeToOpenUnityForCompileOrPlaytest,
      blockedReasons: ["No fall recovery scene backup was found for rollback."],
      safety: {
        noUnityExecution: true,
        backupRetained: true,
        scriptRemoved: false,
      },
    };
  }

  const backupSource = await readFile(backupPath, "utf-8");
  await writeFile(contextBefore.parsedScene.sceneAbsolutePath, backupSource, "utf-8");

  let scriptRemoved = false;
  if (createdScriptByAie) {
    const scriptAbsolutePath = path.join(contextBefore.parsedScene.rootPath, FALL_RECOVERY_SCRIPT_PATH);
    if (await fileExists(scriptAbsolutePath)) {
      await writeFile(scriptAbsolutePath, "", "utf-8");
      await stat(scriptAbsolutePath);
      await import("node:fs/promises").then(({ unlink }) => unlink(scriptAbsolutePath));
      scriptRemoved = true;
    }
    await import("node:fs/promises").then(({ unlink }) => unlink(scriptCreatedMarkerPath));
  }

  if (createdMetaByAie) {
    const metaAbsolutePath = path.join(contextBefore.parsedScene.rootPath, FALL_RECOVERY_META_PATH);
    if (await fileExists(metaAbsolutePath)) {
      await import("node:fs/promises").then(({ unlink }) => unlink(metaAbsolutePath));
      scriptRemoved = true;
    }
    await import("node:fs/promises").then(({ unlink }) => unlink(metaCreatedMarkerPath));
  }

  const status = await inspectUnityFallRecoveryStatus(projectPath, recoverySafe);
  return {
    restored: true,
    scenePath: status.scenePath,
    sceneAbsolutePath: status.sceneAbsolutePath,
    playerName: status.playerName,
    respawnTargetName: status.respawnTargetName,
    scriptPath: FALL_RECOVERY_SCRIPT_PATH,
    backupPath,
    fallRecoveryAttached: status.fallRecoveryAttached,
    respawnTargetAssigned: status.respawnTargetAssigned,
    fallRecoveryScriptExists: status.fallRecoveryScriptExists,
    safeToOpenUnityForCompileOrPlaytest: status.safeToOpenUnityForCompileOrPlaytest,
    blockedReasons: [],
    safety: {
      noUnityExecution: true,
      backupRetained: true,
      scriptRemoved,
    },
  };
}

export async function inspectUnityBasicEnemyStatus(projectPath: string, recoverySafe: boolean): Promise<UnityBasicEnemyStatus> {
  const context = await loadBasicEnemyContext(projectPath);
  const scriptAbsolutePath = path.join(context.parsedScene.rootPath, BASIC_ENEMY_SCRIPT_PATH);
  const scriptMetaAbsolutePath = path.join(context.parsedScene.rootPath, BASIC_ENEMY_META_PATH);
  const basicEnemyScriptExists = await fileExists(scriptAbsolutePath);
  const basicEnemyMetaExists = await fileExists(scriptMetaAbsolutePath);
  const backupPath = sceneBackupPathFor(context.parsedScene.sceneAbsolutePath, BASIC_ENEMY_SCENE_BACKUP_TAG);
  const backupExists = await fileExists(backupPath);
  const details: string[] = [];

  if (!context.enemyObject) {
    details.push("Enemy GameObject was not found in the selected scene.");
  } else {
    details.push(`Detected enemy object: ${context.enemyObject.name}`);
  }

  if (context.playerSpawnPosition) {
    details.push(`Player spawn reference: {x: ${context.playerSpawnPosition.x}, y: ${context.playerSpawnPosition.y}, z: ${context.playerSpawnPosition.z}}`);
  } else {
    details.push("Player spawn reference could not be resolved.");
  }

  if (context.groundObject && context.groundPosition) {
    details.push(`Detected ground object: ${context.groundObject.name} at y=${context.groundPosition.y}`);
  } else {
    details.push("Ground object could not be resolved for enemy placement verification.");
  }

  if (!basicEnemyScriptExists) {
    details.push(`Basic enemy script asset is missing: ${BASIC_ENEMY_SCRIPT_PATH}`);
  } else if (!basicEnemyMetaExists) {
    details.push(`Basic enemy script meta is missing: ${BASIC_ENEMY_META_PATH}`);
  }

  const safeToOpenUnityForCompileOrPlaytest = recoverySafe
    && basicEnemyScriptExists
    && basicEnemyMetaExists
    && context.enemyObject !== null
    && context.verification.componentVisibleToUnity
    && context.verification.positionedOnGround;

  return {
    scenePath: context.parsedScene.scenePath,
    sceneAbsolutePath: context.parsedScene.sceneAbsolutePath,
    enemyName: context.enemyObject?.name ?? null,
    basicEnemyScriptExists,
    enemyExists: context.enemyObject !== null,
    scriptAttached: context.verification.componentVisibleToUnity,
    positionedOnGround: context.verification.positionedOnGround,
    backupExists,
    safeToOpenUnityForCompileOrPlaytest,
    details,
    safety: {
      readOnly: true,
      noUnityExecution: true,
    },
  };
}

export async function applyUnityBasicEnemy(projectPath: string, recoverySafe: boolean): Promise<UnityBasicEnemyApplyResult> {
  const contextBefore = await loadBasicEnemyContext(projectPath);
  const backupPath = sceneBackupPathFor(contextBefore.parsedScene.sceneAbsolutePath, BASIC_ENEMY_SCENE_BACKUP_TAG);
  const backupExists = await fileExists(backupPath);
  const blockedReasons: string[] = [];

  if (!recoverySafe) {
    blockedReasons.push("Unity recovery guard did not report a safe state for basic enemy mutation.");
  }

  if (!contextBefore.playerSpawnPosition) {
    blockedReasons.push("A Player spawn position was not found in the selected scene.");
  }

  if (!contextBefore.groundPosition) {
    blockedReasons.push("A ground object was not detected, so safe enemy placement could not be verified.");
  }

  if (blockedReasons.length > 0) {
    return {
      applied: false,
      scenePath: contextBefore.parsedScene.scenePath,
      sceneAbsolutePath: contextBefore.parsedScene.sceneAbsolutePath,
      enemyName: contextBefore.enemyObject?.name ?? null,
      scriptPath: BASIC_ENEMY_SCRIPT_PATH,
      backupPath,
      basicEnemyScriptExists: await fileExists(path.join(contextBefore.parsedScene.rootPath, BASIC_ENEMY_SCRIPT_PATH)),
      enemyExists: contextBefore.enemyObject !== null,
      scriptAttached: false,
      positionedOnGround: contextBefore.verification.positionedOnGround,
      safeToOpenUnityForCompileOrPlaytest: false,
      blockedReasons,
      safety: {
        noUnityExecution: true,
        backupCreated: backupExists,
        sceneWritten: false,
      },
    };
  }

  const ensuredScript = await ensureBasicEnemyScript(contextBefore.parsedScene.rootPath);
  const contextAfterScript = await loadBasicEnemyContext(projectPath);

  if (contextAfterScript.enemyObject && contextAfterScript.verification.componentVisibleToUnity && contextAfterScript.verification.positionedOnGround) {
    const status = await inspectUnityBasicEnemyStatus(projectPath, recoverySafe);
    return {
      applied: false,
      scenePath: status.scenePath,
      sceneAbsolutePath: status.sceneAbsolutePath,
      enemyName: status.enemyName,
      scriptPath: BASIC_ENEMY_SCRIPT_PATH,
      backupPath,
      basicEnemyScriptExists: status.basicEnemyScriptExists,
      enemyExists: status.enemyExists,
      scriptAttached: status.scriptAttached,
      positionedOnGround: status.positionedOnGround,
      safeToOpenUnityForCompileOrPlaytest: status.safeToOpenUnityForCompileOrPlaytest,
      blockedReasons: ["Enemy already exists with a Unity-visible BasicEnemy component and valid ground placement."],
      safety: {
        noUnityExecution: true,
        backupCreated: backupExists,
        sceneWritten: !ensuredScript.scriptExisted || !ensuredScript.metaExisted,
      },
    };
  }

  if (!backupExists) {
    await copyFile(contextAfterScript.parsedScene.sceneAbsolutePath, backupPath);
  }

  const spawnPosition = {
    x: contextAfterScript.playerSpawnPosition?.x ?? 0,
    y: (contextAfterScript.groundPosition?.y ?? 0) + 1.25,
    z: (contextAfterScript.playerSpawnPosition?.z ?? 0) + 6,
  };

  let updatedSource = contextAfterScript.parsedScene.source;

  if (contextAfterScript.enemyObject) {
    const enemyObject = contextAfterScript.enemyObject;
    const enemyBlock = findBlock(contextAfterScript.parsedScene.blocks, enemyObject.gameObjectFileId);
    const transformBlock = findBlock(contextAfterScript.parsedScene.blocks, contextAfterScript.enemyTransformFileId);
    if (!enemyBlock || !transformBlock) {
      throw new Error("Enemy GameObject or Transform block was not found during basic enemy apply.");
    }

    const staleComponentIds = collectStaleBasicEnemyComponentIds(contextAfterScript.parsedScene, enemyObject, ensuredScript.guid);
    const filteredComponentIds = enemyObject.componentFileIds.filter((componentFileId) => !staleComponentIds.includes(componentFileId));
    const filteredBlocks = contextAfterScript.parsedScene.blocks.filter((block) => !staleComponentIds.includes(block.fileId));
    const newComponentFileId = nextSafeSceneFileId(filteredBlocks);
    const updatedEnemyBlock = replaceGameObjectComponentList(enemyBlock, [...filteredComponentIds, newComponentFileId]);
    updatedSource = updatedSource.replace(enemyBlock.raw, updatedEnemyBlock);

    for (const staleComponentId of staleComponentIds) {
      const staleBlock = findBlock(contextAfterScript.parsedScene.blocks, staleComponentId);
      if (staleBlock) {
        updatedSource = updatedSource.replace(staleBlock.raw, "");
      }
    }

    let updatedTransformBlock = replaceNamedVector3(transformBlock.raw, "m_LocalPosition", spawnPosition);
    updatedTransformBlock = replaceNamedVector3(updatedTransformBlock, "m_LocalScale", { x: 1.25, y: 1.25, z: 1.25 });
    updatedSource = updatedSource.replace(transformBlock.raw, updatedTransformBlock);
    updatedSource = `${updatedSource.trimEnd()}\n${buildBasicEnemyComponentBlock(newComponentFileId, enemyObject.gameObjectFileId, ensuredScript.guid)}`;
  } else {
    const safeIds = contextAfterScript.parsedScene.blocks
      .map((block) => Number(block.fileId))
      .filter((value) => Number.isInteger(value) && value > 0 && value <= MAX_SAFE_UNITY_SCENE_FILE_ID);
    const nextIdStart = (safeIds.length > 0 ? Math.max(...safeIds) : 0) + 1;
    updatedSource = `${updatedSource.trimEnd()}\n${buildBasicEnemyBlocks(
      String(nextIdStart),
      String(nextIdStart + 1),
      String(nextIdStart + 2),
      String(nextIdStart + 3),
      String(nextIdStart + 4),
      String(nextIdStart + 5),
      ensuredScript.guid,
      spawnPosition,
    )}`;
  }

  await writeFile(contextAfterScript.parsedScene.sceneAbsolutePath, updatedSource, "utf-8");

  const status = await inspectUnityBasicEnemyStatus(projectPath, recoverySafe);
  return {
    applied: status.scriptAttached && status.positionedOnGround,
    scenePath: status.scenePath,
    sceneAbsolutePath: status.sceneAbsolutePath,
    enemyName: status.enemyName,
    scriptPath: BASIC_ENEMY_SCRIPT_PATH,
    backupPath,
    basicEnemyScriptExists: status.basicEnemyScriptExists,
    enemyExists: status.enemyExists,
    scriptAttached: status.scriptAttached,
    positionedOnGround: status.positionedOnGround,
    safeToOpenUnityForCompileOrPlaytest: status.safeToOpenUnityForCompileOrPlaytest,
    blockedReasons: status.scriptAttached && status.positionedOnGround ? [] : ["Basic enemy scene state was not written in the expected Unity-visible shape."],
    safety: {
      noUnityExecution: true,
      backupCreated: true,
      sceneWritten: true,
    },
  };
}

export async function rollbackUnityBasicEnemy(projectPath: string, recoverySafe: boolean): Promise<UnityBasicEnemyRollbackResult> {
  const contextBefore = await loadBasicEnemyContext(projectPath);
  const backupPath = sceneBackupPathFor(contextBefore.parsedScene.sceneAbsolutePath, BASIC_ENEMY_SCENE_BACKUP_TAG);
  const scriptCreatedMarkerPath = path.join(contextBefore.parsedScene.rootPath, BASIC_ENEMY_CREATED_SCRIPT_MARKER);
  const metaCreatedMarkerPath = path.join(contextBefore.parsedScene.rootPath, BASIC_ENEMY_CREATED_META_MARKER);
  const createdScriptByAie = await fileExists(scriptCreatedMarkerPath);
  const createdMetaByAie = await fileExists(metaCreatedMarkerPath);

  if (!(await fileExists(backupPath))) {
    const status = await inspectUnityBasicEnemyStatus(projectPath, recoverySafe);
    return {
      restored: false,
      scenePath: status.scenePath,
      sceneAbsolutePath: status.sceneAbsolutePath,
      enemyName: status.enemyName,
      scriptPath: BASIC_ENEMY_SCRIPT_PATH,
      backupPath,
      basicEnemyScriptExists: status.basicEnemyScriptExists,
      enemyExists: status.enemyExists,
      scriptAttached: status.scriptAttached,
      positionedOnGround: status.positionedOnGround,
      safeToOpenUnityForCompileOrPlaytest: status.safeToOpenUnityForCompileOrPlaytest,
      blockedReasons: ["No basic enemy scene backup was found for rollback."],
      safety: {
        noUnityExecution: true,
        backupRetained: true,
        scriptRemoved: false,
      },
    };
  }

  const backupSource = await readFile(backupPath, "utf-8");
  await writeFile(contextBefore.parsedScene.sceneAbsolutePath, backupSource, "utf-8");

  let scriptRemoved = false;
  if (createdScriptByAie) {
    const scriptAbsolutePath = path.join(contextBefore.parsedScene.rootPath, BASIC_ENEMY_SCRIPT_PATH);
    if (await fileExists(scriptAbsolutePath)) {
      await writeFile(scriptAbsolutePath, "", "utf-8");
      await stat(scriptAbsolutePath);
      await import("node:fs/promises").then(({ unlink }) => unlink(scriptAbsolutePath));
      scriptRemoved = true;
    }
    await import("node:fs/promises").then(({ unlink }) => unlink(scriptCreatedMarkerPath));
  }

  if (createdMetaByAie) {
    const metaAbsolutePath = path.join(contextBefore.parsedScene.rootPath, BASIC_ENEMY_META_PATH);
    if (await fileExists(metaAbsolutePath)) {
      await import("node:fs/promises").then(({ unlink }) => unlink(metaAbsolutePath));
      scriptRemoved = true;
    }
    await import("node:fs/promises").then(({ unlink }) => unlink(metaCreatedMarkerPath));
  }

  const status = await inspectUnityBasicEnemyStatus(projectPath, recoverySafe);
  return {
    restored: true,
    scenePath: status.scenePath,
    sceneAbsolutePath: status.sceneAbsolutePath,
    enemyName: status.enemyName,
    scriptPath: BASIC_ENEMY_SCRIPT_PATH,
    backupPath,
    basicEnemyScriptExists: status.basicEnemyScriptExists,
    enemyExists: status.enemyExists,
    scriptAttached: status.scriptAttached,
    positionedOnGround: status.positionedOnGround,
    safeToOpenUnityForCompileOrPlaytest: status.safeToOpenUnityForCompileOrPlaytest,
    blockedReasons: [],
    safety: {
      noUnityExecution: true,
      backupRetained: true,
      scriptRemoved,
    },
  };
}

export async function inspectUnityPlayerAttackStatus(projectPath: string, recoverySafe: boolean): Promise<UnityPlayerAttackStatus> {
  const context = await loadPlayerAttackContext(projectPath);
  const scriptAbsolutePath = path.join(context.parsedScene.rootPath, PLAYER_ATTACK_SCRIPT_PATH);
  const scriptMetaAbsolutePath = path.join(context.parsedScene.rootPath, PLAYER_ATTACK_META_PATH);
  const playerAttackScriptExists = await fileExists(scriptAbsolutePath);
  const playerAttackMetaExists = await fileExists(scriptMetaAbsolutePath);
  const backupPath = sceneBackupPathFor(context.parsedScene.sceneAbsolutePath, PLAYER_ATTACK_SCENE_BACKUP_TAG);
  const backupExists = await fileExists(backupPath);
  const details: string[] = [];

  if (!context.playerObject) {
    details.push("Player GameObject was not found in the selected scene.");
  } else {
    details.push(`Detected player object: ${context.playerObject.name}`);
  }

  if (context.enemyObject) {
    details.push(`Detected enemy object: ${context.enemyObject.name}`);
  } else {
    details.push("Enemy GameObject was not found; attacks will compile but cannot affect an enemy in playtest.");
  }

  if (!playerAttackScriptExists) {
    details.push(`Player attack script asset is missing: ${PLAYER_ATTACK_SCRIPT_PATH}`);
  } else if (!playerAttackMetaExists) {
    details.push(`Player attack script meta is missing: ${PLAYER_ATTACK_META_PATH}`);
  }

  const safeToOpenUnityForCompileOrPlaytest = recoverySafe
    && playerAttackScriptExists
    && playerAttackMetaExists
    && context.enemyObject !== null
    && context.verification.componentVisibleToUnity;

  return {
    scenePath: context.parsedScene.scenePath,
    sceneAbsolutePath: context.parsedScene.sceneAbsolutePath,
    playerName: context.playerObject?.name ?? null,
    enemyName: context.enemyObject?.name ?? null,
    playerAttackScriptExists,
    playerAttackAttached: context.verification.componentVisibleToUnity,
    attackKeyConfigured: context.verification.attackKeyConfigured,
    backupExists,
    safeToOpenUnityForCompileOrPlaytest,
    details,
    safety: {
      readOnly: true,
      noUnityExecution: true,
    },
  };
}

export async function applyUnityPlayerAttack(projectPath: string, recoverySafe: boolean): Promise<UnityPlayerAttackApplyResult> {
  const contextBefore = await loadPlayerAttackContext(projectPath);
  const backupPath = sceneBackupPathFor(contextBefore.parsedScene.sceneAbsolutePath, PLAYER_ATTACK_SCENE_BACKUP_TAG);
  const backupExists = await fileExists(backupPath);
  const blockedReasons: string[] = [];

  if (!recoverySafe) {
    blockedReasons.push("Unity recovery guard did not report a safe state for player attack mutation.");
  }

  if (!contextBefore.playerObject) {
    blockedReasons.push("A Player object was not found in the selected scene.");
  }

  if (blockedReasons.length > 0) {
    return {
      applied: false,
      scenePath: contextBefore.parsedScene.scenePath,
      sceneAbsolutePath: contextBefore.parsedScene.sceneAbsolutePath,
      playerName: contextBefore.playerObject?.name ?? null,
      enemyName: contextBefore.enemyObject?.name ?? null,
      scriptPath: PLAYER_ATTACK_SCRIPT_PATH,
      backupPath,
      playerAttackScriptExists: await fileExists(path.join(contextBefore.parsedScene.rootPath, PLAYER_ATTACK_SCRIPT_PATH)),
      playerAttackAttached: false,
      attackKeyConfigured: false,
      safeToOpenUnityForCompileOrPlaytest: false,
      blockedReasons,
      safety: {
        noUnityExecution: true,
        backupCreated: backupExists,
        sceneWritten: false,
      },
    };
  }

  const ensuredScript = await ensurePlayerAttackScript(contextBefore.parsedScene.rootPath);
  const contextAfterScript = await loadPlayerAttackContext(projectPath);

  if (contextAfterScript.verification.componentVisibleToUnity && contextAfterScript.verification.attackKeyConfigured) {
    const status = await inspectUnityPlayerAttackStatus(projectPath, recoverySafe);
    return {
      applied: false,
      scenePath: status.scenePath,
      sceneAbsolutePath: status.sceneAbsolutePath,
      playerName: status.playerName,
      enemyName: status.enemyName,
      scriptPath: PLAYER_ATTACK_SCRIPT_PATH,
      backupPath,
      playerAttackScriptExists: status.playerAttackScriptExists,
      playerAttackAttached: status.playerAttackAttached,
      attackKeyConfigured: status.attackKeyConfigured,
      safeToOpenUnityForCompileOrPlaytest: status.safeToOpenUnityForCompileOrPlaytest,
      blockedReasons: ["PlayerAttack is already attached to Player with the expected serialized fields."],
      safety: {
        noUnityExecution: true,
        backupCreated: backupExists,
        sceneWritten: !ensuredScript.scriptExisted || !ensuredScript.metaExisted,
      },
    };
  }

  if (!backupExists) {
    await copyFile(contextAfterScript.parsedScene.sceneAbsolutePath, backupPath);
  }

  const playerObject = contextAfterScript.playerObject;
  if (!playerObject) {
    throw new Error("Player attack prerequisites were not present during apply.");
  }

  const playerBlock = findBlock(contextAfterScript.parsedScene.blocks, playerObject.gameObjectFileId);
  if (!playerBlock) {
    throw new Error("Player GameObject block was not found during player attack apply.");
  }

  let updatedSource = contextAfterScript.parsedScene.source;
  const staleComponentIds = collectStalePlayerAttackComponentIds(contextAfterScript.parsedScene, playerObject, ensuredScript.guid);
  const filteredComponentIds = playerObject.componentFileIds.filter((componentFileId) => !staleComponentIds.includes(componentFileId));
  const filteredBlocks = contextAfterScript.parsedScene.blocks.filter((block) => !staleComponentIds.includes(block.fileId));
  const newComponentFileId = nextSafeSceneFileId(filteredBlocks);
  const updatedPlayerBlock = replaceGameObjectComponentList(playerBlock, [...filteredComponentIds, newComponentFileId]);
  updatedSource = updatedSource.replace(playerBlock.raw, updatedPlayerBlock);

  for (const staleComponentId of staleComponentIds) {
    const staleBlock = findBlock(contextAfterScript.parsedScene.blocks, staleComponentId);
    if (staleBlock) {
      updatedSource = updatedSource.replace(staleBlock.raw, "");
    }
  }

  updatedSource = `${updatedSource.trimEnd()}\n${buildPlayerAttackComponentBlock(newComponentFileId, playerObject.gameObjectFileId, ensuredScript.guid)}`;
  await writeFile(contextAfterScript.parsedScene.sceneAbsolutePath, updatedSource, "utf-8");

  const status = await inspectUnityPlayerAttackStatus(projectPath, recoverySafe);
  return {
    applied: status.playerAttackAttached,
    scenePath: status.scenePath,
    sceneAbsolutePath: status.sceneAbsolutePath,
    playerName: status.playerName,
    enemyName: status.enemyName,
    scriptPath: PLAYER_ATTACK_SCRIPT_PATH,
    backupPath,
    playerAttackScriptExists: status.playerAttackScriptExists,
    playerAttackAttached: status.playerAttackAttached,
    attackKeyConfigured: status.attackKeyConfigured,
    safeToOpenUnityForCompileOrPlaytest: status.safeToOpenUnityForCompileOrPlaytest,
    blockedReasons: status.playerAttackAttached ? [] : ["PlayerAttack was not attached to Player with the expected serialized fields."],
    safety: {
      noUnityExecution: true,
      backupCreated: true,
      sceneWritten: true,
    },
  };
}

export async function rollbackUnityPlayerAttack(projectPath: string, recoverySafe: boolean): Promise<UnityPlayerAttackRollbackResult> {
  const contextBefore = await loadPlayerAttackContext(projectPath);
  const backupPath = sceneBackupPathFor(contextBefore.parsedScene.sceneAbsolutePath, PLAYER_ATTACK_SCENE_BACKUP_TAG);
  const scriptCreatedMarkerPath = path.join(contextBefore.parsedScene.rootPath, PLAYER_ATTACK_CREATED_SCRIPT_MARKER);
  const metaCreatedMarkerPath = path.join(contextBefore.parsedScene.rootPath, PLAYER_ATTACK_CREATED_META_MARKER);
  const createdScriptByAie = await fileExists(scriptCreatedMarkerPath);
  const createdMetaByAie = await fileExists(metaCreatedMarkerPath);

  if (!(await fileExists(backupPath))) {
    const status = await inspectUnityPlayerAttackStatus(projectPath, recoverySafe);
    return {
      restored: false,
      scenePath: status.scenePath,
      sceneAbsolutePath: status.sceneAbsolutePath,
      playerName: status.playerName,
      enemyName: status.enemyName,
      scriptPath: PLAYER_ATTACK_SCRIPT_PATH,
      backupPath,
      playerAttackScriptExists: status.playerAttackScriptExists,
      playerAttackAttached: status.playerAttackAttached,
      attackKeyConfigured: status.attackKeyConfigured,
      safeToOpenUnityForCompileOrPlaytest: status.safeToOpenUnityForCompileOrPlaytest,
      blockedReasons: ["No player attack scene backup was found for rollback."],
      safety: {
        noUnityExecution: true,
        backupRetained: true,
        scriptRemoved: false,
      },
    };
  }

  const backupSource = await readFile(backupPath, "utf-8");
  await writeFile(contextBefore.parsedScene.sceneAbsolutePath, backupSource, "utf-8");

  let scriptRemoved = false;
  if (createdScriptByAie) {
    const scriptAbsolutePath = path.join(contextBefore.parsedScene.rootPath, PLAYER_ATTACK_SCRIPT_PATH);
    if (await fileExists(scriptAbsolutePath)) {
      await writeFile(scriptAbsolutePath, "", "utf-8");
      await stat(scriptAbsolutePath);
      await import("node:fs/promises").then(({ unlink }) => unlink(scriptAbsolutePath));
      scriptRemoved = true;
    }
    await import("node:fs/promises").then(({ unlink }) => unlink(scriptCreatedMarkerPath));
  }

  if (createdMetaByAie) {
    const metaAbsolutePath = path.join(contextBefore.parsedScene.rootPath, PLAYER_ATTACK_META_PATH);
    if (await fileExists(metaAbsolutePath)) {
      await import("node:fs/promises").then(({ unlink }) => unlink(metaAbsolutePath));
      scriptRemoved = true;
    }
    await import("node:fs/promises").then(({ unlink }) => unlink(metaCreatedMarkerPath));
  }

  const status = await inspectUnityPlayerAttackStatus(projectPath, recoverySafe);
  return {
    restored: true,
    scenePath: status.scenePath,
    sceneAbsolutePath: status.sceneAbsolutePath,
    playerName: status.playerName,
    enemyName: status.enemyName,
    scriptPath: PLAYER_ATTACK_SCRIPT_PATH,
    backupPath,
    playerAttackScriptExists: status.playerAttackScriptExists,
    playerAttackAttached: status.playerAttackAttached,
    attackKeyConfigured: status.attackKeyConfigured,
    safeToOpenUnityForCompileOrPlaytest: status.safeToOpenUnityForCompileOrPlaytest,
    blockedReasons: [],
    safety: {
      noUnityExecution: true,
      backupRetained: true,
      scriptRemoved,
    },
  };
}

export async function inspectUnitySceneWiring(projectPath: string): Promise<UnitySceneWiringSnapshot> {
  const parsedScene = await parseProjectScene(projectPath);
  const mainCameraFound = parsedScene.mainCamera !== null;
  const playerCandidateFound = parsedScene.playerCandidate !== null && parsedScene.playerTransformFileId !== null;
  const cameraFollowAlreadyAttached = parsedScene.verification.componentVisibleToUnity;

  return {
    projectPath: path.resolve(projectPath),
    scenePath: parsedScene.scenePath,
    mainCameraFound,
    playerCandidateFound,
    cameraFollowAlreadyAttached,
    safeToWire: mainCameraFound && playerCandidateFound && !cameraFollowAlreadyAttached,
    recommendedActions: buildRecommendedActions(parsedScene),
    safety: {
      readOnly: true,
      noUnityExecution: true,
    },
  };
}

function nextSafeSceneFileId(blocks: readonly SceneBlock[]): string {
  const safeIds = blocks
    .map((block) => Number(block.fileId))
    .filter((value) => Number.isInteger(value) && value > 0 && value <= MAX_SAFE_UNITY_SCENE_FILE_ID);
  const nextValue = (safeIds.length > 0 ? Math.max(...safeIds) : 0) + 1;
  return String(nextValue);
}

function replaceGameObjectComponentList(gameObjectBlock: SceneBlock, componentFileIds: readonly string[]): string {
  const componentLines = componentFileIds.map((componentFileId) => `  - component: {fileID: ${componentFileId}}`).join("\n");
  return gameObjectBlock.raw.replace(/  m_Component:\r?\n(?:  - component: \{fileID: \d+\}\r?\n)+/, `  m_Component:\n${componentLines}\n`);
}

function buildCameraFollowComponentBlock(componentFileId: string, gameObjectFileId: string, scriptGuid: string, targetFileId: string): string {
  return [
    `--- !u!114 &${componentFileId}`,
    "MonoBehaviour:",
    "  m_ObjectHideFlags: 0",
    "  m_CorrespondingSourceObject: {fileID: 0}",
    "  m_PrefabInstance: {fileID: 0}",
    "  m_PrefabAsset: {fileID: 0}",
    `  m_GameObject: {fileID: ${gameObjectFileId}}`,
    "  m_Enabled: 1",
    "  m_EditorHideFlags: 0",
    `  m_Script: {fileID: 11500000, guid: ${scriptGuid}, type: 3}`,
    "  m_Name: ",
    "  m_EditorClassIdentifier:",
    `  target: {fileID: ${targetFileId}}`,
    "  offset: {x: 0, y: 4, z: -7}",
    "  smoothTime: 0.12",
    "  lookAtHeight: 1.5",
    "  debugFollow: 0",
    "",
  ].join("\n");
}

function collectStaleCameraFollowComponentIds(parsedScene: ParsedScene): string[] {
  const mainCameraGameObjectId = parsedScene.mainCamera?.gameObjectFileId ?? null;
  const candidateIds = parsedScene.blocks
    .filter((block) => isCameraFollowCandidateBlock(block, mainCameraGameObjectId, parsedScene.scriptGuid))
    .map((block) => block.fileId);

  const mainCameraExtraIds = parsedScene.mainCamera?.componentFileIds.filter((componentFileId) => {
    const block = findBlock(parsedScene.blocks, componentFileId);
    if (!block) {
      return true;
    }

    return isCameraFollowCandidateBlock(block, mainCameraGameObjectId, parsedScene.scriptGuid);
  }) ?? [];

  return [...new Set([...candidateIds, ...mainCameraExtraIds])];
}

async function writeValidCameraWiring(projectPath: string, recoverySafe: boolean): Promise<UnitySceneWiringApplyResult> {
  const parsedScene = await parseProjectScene(projectPath);
  const blockedReasons: string[] = [];

  if (!recoverySafe) {
    blockedReasons.push("Unity recovery guard did not report a safe state for scene mutation.");
  }

  if (!parsedScene.mainCamera) {
    blockedReasons.push("Main Camera was not found in the selected scene.");
  }

  if (!parsedScene.playerCandidate || !parsedScene.playerTransformFileId) {
    blockedReasons.push("A player candidate with a Transform was not found in the selected scene.");
  }

  const scriptAbsolutePath = path.join(parsedScene.rootPath, CAMERA_SCRIPT_PATH);
  if (!(await fileExists(scriptAbsolutePath))) {
    blockedReasons.push(`CameraFollow script does not exist: ${CAMERA_SCRIPT_PATH}`);
  }

  const backupPath = sceneBackupPathFor(parsedScene.sceneAbsolutePath);
  const backupExists = await fileExists(backupPath);
  if (blockedReasons.length > 0) {
    return {
      applied: false,
      scenePath: parsedScene.scenePath,
      sceneAbsolutePath: parsedScene.sceneAbsolutePath,
      backupPath,
      cameraFollowAttached: false,
      targetAssigned: false,
      safeToOpenUnityForCompileOrPlaytest: false,
      blockedReasons,
      safety: {
        noUnityExecution: true,
        backupCreated: backupExists,
        sceneWritten: false,
      },
    };
  }

  const scriptGuid = parsedScene.scriptGuid ?? await ensureCameraFollowMeta(parsedScene.rootPath);
  const staleComponentIds = collectStaleCameraFollowComponentIds(parsedScene);
  const mainCameraBlock = findBlock(parsedScene.blocks, parsedScene.mainCamera?.gameObjectFileId ?? null);
  if (!mainCameraBlock || !parsedScene.mainCamera || !parsedScene.playerTransformFileId) {
    throw new Error("Scene wiring prerequisites were not present during apply/repair.");
  }

  let updatedSource = parsedScene.source;
  if (!backupExists) {
    await copyFile(parsedScene.sceneAbsolutePath, backupPath);
  }

  const filteredComponentIds = parsedScene.mainCamera.componentFileIds.filter((componentFileId) => !staleComponentIds.includes(componentFileId));
  const newComponentFileId = nextSafeSceneFileId(parsedScene.blocks.filter((block) => !staleComponentIds.includes(block.fileId)));
  const updatedMainCameraBlock = replaceGameObjectComponentList(mainCameraBlock, [...filteredComponentIds, newComponentFileId]);
  updatedSource = updatedSource.replace(mainCameraBlock.raw, updatedMainCameraBlock);

  for (const staleComponentId of staleComponentIds) {
    const staleBlock = findBlock(parsedScene.blocks, staleComponentId);
    if (staleBlock) {
      updatedSource = updatedSource.replace(staleBlock.raw, "");
    }
  }

  updatedSource = `${updatedSource.trimEnd()}\n${buildCameraFollowComponentBlock(newComponentFileId, parsedScene.mainCamera.gameObjectFileId, scriptGuid, parsedScene.playerTransformFileId)}`;
  await writeFile(parsedScene.sceneAbsolutePath, updatedSource, "utf-8");

  const status = await inspectUnityCameraWiringStatus(projectPath, recoverySafe);
  return {
    applied: status.cameraFollowAttached,
    scenePath: parsedScene.scenePath,
    sceneAbsolutePath: parsedScene.sceneAbsolutePath,
    backupPath,
    cameraFollowAttached: status.cameraFollowAttached,
    targetAssigned: status.playerTargetAssigned,
    safeToOpenUnityForCompileOrPlaytest: status.safeToOpenUnityForCompileOrPlaytest,
    blockedReasons: status.cameraFollowAttached ? [] : status.brokenLinks,
    safety: {
      noUnityExecution: true,
      backupCreated: true,
      sceneWritten: true,
    },
  };
}

export async function applyUnityCameraWiring(projectPath: string, recoverySafe: boolean): Promise<UnitySceneWiringApplyResult> {
  const parsedScene = await parseProjectScene(projectPath);
  if (parsedScene.verification.componentVisibleToUnity) {
    const backupPath = sceneBackupPathFor(parsedScene.sceneAbsolutePath);
    return {
      applied: false,
      scenePath: parsedScene.scenePath,
      sceneAbsolutePath: parsedScene.sceneAbsolutePath,
      backupPath,
      cameraFollowAttached: true,
      targetAssigned: true,
      safeToOpenUnityForCompileOrPlaytest: recoverySafe,
      blockedReasons: ["CameraFollow is already attached with a Unity-visible component link."],
      safety: {
        noUnityExecution: true,
        backupCreated: await fileExists(backupPath),
        sceneWritten: false,
      },
    };
  }

  return writeValidCameraWiring(projectPath, recoverySafe);
}

export async function repairUnityCameraWiring(projectPath: string, recoverySafe: boolean): Promise<UnitySceneWiringRepairResult> {
  const result = await writeValidCameraWiring(projectPath, recoverySafe);
  return {
    repaired: result.applied,
    scenePath: result.scenePath,
    sceneAbsolutePath: result.sceneAbsolutePath,
    backupPath: result.backupPath,
    cameraFollowAttached: result.cameraFollowAttached,
    targetAssigned: result.targetAssigned,
    safeToOpenUnityForCompileOrPlaytest: result.safeToOpenUnityForCompileOrPlaytest,
    blockedReasons: result.blockedReasons,
    safety: result.safety,
  };
}

export async function inspectUnityCameraWiringStatus(projectPath: string, recoverySafe: boolean): Promise<UnitySceneWiringStatus> {
  const parsedScene = await parseProjectScene(projectPath);
  const backupPath = sceneBackupPathFor(parsedScene.sceneAbsolutePath);
  const backupExists = await fileExists(backupPath);

  return {
    scenePath: parsedScene.scenePath,
    sceneAbsolutePath: parsedScene.sceneAbsolutePath,
    backupPath,
    cameraFollowAttached: parsedScene.verification.componentVisibleToUnity,
    cameraFollowComponentVisibleToUnity: parsedScene.verification.componentVisibleToUnity,
    mainCameraComponentListLinked: parsedScene.verification.componentListLinked,
    monoBehaviourBlockExists: parsedScene.verification.monoBehaviourBlockExists,
    scriptGuidMatchesMeta: parsedScene.verification.scriptGuidMatchesMeta,
    playerTargetAssigned: parsedScene.verification.playerTargetAssigned,
    backupExists,
    safeToOpenUnityForCompileOrPlaytest: recoverySafe && parsedScene.verification.componentVisibleToUnity,
    brokenLinks: parsedScene.verification.brokenLinks,
    safety: {
      readOnly: true,
      noUnityExecution: true,
    },
  };
}

export async function rollbackUnityCameraWiring(projectPath: string): Promise<UnitySceneWiringRollbackResult> {
  const parsedScene = await parseProjectScene(projectPath);
  const backupPath = sceneBackupPathFor(parsedScene.sceneAbsolutePath);
  if (!(await fileExists(backupPath))) {
    return {
      restored: false,
      scenePath: parsedScene.scenePath,
      sceneAbsolutePath: parsedScene.sceneAbsolutePath,
      backupPath,
      blockedReasons: ["No scene backup was found for rollback."],
      safety: {
        noUnityExecution: true,
        backupRetained: true,
      },
    };
  }

  const backupSource = await readFile(backupPath, "utf-8");
  await writeFile(parsedScene.sceneAbsolutePath, backupSource, "utf-8");
  return {
    restored: true,
    scenePath: parsedScene.scenePath,
    sceneAbsolutePath: parsedScene.sceneAbsolutePath,
    backupPath,
    blockedReasons: [],
    safety: {
      noUnityExecution: true,
      backupRetained: true,
    },
  };
}

export function renderUnitySceneWiringPreview(snapshot: UnitySceneWiringSnapshot): string {
  return [
    "UNITY CAMERA WIRING PREVIEW",
    "",
    `Project Path: ${snapshot.projectPath}`,
    `Selected Scene: ${snapshot.scenePath}`,
    `Main Camera Found: ${snapshot.mainCameraFound ? "YES" : "NO"}`,
    `Player Candidate Found: ${snapshot.playerCandidateFound ? "YES" : "NO"}`,
    `CameraFollow Already Attached: ${snapshot.cameraFollowAlreadyAttached ? "YES" : "NO"}`,
    `Safe To Wire: ${snapshot.safeToWire ? "YES" : "NO"}`,
    "",
    "Recommended Actions:",
    ...snapshot.recommendedActions.map((action, index) => `${index + 1}. ${action}`),
  ].join("\n");
}

export function renderUnitySceneWiringApplyResult(result: UnitySceneWiringApplyResult): string {
  if (!result.applied) {
    return [
      "UNITY CAMERA WIRING BLOCKED",
      "",
      `Scene: ${result.scenePath}`,
      `Scene Path: ${result.sceneAbsolutePath}`,
      `Backup Path: ${result.backupPath}`,
      "",
      "Blocked Reasons:",
      ...result.blockedReasons.map((reason, index) => `${index + 1}. ${reason}`),
    ].join("\n");
  }

  return [
    "UNITY CAMERA WIRING APPLIED",
    "",
    `Scene: ${result.scenePath}`,
    `Scene Path: ${result.sceneAbsolutePath}`,
    `Backup Path: ${result.backupPath}`,
    `CameraFollow Attached: ${result.cameraFollowAttached ? "YES" : "NO"}`,
    `Target Assigned: ${result.targetAssigned ? "YES" : "NO"}`,
    `Safe To Open Unity For Compile/Playtest: ${result.safeToOpenUnityForCompileOrPlaytest ? "YES" : "NO"}`,
  ].join("\n");
}

export function renderUnitySceneWiringRepairResult(result: UnitySceneWiringRepairResult): string {
  if (!result.repaired) {
    return [
      "UNITY CAMERA WIRING REPAIR BLOCKED",
      "",
      `Scene: ${result.scenePath}`,
      `Scene Path: ${result.sceneAbsolutePath}`,
      `Backup Path: ${result.backupPath}`,
      "",
      "Blocked Reasons:",
      ...result.blockedReasons.map((reason, index) => `${index + 1}. ${reason}`),
    ].join("\n");
  }

  return [
    "UNITY CAMERA WIRING REPAIRED",
    "",
    `Scene: ${result.scenePath}`,
    `Scene Path: ${result.sceneAbsolutePath}`,
    `Backup Path: ${result.backupPath}`,
    `CameraFollow Attached: ${result.cameraFollowAttached ? "YES" : "NO"}`,
    `Target Assigned: ${result.targetAssigned ? "YES" : "NO"}`,
    `Safe To Open Unity For Compile/Playtest: ${result.safeToOpenUnityForCompileOrPlaytest ? "YES" : "NO"}`,
  ].join("\n");
}

export function renderUnitySceneWiringStatus(status: UnitySceneWiringStatus): string {
  const lines = [
    "UNITY CAMERA WIRING STATUS",
    "",
    `Scene: ${status.scenePath}`,
    `Scene Path: ${status.sceneAbsolutePath}`,
    `CameraFollow Attached: ${status.cameraFollowAttached ? "YES" : "NO"}`,
    `CameraFollow Component Visible To Unity: ${status.cameraFollowComponentVisibleToUnity ? "YES" : "NO"}`,
    `Main Camera Component List Linked: ${status.mainCameraComponentListLinked ? "YES" : "NO"}`,
    `MonoBehaviour Block Exists: ${status.monoBehaviourBlockExists ? "YES" : "NO"}`,
    `Script GUID Matches Meta: ${status.scriptGuidMatchesMeta ? "YES" : "NO"}`,
    `Player Target Assigned: ${status.playerTargetAssigned ? "YES" : "NO"}`,
    `Backup Exists: ${status.backupExists ? "YES" : "NO"}`,
    `Safe To Open Unity For Compile/Playtest: ${status.safeToOpenUnityForCompileOrPlaytest ? "YES" : "NO"}`,
  ];

  if (status.brokenLinks.length > 0) {
    lines.push("", "Broken Links:", ...status.brokenLinks.map((reason, index) => `${index + 1}. ${reason}`));
  }

  return lines.join("\n");
}

export function renderUnitySceneWiringRollbackResult(result: UnitySceneWiringRollbackResult): string {
  if (!result.restored) {
    return [
      "UNITY CAMERA WIRING ROLLBACK BLOCKED",
      "",
      `Scene: ${result.scenePath}`,
      `Scene Path: ${result.sceneAbsolutePath}`,
      `Backup Path: ${result.backupPath}`,
      "",
      "Blocked Reasons:",
      ...result.blockedReasons.map((reason, index) => `${index + 1}. ${reason}`),
    ].join("\n");
  }

  return [
    "UNITY CAMERA WIRING RESTORED",
    "",
    `Scene: ${result.scenePath}`,
    `Scene Path: ${result.sceneAbsolutePath}`,
    `Backup Path: ${result.backupPath}`,
  ].join("\n");
}

export async function inspectUnityVisualDebugStatus(projectPath: string): Promise<UnityVisualDebugStatus> {
  const parsedScene = await parseProjectScene(projectPath);
  const floorDetection = detectPrimaryGroundRenderer(parsedScene.blocks, parsedScene.objects);
  const materialAbsolutePath = path.join(parsedScene.rootPath, VISUAL_DEBUG_MATERIAL_PATH);
  const materialMetaAbsolutePath = `${materialAbsolutePath}.meta`;
  const debugMaterialGuid = await readGuidFromMeta(materialMetaAbsolutePath);
  const debugMaterialPresent = (await fileExists(materialAbsolutePath)) && debugMaterialGuid !== null;
  const materialAssigned = isDebugMaterialAssigned(floorDetection?.currentMaterial ?? null, debugMaterialGuid);
  const backupPath = sceneBackupPathFor(parsedScene.sceneAbsolutePath, VISUAL_DEBUG_SCENE_BACKUP_TAG);
  const backupExists = await fileExists(backupPath);
  const details: string[] = [];

  if (!floorDetection) {
    details.push("No primary ground object with a Renderer was detected in the selected scene.");
  } else {
    details.push(`Detected floor object: ${floorDetection.sceneObject.name}`);
    if (floorDetection.currentMaterial) {
      details.push(`Current renderer material: ${floorDetection.currentMaterial.raw}`);
    } else {
      details.push("Renderer has no explicit material assignment and will fall back to Unity defaults.");
    }
  }

  if (!debugMaterialPresent) {
    details.push(`Debug material asset is missing: ${VISUAL_DEBUG_MATERIAL_PATH}`);
  }

  if (materialAssigned && !debugMaterialPresent) {
    details.push("Scene references the debug material, but the material asset or GUID is missing.");
  }

  return {
    scenePath: parsedScene.scenePath,
    sceneAbsolutePath: parsedScene.sceneAbsolutePath,
    floorName: floorDetection?.sceneObject.name ?? null,
    floorDetected: floorDetection !== null,
    materialAssigned,
    debugMaterialPresent,
    backupExists,
    safeToOpenUnityForCompileOrPlaytest: floorDetection !== null && (!materialAssigned || debugMaterialPresent),
    details,
    safety: {
      readOnly: true,
      noUnityExecution: true,
    },
  };
}

export async function applyUnityVisualDebugFloor(projectPath: string): Promise<UnityVisualDebugApplyResult> {
  const parsedScene = await parseProjectScene(projectPath);
  const floorDetection = detectPrimaryGroundRenderer(parsedScene.blocks, parsedScene.objects);
  const backupPath = sceneBackupPathFor(parsedScene.sceneAbsolutePath, VISUAL_DEBUG_SCENE_BACKUP_TAG);
  const backupExists = await fileExists(backupPath);
  const blockedReasons: string[] = [];

  if (!floorDetection) {
    blockedReasons.push("No primary ground object with a Renderer was detected in the selected scene.");
  }

  if (!floorDetection?.currentMaterial) {
    blockedReasons.push("Detected floor renderer does not expose an explicit material slot to replace.");
  }

  if (blockedReasons.length > 0) {
    return {
      applied: false,
      scenePath: parsedScene.scenePath,
      sceneAbsolutePath: parsedScene.sceneAbsolutePath,
      floorName: floorDetection?.sceneObject.name ?? null,
      materialPath: VISUAL_DEBUG_MATERIAL_PATH,
      backupPath,
      floorDetected: floorDetection !== null,
      materialAssigned: false,
      debugMaterialPresent: false,
      safeToOpenUnityForCompileOrPlaytest: false,
      blockedReasons,
      safety: {
        noUnityExecution: true,
        backupCreated: backupExists,
        sceneWritten: false,
      },
    };
  }

  const debugMaterial = await ensureVisualDebugMaterial(parsedScene.rootPath);
  if (isDebugMaterialAssigned(floorDetection.currentMaterial, debugMaterial.guid)) {
    const status = await inspectUnityVisualDebugStatus(projectPath);
    return {
      applied: false,
      scenePath: parsedScene.scenePath,
      sceneAbsolutePath: parsedScene.sceneAbsolutePath,
      floorName: floorDetection.sceneObject.name,
      materialPath: VISUAL_DEBUG_MATERIAL_PATH,
      backupPath,
      floorDetected: status.floorDetected,
      materialAssigned: status.materialAssigned,
      debugMaterialPresent: status.debugMaterialPresent,
      safeToOpenUnityForCompileOrPlaytest: status.safeToOpenUnityForCompileOrPlaytest,
      blockedReasons: ["Visual debug material is already assigned to the detected floor renderer."],
      safety: {
        noUnityExecution: true,
        backupCreated: backupExists,
        sceneWritten: false,
      },
    };
  }

  if (!backupExists) {
    await copyFile(parsedScene.sceneAbsolutePath, backupPath);
  }

  const updatedRendererBlock = replaceRendererMaterial(floorDetection.rendererBlock, buildSceneMaterialReference(debugMaterial.guid));
  const updatedSource = parsedScene.source.replace(floorDetection.rendererBlock.raw, updatedRendererBlock);
  await writeFile(parsedScene.sceneAbsolutePath, updatedSource, "utf-8");

  const status = await inspectUnityVisualDebugStatus(projectPath);
  return {
    applied: status.materialAssigned,
    scenePath: parsedScene.scenePath,
    sceneAbsolutePath: parsedScene.sceneAbsolutePath,
    floorName: status.floorName,
    materialPath: VISUAL_DEBUG_MATERIAL_PATH,
    backupPath,
    floorDetected: status.floorDetected,
    materialAssigned: status.materialAssigned,
    debugMaterialPresent: status.debugMaterialPresent,
    safeToOpenUnityForCompileOrPlaytest: status.safeToOpenUnityForCompileOrPlaytest,
    blockedReasons: status.materialAssigned ? [] : ["Visual debug material was not assigned to the detected floor renderer."],
    safety: {
      noUnityExecution: true,
      backupCreated: true,
      sceneWritten: true,
    },
  };
}

export async function rollbackUnityVisualDebugFloor(projectPath: string): Promise<UnityVisualDebugRollbackResult> {
  const parsedScene = await parseProjectScene(projectPath);
  const backupPath = sceneBackupPathFor(parsedScene.sceneAbsolutePath, VISUAL_DEBUG_SCENE_BACKUP_TAG);
  if (!(await fileExists(backupPath))) {
    const status = await inspectUnityVisualDebugStatus(projectPath);
    return {
      restored: false,
      scenePath: parsedScene.scenePath,
      sceneAbsolutePath: parsedScene.sceneAbsolutePath,
      backupPath,
      floorName: status.floorName,
      materialAssigned: status.materialAssigned,
      debugMaterialPresent: status.debugMaterialPresent,
      safeToOpenUnityForCompileOrPlaytest: status.safeToOpenUnityForCompileOrPlaytest,
      blockedReasons: ["No visual debug scene backup was found for rollback."],
      safety: {
        noUnityExecution: true,
        backupRetained: true,
      },
    };
  }

  const backupSource = await readFile(backupPath, "utf-8");
  await writeFile(parsedScene.sceneAbsolutePath, backupSource, "utf-8");
  const status = await inspectUnityVisualDebugStatus(projectPath);
  return {
    restored: true,
    scenePath: parsedScene.scenePath,
    sceneAbsolutePath: parsedScene.sceneAbsolutePath,
    backupPath,
    floorName: status.floorName,
    materialAssigned: status.materialAssigned,
    debugMaterialPresent: status.debugMaterialPresent,
    safeToOpenUnityForCompileOrPlaytest: status.safeToOpenUnityForCompileOrPlaytest,
    blockedReasons: [],
    safety: {
      noUnityExecution: true,
      backupRetained: true,
    },
  };
}

export function renderUnityVisualDebugStatus(status: UnityVisualDebugStatus): string {
  return [
    "UNITY VISUAL DEBUG STATUS",
    "",
    `Scene: ${status.scenePath}`,
    `Scene Path: ${status.sceneAbsolutePath}`,
    `Detected Floor: ${status.floorName ?? "none"}`,
    `Floor Detected: ${status.floorDetected ? "YES" : "NO"}`,
    `Material Assigned: ${status.materialAssigned ? "YES" : "NO"}`,
    `Debug Material Present: ${status.debugMaterialPresent ? "YES" : "NO"}`,
    `Backup Exists: ${status.backupExists ? "YES" : "NO"}`,
    `Safe To Open Unity: ${status.safeToOpenUnityForCompileOrPlaytest ? "YES" : "NO"}`,
    "",
    "Details:",
    ...status.details.map((detail, index) => `${index + 1}. ${detail}`),
  ].join("\n");
}

export function renderUnityVisualDebugApplyResult(result: UnityVisualDebugApplyResult): string {
  if (!result.applied) {
    return [
      "UNITY VISUAL DEBUG APPLY BLOCKED",
      "",
      `Scene: ${result.scenePath}`,
      `Scene Path: ${result.sceneAbsolutePath}`,
      `Detected Floor: ${result.floorName ?? "none"}`,
      `Material Path: ${result.materialPath}`,
      `Backup Path: ${result.backupPath}`,
      "",
      "Blocked Reasons:",
      ...result.blockedReasons.map((reason, index) => `${index + 1}. ${reason}`),
    ].join("\n");
  }

  return [
    "UNITY VISUAL DEBUG APPLY COMPLETE",
    "",
    `Scene: ${result.scenePath}`,
    `Scene Path: ${result.sceneAbsolutePath}`,
    `Detected Floor: ${result.floorName ?? "none"}`,
    `Material Path: ${result.materialPath}`,
    `Backup Path: ${result.backupPath}`,
    `Floor Detected: ${result.floorDetected ? "YES" : "NO"}`,
    `Material Assigned: ${result.materialAssigned ? "YES" : "NO"}`,
    `Debug Material Present: ${result.debugMaterialPresent ? "YES" : "NO"}`,
    `Safe To Open Unity: ${result.safeToOpenUnityForCompileOrPlaytest ? "YES" : "NO"}`,
  ].join("\n");
}

export function renderUnityVisualDebugRollbackResult(result: UnityVisualDebugRollbackResult): string {
  if (!result.restored) {
    return [
      "UNITY VISUAL DEBUG ROLLBACK BLOCKED",
      "",
      `Scene: ${result.scenePath}`,
      `Scene Path: ${result.sceneAbsolutePath}`,
      `Backup Path: ${result.backupPath}`,
      "",
      "Blocked Reasons:",
      ...result.blockedReasons.map((reason, index) => `${index + 1}. ${reason}`),
    ].join("\n");
  }

  return [
    "UNITY VISUAL DEBUG ROLLBACK COMPLETE",
    "",
    `Scene: ${result.scenePath}`,
    `Scene Path: ${result.sceneAbsolutePath}`,
    `Backup Path: ${result.backupPath}`,
    `Detected Floor: ${result.floorName ?? "none"}`,
    `Material Assigned: ${result.materialAssigned ? "YES" : "NO"}`,
    `Debug Material Present: ${result.debugMaterialPresent ? "YES" : "NO"}`,
    `Safe To Open Unity: ${result.safeToOpenUnityForCompileOrPlaytest ? "YES" : "NO"}`,
  ].join("\n");
}

export function renderUnityFallRecoveryStatus(status: UnityFallRecoveryStatus): string {
  return [
    "UNITY FALL RECOVERY STATUS",
    "",
    `Scene: ${status.scenePath}`,
    `Scene Path: ${status.sceneAbsolutePath}`,
    `Player: ${status.playerName ?? "none"}`,
    `Respawn Target: ${status.respawnTargetName ?? "fallback spawn"}`,
    `FallRecovery.cs Exists: ${status.fallRecoveryScriptExists ? "YES" : "NO"}`,
    `FallRecovery Attached: ${status.fallRecoveryAttached ? "YES" : "NO"}`,
    `Respawn Target Assigned: ${status.respawnTargetAssigned ? "YES" : "NO"}`,
    `Fall Threshold Present: ${status.fallThresholdPresent ? "YES" : "NO"}`,
    `Backup Exists: ${status.backupExists ? "YES" : "NO"}`,
    `Safe To Open Unity/Playtest: ${status.safeToOpenUnityForCompileOrPlaytest ? "YES" : "NO"}`,
    "",
    "Details:",
    ...status.details.map((detail, index) => `${index + 1}. ${detail}`),
  ].join("\n");
}

export function renderUnityFallRecoveryApplyResult(result: UnityFallRecoveryApplyResult): string {
  if (!result.applied) {
    return [
      "UNITY FALL RECOVERY APPLY BLOCKED",
      "",
      `Scene: ${result.scenePath}`,
      `Scene Path: ${result.sceneAbsolutePath}`,
      `Player: ${result.playerName ?? "none"}`,
      `Respawn Target: ${result.respawnTargetName ?? "fallback spawn"}`,
      `Script Path: ${result.scriptPath}`,
      `Backup Path: ${result.backupPath}`,
      "",
      "Blocked Reasons:",
      ...result.blockedReasons.map((reason, index) => `${index + 1}. ${reason}`),
    ].join("\n");
  }

  return [
    "UNITY FALL RECOVERY APPLY COMPLETE",
    "",
    `Scene: ${result.scenePath}`,
    `Scene Path: ${result.sceneAbsolutePath}`,
    `Player: ${result.playerName ?? "none"}`,
    `Respawn Target: ${result.respawnTargetName ?? "fallback spawn"}`,
    `Script Path: ${result.scriptPath}`,
    `Backup Path: ${result.backupPath}`,
    `FallRecovery.cs Exists: ${result.fallRecoveryScriptExists ? "YES" : "NO"}`,
    `FallRecovery Attached: ${result.fallRecoveryAttached ? "YES" : "NO"}`,
    `Respawn Target Assigned: ${result.respawnTargetAssigned ? "YES" : "NO"}`,
    `Fall Threshold Present: ${result.fallThresholdPresent ? "YES" : "NO"}`,
    `Safe To Open Unity/Playtest: ${result.safeToOpenUnityForCompileOrPlaytest ? "YES" : "NO"}`,
  ].join("\n");
}

export function renderUnityFallRecoveryRollbackResult(result: UnityFallRecoveryRollbackResult): string {
  if (!result.restored) {
    return [
      "UNITY FALL RECOVERY ROLLBACK BLOCKED",
      "",
      `Scene: ${result.scenePath}`,
      `Scene Path: ${result.sceneAbsolutePath}`,
      `Script Path: ${result.scriptPath}`,
      `Backup Path: ${result.backupPath}`,
      "",
      "Blocked Reasons:",
      ...result.blockedReasons.map((reason, index) => `${index + 1}. ${reason}`),
    ].join("\n");
  }

  return [
    "UNITY FALL RECOVERY ROLLBACK COMPLETE",
    "",
    `Scene: ${result.scenePath}`,
    `Scene Path: ${result.sceneAbsolutePath}`,
    `Script Path: ${result.scriptPath}`,
    `Backup Path: ${result.backupPath}`,
    `FallRecovery Attached: ${result.fallRecoveryAttached ? "YES" : "NO"}`,
    `Respawn Target Assigned: ${result.respawnTargetAssigned ? "YES" : "NO"}`,
    `FallRecovery.cs Exists: ${result.fallRecoveryScriptExists ? "YES" : "NO"}`,
    `Safe To Open Unity/Playtest: ${result.safeToOpenUnityForCompileOrPlaytest ? "YES" : "NO"}`,
  ].join("\n");
}

export function renderUnityBasicEnemyStatus(status: UnityBasicEnemyStatus): string {
  return [
    "UNITY BASIC ENEMY STATUS",
    "",
    `Scene: ${status.scenePath}`,
    `Scene Path: ${status.sceneAbsolutePath}`,
    `Enemy: ${status.enemyName ?? "none"}`,
    `BasicEnemy.cs Exists: ${status.basicEnemyScriptExists ? "YES" : "NO"}`,
    `Enemy GameObject Exists: ${status.enemyExists ? "YES" : "NO"}`,
    `BasicEnemy Attached: ${status.scriptAttached ? "YES" : "NO"}`,
    `Positioned On Ground: ${status.positionedOnGround ? "YES" : "NO"}`,
    `Backup Exists: ${status.backupExists ? "YES" : "NO"}`,
    `Safe To Open Unity/Playtest: ${status.safeToOpenUnityForCompileOrPlaytest ? "YES" : "NO"}`,
    "",
    "Details:",
    ...status.details.map((detail, index) => `${index + 1}. ${detail}`),
  ].join("\n");
}

export function renderUnityBasicEnemyApplyResult(result: UnityBasicEnemyApplyResult): string {
  if (!result.applied) {
    return [
      "UNITY BASIC ENEMY APPLY BLOCKED",
      "",
      `Scene: ${result.scenePath}`,
      `Scene Path: ${result.sceneAbsolutePath}`,
      `Enemy: ${result.enemyName ?? "none"}`,
      `Script Path: ${result.scriptPath}`,
      `Backup Path: ${result.backupPath}`,
      "",
      "Blocked Reasons:",
      ...result.blockedReasons.map((reason, index) => `${index + 1}. ${reason}`),
    ].join("\n");
  }

  return [
    "UNITY BASIC ENEMY APPLY COMPLETE",
    "",
    `Scene: ${result.scenePath}`,
    `Scene Path: ${result.sceneAbsolutePath}`,
    `Enemy: ${result.enemyName ?? "none"}`,
    `Script Path: ${result.scriptPath}`,
    `Backup Path: ${result.backupPath}`,
    `BasicEnemy.cs Exists: ${result.basicEnemyScriptExists ? "YES" : "NO"}`,
    `Enemy GameObject Exists: ${result.enemyExists ? "YES" : "NO"}`,
    `BasicEnemy Attached: ${result.scriptAttached ? "YES" : "NO"}`,
    `Positioned On Ground: ${result.positionedOnGround ? "YES" : "NO"}`,
    `Safe To Open Unity/Playtest: ${result.safeToOpenUnityForCompileOrPlaytest ? "YES" : "NO"}`,
  ].join("\n");
}

export function renderUnityBasicEnemyRollbackResult(result: UnityBasicEnemyRollbackResult): string {
  if (!result.restored) {
    return [
      "UNITY BASIC ENEMY ROLLBACK BLOCKED",
      "",
      `Scene: ${result.scenePath}`,
      `Scene Path: ${result.sceneAbsolutePath}`,
      `Script Path: ${result.scriptPath}`,
      `Backup Path: ${result.backupPath}`,
      "",
      "Blocked Reasons:",
      ...result.blockedReasons.map((reason, index) => `${index + 1}. ${reason}`),
    ].join("\n");
  }

  return [
    "UNITY BASIC ENEMY ROLLBACK COMPLETE",
    "",
    `Scene: ${result.scenePath}`,
    `Scene Path: ${result.sceneAbsolutePath}`,
    `Script Path: ${result.scriptPath}`,
    `Backup Path: ${result.backupPath}`,
    `BasicEnemy.cs Exists: ${result.basicEnemyScriptExists ? "YES" : "NO"}`,
    `Enemy GameObject Exists: ${result.enemyExists ? "YES" : "NO"}`,
    `BasicEnemy Attached: ${result.scriptAttached ? "YES" : "NO"}`,
    `Positioned On Ground: ${result.positionedOnGround ? "YES" : "NO"}`,
    `Safe To Open Unity/Playtest: ${result.safeToOpenUnityForCompileOrPlaytest ? "YES" : "NO"}`,
  ].join("\n");
}

export function renderUnityPlayerAttackStatus(status: UnityPlayerAttackStatus): string {
  return [
    "UNITY PLAYER ATTACK STATUS",
    "",
    `Scene: ${status.scenePath}`,
    `Scene Path: ${status.sceneAbsolutePath}`,
    `Player: ${status.playerName ?? "none"}`,
    `Enemy: ${status.enemyName ?? "none"}`,
    `PlayerAttack.cs Exists: ${status.playerAttackScriptExists ? "YES" : "NO"}`,
    `PlayerAttack Attached: ${status.playerAttackAttached ? "YES" : "NO"}`,
    `Attack Key Configured: ${status.attackKeyConfigured ? "YES" : "NO"}`,
    `Backup Exists: ${status.backupExists ? "YES" : "NO"}`,
    `Safe To Open Unity/Playtest: ${status.safeToOpenUnityForCompileOrPlaytest ? "YES" : "NO"}`,
    "",
    "Details:",
    ...status.details.map((detail, index) => `${index + 1}. ${detail}`),
  ].join("\n");
}

export function renderUnityPlayerAttackApplyResult(result: UnityPlayerAttackApplyResult): string {
  if (!result.applied) {
    return [
      "UNITY PLAYER ATTACK APPLY BLOCKED",
      "",
      `Scene: ${result.scenePath}`,
      `Scene Path: ${result.sceneAbsolutePath}`,
      `Player: ${result.playerName ?? "none"}`,
      `Enemy: ${result.enemyName ?? "none"}`,
      `Script Path: ${result.scriptPath}`,
      `Backup Path: ${result.backupPath}`,
      "",
      "Blocked Reasons:",
      ...result.blockedReasons.map((reason, index) => `${index + 1}. ${reason}`),
    ].join("\n");
  }

  return [
    "UNITY PLAYER ATTACK APPLY COMPLETE",
    "",
    `Scene: ${result.scenePath}`,
    `Scene Path: ${result.sceneAbsolutePath}`,
    `Player: ${result.playerName ?? "none"}`,
    `Enemy: ${result.enemyName ?? "none"}`,
    `Script Path: ${result.scriptPath}`,
    `Backup Path: ${result.backupPath}`,
    `PlayerAttack.cs Exists: ${result.playerAttackScriptExists ? "YES" : "NO"}`,
    `PlayerAttack Attached: ${result.playerAttackAttached ? "YES" : "NO"}`,
    `Attack Key Configured: ${result.attackKeyConfigured ? "YES" : "NO"}`,
    `Safe To Open Unity/Playtest: ${result.safeToOpenUnityForCompileOrPlaytest ? "YES" : "NO"}`,
  ].join("\n");
}

export function renderUnityPlayerAttackRollbackResult(result: UnityPlayerAttackRollbackResult): string {
  if (!result.restored) {
    return [
      "UNITY PLAYER ATTACK ROLLBACK BLOCKED",
      "",
      `Scene: ${result.scenePath}`,
      `Scene Path: ${result.sceneAbsolutePath}`,
      `Script Path: ${result.scriptPath}`,
      `Backup Path: ${result.backupPath}`,
      "",
      "Blocked Reasons:",
      ...result.blockedReasons.map((reason, index) => `${index + 1}. ${reason}`),
    ].join("\n");
  }

  return [
    "UNITY PLAYER ATTACK ROLLBACK COMPLETE",
    "",
    `Scene: ${result.scenePath}`,
    `Scene Path: ${result.sceneAbsolutePath}`,
    `Script Path: ${result.scriptPath}`,
    `Backup Path: ${result.backupPath}`,
    `PlayerAttack.cs Exists: ${result.playerAttackScriptExists ? "YES" : "NO"}`,
    `PlayerAttack Attached: ${result.playerAttackAttached ? "YES" : "NO"}`,
    `Attack Key Configured: ${result.attackKeyConfigured ? "YES" : "NO"}`,
    `Safe To Open Unity/Playtest: ${result.safeToOpenUnityForCompileOrPlaytest ? "YES" : "NO"}`,
  ].join("\n");
}
