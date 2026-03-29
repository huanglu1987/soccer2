from __future__ import annotations

import json
import math
from pathlib import Path


ROOT_DIR = Path(__file__).resolve().parent
CALIBRATION_PATH = ROOT_DIR / "calibration" / "latest.json"

FIXED_COMPANIES = [
    "Bet365",
    "William Hill",
    "Bwin",
    "Interwetten",
    "Pinnacle",
    "BetVictor",
]

OUTCOME_LABELS = {
    "home": "主胜",
    "draw": "平局",
    "away": "客胜",
}

FALLBACK_THRESHOLDS = {
    "drawMinimum": 0.283,
    "drawLeadSlack": 0.014,
    "drawSplitLeadSlack": 0.024,
    "drawHomeAwayGapMax": 0.048,
    "drawDispersionMax": 0.03,
    "strongSingleProbabilityMin": 0.459,
    "strongSingleGapMin": 0.099,
    "strongSingleVoteShareMin": 1.0,
    "strongSingleDrawMax": 0.298,
    "favoriteVoteShareMin": 0.67,
    "sideDrawDoubleMin": 0.281,
    "sideDrawDoubleGapMax": 0.055,
    "splitVoteShareMax": 0.67,
    "homeAwayDoubleGapMax": 0.05,
    "dispersionMin": 0.018,
}


def load_thresholds() -> dict:
    try:
        data = json.loads(CALIBRATION_PATH.read_text(encoding="utf-8"))
        return data.get("selectedThresholds") or FALLBACK_THRESHOLDS
    except Exception:
        return FALLBACK_THRESHOLDS


THRESHOLDS = load_thresholds()


def clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def average(values: list[float]) -> float:
    return sum(values) / len(values)


def standard_deviation(values: list[float]) -> float:
    mean = average(values)
    variance = average([(value - mean) ** 2 for value in values])
    return math.sqrt(variance)


def normalize_probabilities(values: dict[str, float]) -> dict[str, float]:
    total = values["home"] + values["draw"] + values["away"]
    return {
        "home": values["home"] / total,
        "draw": values["draw"] / total,
        "away": values["away"] / total,
    }


def to_probability_row(home_odds: float, draw_odds: float, away_odds: float) -> dict[str, float]:
    return normalize_probabilities(
        {
            "home": 1.0 / home_odds,
            "draw": 1.0 / draw_odds,
            "away": 1.0 / away_odds,
        }
    )


def distance(left: dict[str, float], right: dict[str, float]) -> float:
    return math.sqrt(
        (left["home"] - right["home"]) ** 2
        + (left["draw"] - right["draw"]) ** 2
        + (left["away"] - right["away"]) ** 2
    )


def confidence_label(consensus: float, top_gap: float) -> str:
    if consensus >= 0.79 and top_gap >= 0.175:
        return "高"
    if consensus >= 0.74 and top_gap >= 0.015:
        return "中"
    return "谨慎"


