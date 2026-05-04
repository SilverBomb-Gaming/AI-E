import { readFile } from "node:fs/promises";
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
  replacementCode?: string;
  expectedResult: string;
  safety: {
    outputOnly: true;
    noFileWrites: true;
    requiresHumanUnityPlaytest: true;
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

export async function generateGamePatchPlan(snapshot: GameProjectSnapshot): Promise<GamePatchPlan> {
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
  const summaryParts = [
    `Patch ${analysis.className} in ${targetFile}`,
    analysis.namespace ? `preserve namespace ${analysis.namespace}` : "no namespace detected",
    analysis.attributeLines.length > 0 ? `preserve ${analysis.attributeLines.length} attribute line(s)` : "no attribute lines detected",
    analysis.hasAwake ? "existing Awake detected" : "Awake missing",
    analysis.hasUpdate ? "existing Update detected" : "Update missing",
    analysis.hasMovementLogic ? "movement logic detected" : "movement logic not detected",
  ];

  return {
    targetFile,
    className: analysis.className,
    namespace: analysis.namespace,
    changeType: "modify-existing-script",
    summary: summaryParts.join("; "),
    exactInstructions: [
      `Open ${targetFile}.`,
      "Replace the full file contents with the generated replacement code below.",
      `Keep the class name as ${analysis.className}.`,
      analysis.namespace ? `Keep the namespace as ${analysis.namespace}.` : "Do not introduce a new namespace unless the project already requires one.",
      "Do not rename the script file or create PlayerController.cs.",
      "After replacing the file, return to Unity and wait for compile to finish before entering Play mode.",
      "Run a human playtest only after the Unity console shows zero compile errors.",
    ],
    replacementCode,
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
    "Exact Instructions:",
    ...plan.exactInstructions.map((step, index) => `${index + 1}. ${step}`),
    "",
    "Replacement Code:",
    plan.replacementCode ?? "none",
    "",
    `Expected Result: ${plan.expectedResult}`,
    "",
    "Safety:",
    `- output only: ${plan.safety.outputOnly ? "true" : "false"}`,
    `- no file writes: ${plan.safety.noFileWrites ? "true" : "false"}`,
    `- requires human Unity playtest: ${plan.safety.requiresHumanUnityPlaytest ? "true" : "false"}`,
  ].join("\n");
}