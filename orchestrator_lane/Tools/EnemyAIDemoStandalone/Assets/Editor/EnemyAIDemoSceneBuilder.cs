using System;
using EnemyAIDemo;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

namespace EnemyAIDemo.Editor
{
    /// <summary>
    /// Creates a complete playable scene so the demo can be opened without manual scene assembly.
    /// </summary>
    public static class EnemyAIDemoSceneBuilder
    {
        private const string SceneFolder = "Assets/Scenes";
        private const string ScenePath = "Assets/Scenes/EnemyAIDemo.unity";

        [MenuItem("Tools/Enemy AI Demo/Build Playable Demo Scene")]
        public static void BuildDemoSceneMenu()
        {
            BuildScene(openAfterBuild: false);
        }

        [MenuItem("Tools/Enemy AI Demo/Build And Open Demo Scene")]
        public static void BuildAndOpenDemoSceneMenu()
        {
            BuildScene(openAfterBuild: true);
        }

        public static string BuildScene(bool openAfterBuild)
        {
            EnsureFolderExists(SceneFolder);

            var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);

            CreateCamera();
            CreateLighting();
            GameObject ground = CreateGround();
            GameObject player = CreatePlayer();
            GameObject enemy = CreateEnemy(player.transform);
            Transform patrolPath = CreatePatrolPath();
            ConfigureEnemy(enemy, player.transform, patrolPath.GetComponent<EnemyPatrolPath>());
            CreateValidationRunner(enemy.GetComponent<EnemyAIController>(), player.transform, player.GetComponent<SimpleKeyboardPlayerMover>());

            CreateNavMeshBootstrap(ground.GetComponent<MeshFilter>());

            EditorSceneManager.SaveScene(scene, ScenePath, true);
            AssetDatabase.SaveAssets();
            AssetDatabase.Refresh();

            if (openAfterBuild)
            {
                EditorSceneManager.OpenScene(ScenePath, OpenSceneMode.Single);
            }

            Debug.Log($"[ENEMY_AI_DEMO] Scene built at {ScenePath}");
            return ScenePath;
        }

        public static void BuildSceneFromCommandLine()
        {
            BuildScene(openAfterBuild: false);
            EditorApplication.Exit(0);
        }

        public static void ValidateSceneFromCommandLine()
        {
            string path = BuildScene(openAfterBuild: false);
            Environment.SetEnvironmentVariable("ENEMY_AI_DEMO_VALIDATE", "1");
            EditorSceneManager.OpenScene(path, OpenSceneMode.Single);
            EditorApplication.isPlaying = true;
        }

        private static void EnsureFolderExists(string folderPath)
        {
            if (AssetDatabase.IsValidFolder(folderPath))
            {
                return;
            }

            string[] parts = folderPath.Split('/');
            string current = parts[0];

            for (int index = 1; index < parts.Length; index++)
            {
                string next = current + "/" + parts[index];

                if (!AssetDatabase.IsValidFolder(next))
                {
                    AssetDatabase.CreateFolder(current, parts[index]);
                }

                current = next;
            }
        }

        private static void CreateCamera()
        {
            var cameraObject = new GameObject("Main Camera");
            Camera camera = cameraObject.AddComponent<Camera>();
            camera.tag = "MainCamera";
            cameraObject.transform.position = new Vector3(0f, 12f, -14f);
            cameraObject.transform.rotation = Quaternion.Euler(35f, 0f, 0f);
            camera.clearFlags = CameraClearFlags.Skybox;
        }

        private static void CreateLighting()
        {
            var lightObject = new GameObject("Directional Light");
            Light light = lightObject.AddComponent<Light>();
            light.type = LightType.Directional;
            light.intensity = 1.1f;
            lightObject.transform.rotation = Quaternion.Euler(50f, -30f, 0f);
        }

        private static GameObject CreateGround()
        {
            GameObject ground = GameObject.CreatePrimitive(PrimitiveType.Plane);
            ground.name = "Ground";
            ground.transform.position = Vector3.zero;
            ground.transform.localScale = new Vector3(3f, 1f, 3f);

            Renderer renderer = ground.GetComponent<Renderer>();
            renderer.sharedMaterial.color = new Color(0.28f, 0.35f, 0.28f);
            return ground;
        }

        private static GameObject CreatePlayer()
        {
            GameObject player = GameObject.CreatePrimitive(PrimitiveType.Capsule);
            player.name = "Player";
            player.tag = "Player";
            player.transform.position = new Vector3(0f, 1f, -8f);

            UnityEngine.Object.DestroyImmediate(player.GetComponent<CapsuleCollider>());

            CharacterController controller = player.AddComponent<CharacterController>();
            controller.center = new Vector3(0f, 1f, 0f);
            controller.height = 2f;
            controller.radius = 0.45f;
            player.AddComponent<SimpleKeyboardPlayerMover>();

            Renderer renderer = player.GetComponent<Renderer>();
            renderer.sharedMaterial.color = new Color(0.2f, 0.55f, 1f);
            return player;
        }