def build_rule_confidence_profile(
    base_confidence: str,
    ranked: list[dict[str, float]],
    final_prob: dict[str, float],
    top_gap: float,
) -> dict[str, str]:
    leader_key = ranked[0]["key"]
    second_key = ranked[1]["key"]
    draw_prob = final_prob["draw"]

    if base_confidence == "高":
        if second_key == "draw":
            if leader_key == "home" and draw_prob < 0.24 and top_gap >= 0.25:
                return {
                    "label": "高-强主",
                    "note": "主胜排第一、平局排第二，而且平局概率较低、前二差值已经明显拉开，这类是高档里最强的主胜结构。",
                }
            if leader_key == "away" and draw_prob < 0.24 and top_gap >= 0.25:
                return {
                    "label": "高-强客",
                    "note": "客胜排第一、平局排第二，而且平局概率较低、前二差值已经明显拉开，这类是高档里最强的客胜结构。",
                }
            if leader_key == "home" and draw_prob < 0.27 and top_gap >= 0.2:
                return {
                    "label": "高-强主",
                    "note": "主胜排第一、平局排第二，且主和平之间已经有足够差距，当前更接近高档强主结构。",
                }
            if leader_key == "away" and draw_prob < 0.27 and top_gap >= 0.2:
                return {
                    "label": "高-强客",
                    "note": "客胜排第一、平局排第二，且客和平之间已经有足够差距，当前更接近高档强客结构。",
                }

        if draw_prob >= 0.281:
            return {
                "label": "高-防平",
                "note": "当前仍处在高档，但平局概率已经被明显抬高，更适合把它理解成高档防平结构，优先考虑 胜/平 或 平/负。",
            }

        return {
            "label": "高-分胜负",
            "note": "当前仍处在高档，但平局相对偏弱、主客两端仍有拉扯，这类更适合按分胜负结构理解，优先考虑 胜/负。",
        }

    if base_confidence == "中":
        if second_key == "draw":
            if top_gap < 0.1 or draw_prob >= 0.3:
                return {
                    "label": "中-偏平",
                    "note": "平局排第二且和第一名接近，或平局概率已明显抬高，优先按平局候选理解。",
                }
            return {
                "label": "中-偏主" if leader_key == "home" else "中-偏客",
                "note": "平局虽然排第二，但第一名仍保持领先，当前更适合按单边方向加防平来理解。",
            }

        if leader_key == "home":
            if top_gap >= 0.1:
                return {
                    "label": "中-偏主",
                    "note": "主胜排第一且前二差值已有一定拉开，当前更偏向主队。",
                }
            if draw_prob >= 0.28:
                return {
                    "label": "中-偏平",
                    "note": "虽然主胜排第一，但差值不大且平局概率不低，建议把平局作为更强候选。",
                }
            return {
                "label": "中-偏主",
                "note": "主胜排第一，但主客仍有拉扯，当前只是偏主而不是强主。",
            }

        if top_gap >= 0.1:
            return {
                "label": "中-偏客",
                "note": "客胜排第一且前二差值已有一定拉开，当前更偏向客队。",
            }
        if draw_prob >= 0.27:
            return {
                "label": "中-偏平",
                "note": "虽然客胜排第一，但差值不大且平局概率偏高，当前更适合优先防平。",
            }
        return {
            "label": "中-偏客",
            "note": "客胜排第一，但领先优势不算大，当前只是偏客而不是强客。",
        }

    if top_gap < 0.05 and second_key != "draw":
        return {
            "label": "谨慎-主客胶着",
            "note": "第一和第二概率几乎贴在一起，而且是主客直接对冲，这类更像主客胶着盘。",
        }

    return {
        "label": "谨慎-不建议单押",
        "note": "当前结构缺乏足够清晰的单边信号，更适合放弃单押或改看双结果。",
    }


def build_rule_explanation(
    final_prob: dict[str, float],
    metrics: dict[str, float],
    decision: dict[str, str | None],
) -> str:
    parts: list[str] = []
    lead_outcome = OUTCOME_LABELS[decision["primaryKey"]]
    second_outcome = (
        OUTCOME_LABELS[decision["secondaryKey"]] if decision["secondaryKey"] else ""
    )

    if metrics["consensus"] >= 0.75:
        parts.append("6 家公司的初始赔率方向较一致")
    elif metrics["consensus"] >= 0.6:
        parts.append("市场存在温和共识")
    else:
        parts.append("公司之间分歧较明显")

    if metrics["outlierCount"] > 0:
        parts.append("已对偏离市场的公司做轻度降权")

    if final_prob["draw"] >= 0.28:
        parts.append("平局概率没有被明显拉开")

    if metrics["favoriteVoteShare"] < THRESHOLDS["favoriteVoteShareMin"]:
        parts.append("各家公司最低赔方向并不完全一致")

    if decision["type"] == "abstain":
        return f"{'，'.join(parts)}，当前更适合把这场视为低确定性场次，主动放弃单押。"

    if decision["type"] == "draw-single":
        return f"{'，'.join(parts)}，同时主客两端接近，因此把平局提升为单结果。"

    if decision["type"] == "double":
        return f"{'，'.join(parts)}，因此将结果收敛为 {lead_outcome}/{second_outcome} 双结果。"

    return f"{'，'.join(parts)}，最终偏向 {lead_outcome}。"


def validate_rows(rows: list[dict]) -> list[dict]:
    if len(rows) != len(FIXED_COMPANIES):
        raise ValueError(f"必须提供 {len(FIXED_COMPANIES)} 家公司的初始赔率。")

    normalized: list[dict] = []
    for index, row in enumerate(rows):
        item = {
            "company": FIXED_COMPANIES[index],
            "home": float(row["home"]),
            "draw": float(row["draw"]),
            "away": float(row["away"]),
        }
        for key in ("home", "draw", "away"):
            value = item[key]
            if not math.isfinite(value) or value <= 1.01 or value >= 100:
                raise ValueError(f"{FIXED_COMPANIES[index]} 的{OUTCOME_LABELS[key]}赔率无效。")
        normalized.append(item)
    return normalized


