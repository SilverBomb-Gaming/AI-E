using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using UnityEngine;
#if UNITY_EDITOR
using UnityEditor;
using UnityEditor.SceneManagement;
#endif

namespace Babylon.CI
{
    /// <summary>
    /// Opens the requested scene and enters play mode so the manual correction tool can be used interactively.
    /// </summary>
    internal static class PlatformerLayoutCorrectionBootstrap
    {
        private const string SceneEnvVar = "AIE_PLATFORMER_CORRECTION_SCENE";
        private static bool _exitEditorOnCompletion;

#if UNITY_EDITOR
        public static void RunFromCommandLine()
        {
            _exitEditorOnCompletion = true;
            var scenePath = Environment.GetEnvironmentVariable(SceneEnvVar);
            if (!string.IsNullOrWhiteSpace(scenePath) && File.Exists(scenePath))
            {
                EditorSceneManager.OpenScene(scenePath, OpenSceneMode.Single);
            }

            EditorApplication.isPlaying = true;
        }

        internal static void Complete(int exitCode)
        {
            if (!_exitEditorOnCompletion)
            {
                return;
            }

            EditorApplication.ExitPlaymode();
            EditorApplication.delayCall += () => EditorApplication.Exit(exitCode);
        }
#endif
    }
}

namespace Babylon.Gameplay.Platformer
{
    /// <summary>
    /// Captures bounded keyboard/mouse edits and writes an explicit correction payload for AI-E.
    /// </summary>
    [DefaultExecutionOrder(-600)]
    internal sealed class PlatformerLayoutManualCorrectionTool : MonoBehaviour
    {
        private const string ModeEnvVar = "AIE_PLATFORMER_CORRECTION_MODE";
        private const string OutputEnvVar = "AIE_PLATFORMER_CORRECTION_OUTPUT";
        private const string LayoutIdEnvVar = "AIE_PLATFORMER_LAYOUT_ID";
        private const string LayoutNameEnvVar = "AIE_PLATFORMER_LAYOUT_NAME";
        private const string GridStepEnvVar = "AIE_PLATFORMER_GRID_STEP";
        private const string ExitOnSaveEnvVar = "AIE_PLATFORMER_EXIT_ON_SAVE";
        private const string ModeValue = "keyboard_mouse";

        private static bool _bootstrapped;

        private readonly Dictionary<string, Vector3> _originalPositions = new Dictionary<string, Vector3>(StringComparer.OrdinalIgnoreCase);
        private readonly Dictionary<string, CorrectionEntry> _corrections = new Dictionary<string, CorrectionEntry>(StringComparer.OrdinalIgnoreCase);
        private readonly List<PlatformerLayoutEditable> _editables = new List<PlatformerLayoutEditable>();

        private PlatformerLayoutEditable _selected;
        private Camera _camera;
        private bool _gridSnapEnabled = true;
        private AxisLock _axisLock = AxisLock.None;
        private bool _dragActive;
        private float _gridStep = 0.5f;
        private Vector3 _dragOffset = Vector3.zero;
        private string _statusMessage = "Select an editable object with left click.";
        private string _saveConfirmation = "";

        private enum AxisLock
        {
            None,
            X,
            Y,
        }

        [Serializable]
        private sealed class SerializableCorrectionPayload
        {
            public string layout_id;
            public string layout_name;
            public string target_context;
            public string manual_edit_mode;
            public SerializableCorrectionEntry[] corrections;
            public SerializableCorrectionEntry[] layout_corrections;
            public SerializableLayoutSnapshot corrected_layout;
        }

        [Serializable]
        private sealed class SerializableCorrectionEntry
        {
            public string object_id;
            public string object_type;
            public string action;
            public float[] original_position;
            public float[] new_position;
            public float[] corrected_position;
        }

        [Serializable]
        private sealed class SerializableLayoutSnapshot
        {
            public string layout_id;
            public string layout_name;
            public SerializableLayoutObject[] objects;
        }

