import { copyFile, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

import type { GameProjectSnapshot } from "./gameProjectInspector";

export type GameTask = {
  type: "create-new-script" | "modify-existing-script";
  title: string;
  description: string;
  targetFile?: string;
  steps: string[];
  code?: string;
  expectedResult: string;
  safety: {
    outputOnly: true;
    requiresHumanUnityPlaytest: true;
  };
};

export type GamePatchPlan = {
  targetFile: string;
  className: string;
  namespace?: string;
  changeType: "modify-existing-script";
  summary: string;
  exactInstructions: string[];
  artifact: UnityPatchArtifact;
  expectedResult: string;
  safety: {
    outputOnly: true;
    noFileWrites: true;
    requiresHumanUnityPlaytest: true;
  };
};

export type UnityPatchArtifact = {
  patchKind: "gameplay-update" | "jump-diagnostic" | "production-movement" | "camera-tuning";
  operation: "create-new-script" | "modify-existing-script";
  targetFile: string;
  absoluteTargetPath: string;
  backupTag?: string;
  originalSha256: string;
  replacementSha256: string;
  replacementCode: string;
  validationRules: {
    preserveClassName: string;
    preserveNamespace?: string;
    forbiddenClassNames: string[];
    requireNoDuplicateMethods: boolean;
  };
  safety: {
    requiresCleanRecoveryState: true;
    createsBackupBeforeApply: true;
    noUnityExecution: true;
  };
};

export type UnityPatchPreview = {
  artifact: UnityPatchArtifact;
  detectedClass: string;
  detectedNamespace?: string;
  diffSummary: string[];
  safetyStatus: string[];
};

export type UnityPatchApplyResult = {
  applied: boolean;
  patchKind: UnityPatchArtifact["patchKind"];
  targetFile: string;
  targetPath: string;
  backupPath: string;
  originalSha256: string;
  replacementSha256: string;
  currentSha256?: string;
  blockedReasons: string[];
  recoveryGuidance: string[];
  safety: {
    noUnityExecution: true;
    backupCreated: boolean;
    targetWritten: boolean;
  };
};

export type NextGameTaskExecutionResult = {
  executed: boolean;
  stage: string;
  title: string;
  scriptName: string;
  targetFile: string;
  targetPath: string;
  patchKind: UnityPatchArtifact["patchKind"];
  operation: UnityPatchArtifact["operation"];
  backupPath: string;
  safeToOpenUnityForCompileOrPlaytest: boolean;
  blockedReasons: string[];
};

export type UnityPatchStatus = {
  patchKind: "gameplay-update" | "jump-diagnostic" | "production-movement" | "camera-tuning";
  targetFile: string;
  targetPath: string;
  backupPath: string;
  backupExists: boolean;
  currentSha256: string;
  expectedPatchedSha256: string;
  currentFileAppearsPatched: boolean;
  jumpDiagnosticPatchApplied: boolean;
  jumpLogicPresent: boolean;
  usesKeyCodeSpace: boolean;
  usesCharacterControllerGrounded: boolean;
  diagnosticLogsPresent: boolean;
  debugJumpLogsEnabled: boolean;
  rollbackAvailable: boolean;
  safeToOpenUnityForCompileOrPlaytest: boolean;
  recoverySafe: boolean;
  safety: {
    noUnityExecution: true;
  };
};

export type UnityPatchRollbackResult = {
  restored: boolean;
  targetFile: string;
  targetPath: string;
  backupPath: string;
  restoredSha256?: string;
  blockedReasons: string[];
  safety: {
    noUnityExecution: true;
    backupRetained: true;
  };
};

export type CameraTuningStatus = {
  targetFile: string;
  targetPath: string;
  backupPath: string;
  backupExists: boolean;
  cameraFollowExists: boolean;
  targetFieldPresent: boolean;
  offsetFieldPresent: boolean;
  lateUpdatePresent: boolean;
  lookAtPresent: boolean;
  debugFollowPresent: boolean;
  safeToOpenUnityForCompileOrPlaytest: boolean;
  recoverySafe: boolean;
  safety: {
    noUnityExecution: true;
  };
};

const PLAYER_CONTROLLER_CODE = `using UnityEngine;

[RequireComponent(typeof(Rigidbody))]
public class PlayerController : MonoBehaviour
{
    [SerializeField] private float moveSpeed = 6f;
    [SerializeField] private float jumpForce = 7f;
    [SerializeField] private Transform groundCheck;
    [SerializeField] private float groundCheckRadius = 0.2f;
    [SerializeField] private LayerMask groundLayers = ~0;

    private Rigidbody body;
    private Vector3 movementInput;
    private bool jumpRequested;

    private void Awake()
    {
        body = GetComponent<Rigidbody>();
    }

    private void Update()
    {
        float horizontal = Input.GetAxisRaw("Horizontal");
        float vertical = Input.GetAxisRaw("Vertical");
        movementInput = new Vector3(horizontal, 0f, vertical).normalized;

        if (Input.GetButtonDown("Jump") && IsGrounded())
        {
            jumpRequested = true;
        }
    }

    private void FixedUpdate()
    {
        Vector3 velocity = body.linearVelocity;
        Vector3 targetVelocity = new Vector3(movementInput.x * moveSpeed, velocity.y, movementInput.z * moveSpeed);
        body.linearVelocity = targetVelocity;

        if (jumpRequested)
        {
            body.AddForce(Vector3.up * jumpForce, ForceMode.Impulse);
            jumpRequested = false;
        }
    }

    private bool IsGrounded()
    {
        Vector3 checkPosition = groundCheck != null ? groundCheck.position : transform.position + Vector3.down * 0.5f;
        return Physics.CheckSphere(checkPosition, groundCheckRadius, groundLayers, QueryTriggerInteraction.Ignore);
    }

    private void OnDrawGizmosSelected()
    {
        Vector3 checkPosition = groundCheck != null ? groundCheck.position : transform.position + Vector3.down * 0.5f;
        Gizmos.color = Color.yellow;
        Gizmos.DrawWireSphere(checkPosition, groundCheckRadius);
    }
}`;

function buildNotStartedTask(): GameTask {
  return {
    type: "create-new-script",
    title: "Create first scene",
    description: "Start the project by creating a playable Unity scene and saving it under Assets/Scenes.",
    targetFile: "Assets/Scenes/MainScene.unity",
    steps: [
      "Create an Assets/Scenes folder if it does not exist.",
      "Create and save a new Unity scene as MainScene.",
      "Add a floor plane and a camera so the scene is navigable.",
      "Save the scene and add it to Build Settings.",
    ],
    expectedResult: "A first playable Unity scene exists and can be opened from Assets/Scenes.",
    safety: {
      outputOnly: true,
      requiresHumanUnityPlaytest: true,
    },
  };
}

function buildSceneOnlyTask(): GameTask {
  return {
    type: "create-new-script",
    title: "Add PlayerController script",
    description: "Introduce the first gameplay logic script so the scene moves beyond static content.",
    targetFile: "Assets/Scripts/PlayerController.cs",
    steps: [
      "Create a new C# script named PlayerController in Assets/Scripts.",
      "Add movement input handling for horizontal and vertical movement.",
      "Attach the script to the player object in the scene.",
      "Press Play and verify that input changes the player position.",
    ],
    expectedResult: "The scene has its first gameplay script attached to a controllable player object.",
    safety: {
      outputOnly: true,
      requiresHumanUnityPlaytest: true,
    },
  };
}

function buildModifyExistingMovementTask(targetFile: string): GameTask {
  return {
    type: "modify-existing-script",
    title: "Improve existing player movement script",
    description: "The project already contains a likely movement script, so do not create PlayerController.cs yet.",
    targetFile,
    steps: [
      "Open the detected movement script.",
      "Do not paste a duplicate class into it.",
      "Review the current class name and namespace.",
      "Replace only after the generated patch is tailored to that file.",
      "If Unity currently has duplicate class errors, restore the edited script before continuing.",
      "Revert SimpleKeyboardPlayerMover.cs to its previous version.",
      "Wait for Unity compile errors to clear.",
      "Re-run the AI-E game task generator.",
      "Continue only after AI-E targets the existing file safely.",
    ],
    expectedResult: "No duplicate class or duplicate method compile errors.",
    safety: {
      outputOnly: true,
      requiresHumanUnityPlaytest: true,
    },
  };
}

function buildLogicPresentTask(): GameTask {
  return {
    type: "create-new-script",
    title: "Create PlayerController with movement",
    description: "Add a reusable Rigidbody-based player movement controller with WASD movement and jumping.",
    targetFile: "Assets/Scripts/PlayerController.cs",
    steps: [
      "Create a new C# script named PlayerController in Assets/Scripts.",
      "Paste the generated code into the script and save it.",
      "Attach the script to the player GameObject.",
      "Add a Rigidbody component and assign a ground check transform if desired.",
      "Press Play and verify that WASD moves the player and Space jumps.",
    ],
    code: PLAYER_CONTROLLER_CODE,
    expectedResult: "Player moves with WASD and jumps with Space using Rigidbody-based movement.",
    safety: {
      outputOnly: true,
      requiresHumanUnityPlaytest: true,
    },
  };
}

function buildUnknownTask(): GameTask {
  return {
    type: "modify-existing-script",
    title: "Inspect project setup",
    description: "The current project structure does not match the expected Unity readiness states.",
    steps: [
      "Confirm the selected path points at a Unity project root.",
      "Check that Assets, ProjectSettings, and Packages are present.",
      "Re-run the inspector once the project root is confirmed.",
    ],
    expectedResult: "The project root is validated and ready for the next guided task.",
    safety: {
      outputOnly: true,
      requiresHumanUnityPlaytest: true,
    },
  };
}

export function generateGameTask(snapshot: GameProjectSnapshot): GameTask {
  if (snapshot.engine !== "unity") {
    return buildUnknownTask();
  }

  if (snapshot.readiness === "not-started") {
    return buildNotStartedTask();
  }

  if (snapshot.readiness === "scene-only") {
    return buildSceneOnlyTask();
  }

  if (snapshot.readiness === "logic-present") {
    const existingMovementScript = snapshot.analysis.scriptSignals.movementScripts[0];
    if (existingMovementScript) {
      return buildModifyExistingMovementTask(existingMovementScript);
    }

    return buildLogicPresentTask();
  }

  return buildUnknownTask();
}

export function renderGameTask(task: GameTask): string {
  const lines = [
    "NEXT TASK",
    "",
    `Task Type: ${task.type}`,
    `Title: ${task.title}`,
    `Description: ${task.description}`,
    `Target File: ${task.targetFile ?? "none"}`,
    `Important Warning: ${task.type === "modify-existing-script" ? "Do not create or paste a duplicate movement class." : "Confirm the target file does not already exist before creating it."}`,
    "",
    "Steps:",
    ...task.steps.map((step, index) => `${index + 1}. ${step}`),
  ];

  if (task.code && task.type !== "modify-existing-script") {
    lines.push("", "Code:", task.code);
  }

  if (task.type === "modify-existing-script") {
    lines.push("", "Important:", "- inspect the existing script first", "- do not paste generic PlayerController code into an existing class");
  }

  lines.push(
    "",
    `Expected Result: ${task.expectedResult}`,
    "",
    "Safety:",
    `- output only: ${task.safety.outputOnly ? "true" : "false"}`,
    `- requires human Unity playtest: ${task.safety.requiresHumanUnityPlaytest ? "true" : "false"}`,
    "- no file writes",
    "- no Unity execution",
  );
  return lines.join("\n");
}

type ExistingScriptAnalysis = {
  namespace?: string;
  className: string;
  attributeLines: string[];
  fields: string[];
  hasAwake: boolean;
  hasUpdate: boolean;
  hasMovementLogic: boolean;
};

function detectNamespace(source: string): string | undefined {
  const match = source.match(/namespace\s+([A-Za-z_][A-Za-z0-9_.]*)/);
  return match?.[1];
}

function detectClassName(source: string): string {
  const match = source.match(/class\s+([A-Za-z_][A-Za-z0-9_]*)/);
  if (!match?.[1]) {
    throw new Error("Unable to detect class name in target script.");
  }

  return match[1];
}

function detectAttributeLines(source: string): string[] {
  return source
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("[") && line.endsWith("]"));
}

