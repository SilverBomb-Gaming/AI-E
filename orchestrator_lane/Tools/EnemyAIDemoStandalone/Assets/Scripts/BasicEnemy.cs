using UnityEngine;

namespace EnemyAIDemo
{
    /// <summary>
    /// Adds a simple visible idle behavior to a scene enemy for local playtests.
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class BasicEnemy : MonoBehaviour
    {
        [SerializeField] private float rotationSpeedDegrees = 24f;
        [SerializeField] private bool debugSpawn = true;
        [SerializeField] private float hitPulseScale = 1.12f;
        [SerializeField] private float hitPulseDuration = 0.12f;

        private Vector3 baseScale;
        private Coroutine hitPulseRoutine;

        private void Awake()
        {
            baseScale = transform.localScale;
        }

        private void Start()
        {
            if (debugSpawn)
            {
                Debug.Log($"[AIE Basic Enemy] Spawned {name} at {transform.position}.", this);
            }
        }

        private void Update()
        {
            if (Mathf.Abs(rotationSpeedDegrees) <= Mathf.Epsilon)
            {
                return;
            }

            transform.Rotate(0f, rotationSpeedDegrees * Time.deltaTime, 0f, Space.World);
        }

        public void ReceiveHit()
        {
            Debug.Log("Enemy hit", this);

            if (hitPulseRoutine != null)
            {
                StopCoroutine(hitPulseRoutine);
            }

            hitPulseRoutine = StartCoroutine(PlayHitPulse());
        }

        private System.Collections.IEnumerator PlayHitPulse()
        {
            float duration = Mathf.Max(0.01f, hitPulseDuration);
            Vector3 pulseScale = baseScale * Mathf.Max(1f, hitPulseScale);
            float elapsed = 0f;

            while (elapsed < duration)
            {
                elapsed += Time.deltaTime;
                float progress = Mathf.Clamp01(elapsed / duration);
                float blend = progress < 0.5f ? progress / 0.5f : 1f - ((progress - 0.5f) / 0.5f);
                transform.localScale = Vector3.Lerp(baseScale, pulseScale, blend);
                yield return null;
            }

            transform.localScale = baseScale;
            hitPulseRoutine = null;
        }
    }
}
