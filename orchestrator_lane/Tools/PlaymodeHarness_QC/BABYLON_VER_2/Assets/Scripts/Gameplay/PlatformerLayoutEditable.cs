using System;
using UnityEngine;

namespace Babylon.Gameplay.Platformer
{
    internal enum PlatformerLayoutEditableObjectType
    {
        Platform,
        Ladder,
        Elevator,
        ObstacleCluster,
        EnemySpawnAnchor,
        CollectibleAnchor,
    }

    /// <summary>
    /// Marks a transform as eligible for bounded manual platformer layout editing.
    /// </summary>
    [DisallowMultipleComponent]
    internal sealed class PlatformerLayoutEditable : MonoBehaviour
    {
        [SerializeField] private string layoutId = "platformer_layout";
        [SerializeField] private string layoutName = "Platformer Layout";
        [SerializeField] private string objectId = "";
        [SerializeField] private PlatformerLayoutEditableObjectType objectType = PlatformerLayoutEditableObjectType.Platform;
        [SerializeField] private Transform editRoot;

        public string LayoutId => string.IsNullOrWhiteSpace(layoutId) ? "platformer_layout" : layoutId.Trim();

        public string LayoutName => string.IsNullOrWhiteSpace(layoutName) ? "Platformer Layout" : layoutName.Trim();

        public string ObjectId => string.IsNullOrWhiteSpace(objectId) ? gameObject.name : objectId.Trim();

        public string ObjectTypeId
        {
            get
            {
                switch (objectType)
                {
                    case PlatformerLayoutEditableObjectType.Platform:
                        return "platform";
                    case PlatformerLayoutEditableObjectType.Ladder:
                        return "ladder";
                    case PlatformerLayoutEditableObjectType.Elevator:
                        return "elevator";
                    case PlatformerLayoutEditableObjectType.ObstacleCluster:
                        return "obstacle_cluster";
                    case PlatformerLayoutEditableObjectType.EnemySpawnAnchor:
                        return "enemy_spawn_anchor";
                    case PlatformerLayoutEditableObjectType.CollectibleAnchor:
                        return "collectible_anchor";
                    default:
                        return "platform";
                }
            }
        }

        public Transform EditTransform => editRoot != null ? editRoot : transform;

        private void OnValidate()
        {
            if (string.IsNullOrWhiteSpace(objectId))
            {
                objectId = gameObject.name;
            }

            if (string.IsNullOrWhiteSpace(layoutId))
            {
                layoutId = "platformer_layout";
            }

            if (string.IsNullOrWhiteSpace(layoutName))
            {
                layoutName = "Platformer Layout";
            }
        }
    }
}