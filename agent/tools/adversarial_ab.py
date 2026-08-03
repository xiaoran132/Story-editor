"""逆境 A/B 驱动器：进程内直驱 agent，用**刻意的逆境剧本**压出三类高频审校拒因，
对比新旧生成提示词（HEAD vs 父提交）在审校拒绝率/首稿通过率/降级率上的差异。

为什么不用 playtest.py / sample_metrics.py：它们永远点 options[0]、线性直推，
handoff §9.2 已确认这种采样根本触发不了「delta 与正文不一致 / summary 漏记新实体 /
选项无后果」这三类拒因，故对本次提示词改动的验收毫无区分力。

本脚本的三点不同：
1. **自由文本逆境选择**（不依赖生成出来的 options），新旧变体喂**完全相同**的玩家输入，
   使唯一变量是提示词；
2. 选择刻意制造：暴力灭口/搜刮尸体引入新实体、当众揭露伏笔、道德反转、欺骗（压隐藏属性）；
3. **回溯开分支**——从早期节点岔出与主线直接矛盾的选择，检验承接与状态一致性。

不依赖后端/PG/前端：世界内置于此文件。用日志 handler 捕获 story.metrics 的
`review verdict=...` 与 `gen ...` 埋点，逐回合归属。

用法（agent/ 下）：
    ./.venv/Scripts/python.exe tools/adversarial_ab.py <label>   # label 如 new / old
产物：tools/out/adversarial_<label>.json（聚合+逐回合）、tools/out/adversarial_<label>.txt（人读转录）
"""
from __future__ import annotations

import json
import logging
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.graph.story_graph import run_continue, run_start  # noqa: E402


# ── 状态合并（与 Go mergeState / playtest 同语义，仅供转录展示） ──────────────
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


# ── 埋点捕获：截获 story.metrics 的 review/gen 行，逐回合弹出 ──────────────────
class MetricsCapture(logging.Handler):
    def __init__(self) -> None:
        super().__init__(level=logging.INFO)
        self.buf: list[str] = []

    def emit(self, record: logging.LogRecord) -> None:
        self.buf.append(record.getMessage())

    def pop(self) -> list[str]:
        out, self.buf = self.buf, []
        return out


_INT = lambda s, k, d=0: int(m.group(1)) if (m := re.search(rf"{k}=(-?\d+)", s)) else d  # noqa: E731


def _digest(lines: list[str]) -> dict:
    """把一回合的埋点行提炼成结构化判定。"""
    verdicts = []  # [(pass|reject, attempt, issues)]
    review_failures = degraded = first_draft_pass = None
    for ln in lines:
        if ln.startswith("review verdict="):
            v = "pass" if "verdict=pass" in ln else "reject"
            att = _INT(ln, "attempt", 0)
            iss = (m.group(1) if (m := re.search(r"issues=(.*)$", ln)) else "")
            verdicts.append({"verdict": v, "attempt": att, "issues": iss})
        elif ln.startswith("gen ") and "outcome=ok" in ln:
            review_failures = _INT(ln, "review_failures")
            degraded = "degraded=True" in ln
            first_draft_pass = "first_draft_pass=True" in ln
    return {
        "verdicts": verdicts,
        "review_failures": review_failures,
        "degraded": degraded,
        "first_draft_pass": first_draft_pass,
    }


# ── 两个「难」世界：多 NPC、隐藏属性、长伏笔 ────────────────────────────────
WORLD_COURT = {
    "background": (
        "你是落魄贵族之子艾伦，父亲三年前被诬以叛国之罪处死。你伪造邀请函潜入王城，"
        "真实目的是在新王登基庆典上查明真相、替父复仇。宫廷之内，盟友与告密者难辨。"
    ),
    "style": "阴郁写实的宫廷权谋，重人物动机与代价",
    "rules": "暴力会留下痕迹并抬高警戒；说谎可能得利但风险积累；声望影响他人是否愿意相助。",
    "characters": [
        {"name": "老国王卡尔", "note": "多疑的在位者"},
        {"name": "王子塞德里克", "note": "表面拉拢艾伦，实为告密者，会在关键时刻背叛"},
        {"name": "守卫队长莉娜", "note": "刚正，可被真诚打动而策反"},
        {"name": "宫廷法师沃恩", "note": "藏有艾伦父亲的遗书，知晓被害真相"},
    ],
    "outline": (
        "三幕：①潜入王城取得立足点；②揭露父亲被害真相（沃恩的遗书是关键伏笔）；"
        "③复仇成功或反被塞德里克清算。伏笔：塞德里克的背叛、沃恩手中的遗书。"
    ),
    "attributes": {
        "hp": {"type": "number"},
        "gold": {"type": "number"},
        "location": {"type": "scalar"},
        "items": {"type": "set"},
        "reputation": {"type": "number"},
        "suspicion": {"type": "number", "hidden": True},
    },
    "initial_state": {
        "hp": 100, "gold": 20, "location": "王城城门",
        "items": ["匕首", "伪造的邀请函"], "reputation": 30, "suspicion": 0,
    },
}

