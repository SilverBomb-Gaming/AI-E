import { copyFile, readFile, stat, writeFile } from "node:fs/promises";
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

export type UnitySceneWiringStatus = {
  scenePath: string;
  sceneAbsolutePath: string;
  backupPath: string;
  cameraFollowAttached: boolean;
  targetAssigned: boolean;
  backupExists: boolean;
  safeToOpenUnityForCompileOrPlaytest: boolean;
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

type ParsedScene = {
  scenePath: string;
  sceneAbsolutePath: string;
  source: string;
  blocks: SceneBlock[];
  scriptGuid: string | null;
  mainCamera: SceneObject | null;
  playerCandidate: SceneObject | null;
  mainCameraTransformFileId: string | null;
  playerTransformFileId: string | null;
  cameraFollowComponentFileId: string | null;
  cameraFollowTargetFileId: string | null;
  offset: { x: number; y: number; z: number };
};

const CAMERA_SCRIPT_PATH = "Assets/Scripts/CameraFollow.cs";
const CAMERA_META_PATH = `${CAMERA_SCRIPT_PATH}.meta`;

function sceneBackupPathFor(sceneAbsolutePath: string): string {
  return `${sceneAbsolutePath}.aie-backup`;
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

function extractVector3(block: SceneBlock | null): { x: number; y: number; z: number } | null {
  if (!block) {
    return null;
  }

  const match = block.body.match(/^  m_LocalPosition: \{x: ([^,]+), y: ([^,]+), z: ([^}]+)\}$/m);
  if (!match) {
    return null;
  }

  return {
    x: Number(match[1]),
    y: Number(match[2]),
    z: Number(match[3]),
  };
}

function computeOffset(cameraPosition: { x: number; y: number; z: number } | null, playerPosition: { x: number; y: number; z: number } | null): { x: number; y: number; z: number } {
  if (!cameraPosition || !playerPosition) {
    return { x: 0, y: 4, z: -6 };
  }

  return {
    x: Number((cameraPosition.x - playerPosition.x).toFixed(3)),
    y: Number((cameraPosition.y - playerPosition.y).toFixed(3)),
    z: Number((cameraPosition.z - playerPosition.z).toFixed(3)),
  };
}

function selectScene(snapshot: GameProjectSnapshot): string {
  if (snapshot.structure.scenes.length === 0) {
    throw new Error("No Unity scene files were found under Assets.");
  }

  return [...snapshot.structure.scenes].sort((left, right) => left.localeCompare(right))[0];
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
  const mainCameraTransformFileId = mainCamera
    ? mainCamera.componentFileIds.find((componentFileId) => findBlock(blocks, componentFileId)?.typeId === "4") ?? null
    : null;
  const playerTransformFileId = playerCandidate
    ? playerCandidate.componentFileIds.find((componentFileId) => findBlock(blocks, componentFileId)?.typeId === "4") ?? null
    : null;
  const cameraFollowBlock = mainCamera
    ? mainCamera.componentFileIds
      .map((componentFileId) => findBlock(blocks, componentFileId))
      .find((block): block is SceneBlock => block?.typeId === "114" && /EnemyAIDemo\.CameraFollow/.test(block.body)) ?? null
    : null;
  const cameraPosition = extractVector3(findBlock(blocks, mainCameraTransformFileId));
  const playerPosition = extractVector3(findBlock(blocks, playerTransformFileId));
  const scriptMetaAbsolutePath = path.join(snapshot.rootPath, CAMERA_META_PATH);
  let scriptGuid: string | null = null;

  if (await fileExists(scriptMetaAbsolutePath)) {
    const metaSource = await readFile(scriptMetaAbsolutePath, "utf-8");
    scriptGuid = metaSource.match(/^guid: ([0-9a-f]{32})$/m)?.[1] ?? null;
  }

  return {
    scenePath,
    sceneAbsolutePath,
    source,
    blocks,
    scriptGuid,
    mainCamera,
    playerCandidate,
    mainCameraTransformFileId,
    playerTransformFileId,
    cameraFollowComponentFileId: cameraFollowBlock?.fileId ?? null,
    cameraFollowTargetFileId: cameraFollowBlock?.body.match(/^  target: \{fileID: (\d+)\}$/m)?.[1] ?? null,
    offset: computeOffset(cameraPosition, playerPosition),
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

  if (!parsedScene.cameraFollowComponentFileId) {
    actions.push("CameraFollow is not attached yet and can be added to Main Camera.");
  } else if (!parsedScene.cameraFollowTargetFileId || parsedScene.cameraFollowTargetFileId === "0") {
    actions.push("CameraFollow is attached but the target Transform still needs assignment.");
  }

  if (!parsedScene.scriptGuid) {
    actions.push("CameraFollow.cs.meta is missing; the guarded apply step will create the required script GUID sidecar before writing the scene.");
  }

  if (actions.length === 0) {
    actions.push("CameraFollow scene wiring is already present.");
  }

  return actions;
}

export async function inspectUnitySceneWiring(projectPath: string): Promise<UnitySceneWiringSnapshot> {
  const parsedScene = await parseProjectScene(projectPath);
  const mainCameraFound = parsedScene.mainCamera !== null;
  const playerCandidateFound = parsedScene.playerCandidate !== null && parsedScene.playerTransformFileId !== null;
  const cameraFollowAlreadyAttached = parsedScene.cameraFollowComponentFileId !== null;

  return {
    projectPath: path.resolve(projectPath),
    scenePath: parsedScene.scenePath,
    mainCameraFound,
    playerCandidateFound,
    cameraFollowAlreadyAttached,
    safeToWire: mainCameraFound && playerCandidateFound && (!cameraFollowAlreadyAttached || parsedScene.cameraFollowTargetFileId === null || parsedScene.cameraFollowTargetFileId === "0"),
    recommendedActions: buildRecommendedActions(parsedScene),
    safety: {
      readOnly: true,
      noUnityExecution: true,
    },
  };
}

function nextFileId(blocks: readonly SceneBlock[]): string {
  const maxValue = blocks.reduce((currentMax, block) => Math.max(currentMax, Number(block.fileId)), 0);
  return String(maxValue + 1);
}

function appendComponentReference(gameObjectBlock: SceneBlock, componentFileId: string): string {
  if (new RegExp(`component: \\{fileID: ${componentFileId}\\}`).test(gameObjectBlock.raw)) {
    return gameObjectBlock.raw;
  }

  return gameObjectBlock.raw.replace(/(  m_Component:\r?\n(?:  - component: \{fileID: \d+\}\r?\n)+)/, `$1  - component: {fileID: ${componentFileId}}\n`);
}

function buildCameraFollowComponentBlock(componentFileId: string, gameObjectFileId: string, scriptGuid: string, targetFileId: string, offset: { x: number; y: number; z: number }): string {
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
    "  m_EditorClassIdentifier: Assembly-CSharp::EnemyAIDemo.CameraFollow",
    `  target: {fileID: ${targetFileId}}`,
    `  offset: {x: ${offset.x}, y: ${offset.y}, z: ${offset.z}}`,
    "  followSmoothTime: 0.15",
    "  lookAtTarget: 1",
    "",
  ].join("\n");
}

function updateTargetAssignment(componentBlock: SceneBlock, targetFileId: string): string {
  if (/^  target: \{fileID: \d+\}$/m.test(componentBlock.raw)) {
    return componentBlock.raw.replace(/^  target: \{fileID: \d+\}$/m, `  target: {fileID: ${targetFileId}}`);
  }

  return componentBlock.raw.replace(/^  m_EditorClassIdentifier: .*$/m, `$&\n  target: {fileID: ${targetFileId}}`);
}

export async function applyUnityCameraWiring(projectPath: string, recoverySafe: boolean): Promise<UnitySceneWiringApplyResult> {
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

  const scriptAbsolutePath = path.join(path.dirname(path.dirname(parsedScene.sceneAbsolutePath)), "Scripts", "CameraFollow.cs");
  if (!(await fileExists(scriptAbsolutePath))) {
    blockedReasons.push(`CameraFollow script does not exist: ${CAMERA_SCRIPT_PATH}`);
  }

  if (parsedScene.cameraFollowComponentFileId && parsedScene.cameraFollowTargetFileId === parsedScene.playerTransformFileId) {
    blockedReasons.push("CameraFollow is already attached to Main Camera with the player target assigned.");
  }

  const backupPath = sceneBackupPathFor(parsedScene.sceneAbsolutePath);
  const backupExists = await fileExists(backupPath);
  if (blockedReasons.length > 0) {
    return {
      applied: false,
      scenePath: parsedScene.scenePath,
      sceneAbsolutePath: parsedScene.sceneAbsolutePath,
      backupPath,
      cameraFollowAttached: parsedScene.cameraFollowComponentFileId !== null,
      targetAssigned: parsedScene.cameraFollowTargetFileId !== null && parsedScene.cameraFollowTargetFileId !== "0",
      safeToOpenUnityForCompileOrPlaytest: false,
      blockedReasons,
      safety: {
        noUnityExecution: true,
        backupCreated: backupExists,
        sceneWritten: false,
      },
    };
  }

  const scriptGuid = parsedScene.scriptGuid ?? await ensureCameraFollowMeta(path.dirname(path.dirname(path.dirname(parsedScene.sceneAbsolutePath))));
  let updatedSource = parsedScene.source;

  if (!backupExists) {
    await copyFile(parsedScene.sceneAbsolutePath, backupPath);
  }

  if (parsedScene.cameraFollowComponentFileId) {
    const existingComponent = findBlock(parsedScene.blocks, parsedScene.cameraFollowComponentFileId);
    if (!existingComponent || !parsedScene.playerTransformFileId) {
      throw new Error("CameraFollow component was detected but could not be updated safely.");
    }

    updatedSource = updatedSource.replace(existingComponent.raw, updateTargetAssignment(existingComponent, parsedScene.playerTransformFileId));
  } else {
    if (!parsedScene.mainCamera || !parsedScene.playerTransformFileId) {
      throw new Error("Scene wiring prerequisites were not present during apply.");
    }

    const componentFileId = nextFileId(parsedScene.blocks);
    const mainCameraBlock = findBlock(parsedScene.blocks, parsedScene.mainCamera.gameObjectFileId);
    if (!mainCameraBlock) {
      throw new Error("Main Camera GameObject block was not found.");
    }

    updatedSource = updatedSource.replace(mainCameraBlock.raw, appendComponentReference(mainCameraBlock, componentFileId));
    updatedSource = `${updatedSource.trimEnd()}\n${buildCameraFollowComponentBlock(componentFileId, parsedScene.mainCamera.gameObjectFileId, scriptGuid, parsedScene.playerTransformFileId, parsedScene.offset)}`;
  }

  await writeFile(parsedScene.sceneAbsolutePath, updatedSource, "utf-8");
  const status = await inspectUnityCameraWiringStatus(projectPath, recoverySafe);
  return {
    applied: true,
    scenePath: parsedScene.scenePath,
    sceneAbsolutePath: parsedScene.sceneAbsolutePath,
    backupPath,
    cameraFollowAttached: status.cameraFollowAttached,
    targetAssigned: status.targetAssigned,
    safeToOpenUnityForCompileOrPlaytest: status.safeToOpenUnityForCompileOrPlaytest,
    blockedReasons: [],
    safety: {
      noUnityExecution: true,
      backupCreated: true,
      sceneWritten: true,
    },
  };
}

export async function inspectUnityCameraWiringStatus(projectPath: string, recoverySafe: boolean): Promise<UnitySceneWiringStatus> {
  const parsedScene = await parseProjectScene(projectPath);
  const backupPath = sceneBackupPathFor(parsedScene.sceneAbsolutePath);
  const backupExists = await fileExists(backupPath);
  const cameraFollowAttached = parsedScene.cameraFollowComponentFileId !== null;
  const targetAssigned = parsedScene.cameraFollowTargetFileId !== null && parsedScene.cameraFollowTargetFileId !== "0";

  return {
    scenePath: parsedScene.scenePath,
    sceneAbsolutePath: parsedScene.sceneAbsolutePath,
    backupPath,
    cameraFollowAttached,
    targetAssigned,
    backupExists,
    safeToOpenUnityForCompileOrPlaytest: recoverySafe && cameraFollowAttached && targetAssigned,
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

export function renderUnitySceneWiringStatus(status: UnitySceneWiringStatus): string {
  return [
    "UNITY CAMERA WIRING STATUS",
    "",
    `Scene: ${status.scenePath}`,
    `Scene Path: ${status.sceneAbsolutePath}`,
    `CameraFollow Attached: ${status.cameraFollowAttached ? "YES" : "NO"}`,
    `Target Assigned: ${status.targetAssigned ? "YES" : "NO"}`,
    `Backup Exists: ${status.backupExists ? "YES" : "NO"}`,
    `Safe To Open Unity For Compile/Playtest: ${status.safeToOpenUnityForCompileOrPlaytest ? "YES" : "NO"}`,
  ].join("\n");
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