using UnityEngine;

namespace EnemyAIDemo
{
    /// <summary>
    /// Separates target detection from movement so the chase rules stay easy to tune.
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class EnemyTargetDetector : MonoBehaviour
    {
        [SerializeField] [Min(0.1f)] private float detectionRadius = 6f;
        [SerializeField] [Min(1f)] private float loseTargetRadiusMultiplier = 1.4f;

        public float DetectionRadius => detectionRadius;

        public float LoseTargetRadius => detectionRadius * loseTargetRadiusMultiplier;

        public bool CanDetect(Transform target)
        {
            return IsWithinRadius(target, detectionRadius);
        }

        public bool ShouldKeepChasing(Transform target)
        {
            return IsWithinRadius(target, LoseTargetRadius);
        }

        private bool IsWithinRadius(Transform target, float radius)
        {
            if (target == null)
            {
                return false;
            }

            float sqrDistance = (target.position - transform.position).sqrMagnitude;
            return sqrDistance <= radius * radius;
        }

        private void OnDrawGizmosSelected()
        {
            Gizmos.color = Color.yellow;
            Gizmos.DrawWireSphere(transform.position, detectionRadius);

            Gizmos.color = new Color(1f, 0.5f, 0f, 1f);
            Gizmos.DrawWireSphere(transform.position, LoseTargetRadius);
        }
    }
}
