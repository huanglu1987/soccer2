from __future__ import annotations

import csv
import io
import math
import ssl
import sys
import urllib.request
from collections import Counter, defaultdict

sys.path.insert(0, "/Users/huanglu/Projects/WORD 编辑/plugins/football-odds-predictor")

from predictor_py import compute_rule_prediction

LEAGUES = ["E0", "E1", "E2", "E3", "EC", "SP1", "SP2", "D1", "D2", "I1", "I2", "F1", "F2", "N1", "P1", "T1", "B1"]
SEASONS = ["2122", "2223", "2324"]
COMPANY_COLUMNS = [
    ("Bet365", ("B365H", "B365D", "B365A")),
    ("William Hill", ("WHH", "WHD", "WHA")),
    ("Bwin", ("BWH", "BWD", "BWA")),
    ("Interwetten", ("IWH", "IWD", "IWA")),
    ("Pinnacle", ("PSH", "PSD", "PSA")),
    ("BetVictor", ("VCH", "VCD", "VCA")),
]
RESULT_MAP = {"H": "home", "D": "draw", "A": "away"}
CTX = ssl._create_unverified_context()


def fetch_rows(url: str) -> list[dict[str, str]]:
    with urllib.request.urlopen(url, timeout=60, context=CTX) as resp:
        text = resp.read().decode("utf-8-sig", errors="replace")
    return list(csv.DictReader(io.StringIO(text)))


def num(value: str) -> float | None:
    try:
        return float(value)
    except Exception:
        return None


def parse_odds_rows(row: dict[str, str]) -> list[dict[str, float]] | None:
    parsed: list[dict[str, float]] = []
    for name, cols in COMPANY_COLUMNS:
        vals = [num(row.get(col, "")) for col in cols]
        if not all(v is not None and 1.01 < v < 100 for v in vals):
            return None
        parsed.append({"company": name, "home": vals[0], "draw": vals[1], "away": vals[2]})
    return parsed


def normalize(values: dict[str, float]) -> dict[str, float]:
    total = sum(values.values())
    return {key: value / total for key, value in values.items()}


def to_prob(row: dict[str, float]) -> dict[str, float]:
    return normalize({"home": 1 / row["home"], "draw": 1 / row["draw"], "away": 1 / row["away"]})


def average(values: list[float]) -> float:
    return sum(values) / len(values)


def std(values: list[float]) -> float:
    mean = average(values)
    return math.sqrt(average([(value - mean) ** 2 for value in values]))


def distance(left: dict[str, float], right: dict[str, float]) -> float:
    return math.sqrt(
        (left["home"] - right["home"]) ** 2
        + (left["draw"] - right["draw"]) ** 2
        + (left["away"] - right["away"]) ** 2
    )


def compute_market_metrics(rows: list[dict[str, float]]) -> dict[str, float | str]:
    probs = [to_prob(row) for row in rows]
    mean = {key: average([row[key] for row in probs]) for key in ["home", "draw", "away"]}
    distances = [distance(row, mean) for row in probs]
    mean_distance = average(distances)
    std_distance = std(distances)
    outlier_cutoff = max(0.045, mean_distance + std_distance)
    weights = [1 if value <= outlier_cutoff else max(0.52, min(0.92, 1 - (value - outlier_cutoff) * 8)) for value in distances]
    weight_sum = sum(weights)
    final_prob = normalize(
        {
            "home": sum(row["home"] * weights[index] for index, row in enumerate(probs)) / weight_sum,
            "draw": sum(row["draw"] * weights[index] for index, row in enumerate(probs)) / weight_sum,
            "away": sum(row["away"] * weights[index] for index, row in enumerate(probs)) / weight_sum,
        }
    )
    ranked = sorted(final_prob.items(), key=lambda item: item[1], reverse=True)
    favorite_votes: Counter[str] = Counter()
    for row in rows:
        favorite = min([("home", row["home"]), ("draw", row["draw"]), ("away", row["away"])], key=lambda item: item[1])[0]
        favorite_votes[favorite] += 1
    return {
        "favorite": ranked[0][0],
        "second": ranked[1][0],
        "top_gap": ranked[0][1] - ranked[1][1],
        "favorite_vote_share": favorite_votes[ranked[0][0]] / len(rows),
        "draw_prob": final_prob["draw"],
        "home_away_gap": abs(final_prob["home"] - final_prob["away"]),
        "consensus": max(0, min(1, 1 - mean_distance / 0.09)),
    }


def band(value: float, cuts: list[tuple[float, float, str]]) -> str:
    for low, high, label in cuts:
        if low <= value < high:
            return label
    return cuts[-1][2]


CUTS = {
    "top_gap": [(0, 0.05, "<0.05"), (0.05, 0.10, "0.05-0.10"), (0.10, 0.15, "0.10-0.15"), (0.15, 0.20, "0.15-0.20"), (0.20, 1.0, ">=0.20")],
    "favorite_vote_share": [(0, 0.67, "<0.67"), (0.67, 0.83, "0.67-0.83"), (0.83, 1.0, "0.83-1.00"), (1.0, 2.0, "1.00")],
    "draw_prob": [(0, 0.24, "<0.24"), (0.24, 0.27, "0.24-0.27"), (0.27, 0.30, "0.27-0.30"), (0.30, 1.0, ">=0.30")],
    "consensus": [(0, 0.60, "<0.60"), (0.60, 0.75, "0.60-0.75"), (0.75, 0.85, "0.75-0.85"), (0.85, 1.1, ">=0.85")],
    "home_away_gap": [(0, 0.05, "<0.05"), (0.05, 0.10, "0.05-0.10"), (0.10, 0.18, "0.10-0.18"), (0.18, 1.0, ">=0.18")],
}


