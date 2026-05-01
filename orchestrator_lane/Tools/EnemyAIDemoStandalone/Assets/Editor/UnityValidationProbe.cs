using System;
using System.Collections.Generic;
using System.Text;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace EnemyAIDemo.Editor
{
    /// <summary>
    /// Runs a deterministic, read-only Unity validation probe for AI-E bridge verification.
    /// </summary>
    public static class UnityValidationProbe
    {
        private const string JsonPrefix = "[AIE_UNITY_VALIDATION_JSON]";
        private const string MutationJsonPrefix = "[AIE_UNITY_MUTATION_JSON]";
        private const string ScenePathEnv = "AIE_UNITY_SCENE_PATH";
        private const string RequestIdEnv = "AIE_UNITY_VALIDATION_REQUEST_ID";
        private const string RequestedAtEnv = "AIE_UNITY_VALIDATION_REQUESTED_AT";
        private const string SceneNameHintEnv = "AIE_UNITY_SCENE_NAME_HINT";
        private const string MutationRequestIdEnv = "AIE_UNITY_MUTATION_REQUEST_ID";
        private const string MutationRequestedAtEnv = "AIE_UNITY_MUTATION_REQUESTED_AT";
        private const string MutationObjectNameEnv = "AIE_UNITY_MUTATION_OBJECT_NAME";
        private const string MutationTypeEnv = "AIE_UNITY_MUTATION_TYPE";
        private const string MutationEnabledEnv = "AIE_UNITY_MUTATION_ENABLED";
        private const string MutationIdempotentOnDuplicateEnv = "AIE_UNITY_MUTATION_IDEMPOTENT_ON_DUPLICATE";
        private const string DefaultScenePath = "Assets/Scenes/EnemyAIDemo.unity";
        private const string DefaultMutationObjectName = "AIE_ControlledMutationProbe";

        public static void RunValidationProbeFromCommandLine()
        {
            int consoleErrors = 0;

            void CountConsoleError(string _, string __, LogType type)
            {
                if (type == LogType.Error || type == LogType.Assert || type == LogType.Exception)
                {
                    consoleErrors++;
                }
            }

            Application.logMessageReceived += CountConsoleError;

            try
            {
                string scenePath = GetEnvironmentValue(ScenePathEnv) ?? DefaultScenePath;
                if (!System.IO.File.Exists(scenePath))
                {
                    Fail($"Validation probe scene not found at {scenePath}.");
                    return;
                }

                Scene scene = EditorSceneManager.OpenScene(scenePath, OpenSceneMode.Single);
                string sceneName = string.IsNullOrWhiteSpace(scene.name)
                    ? GetEnvironmentValue(SceneNameHintEnv) ?? "UnknownScene"
                    : scene.name;

                IReadOnlyList<GameObject> rootObjects = scene.GetRootGameObjects();
                int objectCount = 0;
                int missingScripts = 0;

                foreach (GameObject root in rootObjects)
                {
                    CountHierarchy(root, ref objectCount, ref missingScripts);
                }

                string timestamp = GetEnvironmentValue(RequestedAtEnv) ?? DateTime.UtcNow.ToString("O");
                string sceneValidationStatus = missingScripts > 0 || consoleErrors > 0
                    ? "checked_with_findings"
                    : "checked_clean";
                string rawEvidenceSummary = BuildSummary(sceneName, missingScripts, consoleErrors, objectCount);
                string recommendedNextOperatorAction = missingScripts > 0 || consoleErrors > 0
                    ? "Review the live Unity findings before continuing delivery."
                    : "Live Unity validation returned a clean read-only result; continue operator review as needed.";

                string payload = $"{{\"requestId\":\"{EscapeJson(GetEnvironmentValue(RequestIdEnv) ?? string.Empty)}\",\"sceneName\":\"{EscapeJson(sceneName)}\",\"missingScripts\":{missingScripts},\"consoleErrors\":{consoleErrors},\"objectCount\":{objectCount},\"timestamp\":\"{EscapeJson(timestamp)}\",\"scene_validation_status\":\"{sceneValidationStatus}\",\"checked_scene_name\":\"{EscapeJson(sceneName)}\",\"missing_script_count\":{missingScripts},\"console_error_count\":{consoleErrors},\"object_count\":{objectCount},\"evidence_timestamp\":\"{EscapeJson(timestamp)}\",\"raw_evidence_summary\":\"{EscapeJson(rawEvidenceSummary)}\",\"recommended_next_operator_action\":\"{EscapeJson(recommendedNextOperatorAction)}\"}}";
                Debug.Log(JsonPrefix + payload);
                EditorApplication.Exit(0);
            }
            catch (Exception exception)
            {
                Fail($"Validation probe failed: {exception}");
            }
            finally
            {
                Application.logMessageReceived -= CountConsoleError;
            }
        }

        public static void RunSceneObjectCreationMutationFromCommandLine()
        {
            string requestId = GetEnvironmentValue(MutationRequestIdEnv) ?? string.Empty;
            string requestedAt = GetEnvironmentValue(MutationRequestedAtEnv) ?? DateTime.UtcNow.ToString("O");
            string scenePath = GetEnvironmentValue(ScenePathEnv) ?? DefaultScenePath;
            string objectName = GetEnvironmentValue(MutationObjectNameEnv) ?? DefaultMutationObjectName;
            string mutationType = GetEnvironmentValue(MutationTypeEnv) ?? "scene_object_creation_request";
            bool mutationEnabled = GetBooleanEnvironmentValue(MutationEnabledEnv);
            bool idempotentOnDuplicate = GetBooleanEnvironmentValue(MutationIdempotentOnDuplicateEnv, true);

            try
            {
                if (!string.Equals(mutationType, "scene_object_creation_request", StringComparison.Ordinal))
                {
                    EmitMutationFailure(
                        requestId,
                        requestedAt,
                        scenePath,
                        objectName,
                        mutationType,
                        "Unsupported mutation type requested for controlled Unity mutation.");
                    return;
                }

                if (!mutationEnabled)
                {
                    EmitMutationFailure(
                        requestId,
                        requestedAt,
                        scenePath,
                        objectName,
                        mutationType,
                        "Controlled Unity mutation is disabled and cannot run without explicit mutation enablement.");
                    return;
                }

                if (!System.IO.File.Exists(scenePath))
                {
                    EmitMutationFailure(
                        requestId,
                        requestedAt,
                        scenePath,
                        objectName,
                        mutationType,
                        $"Mutation target scene not found at {scenePath}.");
                    return;
                }

                Scene scene = EditorSceneManager.OpenScene(scenePath, OpenSceneMode.Single);
                string sceneName = string.IsNullOrWhiteSpace(scene.name) ? "UnknownScene" : scene.name;
                GameObject existing = FindSceneObjectByName(scene, objectName);
                if (existing != null)
                {
                    if (idempotentOnDuplicate)
                    {
                        EmitMutationSuccess(
                            requestId,
                            requestedAt,
                            sceneName,
                            objectName,
                            mutationType,
                            false,
                            "mutation_idempotent",
                            "already_exists_idempotent",
                            $"Rollback requires separate approval: remove {objectName} from {sceneName} only if it was not expected.",
                            $"Controlled Unity mutation confirmed the existing object {objectName} in {sceneName}; no additional scene write was required.");
                        return;
                    }

                    EmitMutationFailure(
                        requestId,
                        requestedAt,
                        sceneName,
                        objectName,
                        mutationType,
                        $"Controlled Unity mutation refused duplicate object creation because {objectName} already exists in {sceneName}.");
                    return;
                }

                GameObject created = new GameObject(objectName);
                SceneManager.MoveGameObjectToScene(created, scene);
                EditorSceneManager.MarkSceneDirty(scene);
                bool sceneSaved = EditorSceneManager.SaveScene(scene);
                if (!sceneSaved)
                {
                    EmitMutationFailure(
                        requestId,
                        requestedAt,
                        sceneName,
                        objectName,
                        mutationType,
                        $"Controlled Unity mutation created {objectName} but SaveScene returned false for {sceneName}.");
                    return;
                }

                EmitMutationSuccess(
                    requestId,
                    requestedAt,
                    sceneName,
                    objectName,
                    mutationType,
                    true,
                    "mutation_executed",
                    "created",
                    $"Rollback requires separate approval: remove {objectName} from {sceneName}.",
                    $"Controlled Unity mutation created {objectName} in {sceneName} and saved the scene.");
            }
            catch (Exception exception)
            {
                EmitMutationFailure(
                    requestId,
                    requestedAt,
                    scenePath,
                    objectName,
                    mutationType,
                    $"Controlled Unity mutation failed: {exception}");
            }
        }

        private static void CountHierarchy(GameObject node, ref int objectCount, ref int missingScripts)
        {
            if (node == null)
            {
                return;
            }

            objectCount++;

            Component[] components = node.GetComponents<Component>();
            for (int index = 0; index < components.Length; index++)
            {
                if (components[index] == null)
                {
                    missingScripts++;
                }
            }

            Transform transform = node.transform;
            for (int index = 0; index < transform.childCount; index++)
            {
                CountHierarchy(transform.GetChild(index).gameObject, ref objectCount, ref missingScripts);
            }
        }

        private static string BuildSummary(string sceneName, int missingScripts, int consoleErrors, int objectCount)
        {
            return $"Live Unity validation inspected {sceneName} with missing scripts {missingScripts}, console errors {consoleErrors}, and object count {objectCount}.";
        }

        private static GameObject FindSceneObjectByName(Scene scene, string objectName)
        {
            if (string.IsNullOrWhiteSpace(objectName))
            {
                return null;
            }

            IReadOnlyList<GameObject> rootObjects = scene.GetRootGameObjects();
            foreach (GameObject root in rootObjects)
            {
                GameObject match = FindInHierarchy(root, objectName.Trim());
                if (match != null)
                {
                    return match;
                }
            }

            return null;
        }

        private static GameObject FindInHierarchy(GameObject node, string objectName)
        {
            if (node == null)
            {
                return null;
            }

            if (string.Equals(node.name, objectName, StringComparison.Ordinal))
            {
                return node;
            }

            Transform transform = node.transform;
            for (int index = 0; index < transform.childCount; index++)
            {
                GameObject match = FindInHierarchy(transform.GetChild(index).gameObject, objectName);
                if (match != null)
                {
                    return match;
                }
            }

            return null;
        }

        private static bool GetBooleanEnvironmentValue(string name, bool defaultValue = false)
        {
            string value = GetEnvironmentValue(name);
            if (string.IsNullOrWhiteSpace(value))
            {
                return defaultValue;
            }

            return value.Equals("true", StringComparison.OrdinalIgnoreCase)
                || value.Equals("1", StringComparison.OrdinalIgnoreCase)
                || value.Equals("yes", StringComparison.OrdinalIgnoreCase);
        }

        private static void EmitMutationSuccess(
            string requestId,
            string requestedAt,
            string targetScene,
            string objectName,
            string mutationType,
            bool sceneSaved,
            string mutationStatus,
            string duplicateHandling,
            string rollbackHint,
            string rawEvidenceSummary)
        {
            string payload = $"{{\"request_id\":\"{EscapeJson(requestId)}\",\"mutation_status\":\"{EscapeJson(mutationStatus)}\",\"mutation_type\":\"{EscapeJson(mutationType)}\",\"target_scene\":\"{EscapeJson(targetScene)}\",\"object_name\":\"{EscapeJson(objectName)}\",\"created_object_name\":\"{EscapeJson(objectName)}\",\"scene_saved\":{sceneSaved.ToString().ToLowerInvariant()},\"duplicate_handling\":\"{EscapeJson(duplicateHandling)}\",\"evidence_timestamp\":\"{EscapeJson(requestedAt)}\",\"raw_evidence_summary\":\"{EscapeJson(rawEvidenceSummary)}\",\"rollback_hint\":\"{EscapeJson(rollbackHint)}\",\"recommended_next_operator_action\":\"{EscapeJson("Review the controlled Unity mutation evidence and keep rollback as a separately approved follow-up action.")}\"}}";
            Debug.Log(MutationJsonPrefix + payload);
            EditorApplication.Exit(0);
        }

        private static void EmitMutationFailure(
            string requestId,
            string requestedAt,
            string targetScene,
            string objectName,
            string mutationType,
            string reason)
        {
            string payload = $"{{\"request_id\":\"{EscapeJson(requestId)}\",\"mutation_status\":\"mutation_failed\",\"mutation_type\":\"{EscapeJson(mutationType)}\",\"target_scene\":\"{EscapeJson(targetScene)}\",\"object_name\":\"{EscapeJson(objectName)}\",\"created_object_name\":\"\",\"scene_saved\":false,\"duplicate_handling\":\"created\",\"evidence_timestamp\":\"{EscapeJson(requestedAt)}\",\"raw_evidence_summary\":\"{EscapeJson(reason)}\",\"rollback_hint\":\"{EscapeJson("Rollback not available because the controlled Unity mutation did not complete.")}\",\"recommended_next_operator_action\":\"{EscapeJson("Review the mutation failure evidence, keep the switch disabled, and do not retry until the blocker is understood.")}\"}}";
            Debug.Log(MutationJsonPrefix + payload);
            EditorApplication.Exit(1);
        }

        private static string EscapeJson(string value)
        {
            if (string.IsNullOrEmpty(value))
            {
                return string.Empty;
            }

            StringBuilder builder = new StringBuilder(value.Length + 8);
            foreach (char ch in value)
            {
                switch (ch)
                {
                    case '\\':
                        builder.Append("\\\\");
                        break;
                    case '"':
                        builder.Append("\\\"");
                        break;
                    case '\n':
                        builder.Append("\\n");
                        break;
                    case '\r':
                        builder.Append("\\r");
                        break;
                    case '\t':
                        builder.Append("\\t");
                        break;
                    default:
                        builder.Append(ch);
                        break;
                }
            }

            return builder.ToString();
        }

        private static string GetEnvironmentValue(string name)
        {
            string value = Environment.GetEnvironmentVariable(name);
            return string.IsNullOrWhiteSpace(value) ? null : value.Trim();
        }

        private static void Fail(string message)
        {
            Debug.LogError($"[AIE_UNITY_VALIDATION] FAIL {message}");
            EditorApplication.Exit(1);
        }
    }
}