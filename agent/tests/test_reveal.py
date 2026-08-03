"""揭示门控属性（reveal-gated）机制：normalize 白名单 + prepare 注入/抑制。"""
import unittest

from app.graph.story_graph import normalize, prepare

WORLD = {
    "attributes": {
        "物资": {"type": "number", "reveal": True},
        "hp": {"type": "number"},
    },
    "initial_state": {"物资": 5, "hp": 100},
}


class RevealTest(unittest.TestCase):
    def test_normalize_whitelists_revealed(self):
        """revealed 只保留声明为门控的键，丢弃非门控/不存在的键。"""
        st = {
            "raw": {"content": "x", "options": [], "state_delta": {},
                    "summary": "s", "revealed": ["物资", "hp", "幽灵键"]},
            "known_keys": ["物资", "hp"],
            "attr_types": {},
            "reveal_gated": ["物资"],
        }
        self.assertEqual(normalize(st)["result"]["revealed"], ["物资"])

    def test_normalize_defaults_empty(self):
        """无 revealed 字段时归一为空列表。"""
        st = {"raw": {"content": "x"}, "known_keys": [], "attr_types": {}, "reveal_gated": ["物资"]}
        self.assertEqual(normalize(st)["result"]["revealed"], [])

    def test_prepare_injects_pending_until_revealed(self):
        """未揭示时提示词含'未揭示属性'清单；已揭示后不再提示。"""
        p = prepare({"mode": "start", "world": WORLD,
                     "initial_state": WORLD["initial_state"], "revealed_attrs": []})
        self.assertEqual(p["reveal_gated"], ["物资"])
        self.assertIn("未揭示属性", p["user_prompt"])

        p2 = prepare({"mode": "continue", "world": WORLD,
                      "current_state": WORLD["initial_state"], "choice": "x",
                      "revealed_attrs": ["物资"]})
        self.assertNotIn("未揭示属性", p2["user_prompt"])


if __name__ == "__main__":
    unittest.main()
