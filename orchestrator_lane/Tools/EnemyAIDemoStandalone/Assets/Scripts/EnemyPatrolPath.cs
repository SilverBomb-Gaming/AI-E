using System.Collections.Generic;
using UnityEngine;

namespace EnemyAIDemo
{
    /// <summary>
    /// Holds patrol points so the route can be adjusted in the inspector or by moving child transforms.
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class EnemyPatrolPath : MonoBehaviour
    {
        [SerializeField] private bool useChildrenAsPatrolPoints = true;
        [SerializeField] private List<Transform> patrolPoints = new List<Transform>();

        public int PointCount => patrolPoints.Count;

        public Transform GetPoint(int index)
        {
            if (patrolPoints.Count == 0)
            {
                return null;
            }

            index = Mathf.Clamp(index, 0, patrolPoints.Count - 1);
            return patrolPoints[index];
        }

        private void OnValidate()
        {
            if (!useChildrenAsPatrolPoints)
            {
                patrolPoints.RemoveAll(point => point == null);
                return;
            }

            patrolPoints.Clear();

            for (int index = 0; index < transform.childCount; index++)
            {
                patrolPoints.Add(transform.GetChild(index));
            }
        }

        private void OnDrawGizmos()
        {
            patrolPoints.RemoveAll(point => point == null);

            if (patrolPoints.Count == 0)
            {
                return;
            }

            Gizmos.color = Color.cyan;

            for (int index = 0; index < patrolPoints.Count; index++)
            {
                Transform currentPoint = patrolPoints[index];
                Transform nextPoint = patrolPoints[(index + 1) % patrolPoints.Count];

                if (currentPoint == null)
                {
                    continue;
                }

                Gizmos.DrawSphere(currentPoint.position, 0.2f);

                if (nextPoint != null && patrolPoints.Count > 1)
                {
                    Gizmos.DrawLine(currentPoint.position, nextPoint.position);
                }
            }
        }
    }
}
