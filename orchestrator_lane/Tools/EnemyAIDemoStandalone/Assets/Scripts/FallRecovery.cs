using UnityEngine;

namespace EnemyAIDemo
{
    /// <summary>
    /// Resets the player to a safe point when they fall out of the local playtest area.
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class FallRecovery : MonoBehaviour
    {
        [SerializeField] private Transform respawnPoint;
        [SerializeField] private float fallThresholdY = -10f;
        [SerializeField] private bool debugRecovery = true;
        [SerializeField] private Vector3 fallbackSpawnPosition = new Vector3(0f, 1f, -8f);

        private CharacterController characterController;
        private Rigidbody attachedRigidbody;

        private void Awake()
        {
            characterController = GetComponent<CharacterController>();
            attachedRigidbody = GetComponent<Rigidbody>();
        }

        private void Update()
        {
            if (transform.position.y >= fallThresholdY)
            {
                return;
            }

            RecoverPlayer();
        }

        private void RecoverPlayer()
        {
            Vector3 respawnPosition = respawnPoint != null ? respawnPoint.position : fallbackSpawnPosition;

            if (characterController != null)
            {
                characterController.enabled = false;
            }

            transform.position = respawnPosition;

            if (characterController != null)
            {
                characterController.enabled = true;
            }

            if (attachedRigidbody != null)
            {
                attachedRigidbody.velocity = Vector3.zero;
                attachedRigidbody.angularVelocity = Vector3.zero;
            }

            if (debugRecovery)
            {
                Debug.Log($"[AIE Fall Recovery] Player reset to {respawnPosition} after crossing Y={fallThresholdY:F2}.", this);
            }
        }
    }
}