        private static GameObject CreateEnemy(Transform player)
        {
            GameObject enemy = GameObject.CreatePrimitive(PrimitiveType.Capsule);
            enemy.name = "Enemy";
            enemy.transform.position = new Vector3(0f, 1f, 0f);

            NavMeshAgent agent = enemy.AddComponent<NavMeshAgent>();
            agent.speed = 3.5f;
            agent.acceleration = 12f;
            agent.angularSpeed = 720f;
            agent.stoppingDistance = 0.05f;

            enemy.AddComponent<EnemyTargetDetector>();
            enemy.AddComponent<EnemyAIController>();

            Renderer renderer = enemy.GetComponent<Renderer>();
            renderer.sharedMaterial.color = new Color(1f, 0.25f, 0.25f);
            return enemy;
        }

        private static Transform CreatePatrolPath()
        {
            GameObject pathRoot = new GameObject("PatrolPath");
            EnemyPatrolPath path = pathRoot.AddComponent<EnemyPatrolPath>();

            CreatePatrolPoint(pathRoot.transform, "Point_A", new Vector3(-4f, 0.1f, -2f));
            CreatePatrolPoint(pathRoot.transform, "Point_B", new Vector3(-4f, 0.1f, 4f));
            CreatePatrolPoint(pathRoot.transform, "Point_C", new Vector3(4f, 0.1f, 4f));
            CreatePatrolPoint(pathRoot.transform, "Point_D", new Vector3(4f, 0.1f, -2f));

            EditorUtility.SetDirty(path);
            return pathRoot.transform;
        }

        private static void CreatePatrolPoint(Transform parent, string name, Vector3 position)
        {
            GameObject point = new GameObject(name);
            point.transform.SetParent(parent);
            point.transform.position = position;
        }

        private static void ConfigureEnemy(GameObject enemyObject, Transform player, EnemyPatrolPath patrolPath)
        {
            EnemyAIController controller = enemyObject.GetComponent<EnemyAIController>();
            SerializedObject serializedController = new SerializedObject(controller);
            serializedController.FindProperty("player").objectReferenceValue = player;
            serializedController.FindProperty("patrolPath").objectReferenceValue = patrolPath;
            serializedController.ApplyModifiedPropertiesWithoutUndo();

            EnemyTargetDetector detector = enemyObject.GetComponent<EnemyTargetDetector>();
            SerializedObject serializedDetector = new SerializedObject(detector);
            serializedDetector.FindProperty("detectionRadius").floatValue = 5.5f;
            serializedDetector.FindProperty("loseTargetRadiusMultiplier").floatValue = 1.5f;
            serializedDetector.ApplyModifiedPropertiesWithoutUndo();
        }

        private static void CreateValidationRunner(EnemyAIController enemy, Transform player, SimpleKeyboardPlayerMover mover)
        {
            GameObject farResetPoint = new GameObject("FarResetPoint");
            farResetPoint.transform.position = new Vector3(0f, 1f, -10f);

            GameObject runnerObject = new GameObject("DemoValidationRunner");
            EnemyAIDemoValidationRunner runner = runnerObject.AddComponent<EnemyAIDemoValidationRunner>();

            SerializedObject serializedRunner = new SerializedObject(runner);
            serializedRunner.FindProperty("enemy").objectReferenceValue = enemy;
            serializedRunner.FindProperty("player").objectReferenceValue = player;
            serializedRunner.FindProperty("playerMover").objectReferenceValue = mover;
            serializedRunner.FindProperty("farResetPoint").objectReferenceValue = farResetPoint.transform;
            serializedRunner.ApplyModifiedPropertiesWithoutUndo();
        }

        private static void CreateNavMeshBootstrap(MeshFilter groundMeshFilter)
        {
            GameObject bootstrapObject = new GameObject("RuntimeNavMeshBootstrap");
            RuntimeNavMeshBootstrap bootstrap = bootstrapObject.AddComponent<RuntimeNavMeshBootstrap>();

            SerializedObject serializedBootstrap = new SerializedObject(bootstrap);
            serializedBootstrap.FindProperty("groundMeshFilter").objectReferenceValue = groundMeshFilter;
            serializedBootstrap.FindProperty("buildBoundsCenter").vector3Value = new Vector3(0f, 0f, 0f);
            serializedBootstrap.FindProperty("buildBoundsSize").vector3Value = new Vector3(40f, 10f, 40f);
            serializedBootstrap.ApplyModifiedPropertiesWithoutUndo();
        }
    }
}