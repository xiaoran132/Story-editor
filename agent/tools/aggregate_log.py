"""真人埋点聚合器：读 agent 服务日志，把 story.metrics 的 gen/review 打点聚合成一张报表。

与 sample_metrics.py 的分工——
- sample_metrics.py：**自动线性采样**，进程内直驱 run_start/continue 现造数据（会调 DeepSeek）。
  只能刷出漂亮数字，触发不了三大拒因（见记忆/handoff §9.2），对提示词质量改动无区分力。
- 本脚本：**零依赖离线**，只读**真人真实游玩**产生的日志文件，不碰 app/DB/LLM/网络。
  真人的矛盾选择/回溯/深剧情才会让 summary 漂移、delta 对不上、选项无后果真正发作，
  这才是给提示词质量“结账”的样本来源。

日志来源：起全套三进程真人游玩后，把 agent 进程（uvicorn）的输出重定向到文件即可，
例如：`uvicorn app.main:app --port 8001 > agent.log 2>&1`。main.py 已给 story.metrics
挂了带时间戳的 handler，行形如：
    2026-08-03 11:20:33,123 story.metrics gen mode=continue outcome=ok stream=1 depth=7 elapsed_ms=8200 ttfb_ms=1100 review_failures=1 first_draft_pass=False degraded=False is_ending=False
    2026-08-03 11:20:31,050 story.metrics review verdict=reject depth=7 attempt=1 issues=state_delta 与正文不一致

用法（agent/ 下）：
    ./.venv/Scripts/python.exe tools/aggregate_log.py agent.log [more.log ...]
    cat agent.log | ./.venv/Scripts/python.exe tools/aggregate_log.py      # 或从 stdin
"""
from __future__ import annotations

import re
import statistics
import sys
from collections import Counter
from pathlib import Path

# 从任意前缀（时间戳/logger 名）里切出打点正文；打点正文总在行尾。
_GEN = re.compile(r"(gen mode=.*)$")
_REVIEW = re.compile(r"(review verdict=.*)$")


def _parse_fields(msg: str) -> dict[str, str]:
    """logfmt 行拆 key=value；detail/issues 含空格，取到行尾。（同 sample_metrics）"""
    fields: dict[str, str] = {}
    for tok in msg.split():
        if "=" not in tok:
            continue
        k, v = tok.split("=", 1)
        if k in ("detail", "issues"):  # 尾字段，吞掉后续全部
            fields[k] = msg.split(f"{k}=", 1)[1]
            break
        fields[k] = v
    return fields


def _p95(xs: list[float]) -> float:
    if not xs:
        return 0.0
    s = sorted(xs)
    return s[max(0, min(len(s) - 1, round(0.95 * (len(s) - 1))))]


def _stat(xs: list[float]) -> str:
    if not xs:
        return "—"
    return f"均值 {statistics.mean(xs) / 1000:.1f}s  p95 {_p95(xs) / 1000:.1f}s  (n={len(xs)})"


def _depth_bucket(v: str) -> str | None:
    """depth 字段 → 分桶标签；行里没有 depth（老日志）返回 None，不计入深度分解。"""
    if not v.lstrip("-").isdigit():
        return None
    d = int(v)
    if d <= 5:
        return "00-05"
    if d <= 10:
        return "06-10"
    if d <= 20:
        return "11-20"
    return "21+"


def _read_lines(paths: list[str]):
    if not paths:
        yield from sys.stdin
        return
    for p in paths:
        text = Path(p).read_text(encoding="utf-8", errors="replace")
        yield from text.splitlines()


