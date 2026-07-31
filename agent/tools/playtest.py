"""多回合游玩转录：进程内直驱 agent，对后端已 seed 的丰富作品跑若干回合，
把每回合的正文/选项/属性变化/摘要完整转录，用于人读评估叙事质量与玩法深度。

用法（agent/ 下）：
    ./.venv/Scripts/python.exe tools/playtest.py [每部回合数=5]
"""
from __future__ import annotations

import json
import logging
import sys
import urllib.request as u
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
logging.getLogger("story.metrics").addHandler(logging.NullHandler())

# run_start/run_continue 现为流式管线的同步 drain 适配器（drain 逻辑在 story_graph 内复用）。
from app.graph.story_graph import run_continue, run_start  # noqa: E402

BACKEND = "http://localhost:8080/api/v1"


def merge(state: dict, delta: dict | None) -> dict:
    for k, v in (delta or {}).items():
        if isinstance(v, (int, float)) and isinstance(state.get(k), (int, float)):
            state[k] = state[k] + v
        elif isinstance(v, dict) and ("add" in v or "remove" in v):
            cur = list(state.get(k) or [])
            for x in v.get("remove", []):
                if x in cur:
                    cur.remove(x)
            for x in v.get("add", []):
                if x not in cur:
                    cur.append(x)
            state[k] = cur
        else:
            state[k] = v
    return state


def main() -> None:
    rounds = int(sys.argv[1]) if len(sys.argv) > 1 else 5
    stories = json.load(u.urlopen(BACKEND + "/stories/"))["data"]
    rich = [s for s in stories if not s["opening_content"]]  # AI 开局的丰富作品

    for s in rich:
        w = json.loads(s["world_config"])
        init = w.get("initial_state", {})
        print("=" * 72)
        print("作品:", s["title"])
        print("=" * 72)
        op = run_start(w, init)
        print("\n【开局】\n" + op["content"])
        print("选项:", [o["text"] for o in op["options"]])
        print("初始 state:", init)
        print("summary:", op.get("summary", ""))
        hist = [{"choice_text": "", "content": op["content"], "summary": op.get("summary", "")}]
        state = dict(init)
        prev = op
        for r in range(1, rounds + 1):
            if prev.get("is_ending"):
                print(f"\n[第{r-1}回合到达结局，停止]")
                break
            ch = prev["options"][0]["text"] if prev["options"] else "仔细观察周围，谨慎行事"
            nx = run_continue(w, hist, state, ch)
            state = merge(state, nx.get("state_delta"))
            print(f"\n【第{r}回合 · 选择:{ch}】\n" + nx["content"])
            print("选项:", [o["text"] for o in nx["options"]])
            print("delta:", nx.get("state_delta"), "| state:", state)
            print("summary:", nx.get("summary", ""))
            hist.append({"choice_text": ch, "content": nx["content"], "summary": nx.get("summary", "")})
            prev = nx
        print()
    print("PLAYTEST_DONE")


if __name__ == "__main__":
    main()