        [Serializable]
        private sealed class SerializableLayoutObject
        {
            public string object_id;
            public string object_type;
            public float[] position;
        }

        private struct CorrectionEntry
        {
            public string ObjectId;
            public string ObjectType;
            public string Action;
            public Vector3 OriginalPosition;
            public Vector3 NewPosition;
        }

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
        private static void BootstrapIfRequested()
        {
            if (_bootstrapped || !ShouldEnable())
            {
                return;
            }

            _bootstrapped = true;
            var host = new GameObject("PlatformerLayoutManualCorrectionTool")
            {
                hideFlags = HideFlags.HideAndDontSave,
            };
            DontDestroyOnLoad(host);
            host.AddComponent<PlatformerLayoutManualCorrectionTool>();
        }

        private void Awake()
        {
            _camera = Camera.main;
            _gridStep = ReadGridStep();
            RefreshEditables();
        }

        private void Update()
        {
            if (_camera == null)
            {
                _camera = Camera.main;
                if (_camera == null)
                {
                    return;
                }
            }

            if (_editables.Count == 0)
            {
                RefreshEditables();
                if (_editables.Count == 0)
                {
                    _statusMessage = "No PlatformerLayoutEditable objects were found in the loaded scene.";
                    if (Input.GetKeyDown(KeyCode.Escape))
                    {
                        CancelSession();
                    }
                    return;
                }
            }

            HandleSelection();
            HandleAxisLockToggles();
            HandleDrag();
            HandleNudge();
            HandleSaveCancel();
        }

