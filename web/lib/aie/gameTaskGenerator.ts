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