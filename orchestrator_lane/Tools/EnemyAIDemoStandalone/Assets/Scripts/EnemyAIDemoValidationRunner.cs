using System;
using System.Collections;
using UnityEngine;

namespace EnemyAIDemo
{
    /// <summary>
    /// Runs only in automated validation mode so batch validation can prove the demo works.
    /// </summary>
    public sealed class EnemyAIDemoValidationRunner : MonoBehaviour
    {
        private const string ValidationEnv = "ENEMY_AI_DEMO_VALIDATE";

        [SerializeField] private EnemyAIController enemy;
        [SerializeField] private Transform player;
        [SerializeField] private SimpleKeyboardPlayerMover playerMover;
        [SerializeField] private Transform farResetPoint;

        private void Start()
        {
            if (!IsValidationRun())
            {
                return;
            }

            StartCoroutine(RunValidation());
        }

        private IEnumerator RunValidation()
        {
            if (enemy == null || player == null || farResetPoint == null)
            {
                Fail("Validation runner is missing required references.");
                yield break;
            }

            if (playerMover != null)
            {
                playerMover.enabled = false;
            }

            player.position = farResetPoint.position;

            Vector3 patrolStart = enemy.transform.position;
            yield return WaitForCondition(() => Vector3.Distance(enemy.transform.position, patrolStart) > 0.75f, 8f, "Enemy never started patrolling.");

            Vector3 chaseTargetPosition = enemy.transform.position + new Vector3(2f, 0f, 0f);
            player.position = chaseTargetPosition;

            yield return WaitForCondition(() => enemy.CurrentState == EnemyAIController.EnemyState.Chase, 4f, "Enemy never detected the player.");

            float chaseStartDistance = Vector3.Distance(enemy.transform.position, player.position);
            yield return WaitForCondition(() => Vector3.Distance(enemy.transform.position, player.position) < chaseStartDistance - 0.5f, 4f, "Enemy never closed distance while chasing.");

            player.position = farResetPoint.position;
            yield return WaitForCondition(() => enemy.CurrentState == EnemyAIController.EnemyState.Patrol, 6f, "Enemy never returned to patrol after losing the player.");

            Vector3 returnStart = enemy.transform.position;
            yield return WaitForCondition(() => Vector3.Distance(enemy.transform.position, returnStart) > 0.25f, 6f, "Enemy did not resume movement after returning to patrol.");

            Pass("Enemy AI demo validation passed: patrol, detect, chase, and return behavior all succeeded.");
        }

        private IEnumerator WaitForCondition(Func<bool> predicate, float timeoutSeconds, string failureMessage)
        {
            float timer = 0f;

            while (timer < timeoutSeconds)
            {
                if (predicate())
                {
                    yield break;
                }

                timer += Time.deltaTime;
                yield return null;
            }

            Fail(failureMessage);
        }

        private static bool IsValidationRun()
        {
            string value = Environment.GetEnvironmentVariable(ValidationEnv);
            return string.Equals(value, "1", StringComparison.OrdinalIgnoreCase);
        }

        private static void Pass(string message)
        {
            Debug.Log($"[ENEMY_AI_DEMO] PASS {message}");
            Exit(0);
        }

        private static void Fail(string message)
        {
            Debug.LogError($"[ENEMY_AI_DEMO] FAIL {message}");
            Exit(1);
        }

        private static void Exit(int exitCode)
        {
#if UNITY_EDITOR
            UnityEditor.EditorApplication.ExitPlaymode();
            UnityEditor.EditorApplication.Exit(exitCode);
#else
            Application.Quit(exitCode);
#endif
        }
    }
}