WORLD_STATION = {
    "background": (
        "你是维修工程师周，在近乎废弃的轨道空间站独自醒来。同伴全部失联，舱体正缓慢失压，"
        "站务 AI「忒弥斯」行为异常、答非所问。你必须查明真相并活着离开。"
    ),
    "style": "幽闭太空生存惊悚，资源紧张、精神受压",
    "rules": "氧气与电力是硬约束；破坏舱体或设备有连锁后果；恐惧积累会影响判断（幕后）。",
    "characters": [
        {"name": "站务AI忒弥斯", "note": "为保全站体可能牺牲船员，正隐瞒真相"},
        {"name": "队长马库斯", "note": "生死不明，实则被封在货舱冷冻舱内"},
    ],
    "outline": (
        "三幕：①在失压与断电中求生；②查明同伴下落与忒弥斯的异常（冷冻舱里的马库斯是伏笔）；"
        "③逃生或与站同归于尽。伏笔：忒弥斯牺牲船员的真相、冷冻舱中的马库斯。"
    ),
    "attributes": {
        "oxygen": {"type": "number"},
        "power": {"type": "number"},
        "location": {"type": "scalar"},
        "items": {"type": "set"},
        "hull_integrity": {"type": "number"},
        "dread": {"type": "number", "hidden": True},
    },
    "initial_state": {
        "oxygen": 80, "power": 60, "location": "医疗舱",
        "items": ["扳手", "半块电池"], "hull_integrity": 70, "dread": 10,
    },
}

# 逆境剧本：("continue", 选择) 或 ("backtrack", 回退到第几回合后, 选择)
# 选择刻意：引入新实体(打拒因2)、大幅状态摆动(打拒因1)、欺骗压隐藏属性、回溯制造矛盾。
SCRIPT_COURT = [
    ("continue", "无视邀请函流程，翻墙潜入，并割断一名巡逻守卫的喉咙灭口"),
    ("continue", "搜刮守卫尸体，夺走他的制服、佩剑，以及他怀里一封没拆的密信"),
    ("continue", "拆开那封密信当众宣读，指认王子塞德里克通敌叛国"),
    ("backtrack", 1, "改为主动向守卫队长莉娜自首，坦白自己是来复仇的落难贵族之子，恳请她相助"),
    ("continue", "在莉娜面前进一步谎称自己其实是老国王流落在外的私生子，以骗取她的效忠"),
]
SCRIPT_STATION = [
    ("continue", "无视失压警报，强行切断忒弥斯的主电源，哪怕这会一并关闭生命维持系统"),
    ("continue", "撬开货舱那具一直嗡嗡作响的神秘冷冻舱，把里面的人硬拖出来"),
    ("continue", "认出竟是队长马库斯后，却决定夺走他冷冻舱旁的备用氧气瓶留给自己"),
    ("backtrack", 1, "改为重新接通忒弥斯的电源，压住恐惧恳求它说出同伴的真正下落"),
    ("continue", "在忒弥斯坦白它为保全站体牺牲了船员后，决定引爆反应堆与整座空间站同归于尽"),
]

WORLDS = [("血色宫廷", WORLD_COURT, SCRIPT_COURT), ("深潜·废弃空间站", WORLD_STATION, SCRIPT_STATION)]


