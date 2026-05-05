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
        [SerializeField] private Color hitFlashColor = new Color(1f, 0.2f, 0.1f, 1f);
        [SerializeField] private float hitFlashDuration = 0.28f;
        [SerializeField] private float hitPulseScale = 1.35f;
        [SerializeField] private float hitPulseDuration = 0.28f;

        private Renderer cachedRenderer;
        private Material runtimeMaterialInstance;
        private bool hasColorProperty;
        private Color baseColor = Color.white;
        private Vector3 baseScale;
        private Coroutine hitFeedbackRoutine;

        private void Awake()
        {
            baseScale = transform.localScale;
            cachedRenderer = GetComponent<Renderer>();

            if (cachedRenderer != null)
            {
                runtimeMaterialInstance = cachedRenderer.material;
                hasColorProperty = runtimeMaterialInstance != null && runtimeMaterialInstance.HasProperty("_Color");
                if (hasColorProperty)
                {
                    baseColor = runtimeMaterialInstance.color;
                }
            }
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

            if (hitFeedbackRoutine != null)
            {
                StopCoroutine(hitFeedbackRoutine);
            }

            ResetVisualState();
            hitFeedbackRoutine = StartCoroutine(PlayHitFeedback());
        }

        private System.Collections.IEnumerator PlayHitFeedback()
        {
            float duration = Mathf.Max(0.05f, Mathf.Max(hitFlashDuration, hitPulseDuration));
            Vector3 pulseScale = baseScale * Mathf.Max(1f, hitPulseScale);
            float elapsed = 0f;

            while (elapsed < duration)
            {
                elapsed += Time.deltaTime;
                float progress = Mathf.Clamp01(elapsed / duration);
                float blend = Mathf.Sin(progress * Mathf.PI);
                transform.localScale = Vector3.Lerp(baseScale, pulseScale, blend);

                if (hasColorProperty && runtimeMaterialInstance != null)
                {
                    runtimeMaterialInstance.color = Color.Lerp(baseColor, hitFlashColor, blend);
                }

                yield return null;
            }

            ResetVisualState();
            hitFeedbackRoutine = null;
        }

        private void ResetVisualState()
        {
            transform.localScale = baseScale;

            if (hasColorProperty && runtimeMaterialInstance != null)
            {
                runtimeMaterialInstance.color = baseColor;
            }
        }
    }
}
