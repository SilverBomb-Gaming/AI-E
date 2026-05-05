using System;
using UnityEngine;

namespace EnemyAIDemo
{
    /// <summary>
    /// Emits bounded playtest session markers into the Unity runtime log so AI-E can isolate the latest run.
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class AIEPlaytestSessionMarker : MonoBehaviour
    {
        [SerializeField] private bool logSessionLifecycle = true;

        // AIE guarded act proof: validated safe comment-only patch v2.
        private bool sessionStarted;
        private bool sessionEnded;
        private string sessionId = string.Empty;

        private void Awake()
        {
            if (!Application.isPlaying)
            {
                return;
            }

            sessionId = $"{DateTime.UtcNow:O}|{name}|{GetInstanceID()}";
            sessionStarted = true;

            if (logSessionLifecycle)
            {
                Debug.Log($"[AIE Playtest Session] START id={sessionId} object={name}", this);
            }
        }

        private void OnApplicationQuit()
        {
            TryLogSessionEnd("application-quit");
        }

        private void OnDestroy()
        {
            TryLogSessionEnd("destroy");
        }

        private void TryLogSessionEnd(string reason)
        {
            if (!logSessionLifecycle || !sessionStarted || sessionEnded)
            {
                return;
            }

            sessionEnded = true;
            Debug.Log($"[AIE Playtest Session] END id={sessionId} reason={reason} object={name}", this);
        }
    }
}