def main() -> None:
    records: list[dict[str, object]] = []

    for season in SEASONS:
        for league in LEAGUES:
            rows = fetch_rows(f"https://www.football-data.co.uk/mmz4281/{season}/{league}.csv")
            for row in rows:
                actual = RESULT_MAP.get(row.get("FTR", ""))
                if actual is None:
                    continue
                odds_rows = parse_odds_rows(row)
                if odds_rows is None:
                    continue
                market = compute_market_metrics(odds_rows)
                if market["favorite"] == "draw":
                    continue
                prediction = compute_rule_prediction(odds_rows)
                records.append(
                    {
                        "favorite": market["favorite"],
                        "second": market["second"],
                        "actual": actual,
                        "upset": actual != market["favorite"],
                        "draw_upset": actual == "draw",
                        "side_upset": actual not in ("draw", market["favorite"]),
                        "top_gap": market["top_gap"],
                        "favorite_vote_share": market["favorite_vote_share"],
                        "draw_prob": market["draw_prob"],
                        "home_away_gap": market["home_away_gap"],
                        "consensus": market["consensus"],
                        "confidence": prediction["confidence"],
                        "structure": prediction["confidenceProfile"]["label"],
                    }
                )

    print("records", len(records))
    print("upset_rate", round(sum(1 for item in records if item["upset"]) / len(records), 4))
    print("draw_upset_rate", round(sum(1 for item in records if item["draw_upset"]) / len(records), 4))
    print("side_upset_rate", round(sum(1 for item in records if item["side_upset"]) / len(records), 4))

    segments: defaultdict[tuple[str, ...], dict[str, int]] = defaultdict(lambda: {"count": 0, "upset": 0, "draw_upset": 0, "side_upset": 0})
    for record in records:
        key = (
            str(record["favorite"]),
            str(record["second"]),
            band(float(record["top_gap"]), CUTS["top_gap"]),
            band(float(record["favorite_vote_share"]), CUTS["favorite_vote_share"]),
            band(float(record["draw_prob"]), CUTS["draw_prob"]),
            band(float(record["consensus"]), CUTS["consensus"]),
            band(float(record["home_away_gap"]), CUTS["home_away_gap"]),
        )
        segment = segments[key]
        segment["count"] += 1
        segment["upset"] += int(bool(record["upset"]))
        segment["draw_upset"] += int(bool(record["draw_upset"]))
        segment["side_upset"] += int(bool(record["side_upset"]))

    best_draw: list[tuple[float, int, float, tuple[str, ...]]] = []
    best_side: list[tuple[float, int, float, tuple[str, ...]]] = []
    for key, segment in segments.items():
        if segment["count"] < 40:
            continue
        upset_rate = segment["upset"] / segment["count"]
        draw_rate = segment["draw_upset"] / segment["count"]
        side_rate = segment["side_upset"] / segment["count"]
        best_draw.append((draw_rate, segment["count"], upset_rate, key))
        best_side.append((side_rate, segment["count"], upset_rate, key))

    best_draw.sort(reverse=True)
    best_side.sort(reverse=True)
    print("BEST_DRAW")
    for draw_rate, count, upset_rate, key in best_draw[:12]:
        print(round(draw_rate, 4), count, round(upset_rate, 4), key)
    print("BEST_SIDE")
    for side_rate, count, upset_rate, key in best_side[:12]:
        print(round(side_rate, 4), count, round(upset_rate, 4), key)

    cold_candidates: list[dict[str, object]] = []
    for record in records:
        favorite = str(record["favorite"])
        second = str(record["second"])
        confidence = str(record["confidence"])
        structure = str(record["structure"])
        top_gap = float(record["top_gap"])
        draw_prob = float(record["draw_prob"])
        home_away_gap = float(record["home_away_gap"])
        consensus = float(record["consensus"])
        favorite_vote_share = float(record["favorite_vote_share"])
        actual = str(record["actual"])

        if second == "draw":
            draw_cold = (
                structure in {"高-防平", "中-偏平"}
                and 0.05 <= top_gap <= 0.15
                and draw_prob >= 0.30
                and consensus >= 0.75
                and favorite_vote_share >= 0.83
                and 0.05 <= home_away_gap <= 0.18
            )
            if draw_cold:
                cold_candidates.append(
                    {
                        "cold_type": "draw",
                        "predicted": "draw",
                        "hit": actual == "draw",
                        "favorite": favorite,
                        "structure": structure,
                        "confidence": confidence,
                    }
                )
                continue

        side_cold = (
            second != "draw"
            and structure in {"高-分胜负", "中-偏主", "中-偏客", "谨慎-主客胶着"}
            and top_gap < 0.10
            and 0.24 <= draw_prob <= 0.30
            and consensus >= 0.85
            and favorite_vote_share >= 0.83
            and home_away_gap < 0.10
        )
        if side_cold:
            cold_candidates.append(
                {
                    "cold_type": "side",
                    "predicted": second,
                    "hit": actual == second,
                    "favorite": favorite,
                    "structure": structure,
                    "confidence": confidence,
                }
            )

    print("COLD_RULE_CANDIDATES")
    print("count", len(cold_candidates))
    if cold_candidates:
        hit_rate = sum(1 for item in cold_candidates if item["hit"]) / len(cold_candidates)
        print("hit_rate", round(hit_rate, 4))
        by_type = Counter(item["cold_type"] for item in cold_candidates)
        by_predicted = Counter(item["predicted"] for item in cold_candidates)
        by_structure = Counter(item["structure"] for item in cold_candidates)
        print("by_type", dict(by_type))
        print("by_predicted", dict(by_predicted))
        print("by_structure", dict(by_structure))


if __name__ == "__main__":
    main()
