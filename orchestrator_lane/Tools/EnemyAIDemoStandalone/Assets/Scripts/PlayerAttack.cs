using System.Collections.Generic;
using UnityEngine;

namespace EnemyAIDemo
{
    /// <summary>
    /// Performs a simple short-range attack against nearby enemies during local playtests.
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class PlayerAttack : MonoBehaviour
    {
        [SerializeField] private float attackRange = 2.5f;
        [SerializeField] private float attackCooldown = 0.35f;
        [SerializeField] private float attackRadius = 1.1f;
        [SerializeField] private KeyCode attackKey = KeyCode.E;
        [SerializeField] private bool allowMouse0 = true;
        [SerializeField] private bool debugHits = true;

        private float nextAttackTime;

        private void Update()
        {
            if (!ShouldAttack() || Time.time < nextAttackTime)
            {
                return;
            }

            nextAttackTime = Time.time + attackCooldown;
            PerformAttack();
        }

        private bool ShouldAttack()
        {
            return Input.GetKeyDown(attackKey) || (allowMouse0 && Input.GetMouseButtonDown(0));
        }

        private void PerformAttack()
        {
            Vector3 attackOrigin = transform.position + Vector3.up + (transform.forward * Mathf.Min(attackRange * 0.6f, 1.5f));
            Collider[] hits = Physics.OverlapSphere(attackOrigin, attackRadius, ~0, QueryTriggerInteraction.Ignore);
            HashSet<BasicEnemy> hitEnemies = new HashSet<BasicEnemy>();
            bool hitAny = false;

            foreach (Collider hit in hits)
            {
                BasicEnemy enemy = hit.GetComponentInParent<BasicEnemy>();
                if (enemy == null || !hitEnemies.Add(enemy))
                {
                    continue;
                }

                if (Vector3.Distance(transform.position, enemy.transform.position) > attackRange + 0.75f)
                {
                    continue;
                }

                enemy.ReceiveHit();
                hitAny = true;

                if (debugHits)
                {
                    Debug.Log($"[AIE Player Attack] Hit {enemy.name}.", enemy);
                }
            }

            if (!hitAny && debugHits)
            {
                Debug.Log("[AIE Player Attack] Attack missed.", this);
            }
        }

        private void OnDrawGizmosSelected()
        {
            Vector3 attackOrigin = transform.position + Vector3.up + (transform.forward * Mathf.Min(attackRange * 0.6f, 1.5f));
            Gizmos.color = Color.red;
            Gizmos.DrawWireSphere(attackOrigin, attackRadius);
        }
    }
}
