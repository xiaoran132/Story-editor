"""真实样本采集：在进程内直接驱动 run_start/run_continue，收集 story.metrics 埋点并聚合。

不经 HTTP、不碰数据库（agent 本就无 DB 依赖），因此 INFO 级 story.metrics 不会被
uvicorn 默认日志配置吞掉。会真实调用 DeepSeek，产生费用与耗时。

用法（在 agent/ 目录下）：
    ./.venv/Scripts/python.exe tools/sample_metrics.py [每个世界的续写轮数=3]

输出：逐条埋点 + 末尾聚合（首稿通过率 / 平均重写次数 / 延迟均值与 p95 / 超限率）。
"""
from __future__ import annotations

import logging
import statistics
import sys
from pathlib import Path

# 允许 `python tools/sample_metrics.py` 直接运行时找到 app 包
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

# 采集 story.metrics 的结构化行 —— 必须在 import story_graph 前配好 root handler
_METRICS: list[dict[str, str]] = []   # gen 行：每次生成流的最终结果
_REVIEWS: list[str] = []              # review 行：逐次审校判定（含拒绝理由）


def _parse_fields(msg: str) -> dict[str, str]:
    """把 logfmt 行拆成 key=value；detail/issues 里可能含空格，取到行尾。"""
    fields: dict[str, str] = {}
    tokens = msg.split()
    for i, tok in enumerate(tokens):
        if "=" not in tok:
            continue
        k, v = tok.split("=", 1)
        if k in ("detail", "issues"):  # 尾字段，吞掉后续所有 token
            fields[k] = msg.split(f"{k}=", 1)[1]
            break
        fields[k] = v
    return fields


class _Collector(logging.Handler):
    def emit(self, record: logging.LogRecord) -> None:
        msg = record.getMessage()
        if msg.startswith("gen "):
            _METRICS.append(_parse_fields(msg))
        elif msg.startswith("review "):
            _REVIEWS.append(msg[len("review "):])


logging.basicConfig(level=logging.INFO, format="%(name)s %(message)s", stream=sys.stderr)
logging.getLogger("story.metrics").addHandler(_Collector())

from app.graph.story_graph import run_continue, run_start  # noqa: E402

# 三个不同题材/属性类型的世界观，尽量覆盖 number/scalar/set 与不同风格
WORLDS: list[dict] = [
    {
        "background": "末世废土，玩家是独行的拾荒者，在辐射废都寻找净水源。",
        "style": "冷硬、紧张、资源稀缺",
        "rules": "每个选择都应消耗或获得资源；危险选择要有明确代价。",
        "characters": [{"name": "老K", "desc": "神秘的电台声音，提供情报也隐藏动机"}],
        "initial_state": {"hp": 100, "water": 3, "location": "废都入口", "items": ["生锈匕首"]},
        "attributes": {
            "hp": {"type": "number"}, "water": {"type": "number"},
            "location": {"type": "scalar"}, "items": {"type": "set"},
        },
    },
    {
        "background": "江湖武侠，玩家是初出茅庐的少年剑客，卷入门派恩怨。",
        "style": "写意、快意恩仇、留白",
        "rules": "武功与声望互相影响；重要抉择要牵动人物关系。",
        "characters": [{"name": "苏挽月", "desc": "亦敌亦友的女侠，身负血仇"}],
        "initial_state": {"internal_power": 10, "reputation": 0, "location": "客栈", "skills": ["基础剑法"]},
        "attributes": {
            "internal_power": {"type": "number"}, "reputation": {"type": "number"},
            "location": {"type": "scalar"}, "skills": {"type": "set"},
        },
    },
    {
        "background": "近未来赛博都市，玩家是接单的义体黑客，被卷进一桩企业阴谋。",
        "style": "霓虹、悬疑、道德灰色",
        "rules": "金钱与警戒度此消彼长；黑入行为提升风险。",
        "characters": [{"name": "Echo", "desc": "AI 助手，逐渐显露自我意识"}],
        "initial_state": {"credits": 500, "heat": 0, "location": "地下诊所", "implants": ["神经接口"]},
        "attributes": {
            "credits": {"type": "number"}, "heat": {"type": "number"},
            "location": {"type": "scalar"}, "implants": {"type": "set"},
        },
    },
]


def _first_option_text(result: dict) -> str:
    opts = result.get("options") or []
    if opts and isinstance(opts[0], dict):
        return str(opts[0].get("text") or "继续前进")
    return "继续前进"