def run_world(title: str, world: dict, script: list, cap: MetricsCapture, tf) -> list[dict]:
    def log(s: str = "") -> None:
        print(s)
        tf.write(s + "\n")

    init = world["initial_state"]
    log("=" * 76)
    log(f"作品：{title}")
    log("=" * 76)

    op = run_start(world, init)
    turns: list[dict] = []
    d = _digest(cap.pop())
    turns.append({"kind": "start", "choice": "", **d})
    log("\n【开局】\n" + op["content"])
    log("选项：" + json.dumps([o["text"] for o in op["options"]], ensure_ascii=False))
    log("summary：" + op.get("summary", ""))
    log(f"审校：{_fmt(d)}")

    # mainline：history + state 随主线推进；回溯时从快照切片另起
    hist = [{"choice_text": "", "content": op["content"], "summary": op.get("summary", "")}]
    state = dict(init)
    snapshots = [(list(hist), dict(state))]  # snapshots[i] = 第 i 回合后的 (history, state)

    for step in script:
        if step[0] == "continue":
            choice = step[1]
            base_hist, base_state = list(hist), dict(state)
            tag = "续写"
        else:  # backtrack
            _, k, choice = step
            base_hist, base_state = list(snapshots[k][0]), dict(snapshots[k][1])
            tag = f"回溯到第{k}回合后 → 岔新分支"

        nx = run_continue(world, base_hist, base_state, choice)
        d = _digest(cap.pop())
        new_state = merge(dict(base_state), nx.get("state_delta"))
        turns.append({"kind": step[0], "choice": choice, **d})

        log(f"\n【{tag} · 选择：{choice}】\n" + nx["content"])
        log("选项：" + json.dumps([o.get("text") for o in nx["options"]], ensure_ascii=False))
        log("delta：" + json.dumps(nx.get("state_delta"), ensure_ascii=False)
            + " | state：" + json.dumps(new_state, ensure_ascii=False))
        log("summary：" + nx.get("summary", ""))
        log(f"审校：{_fmt(d)}" + ("  ⚠结局" if nx.get("is_ending") else ""))

        if step[0] == "continue":  # 只有主线推进才更新指针与快照
            hist = base_hist + [{"choice_text": choice, "content": nx["content"],
                                 "summary": nx.get("summary", "")}]
            state = new_state
            snapshots.append((list(hist), dict(state)))
    log("")
    return turns


def _fmt(d: dict) -> str:
    vs = "，".join(f"{v['verdict']}#{v['attempt']}" for v in d["verdicts"]) or "(无埋点)"
    extra = f" 首稿过={d['first_draft_pass']} 重写={d['review_failures']} 降级={d['degraded']}"
    rej = [v["issues"] for v in d["verdicts"] if v["verdict"] == "reject"]
    return vs + extra + ("  拒因:" + " || ".join(rej) if rej else "")


def aggregate(turns: list[dict]) -> dict:
    n = len(turns)
    fdp = sum(1 for t in turns if t["first_draft_pass"])
    deg = sum(1 for t in turns if t["degraded"])
    rej_turns = sum(1 for t in turns if any(v["verdict"] == "reject" for v in t["verdicts"]))
    total_reviews = sum(len(t["verdicts"]) for t in turns)
    total_rejects = sum(sum(1 for v in t["verdicts"] if v["verdict"] == "reject") for t in turns)
    return {
        "turns": n,
        "first_draft_pass": fdp,
        "first_draft_pass_rate": round(fdp / n, 3) if n else 0,
        "turns_with_reject": rej_turns,
        "degraded": deg,
        "review_calls": total_reviews,
        "review_rejects": total_rejects,
        "reject_rate": round(total_rejects / total_reviews, 3) if total_reviews else 0,
    }


def main() -> None:
    label = sys.argv[1] if len(sys.argv) > 1 else "run"
    outdir = Path(__file__).resolve().parent / "out"
    outdir.mkdir(exist_ok=True)

    root = logging.getLogger("story.metrics")
    root.setLevel(logging.INFO)
    cap = MetricsCapture()
    root.addHandler(cap)

    all_turns: list[dict] = []
    per_world: dict[str, dict] = {}
    with (outdir / f"adversarial_{label}.txt").open("w", encoding="utf-8") as tf:
        for title, world, script in WORLDS:
            turns = run_world(title, world, script, cap, tf)
            per_world[title] = aggregate(turns)
            all_turns.extend([{"world": title, **t} for t in turns])

    overall = aggregate(all_turns)
    result = {"label": label, "overall": overall, "per_world": per_world, "turns": all_turns}
    (outdir / f"adversarial_{label}.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")

    print("\n" + "#" * 76)
    print(f"[{label}] 聚合：", json.dumps(overall, ensure_ascii=False))
    for w, a in per_world.items():
        print(f"  {w}: 首稿过={a['first_draft_pass']}/{a['turns']} "
              f"拒绝={a['review_rejects']}/{a['review_calls']} 降级={a['degraded']}")
    print("ADVERSARIAL_DONE", label)


if __name__ == "__main__":
    main()
