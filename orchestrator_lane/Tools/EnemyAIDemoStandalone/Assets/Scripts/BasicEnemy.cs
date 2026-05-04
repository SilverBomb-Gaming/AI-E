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
    }
}
