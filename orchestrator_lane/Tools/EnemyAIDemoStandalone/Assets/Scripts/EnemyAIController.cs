using UnityEngine;
using UnityEngine.AI;

namespace EnemyAIDemo
{
    /// <summary>
    /// Simple enemy state machine for a recordable patrol and chase demo.
    /// </summary>
    [DisallowMultipleComponent]
    [RequireComponent(typeof(NavMeshAgent))]
    [RequireComponent(typeof(EnemyTargetDetector))]
    public sealed class EnemyAIController : MonoBehaviour
    {
        public enum EnemyState
        {
            Patrol,
            Chase,
        }

        [Header("References")]
        [SerializeField] private Transform player;
        [SerializeField] private EnemyPatrolPath patrolPath;

        [Header("Patrol")]
        [SerializeField] [Min(0.05f)] private float patrolPointReachDistance = 0.4f;
        [SerializeField] [Min(0f)] private float patrolWaitTime = 0.35f;

        private NavMeshAgent agent;
        private EnemyTargetDetector detector;
        private int patrolIndex;
        private float patrolWaitTimer;

        public EnemyState CurrentState { get; private set; } = EnemyState.Patrol;

        public Transform Player => player;

        private void Awake()
        {
            agent = GetComponent<NavMeshAgent>();
            detector = GetComponent<EnemyTargetDetector>();
        }

        private void Start()
        {
            MoveToCurrentPatrolPoint();
        }

        private void Update()
        {
            if (detector.CanDetect(player))
            {
                CurrentState = EnemyState.Chase;
            }
            else if (CurrentState == EnemyState.Chase && !detector.ShouldKeepChasing(player))
            {
                CurrentState = EnemyState.Patrol;
                MoveToCurrentPatrolPoint();
            }

            if (CurrentState == EnemyState.Chase)
            {
                UpdateChase();
                return;
            }

            UpdatePatrol();
        }

        // Chasing keeps the destination pointed at the player's latest location.
        private void UpdateChase()
        {
            if (player == null)
            {
                CurrentState = EnemyState.Patrol;
                MoveToCurrentPatrolPoint();
                return;
            }

            agent.isStopped = false;
            agent.SetDestination(player.position);
        }

        // Patrol advances through the route after reaching each point and waiting briefly.
        private void UpdatePatrol()
        {
            if (patrolPath == null || patrolPath.PointCount == 0)
            {
                agent.isStopped = true;
                return;
            }

            if (agent.pathPending)
            {
                return;
            }

            if (agent.remainingDistance > patrolPointReachDistance)
            {
                return;
            }

            patrolWaitTimer += Time.deltaTime;

            if (patrolWaitTimer < patrolWaitTime)
            {
                agent.isStopped = true;
                return;
            }

            patrolIndex = (patrolIndex + 1) % patrolPath.PointCount;
            MoveToCurrentPatrolPoint();
        }

        private void MoveToCurrentPatrolPoint()
        {
            patrolWaitTimer = 0f;
            agent.isStopped = false;

            Transform nextPoint = patrolPath != null ? patrolPath.GetPoint(patrolIndex) : null;

            if (nextPoint != null)
            {
                agent.SetDestination(nextPoint.position);
            }
        }

        private void Reset()
        {
            agent = GetComponent<NavMeshAgent>();
            detector = GetComponent<EnemyTargetDetector>();

            if (player == null)
            {
                GameObject playerObject = GameObject.FindGameObjectWithTag("Player");
                player = playerObject != null ? playerObject.transform : null;
            }

            if (patrolPath == null)
            {
                patrolPath = GetComponentInChildren<EnemyPatrolPath>();
            }

            if (agent != null)
            {
                agent.speed = 3.5f;
                agent.acceleration = 12f;
                agent.angularSpeed = 720f;
                agent.stoppingDistance = 0.05f;
                agent.autoBraking = true;
            }
        }

        private void OnValidate()
        {
            if (patrolPath == null)
            {
                patrolPath = GetComponentInChildren<EnemyPatrolPath>();
            }
        }
    }
}
