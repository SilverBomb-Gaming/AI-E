using UnityEngine;

namespace EnemyAIDemo
{
    /// <summary>
    /// Keeps player movement simple so the demo is immediately playable in a blank scene.
    /// </summary>
    [DisallowMultipleComponent]
    [RequireComponent(typeof(CharacterController))]
    public sealed class SimpleKeyboardPlayerMover : MonoBehaviour
    {
        [SerializeField] [Min(0.1f)] private float moveSpeed = 5f;
        [SerializeField] [Min(0f)] private float turnSpeed = 720f;
        [SerializeField] private float gravity = -20f;

        private CharacterController controller;
        private Vector3 velocity;

        private void Awake()
        {
            controller = GetComponent<CharacterController>();
        }

        private void Update()
        {
            Vector3 input = new Vector3(Input.GetAxisRaw("Horizontal"), 0f, Input.GetAxisRaw("Vertical"));
            input = Vector3.ClampMagnitude(input, 1f);

            Vector3 move = input * moveSpeed;

            if (controller.isGrounded && velocity.y < 0f)
            {
                velocity.y = -1f;
            }

            velocity.y += gravity * Time.deltaTime;

            controller.Move((move + new Vector3(0f, velocity.y, 0f)) * Time.deltaTime);

            if (input.sqrMagnitude > 0.001f)
            {
                Quaternion targetRotation = Quaternion.LookRotation(input, Vector3.up);
                transform.rotation = Quaternion.RotateTowards(transform.rotation, targetRotation, turnSpeed * Time.deltaTime);
            }
        }
    }
}
