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
        private const string ScenePathEnv = "AIE_UNITY_SCENE_PATH";
        private const string RequestIdEnv = "AIE_UNITY_VALIDATION_REQUEST_ID";
        private const string RequestedAtEnv = "AIE_UNITY_VALIDATION_REQUESTED_AT";
        private const string SceneNameHintEnv = "AIE_UNITY_SCENE_NAME_HINT";
        private const string DefaultScenePath = "Assets/Scenes/EnemyAIDemo.unity";

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