def main() -> None:
    paths = sys.argv[1:]
    gens: list[dict[str, str]] = []
    reviews: list[dict[str, str]] = []
    for line in _read_lines(paths):
        if m := _GEN.search(line):
            gens.append(_parse_fields(m.group(1)[len("gen "):]))
        elif m := _REVIEW.search(line):
            reviews.append(_parse_fields(m.group(1)[len("review "):]))

    src = "、".join(paths) if paths else "stdin"
    if not gens and not reviews:
        print(f"没有从 [{src}] 解析到任何 gen/review 打点。\n"
              "确认日志确实来自 agent 进程、且 story.metrics 的 INFO 未被吞掉。", file=sys.stderr)
        sys.exit(1)

    ok = [g for g in gens if g.get("outcome") == "ok"]
    errs = [g for g in gens if g.get("outcome") != "ok"]
    first_pass = [g for g in ok if g.get("first_draft_pass") == "True"]
    degraded = [g for g in ok if g.get("degraded") == "True"]
    endings = [g for g in ok if g.get("is_ending") == "True"]
    retries = [int(g["review_failures"]) for g in ok if g.get("review_failures", "").lstrip("-").isdigit()]

    def _nums(field: str, pool: list[dict[str, str]]) -> list[float]:
        out = []
        for g in pool:
            v = g.get(field)
            if v and v.lstrip("-").isdigit() and int(v) >= 0:
                out.append(float(v))
        return out

    elapsed_all = _nums("elapsed_ms", gens)
    ttfb = _nums("ttfb_ms", [g for g in gens if g.get("stream") == "1"])

    rejects = [r for r in reviews if r.get("verdict") == "reject"]

    print("=" * 56)
    print(f"真人埋点聚合 · 来源：{src}")
    print("=" * 56)
    print(f"总生成数      : {len(gens)}  (ok={len(ok)}, error={len(errs)})")
    if errs:
        kinds = ", ".join(f"{k}={v}" for k, v in Counter(g.get("outcome", "error") for g in errs).items())
        print(f"报错率        : {len(errs)/len(gens):.0%}  [{kinds}]")
    else:
        print("报错率        : 0%")

    if ok:
        print(f"首稿通过率    : {len(first_pass)/len(ok):.0%}  ({len(first_pass)}/{len(ok)})")
        print(f"降级交付占比  : {len(degraded)/len(ok):.0%}  ({len(degraded)}/{len(ok)})")
        print(f"到达结局数    : {len(endings)}")
    if retries:
        print(f"平均重写次数  : {statistics.mean(retries):.2f}  (max={max(retries)})")
    if reviews:
        print(f"审校拒绝率    : {len(rejects)/len(reviews):.0%}  ({len(rejects)}/{len(reviews)} 次审校)")

    # 按 mode（start/continue）分解首稿通过率
    if ok:
        print("\n按 mode 分解（仅 ok）：")
        for mode in sorted({g.get("mode", "?") for g in ok}):
            sub = [g for g in ok if g.get("mode") == mode]
            fp = sum(1 for g in sub if g.get("first_draft_pass") == "True")
            print(f"  {mode:9s}: 首稿过 {fp}/{len(sub)}  ({fp/len(sub):.0%})")

    # 按深度分桶：阶段二触发判据的信号在这里（external-lessons §2.0）——
    # 「与前情矛盾」拒因/降级率随深度上升（深段 ≥ 前 5 回合段 2 倍）则该拆 Recall Cues。
    # 老 gen 行没有 depth 字段，不计入（桶内 n 与总数对不上时先看日志新旧）。
    buckets = sorted({b for g in gens if (b := _depth_bucket(g.get("depth", "")))})
    if buckets:
        print("\n按回合深度分解（判据见 docs/external-lessons.md §2.0）：")
        rej_by_depth: Counter[str] = Counter(
            b for r in rejects if (b := _depth_bucket(r.get("depth", "")))
        )
        for b in buckets:
            sub = [g for g in gens if _depth_bucket(g.get("depth", "")) == b]
            sub_ok = [g for g in sub if g.get("outcome") == "ok"]
            fp = sum(1 for g in sub_ok if g.get("first_draft_pass") == "True")
            dg = sum(1 for g in sub_ok if g.get("degraded") == "True")
            line = f"  回合 {b}: n={len(sub)}"
            if sub_ok:
                line += f"  首稿过 {fp}/{len(sub_ok)} ({fp/len(sub_ok):.0%})  降级 {dg} ({dg/len(sub_ok):.0%})"
            if rej_by_depth.get(b):
                line += f"  拒绝 {rej_by_depth[b]} 次"
            print(line)

    print("\n延迟：")
    print(f"  完整回复    : {_stat(elapsed_all)}")
    print(f"  首字(ttfb)  : {_stat(ttfb)}")

    if rejects:
        print("\n审校拒因分布（判断门槛是否形同橡皮图章、哪类拒因最高频）：")
        reasons = Counter(r.get("issues", "(无理由)") for r in rejects)
        for reason, cnt in reasons.most_common():
            print(f"  ×{cnt}  {reason}")


if __name__ == "__main__":
    main()
