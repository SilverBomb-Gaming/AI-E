"""Offline tests: no model, GPU, desktop, network, or process interaction."""
import unittest

from movie_mode.manifest import validate_manifest


def valid_project(category="movie"):
    return {
        "schema_version": 1,
        "project_id": "silver-001",
        "title": "Pilot",
        "category": category,
        "scenes": [
            {"scene_id": "s01", "shots": [
                {"shot_id": "sh01", "duration_seconds": 4.5}
            ]}
        ],
    }


class ManifestValidationTests(unittest.TestCase):
    def test_all_categories(self):
        for category in ("movie", "tv_show", "music_video"):
            with self.subTest(category=category):
                self.assertEqual(validate_manifest(valid_project(category)), ())

    def test_rejects_invalid_root(self):
        self.assertTrue(validate_manifest(None))

    def test_rejects_unsupported_category(self):
        payload = valid_project("advertisement")
        self.assertIn("category", [error.field for error in validate_manifest(payload)])

    def test_rejects_duplicate_shots_across_scenes(self):
        payload = valid_project()
        payload["scenes"].append({
            "scene_id": "s02",
            "shots": [{"shot_id": "sh01", "duration_seconds": 3}],
        })
        self.assertIn("scenes[1].shots[0].shot_id", [e.field for e in validate_manifest(payload)])

    def test_rejects_invalid_duration(self):
        for duration in (0, -1, True, "4", 601):
            with self.subTest(duration=duration):
                payload = valid_project()
                payload["scenes"][0]["shots"][0]["duration_seconds"] = duration
                self.assertTrue(validate_manifest(payload))

    def test_rejects_missing_shots(self):
        payload = valid_project()
        del payload["scenes"][0]["shots"]
        self.assertTrue(validate_manifest(payload))


if __name__ == "__main__":
    unittest.main()