def _play_one_world(world: dict, rounds: int) -> None:
    """一次开局 + rounds 轮续写，按第一个推荐选项推进，构建带 summary 的历史。"""
    initial = world["initial_state"]
    try:
        opening = run_start(world, initial)
    except Exception as e:  # 已在埋点里记为 error；这里仅中断本世界
        print(f"[skip] 开局失败：{e}", file=sys.stderr)
        return

    # history 首步 = 开局节点（choice_text 为空，对齐后端根节点）
    history = [{"choice_text": "", "content": opening.get("content", ""), "summary": opening.get("summary", "")}]
    state = dict(initial)
    prev = opening

    for _ in range(rounds):
        if prev.get("is_ending"):
            break
        choice = _first_option_text(prev)
        try:
            nxt = run_continue(world, history, state, choice)
        except Exception as e:
            print(f"[skip] 续写失败：{e}", file=sys.stderr)
            return
        # 合并 state_delta（此处仅为让后续上下文的 current_state 有变化，不做严格类型合并）
        for k, v in (nxt.get("state_delta") or {}).items():
            if isinstance(v, (int, float)) and isinstance(state.get(k), (int, float)):
                state[k] = state[k] + v
            else:
                state[k] = v
        history.append({"choice_text": choice, "content": nxt.get("content", ""), "summary": nxt.get("summary", "")})
        prev = nxt


def _p95(xs: list[float]) -> float:
    if not xs:
        return 0.0
    s = sorted(xs)
    # 最近秩法，样本少时稳妥
    idx = max(0, min(len(s) - 1, round(0.95 * (len(s) - 1))))
    return s[idx]


def _aggregate() -> None:
    total = len(_METRICS)
    if total == 0:
        print("\n没有采集到任何埋点。", file=sys.stderr)
        return
    ok = [m for m in _METRICS if m.get("outcome") == "ok"]
    errs = [m for m in _METRICS if m.get("outcome") != "ok"]
    err_by_kind: dict[str, int] = {}
    for m in errs:
        err_by_kind[m.get("outcome", "error")] = err_by_kind.get(m.get("outcome", "error"), 0) + 1
    elapsed = [float(m["elapsed_ms"]) for m in _METRICS if "elapsed_ms" in m]
    ok_elapsed = [float(m["elapsed_ms"]) for m in ok if "elapsed_ms" in m]
    first_pass = [m for m in ok if m.get("first_draft_pass") == "True"]
    retries = [int(m["review_failures"]) for m in ok if "review_failures" in m]

    rejects = [r for r in _REVIEWS if "verdict=reject" in r]
    review_total = len(_REVIEWS)

    print("\n" + "=" * 52)
    print("真实样本聚合（story.metrics）")
    print("=" * 52)
    print(f"总样本        : {total}  (ok={len(ok)}, error={len(errs)})")
    if errs:
        kinds = ", ".join(f"{k}={v}" for k, v in sorted(err_by_kind.items()))
        print(f"报错率         : {len(errs) / total:.0%}  [{kinds}]")
    else:
        print("报错率         : 0%")
    if ok:
        print(f"首稿通过率     : {len(first_pass) / len(ok):.0%}  ({len(first_pass)}/{len(ok)})")
    if retries:
        print(f"平均重写次数   : {statistics.mean(retries):.2f}  (max={max(retries)})")
    if review_total:
        print(f"审校拒绝率     : {len(rejects) / review_total:.0%}  ({len(rejects)}/{review_total} 次审校)")
    if elapsed:
        print(f"完整回复延迟   : 均值 {statistics.mean(elapsed) / 1000:.1f}s  "
              f"p95 {_p95(elapsed) / 1000:.1f}s  (全部样本)")
    if ok_elapsed:
        print(f"  仅成功样本   : 均值 {statistics.mean(ok_elapsed) / 1000:.1f}s  p95 {_p95(ok_elapsed) / 1000:.1f}s")
    print("注：无流式，首字延迟不可测。")
    if rejects:
        print("\n审校拒绝理由（用于判断门槛是否形同橡皮图章）：")
        for r in rejects:
            print(f"  - {r}")


def main() -> None:
    rounds = int(sys.argv[1]) if len(sys.argv) > 1 else 3
    print(f"采样开始：{len(WORLDS)} 个世界 × (1 开局 + {rounds} 续写)\n", file=sys.stderr)
    for i, world in enumerate(WORLDS, 1):
        print(f"--- 世界 {i}/{len(WORLDS)}：{world['style']} ---", file=sys.stderr)
        _play_one_world(world, rounds)
    _aggregate()


if __name__ == "__main__":
    main()
