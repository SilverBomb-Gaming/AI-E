using System.Collections.Generic;
using UnityEngine;
using UnityEngine.AI;

namespace EnemyAIDemo
{
    /// <summary>
    /// Builds a small NavMesh at runtime so the demo works in a fresh project without manual baking.
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class RuntimeNavMeshBootstrap : MonoBehaviour
    {
        [SerializeField] private MeshFilter groundMeshFilter;
        [SerializeField] private Vector3 buildBoundsCenter = Vector3.zero;
        [SerializeField] private Vector3 buildBoundsSize = new Vector3(40f, 10f, 40f);

        private NavMeshDataInstance navMeshInstance;
        private bool navMeshBuilt;

        private void Awake()
        {
            BuildNavMesh();
        }

        private void OnDisable()
        {
            if (navMeshBuilt)
            {
                navMeshInstance.Remove();
                navMeshBuilt = false;
            }
        }

        private void BuildNavMesh()
        {
            if (groundMeshFilter == null || groundMeshFilter.sharedMesh == null)
            {
                Debug.LogError("[ENEMY_AI_DEMO] RuntimeNavMeshBootstrap is missing a valid ground mesh.");
                return;
            }

            var sources = new List<NavMeshBuildSource>
            {
                new NavMeshBuildSource
                {
                    shape = NavMeshBuildSourceShape.Mesh,
                    sourceObject = groundMeshFilter.sharedMesh,
                    transform = groundMeshFilter.transform.localToWorldMatrix,
                    area = 0,
                },
            };

            if (NavMesh.GetSettingsCount() == 0)
            {
                Debug.LogError("[ENEMY_AI_DEMO] No NavMesh build settings are available.");
                return;
            }

            int settingsIndex = NavMesh.GetSettingsByIndex(0).agentTypeID;
            NavMeshBuildSettings settings = NavMesh.GetSettingsByID(settingsIndex);

            if (!settings.agentTypeID.Equals(settingsIndex))
            {
                Debug.LogError("[ENEMY_AI_DEMO] No valid NavMesh build settings were found.");
                return;
            }

            Bounds bounds = new Bounds(buildBoundsCenter, buildBoundsSize);
            NavMeshData navMeshData = NavMeshBuilder.BuildNavMeshData(settings, sources, bounds, Vector3.zero, Quaternion.identity);

            if (navMeshData == null)
            {
                Debug.LogError("[ENEMY_AI_DEMO] Runtime NavMesh build failed.");
                return;
            }

            navMeshInstance = NavMesh.AddNavMeshData(navMeshData);
            navMeshBuilt = true;
            Debug.Log("[ENEMY_AI_DEMO] Runtime NavMesh built successfully.");
        }
    }
}