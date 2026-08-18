"""玩家游玩双配置转录：直驱与线上相同的流式 Agent 编排，转录多回合正文、
选项、属性、摘要、SSE revise 和用量，供人工检查叙事质量与游玩手感。

写手配置必填，供 Writer 与 Structurer 两个阶段共用；审校配置可选。两份配置显式
从仓库外 JSON 文件读取，工具不读取 Agent 默认凭据，也不替 Go 解析连接、平台
扣费或鉴权。传入审校配置时，实际覆盖玩家链路的「Writer 正文流式生成 →
Structurer 生成元数据 → 审校 → 被拒后完整重跑」闭环；省略它只关闭审校，
不关闭结构化生成。

取材于 GET /stories/（只取已发布且没有预设 opening_content 的作品）。干净库会跑空；
先注册、创作并发布至少一部 AI 开局作品。

用法（agent/ 下）：
    ./.venv/Scripts/python.exe tools/playtest.py \
      --write-config-file C:/secure/write.json \
      [--review-config-file C:/secure/review.json] [--rounds 5]

配置文件只含本次调用所需的 OpenAI 兼容配置：
    {"provider":"...","base_url":"https://...","api_key":"...","model":"..."}
不要把含密钥的文件放进仓库。
"""
from __future__ import annotations

import argparse
import asyncio
import json
import sys
import time
import urllib.request as u
from pathlib import Path
from typing import Any, AsyncIterator

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.graph.story_graph import run_continue_stream, run_start_stream  # noqa: E402
from app.schemas import LLMConfig  # noqa: E402

BACKEND = "http://localhost:8080/api/v1"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="转录玩家游玩的 Writer/Structurer/Reviewer 流式链路")
    parser.add_argument(
        "--write-config-file", type=Path, required=True,
        help="Writer 与 Structurer 共用的 provider/base_url/api_key/model 本地 JSON 文件；不要放在仓库内。",
    )
    parser.add_argument(
        "--review-config-file", type=Path,
        help="可选的 Reviewer JSON 配置；未传时只关闭审校，Writer/Structurer 仍会运行。",
    )
    parser.add_argument("--rounds", type=int, default=5, help="每部作品最多续写轮数（默认 5）。")
    parser.add_argument("--backend", default=BACKEND, help=f"作品列表 API（默认 {BACKEND}）。")
    return parser.parse_args()


def load_llm_config(path: Path, label: str) -> dict[str, Any]:
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise SystemExit(f"无法读取{label}配置: {error}") from error
    if not isinstance(raw, dict):
        raise SystemExit(f"{label}配置必须是 JSON 对象")
    try:
        config = LLMConfig.model_validate(raw).model_dump()
    except ValueError as error:
        raise SystemExit(f"{label}配置格式错误: {error}") from error
    missing = [key for key in ("api_key", "base_url", "model") if not config[key].strip()]
    if missing:
        raise SystemExit(f"{label}配置缺少非空字段: {', '.join(missing)}")
    return config


def merge(state: dict[str, Any], delta: dict[str, Any] | None) -> dict[str, Any]:
    for key, value in (delta or {}).items():
        if isinstance(value, (int, float)) and isinstance(state.get(key), (int, float)):
            state[key] = state[key] + value
        elif isinstance(value, dict) and ("add" in value or "remove" in value):
            current = list(state.get(key) or [])
            for item in value.get("remove", []):
                if item in current:
                    current.remove(item)
            for item in value.get("add", []):
                if item not in current:
                    current.append(item)
            state[key] = current
        else:
            state[key] = value
    return state


async def collect_turn(stream: AsyncIterator[dict[str, Any]]) -> tuple[dict[str, Any], dict[str, Any]]:
    """消费一次真实 SSE 内部事件，保留最终稿并记录首字与 revise 次数。"""
    started = time.perf_counter()
    first_delta_ms: int | None = None
    revise_count = 0
    result: dict[str, Any] | None = None
    usage: dict[str, Any] = {}
    async for event in stream:
        event_type = event.get("type")
        if event_type == "delta" and first_delta_ms is None:
            first_delta_ms = round((time.perf_counter() - started) * 1000)
        elif event_type == "revise":
            revise_count += 1
        elif event_type == "done":
            result = event.get("result")
            usage = event.get("usage") or {}
    if not isinstance(result, dict):
        raise RuntimeError("流式管线没有返回 done 结果")
    return result, {
        "ttfb_ms": first_delta_ms,
        "elapsed_ms": round((time.perf_counter() - started) * 1000),
        "revise_count": revise_count,
        "usage": usage,
    }


