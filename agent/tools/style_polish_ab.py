"""作者侧精品润色的离线盲选 A/B 驱动器。

它只评估独立的完整段落润色，不推断玩家多回合游玩的质量。每个固定原创场景
分别运行三次：A 为未改动的 ``POLISH_SYSTEM`` 单次基线，B 为
``polish_with_style_review`` 闭环候选；展示位置随机交换。输出写入已忽略的
``tools/out/``，其中盲选文件不包含 mapping，供人工按自然度、人物声音、具体性和
节奏做强制二选一；私有 mapping 用于之后汇总 Candidate 胜率与锚点核验。

用法（在 agent/ 下）：
    ./.venv/Scripts/python.exe tools/style_polish_ab.py --llm-config-file C:/secure/llm.json

llm.json 只含本次调用所需的 OpenAI 兼容配置：
    {"provider":"...","base_url":"https://...","api_key":"...","model":"..."}

真实模型输出、随机 mapping 与人工选择均不进入 Git。验收：Candidate 至少胜 15/24，
且逐组按夹具 anchors 人工核验零丢失。该脚本不自动声称通过这些人工指标。
"""
from __future__ import annotations

import argparse
import json
import random
import sys
from datetime import datetime
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.llm import Usage, chat_json  # noqa: E402
from app.prompts import POLISH_SYSTEM  # noqa: E402
from app.routers.assist import polish_with_style_review  # noqa: E402
from app.schemas import PolishRequest  # noqa: E402

ROOT = Path(__file__).resolve().parent
CASES_PATH = ROOT / "style_polish_cases.json"
OUT_DIR = ROOT / "out"
RUNS_PER_CASE = 3


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="生成作者侧精品润色盲选 A/B 文件")
    parser.add_argument(
        "--llm-config-file",
        type=Path,
        required=True,
        help="包含 provider/base_url/api_key/model 的本地 JSON 文件；不要放在仓库内。",
    )
    parser.add_argument("--seed", type=int, help="可复现实验位置随机化；默认使用系统随机数。")
    return parser.parse_args()


def load_object(path: Path, label: str) -> dict[str, Any]:
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise SystemExit(f"无法读取 {label}: {error}") from error
    if not isinstance(raw, dict):
        raise SystemExit(f"{label} 必须是 JSON 对象")
    return raw


def load_cases() -> list[dict[str, Any]]:
    try:
        raw = json.loads(CASES_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise SystemExit(f"无法读取场景夹具: {error}") from error
    if not isinstance(raw, list) or len(raw) != 8:
        raise SystemExit("场景夹具必须恰有 8 个场景")
    required = {"id", "title", "text", "instruction", "world", "anchors"}
    for case in raw:
        if not isinstance(case, dict) or not required.issubset(case):
            raise SystemExit("场景夹具缺少必填字段")
    return raw


def baseline_text(case: dict[str, Any], llm: dict[str, Any]) -> tuple[str, dict[str, Any]]:
    user = ""
    if case["instruction"]:
        user += f"润色要求：{case['instruction']}\n\n"
    user += f"原文：\n{case['text']}"
    usage = Usage()
    try:
        data = chat_json(POLISH_SYSTEM, user, temperature=0.7, llm_cfg=llm, usage_out=usage)
        text = str(data.get("text", "")).strip()
    except Exception as error:  # noqa: BLE001
        return case["text"], {"fallback": True, "error": type(error).__name__, "usage": dict(usage)}
    if not text:
        return case["text"], {"fallback": True, "error": "empty_text", "usage": dict(usage)}
    return text, {"fallback": False, "usage": dict(usage)}


def candidate_text(case: dict[str, Any], llm: dict[str, Any]) -> tuple[str, dict[str, Any]]:
    draft = polish_with_style_review(
        PolishRequest(
            text=case["text"],
            instruction=case["instruction"],
            world=case["world"],
            llm=llm,
        )
    )
    return draft.text, {
        "applied": draft.applied,
        "feedback": [issue.model_dump() for issue in draft.feedback],
        "usage": draft.usage.model_dump(),
    }


def main() -> None:
    args = parse_args()
    llm = load_object(args.llm_config_file, "LLM 配置")
    missing = [key for key in ("base_url", "api_key", "model") if not str(llm.get(key, "")).strip()]
    if missing:
        raise SystemExit("LLM 配置缺少: " + ", ".join(missing))
    cases = load_cases()
    rng = random.Random(args.seed) if args.seed is not None else random.SystemRandom()
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    blind: list[dict[str, Any]] = []
    mapping: list[dict[str, Any]] = []

    for case in cases:
        for run in range(1, RUNS_PER_CASE + 1):
            baseline, baseline_meta = baseline_text(case, llm)
            candidate, candidate_meta = candidate_text(case, llm)
            position = ["baseline", "candidate"]
            rng.shuffle(position)
            versions = {"baseline": baseline, "candidate": candidate}
            pair_id = f"{case['id']}-{run}"
            blind.append(
                {
                    "pair_id": pair_id,
                    "scenario": case["title"],
                    "criteria": ["自然度", "人物声音", "具体性", "节奏"],
                    "instruction": "请只选 A 或 B；不得选择平局。随后逐项核验 anchors 是否全部保留。",
                    "anchors": case["anchors"],
                    "A": versions[position[0]],
                    "B": versions[position[1]],
                }
            )
            mapping.append(
                {
                    "pair_id": pair_id,
                    "A": position[0],
                    "B": position[1],
                    "baseline": baseline_meta,
                    "candidate": candidate_meta,
                    "anchors": case["anchors"],
                }
            )
            print(f"完成 {pair_id}")

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    blind_path = OUT_DIR / f"style_polish_blind_{stamp}.json"
    mapping_path = OUT_DIR / f"style_polish_mapping_{stamp}.json"
    blind_path.write_text(json.dumps(blind, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    mapping_path.write_text(json.dumps(mapping, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"已生成 24 组盲选：{blind_path}")
    print(f"私有 mapping：{mapping_path}")
    print("人工验收门槛：Candidate 至少胜 15/24，且 anchors 零丢失。")


if __name__ == "__main__":
    main()