        private void OnGUI()
        {
            GUILayout.BeginArea(new Rect(12f, 12f, 460f, 220f), GUI.skin.box);
            GUILayout.Label("AI-E Platformer Layout Manual Correction Tool");
            GUILayout.Label("Controls: left click select, drag to move, arrow keys nudge, PageUp/PageDown vertical, G grid snap, X/Y axis lock, Enter save, Escape cancel.");
            GUILayout.Label($"Grid snap: {(_gridSnapEnabled ? "on" : "off")} ({_gridStep.ToString("0.###", CultureInfo.InvariantCulture)})");
            GUILayout.Label($"Axis lock: {_axisLock}");
            GUILayout.Label($"Selected: {(_selected != null ? _selected.ObjectId : "none")}");
            GUILayout.Label($"Delta: {FormatDelta()}");
            GUILayout.Label($"Status: {_statusMessage}");
            if (!string.IsNullOrWhiteSpace(_saveConfirmation))
            {
                GUILayout.Label($"Save: {_saveConfirmation}");
            }
            GUILayout.EndArea();
        }

        private void OnDrawGizmos()
        {
            if (_selected == null)
            {
                return;
            }

            var bounds = GetSelectionBounds(_selected.gameObject);
            Gizmos.color = Color.yellow;
            Gizmos.DrawWireCube(bounds.center, bounds.size);

            if (_originalPositions.TryGetValue(_selected.ObjectId, out var originalPosition))
            {
                Gizmos.color = Color.cyan;
                Gizmos.DrawLine(originalPosition, _selected.EditTransform.position);
            }
        }

        private void RefreshEditables()
        {
            _editables.Clear();
            _editables.AddRange(FindObjectsOfType<PlatformerLayoutEditable>(true));
            foreach (var editable in _editables)
            {
                if (editable == null)
                {
                    continue;
                }

                _originalPositions[editable.ObjectId] = editable.EditTransform.position;
            }
        }

        private void HandleSelection()
        {
            if (!Input.GetMouseButtonDown(0))
            {
                return;
            }

            var editable = RaycastEditable();
            if (editable == null)
            {
                return;
            }

            _selected = editable;
            _statusMessage = $"Selected {_selected.ObjectId} ({_selected.ObjectTypeId}).";
#if UNITY_EDITOR
            Selection.activeGameObject = _selected.gameObject;
#endif
        }

        private void HandleAxisLockToggles()
        {
            if (Input.GetKeyDown(KeyCode.G))
            {
                _gridSnapEnabled = !_gridSnapEnabled;
                _statusMessage = $"Grid snap {(_gridSnapEnabled ? "enabled" : "disabled")}.";
            }

            if (Input.GetKeyDown(KeyCode.X))
            {
                _axisLock = _axisLock == AxisLock.X ? AxisLock.None : AxisLock.X;
                _statusMessage = $"Axis lock set to {_axisLock}.";
            }

            if (Input.GetKeyDown(KeyCode.Y))
            {
                _axisLock = _axisLock == AxisLock.Y ? AxisLock.None : AxisLock.Y;
                _statusMessage = $"Axis lock set to {_axisLock}.";
            }
        }

        private void HandleDrag()
        {
            if (_selected == null)
            {
                _dragActive = false;
                return;
            }

            if (Input.GetMouseButtonDown(0) && RaycastEditable() == _selected)
            {
                _dragActive = TryGetPointerPositionOnPlane(_selected.EditTransform.position.z, out var hitPoint);
                if (_dragActive)
                {
                    _dragOffset = _selected.EditTransform.position - hitPoint;
                }
            }

            if (!_dragActive)
            {
                return;
            }

            if (Input.GetMouseButton(0) && TryGetPointerPositionOnPlane(_selected.EditTransform.position.z, out var dragPoint))
            {
                ApplyPosition(_selected, dragPoint + _dragOffset, "move");
            }

            if (Input.GetMouseButtonUp(0))
            {
                _dragActive = false;
            }
        }

        private void HandleNudge()
        {
            if (_selected == null)
            {
                return;
            }

            var step = Input.GetKey(KeyCode.LeftShift) || Input.GetKey(KeyCode.RightShift) ? _gridStep * 2f : _gridStep;
            var delta = Vector3.zero;
            if (Input.GetKeyDown(KeyCode.LeftArrow))
            {
                delta.x -= step;
            }
            if (Input.GetKeyDown(KeyCode.RightArrow))
            {
                delta.x += step;
            }
            if (Input.GetKeyDown(KeyCode.UpArrow) || Input.GetKeyDown(KeyCode.PageUp))
            {
                delta.y += step;
            }
            if (Input.GetKeyDown(KeyCode.DownArrow) || Input.GetKeyDown(KeyCode.PageDown))
            {
                delta.y -= step;
            }

            if (delta == Vector3.zero)
            {
                return;
            }

            ApplyPosition(_selected, _selected.EditTransform.position + delta, "nudge");
        }

        private void HandleSaveCancel()
        {
            if (Input.GetKeyDown(KeyCode.Return) || Input.GetKeyDown(KeyCode.KeypadEnter))
            {
                SavePayload();
                return;
            }

            if (Input.GetKeyDown(KeyCode.Escape))
            {
                CancelSession();
            }
        }

        private void SavePayload()
        {
            var outputPath = Environment.GetEnvironmentVariable(OutputEnvVar);
            if (string.IsNullOrWhiteSpace(outputPath))
            {
                _statusMessage = "AIE_PLATFORMER_CORRECTION_OUTPUT is not configured.";
                return;
            }

            var corrections = BuildCorrectionEntries();
            var payload = new SerializableCorrectionPayload
            {
                layout_id = ResolveLayoutId(),
                layout_name = ResolveLayoutName(),
                target_context = "platformer",
                manual_edit_mode = ModeValue,
                corrections = corrections,
                layout_corrections = corrections,
                corrected_layout = BuildCorrectedLayoutSnapshot(),
            };

            var directory = Path.GetDirectoryName(outputPath);
            if (!string.IsNullOrWhiteSpace(directory))
            {
                Directory.CreateDirectory(directory);
            }

            File.WriteAllText(outputPath, JsonUtility.ToJson(payload, true));
            _saveConfirmation = $"Saved {corrections.Length} correction(s) to {outputPath}";
            _statusMessage = "Correction payload saved.";
            Debug.Log($"[PlatformerCorrectionTool] {_saveConfirmation}");

#if UNITY_EDITOR
            if (ShouldExitOnSave())
            {
                PlatformerLayoutCorrectionBootstrap.Complete(0);
            }
#endif
        }

        private void CancelSession()
        {
            _statusMessage = "Manual correction session cancelled by operator.";
            Debug.Log("[PlatformerCorrectionTool] Manual correction session cancelled.");
#if UNITY_EDITOR
            if (ShouldExitOnSave())
            {
                PlatformerLayoutCorrectionBootstrap.Complete(1);
            }
#endif
        }

        private SerializableCorrectionEntry[] BuildCorrectionEntries()
        {
            var entries = new List<SerializableCorrectionEntry>();
            foreach (var correction in _corrections.Values)
            {
                if (Approximately(correction.OriginalPosition, correction.NewPosition))
                {
                    continue;
                }

                entries.Add(new SerializableCorrectionEntry
                {
                    object_id = correction.ObjectId,
                    object_type = correction.ObjectType,
                    action = correction.Action,
                    original_position = ToVectorArray(correction.OriginalPosition),
                    new_position = ToVectorArray(correction.NewPosition),
                    corrected_position = ToVectorArray(correction.NewPosition),
                });
            }

            entries.Sort((left, right) => string.CompareOrdinal(left.object_id, right.object_id));
            return entries.ToArray();
        }

        private SerializableLayoutSnapshot BuildCorrectedLayoutSnapshot()
        {
            var objects = new List<SerializableLayoutObject>(_editables.Count);
            foreach (var editable in _editables)
            {
                if (editable == null)
                {
                    continue;
                }

                objects.Add(new SerializableLayoutObject
                {
                    object_id = editable.ObjectId,
                    object_type = editable.ObjectTypeId,
                    position = ToVectorArray(editable.EditTransform.position),
                });
            }

            objects.Sort((left, right) => string.CompareOrdinal(left.object_id, right.object_id));
            return new SerializableLayoutSnapshot
            {
                layout_id = ResolveLayoutId(),
                layout_name = ResolveLayoutName(),
                objects = objects.ToArray(),
            };
        }

        private string ResolveLayoutId()
        {
            var overrideValue = Environment.GetEnvironmentVariable(LayoutIdEnvVar);
            if (!string.IsNullOrWhiteSpace(overrideValue))
            {
                return overrideValue.Trim();
            }

            if (_selected != null)
            {
                return _selected.LayoutId;
            }

            return _editables.Count > 0 ? _editables[0].LayoutId : "platformer_layout";
        }

        private string ResolveLayoutName()
        {
            var overrideValue = Environment.GetEnvironmentVariable(LayoutNameEnvVar);
            if (!string.IsNullOrWhiteSpace(overrideValue))
            {
                return overrideValue.Trim();
            }

            if (_selected != null)
            {
                return _selected.LayoutName;
            }

            return _editables.Count > 0 ? _editables[0].LayoutName : "Platformer Layout";
        }

        private string FormatDelta()
        {
            if (_selected == null || !_originalPositions.TryGetValue(_selected.ObjectId, out var original))
            {
                return "(0, 0, 0)";
            }

            var delta = _selected.EditTransform.position - original;
            return $"({delta.x.ToString("0.###", CultureInfo.InvariantCulture)}, {delta.y.ToString("0.###", CultureInfo.InvariantCulture)}, {delta.z.ToString("0.###", CultureInfo.InvariantCulture)})";
        }

        private void ApplyPosition(PlatformerLayoutEditable editable, Vector3 candidatePosition, string action)
        {
            if (editable == null)
            {
                return;
            }

            var current = editable.EditTransform.position;
            var original = _originalPositions.TryGetValue(editable.ObjectId, out var originalPosition)
                ? originalPosition
                : current;

            if (_axisLock == AxisLock.X)
            {
                candidatePosition.y = current.y;
            }
            else if (_axisLock == AxisLock.Y)
            {
                candidatePosition.x = current.x;
            }

            candidatePosition.z = current.z;
            if (_gridSnapEnabled)
            {
                candidatePosition.x = Snap(candidatePosition.x);
                candidatePosition.y = Snap(candidatePosition.y);
            }

            if (Approximately(current, candidatePosition))
            {
                return;
            }

            editable.EditTransform.position = candidatePosition;
            _corrections[editable.ObjectId] = new CorrectionEntry
            {
                ObjectId = editable.ObjectId,
                ObjectType = editable.ObjectTypeId,
                Action = action,
                OriginalPosition = original,
                NewPosition = candidatePosition,
            };
            _statusMessage = $"{editable.ObjectId} {action} to {candidatePosition}.";
        }

        private PlatformerLayoutEditable RaycastEditable()
        {
            var ray = _camera.ScreenPointToRay(Input.mousePosition);
            if (Physics.Raycast(ray, out var hit, 500f))
            {
                return hit.collider.GetComponentInParent<PlatformerLayoutEditable>();
            }

            var worldPoint = _camera.ScreenToWorldPoint(new Vector3(Input.mousePosition.x, Input.mousePosition.y, Mathf.Abs(_camera.transform.position.z)));
            var hit2D = Physics2D.Raycast(worldPoint, Vector2.zero);
            if (hit2D.collider != null)
            {
                return hit2D.collider.GetComponentInParent<PlatformerLayoutEditable>();
            }

            return null;
        }

        private bool TryGetPointerPositionOnPlane(float lockedZ, out Vector3 worldPoint)
        {
            var ray = _camera.ScreenPointToRay(Input.mousePosition);
            var plane = new Plane(Vector3.forward, new Vector3(0f, 0f, lockedZ));
            if (plane.Raycast(ray, out var distance))
            {
                worldPoint = ray.GetPoint(distance);
                worldPoint.z = lockedZ;
                return true;
            }

            worldPoint = Vector3.zero;
            return false;
        }

        private static Bounds GetSelectionBounds(GameObject gameObject)
        {
            var renderers = gameObject.GetComponentsInChildren<Renderer>(true);
            if (renderers.Length == 0)
            {
                return new Bounds(gameObject.transform.position, Vector3.one);
            }

            var bounds = renderers[0].bounds;
            for (var index = 1; index < renderers.Length; index++)
            {
                bounds.Encapsulate(renderers[index].bounds);
            }

            return bounds;
        }

        private static bool ShouldEnable()
        {
            var value = Environment.GetEnvironmentVariable(ModeEnvVar);
            return string.Equals(value?.Trim(), ModeValue, StringComparison.OrdinalIgnoreCase);
        }

        private static float[] ToVectorArray(Vector3 value)
        {
            return new[] { value.x, value.y, value.z };
        }

        private static bool Approximately(Vector3 left, Vector3 right)
        {
            return Vector3.SqrMagnitude(left - right) < 0.0001f;
        }

        private float Snap(float value)
        {
            if (_gridStep <= 0f)
            {
                return value;
            }

            return Mathf.Round(value / _gridStep) * _gridStep;
        }

        private float ReadGridStep()
        {
            var text = Environment.GetEnvironmentVariable(GridStepEnvVar);
            if (!float.TryParse(text, NumberStyles.Float, CultureInfo.InvariantCulture, out var step) || step <= 0f)
            {
                return 0.5f;
            }

            return step;
        }

        private static bool ShouldExitOnSave()
        {
            var value = Environment.GetEnvironmentVariable(ExitOnSaveEnvVar);
            return string.Equals(value?.Trim(), "1", StringComparison.OrdinalIgnoreCase)
                || string.Equals(value?.Trim(), "true", StringComparison.OrdinalIgnoreCase);
        }
    }
}