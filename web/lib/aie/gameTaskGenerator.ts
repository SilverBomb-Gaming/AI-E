import type { GameProjectSnapshot } from "./gameProjectInspector";

export type GameTask = {
  title: string;
  description: string;
  steps: string[];
  code?: string;
  expectedResult: string;
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
    title: "Create first scene",
    description: "Start the project by creating a playable Unity scene and saving it under Assets/Scenes.",
    steps: [
      "Create an Assets/Scenes folder if it does not exist.",
      "Create and save a new Unity scene as MainScene.",
      "Add a floor plane and a camera so the scene is navigable.",
      "Save the scene and add it to Build Settings.",
    ],
    expectedResult: "A first playable Unity scene exists and can be opened from Assets/Scenes.",
  };
}

function buildSceneOnlyTask(): GameTask {
  return {
    title: "Add PlayerController script",
    description: "Introduce the first gameplay logic script so the scene moves beyond static content.",
    steps: [
      "Create a new C# script named PlayerController in Assets/Scripts.",
      "Add movement input handling for horizontal and vertical movement.",
      "Attach the script to the player object in the scene.",
      "Press Play and verify that input changes the player position.",
    ],
    expectedResult: "The scene has its first gameplay script attached to a controllable player object.",
  };
}

function buildLogicPresentTask(): GameTask {
  return {
    title: "Create PlayerController with movement",
    description: "Add a reusable Rigidbody-based player movement controller with WASD movement and jumping.",
    steps: [
      "Create a new C# script named PlayerController in Assets/Scripts.",
      "Paste the generated code into the script and save it.",
      "Attach the script to the player GameObject.",
      "Add a Rigidbody component and assign a ground check transform if desired.",
      "Press Play and verify that WASD moves the player and Space jumps.",
    ],
    code: PLAYER_CONTROLLER_CODE,
    expectedResult: "Player moves with WASD and jumps with Space using Rigidbody-based movement.",
  };
}

function buildUnknownTask(): GameTask {
  return {
    title: "Inspect project setup",
    description: "The current project structure does not match the expected Unity readiness states.",
    steps: [
      "Confirm the selected path points at a Unity project root.",
      "Check that Assets, ProjectSettings, and Packages are present.",
      "Re-run the inspector once the project root is confirmed.",
    ],
    expectedResult: "The project root is validated and ready for the next guided task.",
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
    return buildLogicPresentTask();
  }

  return buildUnknownTask();
}

export function renderGameTask(task: GameTask): string {
  const lines = [
    "NEXT TASK",
    "",
    `Title: ${task.title}`,
    `Description: ${task.description}`,
    "",
    "Steps:",
    ...task.steps.map((step, index) => `${index + 1}. ${step}`),
  ];

  if (task.code) {
    lines.push("", "Code:", task.code);
  }

  lines.push("", `Expected Result: ${task.expectedResult}`, "", "Safety:", "- output only", "- no file writes", "- no Unity execution");
  return lines.join("\n");
}