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