def _first_option_text(result: dict[str, Any]) -> str:
    options = result.get("options") or []
    if options and isinstance(options[0], dict):
        return str(options[0].get("text") or "继续前进")
    return "继续前进"


def print_turn(label: str, result: dict[str, Any], metrics: dict[str, Any]) -> None:
    print(f"\n【{label}】\n{result.get('content', '')}")
    print("选项:", [option.get("text", "") for option in result.get("options") or []])
    print("summary:", result.get("summary", ""))
    print(
        "流式:",
        f"首字={metrics['ttfb_ms'] if metrics['ttfb_ms'] is not None else '无正文'}ms",
        f"完整={metrics['elapsed_ms']}ms",
        f"revise={metrics['revise_count']}",
        "| write usage（正文 + 结构化）:", json.dumps(metrics["usage"].get("write") or {}, ensure_ascii=False),
        "| review usage:", json.dumps(metrics["usage"].get("review") or {}, ensure_ascii=False),
    )


def main() -> None:
    args = parse_args()
    if args.rounds < 0:
        raise SystemExit("--rounds 不能小于 0")
    llm_write = load_llm_config(args.write_config_file, "写手")
    llm_review = load_llm_config(args.review_config_file, "审校") if args.review_config_file else None
    try:
        payload = json.load(u.urlopen(args.backend + "/stories/"))
    except Exception as error:  # noqa: BLE001 - CLI 需要把网络问题转成可读报错
        raise SystemExit(f"无法读取作品列表: {error}") from error
    stories = payload.get("data") if isinstance(payload, dict) else None
    if not isinstance(stories, list):
        raise SystemExit("作品列表响应缺少 data 数组")
    ai_opening_stories = [story for story in stories if not story.get("opening_content")]
    if not ai_opening_stories:
        print("没有可测的已发布 AI 开局作品。", file=sys.stderr)
        return

    print(
        "游玩测配置:",
        f"写手={llm_write['model']}",
        f"审校={'关闭' if llm_review is None else llm_review['model']}",
    )
    for story in ai_opening_stories:
        try:
            world = json.loads(story["world_config"])
        except (KeyError, TypeError, json.JSONDecodeError) as error:
            print(f"[skip] {story.get('title', '未命名作品')} world_config 无效: {error}", file=sys.stderr)
            continue
        initial = world.get("initial_state") or {}
        print("=" * 72)
        print("作品:", story.get("title", "未命名作品"))
        print("=" * 72)
        try:
            opening, opening_metrics = asyncio.run(
                collect_turn(run_start_stream(world, initial, None, llm_write, llm_review))
            )
        except Exception as error:  # noqa: BLE001 - 继续其他作品，方便一次发现配置问题
            print(f"[skip] 开局失败: {error}", file=sys.stderr)
            continue
        print_turn("开局", opening, opening_metrics)
        print("初始 state:", initial)

        history = [{"choice_text": "", "content": opening.get("content", ""), "summary": opening.get("summary", "")}]
        state = dict(initial)
        previous = opening
        for round_no in range(1, args.rounds + 1):
            if previous.get("is_ending"):
                print(f"\n[第 {round_no - 1} 回合到达结局，停止]")
                break
            choice = _first_option_text(previous)
            try:
                next_result, metrics = asyncio.run(
                    collect_turn(run_continue_stream(world, history, state, choice, None, llm_write, llm_review))
                )
            except Exception as error:  # noqa: BLE001 - 本作品本局失败，但其他样本可继续
                print(f"[skip] 第 {round_no} 回合失败: {error}", file=sys.stderr)
                break
            print_turn(f"第 {round_no} 回合 · 选择: {choice}", next_result, metrics)
            state = merge(state, next_result.get("state_delta"))
            print("delta:", next_result.get("state_delta"), "| state:", state)
            history.append({"choice_text": choice, "content": next_result.get("content", ""), "summary": next_result.get("summary", "")})
            previous = next_result
        print()
    print("PLAYTEST_DONE")


if __name__ == "__main__":
    main()