def compute_rule_prediction(rows: list[dict]) -> dict:
    clean_rows = validate_rows(rows)
    favorite_votes = {"home": 0, "draw": 0, "away": 0}

    for row in clean_rows:
        ordered = sorted(
            [
                {"key": "home", "odds": row["home"]},
                {"key": "draw", "odds": row["draw"]},
                {"key": "away", "odds": row["away"]},
            ],
            key=lambda item: item["odds"],
        )
        favorite_votes[ordered[0]["key"]] += 1

    probability_rows = [
        to_probability_row(row["home"], row["draw"], row["away"]) for row in clean_rows
    ]

    mean_prob = {
        "home": average([row["home"] for row in probability_rows]),
        "draw": average([row["draw"] for row in probability_rows]),
        "away": average([row["away"] for row in probability_rows]),
    }

    distances = [distance(row, mean_prob) for row in probability_rows]
    mean_distance = average(distances)
    std_distance = standard_deviation(distances)
    outlier_cutoff = max(0.045, mean_distance + std_distance)

    weights: list[float] = []
    for value in distances:
        if value <= outlier_cutoff:
            weights.append(1.0)
        else:
            weights.append(clamp(1 - (value - outlier_cutoff) * 8, 0.52, 0.92))

    weight_sum = sum(weights)
    final_prob = normalize_probabilities(
        {
            "home": sum(row["home"] * weights[index] for index, row in enumerate(probability_rows))
            / weight_sum,
            "draw": sum(row["draw"] * weights[index] for index, row in enumerate(probability_rows))
            / weight_sum,
            "away": sum(row["away"] * weights[index] for index, row in enumerate(probability_rows))
            / weight_sum,
        }
    )

    dispersion = average(
        [
            standard_deviation([row["home"] for row in probability_rows]),
            standard_deviation([row["draw"] for row in probability_rows]),
            standard_deviation([row["away"] for row in probability_rows]),
        ]
    )

    consensus = clamp(1 - mean_distance / 0.09, 0, 1)
    outlier_count = len([value for value in distances if value > outlier_cutoff])
    home_away_gap = abs(final_prob["home"] - final_prob["away"])
    draw_pressure = final_prob["draw"] - average([final_prob["home"], final_prob["away"]])
    strongest_side = max(final_prob["home"], final_prob["away"])
    draw_gap_to_leader = strongest_side - final_prob["draw"]

    ranked = sorted(
        [
            {"key": "home", "value": final_prob["home"]},
            {"key": "draw", "value": final_prob["draw"]},
            {"key": "away", "value": final_prob["away"]},
        ],
        key=lambda item: item["value"],
        reverse=True,
    )

    top_gap = ranked[0]["value"] - ranked[1]["value"]
    favorite_vote_share = favorite_votes[ranked[0]["key"]] / len(clean_rows)
    home_vote_share = favorite_votes["home"] / len(clean_rows)
    draw_vote_share = favorite_votes["draw"] / len(clean_rows)
    away_vote_share = favorite_votes["away"] / len(clean_rows)
    side_leader_key = "home" if final_prob["home"] >= final_prob["away"] else "away"
    side_leader_prob = final_prob[side_leader_key]
    split_sides = max(home_vote_share, away_vote_share) <= THRESHOLDS["splitVoteShareMax"]
    leader_key = ranked[0]["key"]
    second_key = ranked[1]["key"]

    draw_single = (
        final_prob["draw"] >= THRESHOLDS["drawMinimum"]
        and home_away_gap <= THRESHOLDS["drawHomeAwayGapMax"]
        and dispersion <= THRESHOLDS["drawDispersionMax"]
        and (
            draw_gap_to_leader <= THRESHOLDS["drawLeadSlack"]
            or (split_sides and draw_gap_to_leader <= THRESHOLDS["drawSplitLeadSlack"])
        )
    )

    strong_non_draw_single = (
        ranked[0]["key"] != "draw"
        and ranked[0]["value"] >= THRESHOLDS["strongSingleProbabilityMin"]
        and top_gap >= THRESHOLDS["strongSingleGapMin"]
        and favorite_vote_share >= THRESHOLDS["strongSingleVoteShareMin"]
        and final_prob["draw"] <= THRESHOLDS["strongSingleDrawMax"]
    )

    side_draw_double = (
        not draw_single
        and not strong_non_draw_single
        and side_leader_key != "draw"
        and final_prob["draw"] >= THRESHOLDS["sideDrawDoubleMin"]
        and (side_leader_prob - final_prob["draw"]) <= THRESHOLDS["sideDrawDoubleGapMax"]
    )

    home_away_double = (
        not draw_single
        and not strong_non_draw_single
        and not side_draw_double
        and split_sides
        and home_away_gap <= THRESHOLDS["homeAwayDoubleGapMax"]
        and final_prob["draw"] < THRESHOLDS["drawMinimum"]
    )

    base_confidence = confidence_label(consensus, top_gap)
    confidence_profile = build_rule_confidence_profile(
        base_confidence, ranked, final_prob, top_gap
    )

    if draw_single:
        decision = {"type": "draw-single", "primaryKey": "draw", "secondaryKey": None}
    elif base_confidence == "高" and strong_non_draw_single:
        decision = {"type": "single", "primaryKey": ranked[0]["key"], "secondaryKey": None}
    elif base_confidence == "高":
        if side_draw_double:
            decision = {"type": "double", "primaryKey": side_leader_key, "secondaryKey": "draw"}
        elif home_away_double:
            decision = {"type": "double", "primaryKey": "home", "secondaryKey": "away"}
        elif leader_key == "draw" or final_prob["draw"] >= THRESHOLDS["drawMinimum"]:
            decision = {"type": "draw-single", "primaryKey": "draw", "secondaryKey": None}
        else:
            secondary_key = ranked[2]["key"] if second_key == leader_key else second_key
            decision = {"type": "double", "primaryKey": leader_key, "secondaryKey": secondary_key}
    elif base_confidence == "中":
        if confidence_profile["label"] == "中-偏平":
            preferred_side = (
                "home" if final_prob["home"] >= final_prob["away"] else "away"
            ) if leader_key == "draw" else leader_key
            decision = {"type": "double", "primaryKey": preferred_side, "secondaryKey": "draw"}
        elif confidence_profile["label"] == "中-偏主":
            decision = {
                "type": "double",
                "primaryKey": "home",
                "secondaryKey": "draw" if second_key == "draw" or final_prob["draw"] >= 0.27 else "away",
            }
        else:
            decision = {
                "type": "double",
                "primaryKey": "away",
                "secondaryKey": "draw" if second_key == "draw" or final_prob["draw"] >= 0.27 else "home",
            }
    elif confidence_profile["label"] == "谨慎-主客胶着" and top_gap >= 0.04:
        decision = {"type": "double", "primaryKey": "home", "secondaryKey": "away"}
    else:
        decision = {"type": "abstain", "primaryKey": leader_key, "secondaryKey": None}

    recommendation = (
        "不建议单押"
        if decision["type"] == "abstain"
        else (
            f"{OUTCOME_LABELS[decision['primaryKey']]}/{OUTCOME_LABELS[decision['secondaryKey']]}"
            if decision["type"] == "double"
            else OUTCOME_LABELS[decision["primaryKey"]]
        )
    )

    return {
        "companies": FIXED_COMPANIES,
        "recommendation": recommendation,
        "allowDouble": decision["type"] == "double",
        "abstained": decision["type"] == "abstain",
        "drawSingle": decision["type"] == "draw-single",
        "decision": decision,
        "confidence": base_confidence,
        "confidenceProfile": confidence_profile,
        "finalProb": final_prob,
        "metrics": {
            "consensus": consensus,
            "dispersion": dispersion,
            "outlierCount": outlier_count,
            "homeAwayGap": home_away_gap,
            "drawPressure": draw_pressure,
            "drawGapToLeader": draw_gap_to_leader,
            "homeVoteShare": home_vote_share,
            "drawVoteShare": draw_vote_share,
            "awayVoteShare": away_vote_share,
            "favoriteVoteShare": favorite_vote_share,
            "topGap": top_gap,
            "strongNonDrawSingle": strong_non_draw_single,
        },
        "engine": "rule",
        "engineLabel": "默认规则模型",
        "explanation": build_rule_explanation(
            final_prob,
            {
                "consensus": consensus,
                "outlierCount": outlier_count,
                "favoriteVoteShare": favorite_vote_share,
            },
            decision,
        ),
    }