function detectFields(source: string): string[] {
  return Array.from(source.matchAll(/private\s+[A-Za-z0-9_<>,.?\[\]]+\s+([A-Za-z_][A-Za-z0-9_]*)\s*(=|;)/g), (match) => match[1] ?? "").filter(Boolean);
}

function analyzeExistingScript(source: string): ExistingScriptAnalysis {
  return {
    namespace: detectNamespace(source),
    className: detectClassName(source),
    attributeLines: detectAttributeLines(source),
    fields: detectFields(source),
    hasAwake: /\bAwake\s*\(/.test(source),
    hasUpdate: /\bUpdate\s*\(/.test(source),
    hasMovementLogic: /Input\.GetAxisRaw|CharacterController|Rigidbody|controller\.Move|transform\.rotation/.test(source),
  };
}

function uniqueAttributeLines(attributeLines: readonly string[]): string[] {
  return attributeLines.filter((line, index, lines) => lines.indexOf(line) === index);
}

function sha256(content: string): string {
  return createHash("sha256").update(content, "utf-8").digest("hex");
}

async function fileExists(targetPath: string): Promise<boolean> {
  try {
    await stat(targetPath);
    return true;
  } catch {
    return false;
  }
}

function backupPathFor(targetPath: string, backupTag?: string): string {
  return backupTag ? `${targetPath}.aie-backup-${backupTag}` : `${targetPath}.aie-backup`;
}

function backupPathForArtifact(artifact: UnityPatchArtifact): string {
  return backupPathFor(artifact.absoluteTargetPath, artifact.backupTag);
}

const MISSING_FILE_BACKUP_MARKER = "__AIE_ORIGINAL_STATE__:missing-file\n";

function metaPathFor(targetPath: string): string {
  return `${targetPath}.meta`;
}

function buildDeterministicUnityMetaGuid(targetPath: string): string {
  return createHash("sha256").update(targetPath.replace(/\\/g, "/").toLowerCase(), "utf-8").digest("hex").slice(0, 32);
}

async function ensureUnityScriptMeta(targetPath: string): Promise<void> {
  if (!targetPath.endsWith(".cs")) {
    return;
  }

  const metaPath = metaPathFor(targetPath);
  if (await fileExists(metaPath)) {
    return;
  }

  const guid = buildDeterministicUnityMetaGuid(targetPath);
  await writeFile(metaPath, `fileFormatVersion: 2\nguid: ${guid}\n`, "utf-8");
}

function countMethodOccurrences(source: string, methodName: string): number {
  return source.match(new RegExp(`\\b${methodName}\\s*\\(`, "g"))?.length ?? 0;
}

function containsClassName(source: string, className: string): boolean {
  return new RegExp(`\\bclass\\s+${className}\\b`).test(source);
}

function hasJumpLogic(source: string): boolean {
  return (source.includes("Input.GetButtonDown(\"Jump\")") || source.includes("Input.GetKeyDown(KeyCode.Space)"))
    && source.includes("jumpHeight")
    && source.includes("jumpRequested")
    && source.includes("Mathf.Sqrt(jumpHeight * -2f * gravity)");
}

function usesKeyCodeSpaceForJump(source: string): boolean {
  return source.includes("Input.GetKeyDown(KeyCode.Space)");
}

function usesCharacterControllerGroundedSignal(source: string): boolean {
  return source.includes("controller.isGrounded") || source.includes("CharacterController.isGrounded");
}

function hasDebugJumpLogs(source: string): boolean {
  return source.includes("debugJumpLogs")
    && source.includes("[AIE Jump Diagnostic]")
    && source.includes("Debug.Log(");
}

function hasCameraTargetField(source: string): boolean {
  return /\[SerializeField\]\s+private\s+Transform\s+target\s*;/.test(source);
}

function hasCameraOffsetField(source: string): boolean {
  return /\[SerializeField\]\s+private\s+Vector3\s+offset\s*=\s*new\s+Vector3\(0f,\s*4f,\s*-7f\)\s*;/.test(source);
}

function hasCameraLateUpdate(source: string): boolean {
  return /\bLateUpdate\s*\(/.test(source);
}

function hasCameraLookAt(source: string): boolean {
  return source.includes("transform.LookAt(target.position + Vector3.up * lookAtHeight)");
}

function hasCameraDebugFollow(source: string): boolean {
  return source.includes("debugFollow")
    && source.includes("[AIE Camera Follow]")
    && source.includes("distanceToTarget");
}

function buildDiffSummary(original: ExistingScriptAnalysis, replacement: ExistingScriptAnalysis): string[] {
  const summary = [
    `preserve class ${original.className}`,
    `preserve namespace ${original.namespace ?? "none"}`,
    `preserve ${original.attributeLines.length} attribute line(s)`,
  ];

  const addedFields = replacement.fields.filter((field) => !original.fields.includes(field));
  if (addedFields.length > 0) {
    summary.push(`add fields ${addedFields.join(", ")}`);
  }

  if (!original.fields.includes("jumpRequested") && replacement.fields.includes("jumpRequested")) {
    summary.push("add grounded jump request state");
  }

  if (!original.fields.includes("groundCheck") && replacement.fields.includes("groundCheck")) {
    summary.push("add ground probe support for reliable jump gating");
  }

  summary.push(original.hasMovementLogic ? "retain movement controller flow while extending jump behavior" : "introduce explicit movement logic");
  return summary;
}

function validateReplacementCode(artifact: UnityPatchArtifact): string[] {
  const blockedReasons: string[] = [];
  const replacementAnalysis = analyzeExistingScript(artifact.replacementCode);

  if (replacementAnalysis.className !== artifact.validationRules.preserveClassName) {
    blockedReasons.push(`Replacement class changed from ${artifact.validationRules.preserveClassName} to ${replacementAnalysis.className}.`);
  }

  if (artifact.validationRules.preserveNamespace !== undefined
    && replacementAnalysis.namespace !== artifact.validationRules.preserveNamespace) {
    blockedReasons.push(`Replacement namespace changed from ${artifact.validationRules.preserveNamespace} to ${replacementAnalysis.namespace ?? "none"}.`);
  }

  for (const forbiddenClassName of artifact.validationRules.forbiddenClassNames) {
    if (containsClassName(artifact.replacementCode, forbiddenClassName)) {
      blockedReasons.push(`Replacement contains forbidden class ${forbiddenClassName}.`);
    }
  }

  if (artifact.validationRules.requireNoDuplicateMethods) {
    if (countMethodOccurrences(artifact.replacementCode, "Awake") > 1) {
      blockedReasons.push("Replacement contains duplicate Awake methods.");
    }

    if (countMethodOccurrences(artifact.replacementCode, "Update") > 1) {
      blockedReasons.push("Replacement contains duplicate Update methods.");
    }
  }

  return blockedReasons;
}

function buildSimpleKeyboardMoverReplacement(analysis: ExistingScriptAnalysis): string {
  const attributes = uniqueAttributeLines(analysis.attributeLines);
  const indent = "    ";
  const bodyLines = [
    "using UnityEngine;",
    "",
  ];

  if (analysis.namespace) {
    bodyLines.push(`namespace ${analysis.namespace}`, "{");
  }

  bodyLines.push(`${indent}/// <summary>`, `${indent}/// Handles grounded WASD movement and jumping for the playable demo character.`, `${indent}/// </summary>`);
  for (const attribute of attributes) {
    bodyLines.push(`${indent}${attribute}`);
  }
  bodyLines.push(
    `${indent}public sealed class ${analysis.className} : MonoBehaviour`,
    `${indent}{`,
    `${indent}${indent}[SerializeField] [Min(0.1f)] private float moveSpeed = 5f;`,
    `${indent}${indent}[SerializeField] [Min(0f)] private float turnSpeed = 720f;`,
    `${indent}${indent}[SerializeField] [Min(0f)] private float jumpHeight = 1.6f;`,
    `${indent}${indent}[SerializeField] private float gravity = -20f;`,
    `${indent}${indent}[SerializeField] private Transform groundCheck;`,
    `${indent}${indent}[SerializeField] [Min(0.05f)] private float groundCheckRadius = 0.2f;`,
    `${indent}${indent}[SerializeField] private LayerMask groundLayers = ~0;`,
    "",
    `${indent}${indent}private CharacterController controller;`,
    `${indent}${indent}private Vector3 velocity;`,
    `${indent}${indent}private bool jumpRequested;`,
    "",
    `${indent}${indent}private void Awake()`,
    `${indent}${indent}{`,
    `${indent}${indent}${indent}controller = GetComponent<CharacterController>();`,
    `${indent}${indent}}`,
    "",
    `${indent}${indent}private void Update()`,
    `${indent}${indent}{`,
    `${indent}${indent}${indent}Vector3 input = new Vector3(Input.GetAxisRaw("Horizontal"), 0f, Input.GetAxisRaw("Vertical"));`,
    `${indent}${indent}${indent}input = Vector3.ClampMagnitude(input, 1f);`,
    "",
    `${indent}${indent}${indent}Vector3 move = input * moveSpeed;`,
    `${indent}${indent}${indent}bool grounded = IsGrounded();`,
    "",
    `${indent}${indent}${indent}if (grounded && velocity.y < 0f)`,
    `${indent}${indent}${indent}{`,
    `${indent}${indent}${indent}${indent}velocity.y = -2f;`,
    `${indent}${indent}${indent}}`,
    "",
    `${indent}${indent}${indent}if (grounded && Input.GetButtonDown("Jump"))`,
    `${indent}${indent}${indent}{`,
    `${indent}${indent}${indent}${indent}jumpRequested = true;`,
    `${indent}${indent}${indent}}`,
    "",
    `${indent}${indent}${indent}if (jumpRequested)`,
    `${indent}${indent}${indent}{`,
    `${indent}${indent}${indent}${indent}velocity.y = Mathf.Sqrt(jumpHeight * -2f * gravity);`,
    `${indent}${indent}${indent}${indent}jumpRequested = false;`,
    `${indent}${indent}${indent}}`,
    "",
    `${indent}${indent}${indent}velocity.y += gravity * Time.deltaTime;`,
    `${indent}${indent}${indent}controller.Move((move + new Vector3(0f, velocity.y, 0f)) * Time.deltaTime);`,
    "",
    `${indent}${indent}${indent}if (input.sqrMagnitude > 0.001f)`,
    `${indent}${indent}${indent}{`,
    `${indent}${indent}${indent}${indent}Quaternion targetRotation = Quaternion.LookRotation(input, Vector3.up);`,
    `${indent}${indent}${indent}${indent}transform.rotation = Quaternion.RotateTowards(transform.rotation, targetRotation, turnSpeed * Time.deltaTime);`,
    `${indent}${indent}${indent}}`,
    `${indent}${indent}}`,
    "",
    `${indent}${indent}private bool IsGrounded()`,
    `${indent}${indent}{`,
    `${indent}${indent}${indent}Vector3 checkPosition = groundCheck != null ? groundCheck.position : transform.position + Vector3.down * 0.5f;`,
    `${indent}${indent}${indent}return Physics.CheckSphere(checkPosition, groundCheckRadius, groundLayers, QueryTriggerInteraction.Ignore);`,
    `${indent}${indent}}`,
    "",
    `${indent}${indent}private void OnDrawGizmosSelected()`,
    `${indent}${indent}{`,
    `${indent}${indent}${indent}Vector3 checkPosition = groundCheck != null ? groundCheck.position : transform.position + Vector3.down * 0.5f;`,
    `${indent}${indent}${indent}Gizmos.color = Color.yellow;`,
    `${indent}${indent}${indent}Gizmos.DrawWireSphere(checkPosition, groundCheckRadius);`,
    `${indent}${indent}}`,
    `${indent}}`,
  );

  if (analysis.namespace) {
    bodyLines.push("}");
  }

  return bodyLines.join("\n");
}

function buildJumpDiagnosticMoverReplacement(analysis: ExistingScriptAnalysis): string {
  const attributes = uniqueAttributeLines(analysis.attributeLines);
  const indent = "    ";
  const bodyLines = [
    "using UnityEngine;",
    "",
  ];

  if (analysis.namespace) {
    bodyLines.push(`namespace ${analysis.namespace}`, "{");
  }

  bodyLines.push(
    `${indent}/// <summary>`,
    `${indent}/// Instruments jump behavior so runtime playtests can distinguish input, grounded state, and jump application.`,
    `${indent}/// </summary>`,
  );
  for (const attribute of attributes) {
    bodyLines.push(`${indent}${attribute}`);
  }
  bodyLines.push(
    `${indent}public sealed class ${analysis.className} : MonoBehaviour`,
    `${indent}{`,
    `${indent}${indent}[SerializeField] [Min(0.1f)] private float moveSpeed = 5f;`,
    `${indent}${indent}[SerializeField] [Min(0f)] private float turnSpeed = 720f;`,
    `${indent}${indent}[SerializeField] [Min(0f)] private float jumpHeight = 1.6f;`,
    `${indent}${indent}[SerializeField] private float gravity = -20f;`,
    `${indent}${indent}[SerializeField] private bool debugJumpLogs = true;`,
    `${indent}${indent}[SerializeField] private Transform groundCheck;`,
    `${indent}${indent}[SerializeField] [Min(0.05f)] private float groundCheckRadius = 0.2f;`,
    `${indent}${indent}[SerializeField] private LayerMask groundLayers = ~0;`,
    "",
    `${indent}${indent}private CharacterController controller;`,
    `${indent}${indent}private Vector3 velocity;`,
    `${indent}${indent}private bool jumpRequested;`,
    "",
    `${indent}${indent}private void Awake()`,
    `${indent}${indent}{`,
    `${indent}${indent}${indent}controller = GetComponent<CharacterController>();`,
    `${indent}${indent}}`,
    "",
    `${indent}${indent}private void Update()`,
    `${indent}${indent}{`,
    `${indent}${indent}${indent}Vector3 input = new Vector3(Input.GetAxisRaw("Horizontal"), 0f, Input.GetAxisRaw("Vertical"));`,
    `${indent}${indent}${indent}input = Vector3.ClampMagnitude(input, 1f);`,
    `${indent}${indent}${indent}Vector3 move = input * moveSpeed;`,
    "",
    `${indent}${indent}${indent}bool controllerGrounded = controller.isGrounded;`,
    `${indent}${indent}${indent}bool probeGrounded = IsGroundedByProbe();`,
    `${indent}${indent}${indent}bool grounded = controllerGrounded || probeGrounded;`,
    `${indent}${indent}${indent}bool spacePressed = Input.GetKeyDown(KeyCode.Space);`,
    "",
    `${indent}${indent}${indent}if (spacePressed)`,
    `${indent}${indent}${indent}{`,
    `${indent}${indent}${indent}${indent}LogJumpDiagnostic($"Space pressed. grounded={grounded} controllerGrounded={controllerGrounded} probeGrounded={probeGrounded} velocityY={velocity.y:F3}");`,
    `${indent}${indent}${indent}}`,
    "",
    `${indent}${indent}${indent}if (grounded && velocity.y < 0f)`,
    `${indent}${indent}${indent}{`,
    `${indent}${indent}${indent}${indent}velocity.y = -2f;`,
    `${indent}${indent}${indent}}`,
    "",
    `${indent}${indent}${indent}if (spacePressed && grounded)`,
    `${indent}${indent}${indent}{`,
    `${indent}${indent}${indent}${indent}jumpRequested = true;`,
    `${indent}${indent}${indent}${indent}LogJumpDiagnostic("Jump trigger accepted.");`,
    `${indent}${indent}${indent}}`,
    `${indent}${indent}${indent}else if (spacePressed)`,
    `${indent}${indent}${indent}{`,
    `${indent}${indent}${indent}${indent}LogJumpDiagnostic("Jump trigger blocked because grounded was false.");`,
    `${indent}${indent}${indent}}`,
    "",
    `${indent}${indent}${indent}if (jumpRequested)`,
    `${indent}${indent}${indent}{`,
    `${indent}${indent}${indent}${indent}velocity.y = Mathf.Sqrt(jumpHeight * -2f * gravity);`,
    `${indent}${indent}${indent}${indent}jumpRequested = false;`,
    `${indent}${indent}${indent}${indent}LogJumpDiagnostic($"Jump applied. newVelocityY={velocity.y:F3}");`,
    `${indent}${indent}${indent}}`,
    "",
    `${indent}${indent}${indent}velocity.y += gravity * Time.deltaTime;`,
    `${indent}${indent}${indent}controller.Move((move + new Vector3(0f, velocity.y, 0f)) * Time.deltaTime);`,
    "",
    `${indent}${indent}${indent}if (input.sqrMagnitude > 0.001f)`,
    `${indent}${indent}${indent}{`,
    `${indent}${indent}${indent}${indent}Quaternion targetRotation = Quaternion.LookRotation(input, Vector3.up);`,
    `${indent}${indent}${indent}${indent}transform.rotation = Quaternion.RotateTowards(transform.rotation, targetRotation, turnSpeed * Time.deltaTime);`,
    `${indent}${indent}${indent}}`,
    `${indent}${indent}}`,
    "",
    `${indent}${indent}private bool IsGroundedByProbe()`,
    `${indent}${indent}{`,
    `${indent}${indent}${indent}Vector3 checkPosition = groundCheck != null ? groundCheck.position : transform.position + Vector3.down * 0.5f;`,
    `${indent}${indent}${indent}return Physics.CheckSphere(checkPosition, groundCheckRadius, groundLayers, QueryTriggerInteraction.Ignore);`,
    `${indent}${indent}}`,
    "",
    `${indent}${indent}private void LogJumpDiagnostic(string message)`,
    `${indent}${indent}{`,
    `${indent}${indent}${indent}if (!debugJumpLogs)`,
    `${indent}${indent}${indent}{`,
    `${indent}${indent}${indent}${indent}return;`,
    `${indent}${indent}${indent}}`,
    "",
    `${indent}${indent}${indent}Debug.Log($"[AIE Jump Diagnostic] {message}", this);`,
    `${indent}${indent}}`,
    "",
    `${indent}${indent}private void OnDrawGizmosSelected()`,
    `${indent}${indent}{`,
    `${indent}${indent}${indent}Vector3 checkPosition = groundCheck != null ? groundCheck.position : transform.position + Vector3.down * 0.5f;`,
    `${indent}${indent}${indent}Gizmos.color = Color.yellow;`,
    `${indent}${indent}${indent}Gizmos.DrawWireSphere(checkPosition, groundCheckRadius);`,
    `${indent}${indent}}`,
    `${indent}}`,
  );

  if (analysis.namespace) {
    bodyLines.push("}");
  }

  return bodyLines.join("\n");
}

function buildProductionMovementReplacement(analysis: ExistingScriptAnalysis): string {
  const attributes = uniqueAttributeLines(analysis.attributeLines);
  const indent = "    ";
  const bodyLines = [
    "using UnityEngine;",
    "",
  ];

  if (analysis.namespace) {
    bodyLines.push(`namespace ${analysis.namespace}`, "{");
  }

  bodyLines.push(
    `${indent}/// <summary>`,
    `${indent}/// Handles grounded WASD movement and Space jump for the playable demo character.`,
    `${indent}/// </summary>`,
  );
  for (const attribute of attributes) {
    bodyLines.push(`${indent}${attribute}`);
  }
  bodyLines.push(
    `${indent}public sealed class ${analysis.className} : MonoBehaviour`,
    `${indent}{`,
    `${indent}${indent}[SerializeField] [Min(0.1f)] private float moveSpeed = 5f;`,
    `${indent}${indent}[SerializeField] [Min(0f)] private float turnSpeed = 720f;`,
    `${indent}${indent}[SerializeField] [Min(0f)] private float jumpHeight = 1.6f;`,
    `${indent}${indent}[SerializeField] private float gravity = -20f;`,
    `${indent}${indent}[SerializeField] private Transform groundCheck;`,
    `${indent}${indent}[SerializeField] [Min(0.05f)] private float groundCheckRadius = 0.2f;`,
    `${indent}${indent}[SerializeField] private LayerMask groundLayers = ~0;`,
    "",
    `${indent}${indent}private CharacterController controller;`,
    `${indent}${indent}private Vector3 velocity;`,
    `${indent}${indent}private bool jumpRequested;`,
    "",
    `${indent}${indent}private void Awake()`,
    `${indent}${indent}{`,
    `${indent}${indent}${indent}controller = GetComponent<CharacterController>();`,
    `${indent}${indent}}`,
    "",
    `${indent}${indent}private void Update()`,
    `${indent}${indent}{`,
    `${indent}${indent}${indent}Vector3 input = new Vector3(Input.GetAxisRaw("Horizontal"), 0f, Input.GetAxisRaw("Vertical"));`,
    `${indent}${indent}${indent}input = Vector3.ClampMagnitude(input, 1f);`,
    `${indent}${indent}${indent}Vector3 move = input * moveSpeed;`,
    "",
    `${indent}${indent}${indent}bool grounded = controller.isGrounded || IsGroundedByProbe();`,
    `${indent}${indent}${indent}bool jumpPressed = Input.GetKeyDown(KeyCode.Space);`,
    "",
    `${indent}${indent}${indent}if (grounded && velocity.y < 0f)`,
    `${indent}${indent}${indent}{`,
    `${indent}${indent}${indent}${indent}velocity.y = -2f;`,
    `${indent}${indent}${indent}}`,
    "",
    `${indent}${indent}${indent}if (jumpPressed && grounded)`,
    `${indent}${indent}${indent}{`,
    `${indent}${indent}${indent}${indent}jumpRequested = true;`,
    `${indent}${indent}${indent}}`,
    "",
    `${indent}${indent}${indent}if (jumpRequested)`,
    `${indent}${indent}${indent}{`,
    `${indent}${indent}${indent}${indent}velocity.y = Mathf.Sqrt(jumpHeight * -2f * gravity);`,
    `${indent}${indent}${indent}${indent}jumpRequested = false;`,
    `${indent}${indent}${indent}}`,
    "",
    `${indent}${indent}${indent}velocity.y += gravity * Time.deltaTime;`,
    `${indent}${indent}${indent}controller.Move((move + new Vector3(0f, velocity.y, 0f)) * Time.deltaTime);`,
    "",
    `${indent}${indent}${indent}if (input.sqrMagnitude > 0.001f)`,
    `${indent}${indent}${indent}{`,
    `${indent}${indent}${indent}${indent}Quaternion targetRotation = Quaternion.LookRotation(input, Vector3.up);`,
    `${indent}${indent}${indent}${indent}transform.rotation = Quaternion.RotateTowards(transform.rotation, targetRotation, turnSpeed * Time.deltaTime);`,
    `${indent}${indent}${indent}}`,
    `${indent}${indent}}`,
    "",
    `${indent}${indent}private bool IsGroundedByProbe()`,
    `${indent}${indent}{`,
    `${indent}${indent}${indent}Vector3 checkPosition = groundCheck != null ? groundCheck.position : transform.position + Vector3.down * 0.5f;`,
    `${indent}${indent}${indent}return Physics.CheckSphere(checkPosition, groundCheckRadius, groundLayers, QueryTriggerInteraction.Ignore);`,
    `${indent}${indent}}`,
    "",
    `${indent}${indent}private void OnDrawGizmosSelected()`,
    `${indent}${indent}{`,
    `${indent}${indent}${indent}Vector3 checkPosition = groundCheck != null ? groundCheck.position : transform.position + Vector3.down * 0.5f;`,
    `${indent}${indent}${indent}Gizmos.color = Color.yellow;`,
    `${indent}${indent}${indent}Gizmos.DrawWireSphere(checkPosition, groundCheckRadius);`,
    `${indent}${indent}}`,
    `${indent}}`,
  );

  if (analysis.namespace) {
    bodyLines.push("}");
  }

  return bodyLines.join("\n");
}

function buildGameLoopControllerCode(): string {
  return [
    "using UnityEngine;",
    "using UnityEngine.SceneManagement;",
    "",
    "namespace EnemyAIDemo",
    "{",
    "    /// <summary>",
    "    /// Tracks a minimal win/lose loop for the current prototype, reveals a visible completion marker, and supports quick restart.",
    "    /// </summary>",
    "    [DisallowMultipleComponent]",
    "    public sealed class GameLoopController : MonoBehaviour",
    "    {",
    "        [SerializeField] private string sceneName = \"EnemyAIDemo\";",
    "        [SerializeField] private KeyCode restartKey = KeyCode.R;",
    "        [SerializeField] private GameObject winFeedbackRoot;",
    "        [SerializeField] private bool hideWinFeedbackOnStart = true;",
    "        [SerializeField] private bool debugGameLoop = true;",
    "",
    "        private bool gameOver;",
    "        private string gameOverReason = string.Empty;",
    "",
    "        public bool IsGameOver => gameOver;",
    "        public string GameOverReason => gameOverReason;",
    "",
    "        private void Awake()",
    "        {",
    "            if (hideWinFeedbackOnStart)",
    "            {",
    "                SetWinFeedbackVisible(false);",
    "            }",
    "        }",
    "",
    "        private void Update()",
    "        {",
    "            if (gameOver && Input.GetKeyDown(restartKey))",
    "            {",
    "                RestartLevel();",
    "            }",
    "        }",
    "",
    "        public void RegisterWin(string reason = \"Objective complete. You win.\")",
    "        {",
    "            SetGameOver(reason, true);",
    "        }",
    "",
    "        public void RegisterLoss(string reason = \"Player lost the encounter.\")",
    "        {",
    "            SetGameOver(reason, false);",
    "        }",
    "",
    "        public void RestartLevel()",
    "        {",
    "            string targetScene = string.IsNullOrWhiteSpace(sceneName)",
    "                ? SceneManager.GetActiveScene().name",
    "                : sceneName;",
    "            SceneManager.LoadScene(targetScene);",
    "        }",
    "",
    "        private void SetGameOver(string reason, bool showWinFeedback)",
    "        {",
    "            gameOver = true;",
    "            gameOverReason = string.IsNullOrWhiteSpace(reason) ? \"Game over.\" : reason;",
    "            if (showWinFeedback)",
    "            {",
    "                SetWinFeedbackVisible(true);",
    "            }",
    "",
    "            if (debugGameLoop)",
    "            {",
    "                Debug.Log($\"[AIE Game Loop] {gameOverReason}\", this);",
    "            }",
    "        }",
    "",
    "        private void SetWinFeedbackVisible(bool visible)",
    "        {",
    "            if (winFeedbackRoot == null)",
    "            {",
    "                return;",
    "            }",
    "",
    "            winFeedbackRoot.SetActive(visible);",
    "        }",
    "    }",
    "}",
    "",
  ].join("\n");
}

function buildCameraFollowCode(): string {
  return [
    "using UnityEngine;",
    "",
    "namespace EnemyAIDemo",
    "{",
    "    /// <summary>",
    "    /// Follows the player from an obvious third-person angle so playtests can confirm camera motion clearly.",
    "    /// </summary>",
    "    [DisallowMultipleComponent]",
    "    public sealed class CameraFollow : MonoBehaviour",
    "    {",
    "        [SerializeField] private Transform target;",
    "        [SerializeField] private Vector3 offset = new Vector3(0f, 4f, -7f);",
    "        [SerializeField] [Min(0.01f)] private float smoothTime = 0.12f;",
    "        [SerializeField] private float lookAtHeight = 1.5f;",
    "        [SerializeField] private bool debugFollow = false;",
    "",
    "        private Vector3 followVelocity;",
    "        private float debugLogTimer;",
    "",
    "        private void LateUpdate()",
    "        {",
    "            if (target == null)",
    "            {",
    "                return;",
    "            }",
    "",
    "            Vector3 desiredPosition = target.position + offset;",
    "            transform.position = Vector3.SmoothDamp(transform.position, desiredPosition, ref followVelocity, smoothTime);",
    "",
    "            transform.LookAt(target.position + Vector3.up * lookAtHeight);",
    "",
    "            if (!debugFollow)",
    "            {",
    "                return;",
    "            }",
    "",
    "            debugLogTimer += Time.deltaTime;",
    "            if (debugLogTimer < 1f)",
    "            {",
    "                return;",
    "            }",
    "",
    "            debugLogTimer = 0f;",
    "            float distanceToTarget = Vector3.Distance(transform.position, target.position);",
    "            Debug.Log($\"[AIE Camera Follow] distanceToTarget={distanceToTarget:F2} desiredPosition={desiredPosition}\", this);",
    "        }",
    "    }",
    "}",
  ].join("\n");
}

function buildCameraTuningReplacement(analysis: ExistingScriptAnalysis): string {
  const indent = "    ";
  const bodyLines = [
    "using UnityEngine;",
    "",
  ];

  if (analysis.namespace) {
    bodyLines.push(`namespace ${analysis.namespace}`, "{");
  }

  bodyLines.push(
    `${indent}/// <summary>`,
    `${indent}/// Follows the player from an obvious third-person angle so playtests can confirm camera motion clearly.`,
    `${indent}/// </summary>`,
    `${indent}[DisallowMultipleComponent]`,
    `${indent}public sealed class ${analysis.className} : MonoBehaviour`,
    `${indent}{`,
    `${indent}${indent}[SerializeField] private Transform target;`,
    `${indent}${indent}[SerializeField] private Vector3 offset = new Vector3(0f, 4f, -7f);`,
    `${indent}${indent}[SerializeField] [Min(0.01f)] private float smoothTime = 0.12f;`,
    `${indent}${indent}[SerializeField] private float lookAtHeight = 1.5f;`,
    `${indent}${indent}[SerializeField] private bool debugFollow;`,
    "",
    `${indent}${indent}private Vector3 followVelocity;`,
    `${indent}${indent}private float debugLogTimer;`,
    "",
    `${indent}${indent}private void LateUpdate()`,
    `${indent}${indent}{`,
    `${indent}${indent}${indent}if (target == null)`,
    `${indent}${indent}${indent}{`,
    `${indent}${indent}${indent}${indent}return;`,
    `${indent}${indent}${indent}}`,
    "",
    `${indent}${indent}${indent}Vector3 desiredPosition = target.position + offset;`,
    `${indent}${indent}${indent}transform.position = Vector3.SmoothDamp(transform.position, desiredPosition, ref followVelocity, smoothTime);`,
    `${indent}${indent}${indent}transform.LookAt(target.position + Vector3.up * lookAtHeight);`,
    "",
    `${indent}${indent}${indent}if (!debugFollow)`,
    `${indent}${indent}${indent}{`,
    `${indent}${indent}${indent}${indent}return;`,
    `${indent}${indent}${indent}}`,
    "",
    `${indent}${indent}${indent}debugLogTimer += Time.deltaTime;`,
    `${indent}${indent}${indent}if (debugLogTimer < 1f)`,
    `${indent}${indent}${indent}{`,
    `${indent}${indent}${indent}${indent}return;`,
    `${indent}${indent}${indent}}`,
    "",
    `${indent}${indent}${indent}debugLogTimer = 0f;`,
    `${indent}${indent}${indent}float distanceToTarget = Vector3.Distance(transform.position, target.position);`,
    `${indent}${indent}${indent}Debug.Log($"[AIE Camera Follow] distanceToTarget={distanceToTarget:F2} desiredPosition={desiredPosition}", this);`,
    `${indent}${indent}}`,
    `${indent}}`,
  );

  if (analysis.namespace) {
    bodyLines.push("}");
  }

  return bodyLines.join("\n");
}

export async function generateUnityPatchArtifact(snapshot: GameProjectSnapshot): Promise<UnityPatchArtifact> {
  if (snapshot.engine !== "unity") {
    throw new Error("Game patch plans require a Unity project.");
  }

  const targetFile = snapshot.analysis.scriptSignals.movementScripts[0];
  if (!targetFile) {
    throw new Error("No existing movement script was detected for a file-specific patch plan.");
  }

  const absoluteTargetPath = path.join(snapshot.rootPath, targetFile);
  const source = await readFile(absoluteTargetPath, "utf-8");
  const analysis = analyzeExistingScript(source);
  const replacementCode = buildSimpleKeyboardMoverReplacement(analysis);

  return {
    patchKind: "gameplay-update",
    operation: "modify-existing-script",
    targetFile,
    absoluteTargetPath,
    originalSha256: sha256(source),
    replacementSha256: sha256(replacementCode),
    replacementCode,
    validationRules: {
      preserveClassName: analysis.className,
      preserveNamespace: analysis.namespace,
      forbiddenClassNames: ["PlayerController"],
      requireNoDuplicateMethods: true,
    },
    safety: {
      requiresCleanRecoveryState: true,
      createsBackupBeforeApply: true,
      noUnityExecution: true,
    },
  };
}

export async function generateJumpDiagnosticArtifact(snapshot: GameProjectSnapshot): Promise<UnityPatchArtifact> {
  if (snapshot.engine !== "unity") {
    throw new Error("Jump diagnostics require a Unity project.");
  }

  const targetFile = snapshot.analysis.scriptSignals.movementScripts[0];
  if (!targetFile) {
    throw new Error("No existing movement script was detected for jump diagnostics.");
  }

  const absoluteTargetPath = path.join(snapshot.rootPath, targetFile);
  const source = await readFile(absoluteTargetPath, "utf-8");
  const analysis = analyzeExistingScript(source);
  const replacementCode = buildJumpDiagnosticMoverReplacement(analysis);

  return {
    patchKind: "jump-diagnostic",
    operation: "modify-existing-script",
    targetFile,
    absoluteTargetPath,
    originalSha256: sha256(source),
    replacementSha256: sha256(replacementCode),
    replacementCode,
    validationRules: {
      preserveClassName: analysis.className,
      preserveNamespace: analysis.namespace,
      forbiddenClassNames: ["PlayerController"],
      requireNoDuplicateMethods: true,
    },
    safety: {
      requiresCleanRecoveryState: true,
      createsBackupBeforeApply: true,
      noUnityExecution: true,
    },
  };
}

export async function generateProductionMovementArtifact(snapshot: GameProjectSnapshot): Promise<UnityPatchArtifact> {
  if (snapshot.engine !== "unity") {
    throw new Error("Production movement promotion requires a Unity project.");
  }

  const targetFile = snapshot.analysis.scriptSignals.movementScripts[0];
  if (!targetFile) {
    throw new Error("No existing movement script was detected for production movement promotion.");
  }

  const absoluteTargetPath = path.join(snapshot.rootPath, targetFile);
  const source = await readFile(absoluteTargetPath, "utf-8");
  const analysis = analyzeExistingScript(source);
  const replacementCode = buildProductionMovementReplacement(analysis);

  return {
    patchKind: "production-movement",
    operation: "modify-existing-script",
    targetFile,
    absoluteTargetPath,
    originalSha256: sha256(source),
    replacementSha256: sha256(replacementCode),
    replacementCode,
    validationRules: {
      preserveClassName: analysis.className,
      preserveNamespace: analysis.namespace,
      forbiddenClassNames: ["PlayerController"],
      requireNoDuplicateMethods: true,
    },
    safety: {
      requiresCleanRecoveryState: true,
      createsBackupBeforeApply: true,
      noUnityExecution: true,
    },
  };
}

async function buildCameraFollowArtifact(snapshot: GameProjectSnapshot, targetFile = "Assets/Scripts/CameraFollow.cs"): Promise<UnityPatchArtifact> {
  if (snapshot.engine !== "unity") {
    throw new Error("Camera follow generation requires a Unity project.");
  }

  const absoluteTargetPath = path.join(snapshot.rootPath, targetFile);
  const replacementCode = buildCameraFollowCode();
  return {
    patchKind: "gameplay-update",
    operation: "create-new-script",
    targetFile,
    absoluteTargetPath,
    originalSha256: "missing-file",
    replacementSha256: sha256(replacementCode),
    replacementCode,
    validationRules: {
      preserveClassName: "CameraFollow",
      preserveNamespace: "EnemyAIDemo",
      forbiddenClassNames: ["PlayerController"],
      requireNoDuplicateMethods: true,
    },
    safety: {
      requiresCleanRecoveryState: true,
      createsBackupBeforeApply: true,
      noUnityExecution: true,
    },
  };
}

async function buildGameLoopArtifact(snapshot: GameProjectSnapshot, targetFile = "Assets/Scripts/GameLoopController.cs"): Promise<UnityPatchArtifact> {
  if (snapshot.engine !== "unity") {
    throw new Error("Game loop generation requires a Unity project.");
  }

  const absoluteTargetPath = path.join(snapshot.rootPath, targetFile);
  const replacementCode = buildGameLoopControllerCode();
  return {
    patchKind: "gameplay-update",
    operation: "create-new-script",
    targetFile,
    absoluteTargetPath,
    originalSha256: "missing-file",
    replacementSha256: sha256(replacementCode),
    replacementCode,
    validationRules: {
      preserveClassName: "GameLoopController",
      preserveNamespace: "EnemyAIDemo",
      forbiddenClassNames: ["PlayerController"],
      requireNoDuplicateMethods: true,
    },
    safety: {
      requiresCleanRecoveryState: true,
      createsBackupBeforeApply: true,
      noUnityExecution: true,
    },
  };
}

export async function generateCameraFollowArtifact(snapshot: GameProjectSnapshot, targetFile = "Assets/Scripts/CameraFollow.cs"): Promise<UnityPatchArtifact> {
  const artifact = await buildCameraFollowArtifact(snapshot, targetFile);
  if (await fileExists(artifact.absoluteTargetPath)) {
    throw new Error(`Camera follow target already exists: ${targetFile}`);
  }

  return artifact;
}

export async function generateGameLoopArtifact(snapshot: GameProjectSnapshot, targetFile = "Assets/Scripts/GameLoopController.cs"): Promise<UnityPatchArtifact> {
  const artifact = await buildGameLoopArtifact(snapshot, targetFile);
  if (await fileExists(artifact.absoluteTargetPath)) {
    throw new Error(`Game loop target already exists: ${targetFile}`);
  }

  return artifact;
}

export async function buildExistingCameraFollowArtifact(snapshot: GameProjectSnapshot, targetFile = "Assets/Scripts/CameraFollow.cs"): Promise<UnityPatchArtifact> {
  return buildCameraFollowArtifact(snapshot, targetFile);
}

export async function generateCameraTuningArtifact(snapshot: GameProjectSnapshot, targetFile = "Assets/Scripts/CameraFollow.cs"): Promise<UnityPatchArtifact> {
  if (snapshot.engine !== "unity") {
    throw new Error("Camera tuning requires a Unity project.");
  }

  const absoluteTargetPath = path.join(snapshot.rootPath, targetFile);
  if (!(await fileExists(absoluteTargetPath))) {
    throw new Error(`Camera tuning target does not exist: ${targetFile}`);
  }

  const source = await readFile(absoluteTargetPath, "utf-8");
  const analysis = analyzeExistingScript(source);
  const replacementCode = buildCameraTuningReplacement(analysis);
  return {
    patchKind: "camera-tuning",
    operation: "modify-existing-script",
    targetFile,
    absoluteTargetPath,
    backupTag: "camera-tuning",
    originalSha256: sha256(source),
    replacementSha256: sha256(replacementCode),
    replacementCode,
    validationRules: {
      preserveClassName: analysis.className,
      preserveNamespace: analysis.namespace,
      forbiddenClassNames: ["PlayerController"],
      requireNoDuplicateMethods: true,
    },
    safety: {
      requiresCleanRecoveryState: true,
      createsBackupBeforeApply: true,
      noUnityExecution: true,
    },
  };
}

export async function generateUnityPatchPreview(snapshot: GameProjectSnapshot): Promise<UnityPatchPreview> {
  const artifact = await generateUnityPatchArtifact(snapshot);
  const originalSource = await readFile(artifact.absoluteTargetPath, "utf-8");
  const originalAnalysis = analyzeExistingScript(originalSource);
  const replacementAnalysis = analyzeExistingScript(artifact.replacementCode);

  return {
    artifact,
    detectedClass: originalAnalysis.className,
    detectedNamespace: originalAnalysis.namespace,
    diffSummary: buildDiffSummary(originalAnalysis, replacementAnalysis),
    safetyStatus: [
      "manual full-file copy/paste disabled",
      `clean recovery state required before apply: ${artifact.safety.requiresCleanRecoveryState ? "yes" : "no"}`,
      `backup created before write: ${artifact.safety.createsBackupBeforeApply ? "yes" : "no"}`,
      `Unity execution disabled: ${artifact.safety.noUnityExecution ? "yes" : "no"}`,
    ],
  };
}

export async function generateJumpDiagnosticPreview(snapshot: GameProjectSnapshot): Promise<UnityPatchPreview> {
  const artifact = await generateJumpDiagnosticArtifact(snapshot);
  const originalSource = await readFile(artifact.absoluteTargetPath, "utf-8");
  const originalAnalysis = analyzeExistingScript(originalSource);

  return {
    artifact,
    detectedClass: originalAnalysis.className,
    detectedNamespace: originalAnalysis.namespace,
    diffSummary: [
      `preserve class ${originalAnalysis.className}`,
      `preserve namespace ${originalAnalysis.namespace ?? "none"}`,
      "log when Space is pressed",
      "log grounded state and jump trigger",
      "use Input.GetKeyDown(KeyCode.Space)",
      "use CharacterController.isGrounded as the primary grounded signal",
      "expose debugJumpLogs boolean for runtime inspection",
    ],
    safetyStatus: [
      "manual full-file copy/paste disabled",
      `clean recovery state required before apply: ${artifact.safety.requiresCleanRecoveryState ? "yes" : "no"}`,
      `backup created before write: ${artifact.safety.createsBackupBeforeApply ? "yes" : "no"}`,
      `Unity execution disabled: ${artifact.safety.noUnityExecution ? "yes" : "no"}`,
    ],
  };
}

export async function generateCameraTuningPreview(snapshot: GameProjectSnapshot): Promise<UnityPatchPreview> {
  const artifact = await generateCameraTuningArtifact(snapshot);
  const originalSource = await readFile(artifact.absoluteTargetPath, "utf-8");
  const originalAnalysis = analyzeExistingScript(originalSource);

  return {
    artifact,
    detectedClass: originalAnalysis.className,
    detectedNamespace: originalAnalysis.namespace,
    diffSummary: [
      `preserve class ${originalAnalysis.className}`,
      `preserve namespace ${originalAnalysis.namespace ?? "none"}`,
      "use a closer third-person offset for clearer follow motion",
      "always look at the player using lookAtHeight",
      "log follow distance roughly once per second when debugFollow is enabled",
      "expose target, offset, smoothTime, lookAtHeight, and debugFollow in the Inspector",
    ],
    safetyStatus: [
      "manual full-file copy/paste disabled",
      `clean recovery state required before apply: ${artifact.safety.requiresCleanRecoveryState ? "yes" : "no"}`,
      `backup created before write: ${artifact.safety.createsBackupBeforeApply ? "yes" : "no"}`,
      `Unity execution disabled: ${artifact.safety.noUnityExecution ? "yes" : "no"}`,
    ],
  };
}

export async function generateGamePatchPlan(snapshot: GameProjectSnapshot): Promise<GamePatchPlan> {
  const preview = await generateUnityPatchPreview(snapshot);
  const summaryParts = [
    `Patch ${preview.detectedClass} in ${preview.artifact.targetFile}`,
    preview.detectedNamespace ? `preserve namespace ${preview.detectedNamespace}` : "no namespace detected",
    `original sha256 ${preview.artifact.originalSha256}`,
    `replacement sha256 ${preview.artifact.replacementSha256}`,
  ];

  return {
    targetFile: preview.artifact.targetFile,
    className: preview.detectedClass,
    namespace: preview.detectedNamespace,
    changeType: "modify-existing-script",
    summary: summaryParts.join("; "),
    exactInstructions: [
      `Run patch preview for ${preview.artifact.targetFile}.`,
      "Review the hashes, detected class, detected namespace, and diff summary.",
      "Apply the patch only through the guarded apply command.",
      "Check patch status before opening Unity.",
      "Open Unity only after patch status reports safe for compile/playtest.",
    ],
    artifact: preview.artifact,
    expectedResult: "SimpleKeyboardPlayerMover.cs keeps its existing class identity while adding clearer movement and jump behavior without duplicate class or method errors.",
    safety: {
      outputOnly: true,
      noFileWrites: true,
      requiresHumanUnityPlaytest: true,
    },
  };
}

export function renderGamePatchPlan(plan: GamePatchPlan): string {
  return [
    "UNITY FILE PATCH PLAN",
    "",
    `Target File: ${plan.targetFile}`,
    `Detected Class: ${plan.className}`,
    `Detected Namespace: ${plan.namespace ?? "none"}`,
    `Change Type: ${plan.changeType}`,
    `Summary: ${plan.summary}`,
    "",
    `Original SHA256: ${plan.artifact.originalSha256}`,
    `Replacement SHA256: ${plan.artifact.replacementSha256}`,
    "",
    "Exact Instructions:",
    ...plan.exactInstructions.map((step, index) => `${index + 1}. ${step}`),
    "",
    `Expected Result: ${plan.expectedResult}`,
    "",
    "Safety:",
    `- output only: ${plan.safety.outputOnly ? "true" : "false"}`,
    `- no file writes: ${plan.safety.noFileWrites ? "true" : "false"}`,
    `- requires human Unity playtest: ${plan.safety.requiresHumanUnityPlaytest ? "true" : "false"}`,
    "- manual full-file copy/paste disabled",
  ].join("\n");
}

export function renderUnityPatchPreview(preview: UnityPatchPreview): string {
  return [
    "UNITY PATCH PREVIEW",
    "",
    `Patch Kind: ${preview.artifact.patchKind}`,
    `Target File: ${preview.artifact.targetFile}`,
    `Absolute Target Path: ${preview.artifact.absoluteTargetPath}`,
    `Original SHA256: ${preview.artifact.originalSha256}`,
    `Replacement SHA256: ${preview.artifact.replacementSha256}`,
    `Detected Class: ${preview.detectedClass}`,
    `Detected Namespace: ${preview.detectedNamespace ?? "none"}`,
    "",
    "Diff Summary:",
    ...preview.diffSummary.map((line) => `- ${line}`),
    "",
    "Safety Status:",
    ...preview.safetyStatus.map((line) => `- ${line}`),
  ].join("\n");
}

export async function applyUnityPatchArtifact(
  artifact: UnityPatchArtifact,
  recoverySafe: boolean,
  recoveryGuidance: string[],
  allowExistingBackup = false,
): Promise<UnityPatchApplyResult> {
  const blockedReasons: string[] = [];
  const backupPath = backupPathForArtifact(artifact);
  const targetExists = await fileExists(artifact.absoluteTargetPath);

  if (!recoverySafe) {
    blockedReasons.push("Unity recovery guard did not report a clean recovery state.");
  }

  if (artifact.operation === "modify-existing-script" && !targetExists) {
    blockedReasons.push(`Target file does not exist: ${artifact.absoluteTargetPath}`);
  }

  if (artifact.operation === "create-new-script" && targetExists) {
    blockedReasons.push(`Target file already exists and will not be overwritten: ${artifact.absoluteTargetPath}`);
  }

  const currentSource = targetExists ? await readFile(artifact.absoluteTargetPath, "utf-8") : "";
  const currentSha256 = targetExists ? sha256(currentSource) : undefined;
  if (artifact.operation === "modify-existing-script" && currentSha256 && currentSha256 !== artifact.originalSha256) {
    blockedReasons.push(`Current file hash ${currentSha256} did not match expected original hash ${artifact.originalSha256}.`);
  }

  blockedReasons.push(...validateReplacementCode(artifact));

  const backupExists = await fileExists(backupPath);
  if (backupExists && !allowExistingBackup) {
    blockedReasons.push(`Backup already exists and will not be overwritten: ${backupPath}`);
  }

  if (blockedReasons.length > 0) {
    return {
      applied: false,
      patchKind: artifact.patchKind,
      targetFile: artifact.targetFile,
      targetPath: artifact.absoluteTargetPath,
      backupPath,
      originalSha256: artifact.originalSha256,
      replacementSha256: artifact.replacementSha256,
      currentSha256,
      blockedReasons,
      recoveryGuidance,
      safety: {
        noUnityExecution: true,
        backupCreated: false,
        targetWritten: false,
      },
    };
  }

  if (!backupExists) {
    if (artifact.operation === "create-new-script") {
      await writeFile(backupPath, MISSING_FILE_BACKUP_MARKER, "utf-8");
    } else {
      await copyFile(artifact.absoluteTargetPath, backupPath);
    }
  }
  await writeFile(artifact.absoluteTargetPath, artifact.replacementCode, "utf-8");
  if (artifact.operation === "create-new-script") {
    await ensureUnityScriptMeta(artifact.absoluteTargetPath);
  }

  return {
    applied: true,
    patchKind: artifact.patchKind,
    targetFile: artifact.targetFile,
    targetPath: artifact.absoluteTargetPath,
    backupPath,
    originalSha256: artifact.originalSha256,
    replacementSha256: artifact.replacementSha256,
    currentSha256: sha256(artifact.replacementCode),
    blockedReasons: [],
    recoveryGuidance: [],
    safety: {
      noUnityExecution: true,
      backupCreated: true,
      targetWritten: true,
    },
  };
}

export async function inspectUnityPatchStatus(
  artifact: UnityPatchArtifact,
  recoverySafe: boolean,
): Promise<UnityPatchStatus> {
  const backupPath = backupPathForArtifact(artifact);
  const currentSource = await readFile(artifact.absoluteTargetPath, "utf-8");
  const currentSha256 = sha256(currentSource);
  const backupExists = await fileExists(backupPath);
  const currentFileAppearsPatched = currentSha256 === artifact.replacementSha256;
  const usesKeyCodeSpace = usesKeyCodeSpaceForJump(currentSource);
  const usesCharacterControllerGrounded = usesCharacterControllerGroundedSignal(currentSource);
  const debugJumpLogsEnabled = hasDebugJumpLogs(currentSource);
  const diagnosticLogsPresent = debugJumpLogsEnabled;
  const jumpDiagnosticPatchApplied = currentFileAppearsPatched && usesKeyCodeSpace && usesCharacterControllerGrounded && debugJumpLogsEnabled;
  const jumpLogicPresent = artifact.patchKind === "camera-tuning"
    ? hasCameraTargetField(currentSource) && hasCameraOffsetField(currentSource) && hasCameraLateUpdate(currentSource)
    : hasJumpLogic(currentSource);
  const safeToOpenUnityForCompileOrPlaytest = artifact.patchKind === "camera-tuning"
    ? recoverySafe && currentFileAppearsPatched && hasCameraLookAt(currentSource) && backupExists
    : recoverySafe && currentFileAppearsPatched && jumpLogicPresent && backupExists;

  return {
    patchKind: artifact.patchKind,
    targetFile: artifact.targetFile,
    targetPath: artifact.absoluteTargetPath,
    backupPath,
    backupExists,
    currentSha256,
    expectedPatchedSha256: artifact.replacementSha256,
    currentFileAppearsPatched,
    jumpDiagnosticPatchApplied,
    jumpLogicPresent,
    usesKeyCodeSpace,
    usesCharacterControllerGrounded,
    diagnosticLogsPresent,
    debugJumpLogsEnabled,
    rollbackAvailable: backupExists,
    safeToOpenUnityForCompileOrPlaytest,
    recoverySafe,
    safety: {
      noUnityExecution: true,
    },
  };
}

export async function inspectCameraTuningStatus(snapshot: GameProjectSnapshot, recoverySafe: boolean, targetFile = "Assets/Scripts/CameraFollow.cs"): Promise<CameraTuningStatus> {
  if (snapshot.engine !== "unity") {
    throw new Error("Camera tuning status requires a Unity project.");
  }

  const absoluteTargetPath = path.join(snapshot.rootPath, targetFile);
  const backupPath = backupPathFor(absoluteTargetPath, "camera-tuning");
  const cameraFollowExists = await fileExists(absoluteTargetPath);
  const backupExists = await fileExists(backupPath);
  const source = cameraFollowExists ? await readFile(absoluteTargetPath, "utf-8") : "";
  const targetFieldPresent = cameraFollowExists && hasCameraTargetField(source);
  const offsetFieldPresent = cameraFollowExists && hasCameraOffsetField(source);
  const lateUpdatePresent = cameraFollowExists && hasCameraLateUpdate(source);
  const lookAtPresent = cameraFollowExists && hasCameraLookAt(source);
  const debugFollowPresent = cameraFollowExists && hasCameraDebugFollow(source);

  return {
    targetFile,
    targetPath: absoluteTargetPath,
    backupPath,
    backupExists,
    cameraFollowExists,
    targetFieldPresent,
    offsetFieldPresent,
    lateUpdatePresent,
    lookAtPresent,
    debugFollowPresent,
    safeToOpenUnityForCompileOrPlaytest: recoverySafe && cameraFollowExists && targetFieldPresent && offsetFieldPresent && lateUpdatePresent && lookAtPresent && debugFollowPresent && backupExists,
    recoverySafe,
    safety: {
      noUnityExecution: true,
    },
  };
}

export function renderUnityPatchStatus(status: UnityPatchStatus): string {
  return [
    "UNITY PATCH STATUS",
    "",
    `Patch Kind: ${status.patchKind}`,
    `Target File: ${status.targetFile}`,
    `Target Path: ${status.targetPath}`,
    `Backup Path: ${status.backupPath}`,
    `Backup Exists: ${status.backupExists ? "YES" : "NO"}`,
    `Current SHA256: ${status.currentSha256}`,
    `Expected Patched SHA256: ${status.expectedPatchedSha256}`,
    `Current File Appears Patched: ${status.currentFileAppearsPatched ? "YES" : "NO"}`,
    `Jump Diagnostic Patch Applied: ${status.jumpDiagnosticPatchApplied ? "YES" : "NO"}`,
    `Jump Logic Present: ${status.jumpLogicPresent ? "YES" : "NO"}`,
    `Uses KeyCode.Space: ${status.usesKeyCodeSpace ? "YES" : "NO"}`,
    `Uses CharacterController.isGrounded: ${status.usesCharacterControllerGrounded ? "YES" : "NO"}`,
    `Diagnostic Logs Present: ${status.diagnosticLogsPresent ? "YES" : "NO"}`,
    `Debug Jump Logs Enabled: ${status.debugJumpLogsEnabled ? "YES" : "NO"}`,
    `Rollback Available: ${status.rollbackAvailable ? "YES" : "NO"}`,
    `Recovery Guard Safe: ${status.recoverySafe ? "YES" : "NO"}`,
    `Safe To Open Unity For Compile/Playtest: ${status.safeToOpenUnityForCompileOrPlaytest ? "YES" : "NO"}`,
    "",
    "Safety:",
    `- no Unity execution: ${status.safety.noUnityExecution ? "true" : "false"}`,
  ].join("\n");
}

export function renderCameraTuningStatus(status: CameraTuningStatus): string {
  return [
    "CAMERA TUNING STATUS",
    "",
    `Target File: ${status.targetFile}`,
    `Target Path: ${status.targetPath}`,
    `Backup Path: ${status.backupPath}`,
    `CameraFollow.cs Exists: ${status.cameraFollowExists ? "YES" : "NO"}`,
    `Target Field Present: ${status.targetFieldPresent ? "YES" : "NO"}`,
    `Offset Field Present: ${status.offsetFieldPresent ? "YES" : "NO"}`,
    `LateUpdate Present: ${status.lateUpdatePresent ? "YES" : "NO"}`,
    `LookAt Present: ${status.lookAtPresent ? "YES" : "NO"}`,
    `DebugFollow Present: ${status.debugFollowPresent ? "YES" : "NO"}`,
    `Backup Exists: ${status.backupExists ? "YES" : "NO"}`,
    `Recovery Guard Safe: ${status.recoverySafe ? "YES" : "NO"}`,
    `Safe To Open Unity For Compile/Playtest: ${status.safeToOpenUnityForCompileOrPlaytest ? "YES" : "NO"}`,
    "",
    "Safety:",
    `- no Unity execution: ${status.safety.noUnityExecution ? "true" : "false"}`,
  ].join("\n");
}

export function renderUnityPatchApplyResult(result: UnityPatchApplyResult): string {
  if (!result.applied) {
    return [
      "UNITY PATCH APPLY BLOCKED",
      "",
      `Target File: ${result.targetFile}`,
      `Target Path: ${result.targetPath}`,
      `Backup Path: ${result.backupPath}`,
      result.currentSha256 ? `Current SHA256: ${result.currentSha256}` : "Current SHA256: unavailable",
      `Expected Original SHA256: ${result.originalSha256}`,
      "",
      "Blocked Reasons:",
      ...result.blockedReasons.map((reason, index) => `${index + 1}. ${reason}`),
      "",
      "Recovery Guidance:",
      ...(result.recoveryGuidance.length > 0
        ? result.recoveryGuidance.map((step, index) => `${index + 1}. ${step}`)
        : ["1. Inspect the target script and local recovery state before trying again."]),
      "",
      "Safety:",
      `- no Unity execution: ${result.safety.noUnityExecution ? "true" : "false"}`,
      `- backup created: ${result.safety.backupCreated ? "true" : "false"}`,
      `- target written: ${result.safety.targetWritten ? "true" : "false"}`,
    ].join("\n");
  }

  return [
    "PATCH APPLIED",
    "",
    `Backup Path: ${result.backupPath}`,
    `Target Path: ${result.targetPath}`,
    `Original SHA256: ${result.originalSha256}`,
    `New SHA256: ${result.currentSha256 ?? result.replacementSha256}`,
    "",
    "Safety:",
    `- no Unity execution: ${result.safety.noUnityExecution ? "true" : "false"}`,
    `- backup created: ${result.safety.backupCreated ? "true" : "false"}`,
    `- target written: ${result.safety.targetWritten ? "true" : "false"}`,
  ].join("\n");
}

export async function rollbackUnityPatchArtifact(artifact: UnityPatchArtifact): Promise<UnityPatchRollbackResult> {
  const backupPath = backupPathForArtifact(artifact);
  if (!(await fileExists(backupPath))) {
    return {
      restored: false,
      targetFile: artifact.targetFile,
      targetPath: artifact.absoluteTargetPath,
      backupPath,
      blockedReasons: ["Backup file does not exist, so rollback cannot proceed."],
      safety: {
        noUnityExecution: true,
        backupRetained: true,
      },
    };
  }

  const backupSource = await readFile(backupPath, "utf-8");
  if (backupSource === MISSING_FILE_BACKUP_MARKER) {
    if (await fileExists(artifact.absoluteTargetPath)) {
      await unlink(artifact.absoluteTargetPath);
    }
    const metaPath = metaPathFor(artifact.absoluteTargetPath);
    if (await fileExists(metaPath)) {
      await unlink(metaPath);
    }
  } else {
    await writeFile(artifact.absoluteTargetPath, backupSource, "utf-8");
  }

  return {
    restored: true,
    targetFile: artifact.targetFile,
    targetPath: artifact.absoluteTargetPath,
    backupPath,
    restoredSha256: sha256(backupSource),
    blockedReasons: [],
    safety: {
      noUnityExecution: true,
      backupRetained: true,
    },
  };
}

export function renderUnityPatchRollbackResult(result: UnityPatchRollbackResult): string {
  if (!result.restored) {
    return [
      "UNITY PATCH ROLLBACK BLOCKED",
      "",
      `Target File: ${result.targetFile}`,
      `Target Path: ${result.targetPath}`,
      `Backup Path: ${result.backupPath}`,
      "",
      "Blocked Reasons:",
      ...result.blockedReasons.map((reason, index) => `${index + 1}. ${reason}`),
      "",
      "Safety:",
      `- no Unity execution: ${result.safety.noUnityExecution ? "true" : "false"}`,
      `- backup retained: ${result.safety.backupRetained ? "true" : "false"}`,
    ].join("\n");
  }

  return [
    "UNITY PATCH RESTORED",
    "",
    `Target Path: ${result.targetPath}`,
    `Backup Path: ${result.backupPath}`,
    `Restored SHA256: ${result.restoredSha256 ?? "unknown"}`,
    "",
    "Safety:",
    `- no Unity execution: ${result.safety.noUnityExecution ? "true" : "false"}`,
    `- backup retained: ${result.safety.backupRetained ? "true" : "false"}`,
  ].join("\n");
}

export function renderNextGameTaskExecutionResult(result: NextGameTaskExecutionResult): string {
  if (!result.executed) {
    return [
      "NEXT GAME TASK EXECUTION BLOCKED",
      "",
      `Stage: ${result.stage}`,
      `Title: ${result.title}`,
      `Target File: ${result.targetFile}`,
      `Target Path: ${result.targetPath}`,
      `Patch Kind: ${result.patchKind}`,
      `Operation: ${result.operation}`,
      "",
      "Blocked Reasons:",
      ...result.blockedReasons.map((reason, index) => `${index + 1}. ${reason}`),
    ].join("\n");
  }

  return [
    "NEXT GAME TASK EXECUTED",
    "",
    `Stage: ${result.stage}`,
    `Title: ${result.title}`,
    `Script Name: ${result.scriptName}`,
    `Target File: ${result.targetFile}`,
    `Target Path: ${result.targetPath}`,
    `Patch Kind: ${result.patchKind}`,
    `Operation: ${result.operation}`,
    `Backup Path: ${result.backupPath}`,
    `Safe To Open Unity For Compile/Playtest: ${result.safeToOpenUnityForCompileOrPlaytest ? "YES" : "NO"}`,
  ].join("\n");
}