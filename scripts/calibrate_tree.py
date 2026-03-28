import csv
import io
import json
import math
import urllib.request
from pathlib import Path

import numpy as np
from sklearn.ensemble import ExtraTreesClassifier, HistGradientBoostingClassifier, RandomForestClassifier

SEASONS_TRAIN = ["2122", "2223"]
SEASONS_VALIDATION = ["2324"]
LEAGUES = ["E0", "E1", "E2", "E3", "EC", "SP1", "SP2", "D1", "D2", "I1", "I2", "F1", "F2", "N1", "P1", "T1", "B1"]
COMPANIES = [
    ("Bet365", ("B365H", "B365D", "B365A"), ("B365CH", "B365CD", "B365CA")),
    ("Bwin", ("BWH", "BWD", "BWA"), ("BWCH", "BWCD", "BWCA")),
    ("William Hill", ("WHH", "WHD", "WHA"), ("WHCH", "WHCD", "WHCA")),
    ("Interwetten", ("IWH", "IWD", "IWA"), ("IWCH", "IWCD", "IWCA")),
    ("Pinnacle", ("PSH", "PSD", "PSA"), ("PSCH", "PSCD", "PSCA")),
    ("BetVictor", ("VCH", "VCD", "VCA"), ("VCCH", "VCCD", "VCCA")),
]
CLASS_ORDER = ["H", "D", "A"]
DECISION_SEARCH = {"min_gap": 0.0, "max_gap": 0.2, "step": 0.002, "max_double_rate_target": 0.3}
CACHE = {}


def fetch_csv(url):
    if url in CACHE:
        return CACHE[url]

    raw = urllib.request.urlopen(url, timeout=30).read()
    text = None
    for encoding in ("utf-8-sig", "cp1252", "latin1"):
        try:
            text = raw.decode(encoding)
            break
        except UnicodeDecodeError:
            continue

    if text is None:
        raise ValueError(f"Unable to decode {url}")

    rows = list(csv.DictReader(io.StringIO(text)))
    CACHE[url] = rows
    return rows


def average(values):
    return sum(values) / len(values)


def standard_deviation(values):
    mean = average(values)
    return math.sqrt(average([(value - mean) ** 2 for value in values]))


def normalize_probabilities(home_value, draw_value, away_value):
    total = home_value + draw_value + away_value
    return {
        "home": home_value / total,
        "draw": draw_value / total,
        "away": away_value / total,
    }


def to_probability_row(home_odds, draw_odds, away_odds):
    return normalize_probabilities(1 / home_odds, 1 / draw_odds, 1 / away_odds)


def distance(left, right):
    return math.sqrt(
        (left["home"] - right["home"]) ** 2
        + (left["draw"] - right["draw"]) ** 2
        + (left["away"] - right["away"]) ** 2
    )


def parse_odds_rows(raw_row, phase):
    rows = []
    for company_name, opening_columns, closing_columns in COMPANIES:
        columns = closing_columns if phase == "closing" else opening_columns
        try:
            values = [float(raw_row[column]) for column in columns]
        except Exception:
            return None

        if not all(math.isfinite(value) and value > 1.01 for value in values):
            return None

        rows.append(
            {
                "company": company_name,
                "home": values[0],
                "draw": values[1],
                "away": values[2],
            }
        )

    return rows


def build_market_summary(rows):
    probability_rows = [to_probability_row(row["home"], row["draw"], row["away"]) for row in rows]
    lowest_votes = {"home": 0, "draw": 0, "away": 0}

    for row in rows:
        ordered = sorted(
            [
                {"key": "home", "odds": row["home"]},
                {"key": "draw", "odds": row["draw"]},
                {"key": "away", "odds": row["away"]},
            ],
            key=lambda item: item["odds"],
        )
        lowest_votes[ordered[0]["key"]] += 1

    mean_prob = {
        "home": average([row["home"] for row in probability_rows]),
        "draw": average([row["draw"] for row in probability_rows]),
        "away": average([row["away"] for row in probability_rows]),
    }
    std_prob = {
        "home": standard_deviation([row["home"] for row in probability_rows]),
        "draw": standard_deviation([row["draw"] for row in probability_rows]),
        "away": standard_deviation([row["away"] for row in probability_rows]),
    }
    range_prob = {
        "home": max(row["home"] for row in probability_rows) - min(row["home"] for row in probability_rows),
        "draw": max(row["draw"] for row in probability_rows) - min(row["draw"] for row in probability_rows),
        "away": max(row["away"] for row in probability_rows) - min(row["away"] for row in probability_rows),
    }

    distances = [distance(row, mean_prob) for row in probability_rows]
    mean_distance = average(distances)
    std_distance = standard_deviation(distances)
    outlier_cutoff = max(0.045, mean_distance + std_distance)
    outlier_share = sum(value > outlier_cutoff for value in distances) / len(rows)
    consensus = max(0.0, min(1.0, 1 - mean_distance / 0.09))
    dispersion = average([std_prob["home"], std_prob["draw"], std_prob["away"]])
    ranked = sorted(
        [
            {"key": "home", "value": mean_prob["home"]},
            {"key": "draw", "value": mean_prob["draw"]},
            {"key": "away", "value": mean_prob["away"]},
        ],
        key=lambda item: item["value"],
        reverse=True,
    )
    top_prob = ranked[0]["value"]
    second_prob = ranked[1]["value"]
    top_gap = top_prob - second_prob
    home_away_gap = abs(mean_prob["home"] - mean_prob["away"])
    skew_signed = mean_prob["home"] - mean_prob["away"]
    draw_vs_side = mean_prob["draw"] - max(mean_prob["home"], mean_prob["away"])
    overround_mean = average([1 / row["home"] + 1 / row["draw"] + 1 / row["away"] for row in rows])

    return {
        "probability_rows": probability_rows,
        "mean_prob": mean_prob,
        "std_prob": std_prob,
        "range_prob": range_prob,
        "home_vote_share": lowest_votes["home"] / len(rows),
        "draw_vote_share": lowest_votes["draw"] / len(rows),
        "away_vote_share": lowest_votes["away"] / len(rows),
        "favorite_vote_share": max(lowest_votes.values()) / len(rows),
        "top_prob": top_prob,
        "second_prob": second_prob,
        "top_gap": top_gap,
        "home_away_gap": home_away_gap,
        "skew_signed": skew_signed,
        "draw_vs_side": draw_vs_side,
        "consensus": consensus,
        "outlier_share": outlier_share,
        "dispersion": dispersion,
        "overround_mean": overround_mean,
    }


def build_feature_vector(opening_rows, closing_rows):
    opening = build_market_summary(opening_rows)
    closing = build_market_summary(closing_rows)
    favorite_flip_share = (
        sum(
            min(
                [{"key": "home", "odds": opening_rows[index]["home"]}, {"key": "draw", "odds": opening_rows[index]["draw"]}, {"key": "away", "odds": opening_rows[index]["away"]}],
                key=lambda item: item["odds"],
            )["key"]
            != min(
                [{"key": "home", "odds": closing_rows[index]["home"]}, {"key": "draw", "odds": closing_rows[index]["draw"]}, {"key": "away", "odds": closing_rows[index]["away"]}],
                key=lambda item: item["odds"],
            )["key"]
            for index in range(len(opening_rows))
        )
        / len(opening_rows)
    )
    delta_mean = {
        "home": closing["mean_prob"]["home"] - opening["mean_prob"]["home"],
        "draw": closing["mean_prob"]["draw"] - opening["mean_prob"]["draw"],
        "away": closing["mean_prob"]["away"] - opening["mean_prob"]["away"],
    }
    delta_abs_mean = {
        "home": average(
            [
                abs(closing["probability_rows"][index]["home"] - row["home"])
                for index, row in enumerate(opening["probability_rows"])
            ]
        ),
        "draw": average(
            [
                abs(closing["probability_rows"][index]["draw"] - row["draw"])
                for index, row in enumerate(opening["probability_rows"])
            ]
        ),
        "away": average(
            [
                abs(closing["probability_rows"][index]["away"] - row["away"])
                for index, row in enumerate(opening["probability_rows"])
            ]
        ),
    }

    return np.array(
        [
            *[value for row in opening["probability_rows"] for value in (row["home"], row["draw"], row["away"])],
            opening["mean_prob"]["home"],
            opening["mean_prob"]["draw"],
            opening["mean_prob"]["away"],
            opening["std_prob"]["home"],
            opening["std_prob"]["draw"],
            opening["std_prob"]["away"],
            opening["range_prob"]["home"],
            opening["range_prob"]["draw"],
            opening["range_prob"]["away"],
            opening["home_vote_share"],
            opening["draw_vote_share"],
            opening["away_vote_share"],
            opening["top_prob"],
            opening["second_prob"],
            opening["top_gap"],
            opening["home_away_gap"],
            opening["skew_signed"],
            opening["draw_vs_side"],
            opening["consensus"],
            opening["outlier_share"],
            opening["dispersion"],
            opening["overround_mean"],
            *[value for row in closing["probability_rows"] for value in (row["home"], row["draw"], row["away"])],
            closing["mean_prob"]["home"],
            closing["mean_prob"]["draw"],
            closing["mean_prob"]["away"],
            closing["std_prob"]["home"],
            closing["std_prob"]["draw"],
            closing["std_prob"]["away"],
            closing["range_prob"]["home"],
            closing["range_prob"]["draw"],
            closing["range_prob"]["away"],
            closing["home_vote_share"],
            closing["draw_vote_share"],
            closing["away_vote_share"],
            closing["top_prob"],
            closing["second_prob"],
            closing["top_gap"],
            closing["home_away_gap"],
            closing["skew_signed"],
            closing["draw_vs_side"],
            closing["consensus"],
            closing["outlier_share"],
            closing["dispersion"],
            closing["overround_mean"],
            delta_mean["home"],
            delta_mean["draw"],
            delta_mean["away"],
            delta_abs_mean["home"],
            delta_abs_mean["draw"],
            delta_abs_mean["away"],
            favorite_flip_share,
            closing["top_gap"] - opening["top_gap"],
            closing["skew_signed"] - opening["skew_signed"],
            closing["draw_vs_side"] - opening["draw_vs_side"],
            closing["consensus"] - opening["consensus"],
            closing["overround_mean"] - opening["overround_mean"],
            opening["mean_prob"]["home"] * opening["mean_prob"]["draw"],
            opening["mean_prob"]["home"] * opening["mean_prob"]["away"],
            opening["mean_prob"]["draw"] * opening["mean_prob"]["away"],
            opening["top_gap"] * opening["top_gap"],
            opening["skew_signed"] * opening["skew_signed"],
            opening["draw_vs_side"] * opening["draw_vs_side"],
        ],
        dtype=float,
    )


def load_dataset(seasons):
    features = []
    labels = []

    for season in seasons:
        for league in LEAGUES:
            url = f"https://www.football-data.co.uk/mmz4281/{season}/{league}.csv"
            rows = fetch_csv(url)
            for row in rows:
                if row.get("FTR") not in CLASS_ORDER:
                    continue

                opening_rows = parse_odds_rows(row, "opening")
                closing_rows = parse_odds_rows(row, "closing")
                if not opening_rows or not closing_rows:
                    continue

                features.append(build_feature_vector(opening_rows, closing_rows))
                labels.append(CLASS_ORDER.index(row["FTR"]))

    return np.vstack(features), np.array(labels)


def evaluate(y_true, probabilities, threshold):
    top1_hits = 0
    single_hits = 0
    inclusive_hits = 0
    weighted_hits = 0.0
    single_count = 0
    double_count = 0
    draw_single_count = 0
    draw_single_hits = 0

    for truth, probability_row in zip(y_true, probabilities):
        ranked = np.argsort(-probability_row)
        if ranked[0] == truth:
            top1_hits += 1

        if probability_row[ranked[0]] - probability_row[ranked[1]] <= threshold:
            double_count += 1
            if truth in ranked[:2]:
                inclusive_hits += 1
                weighted_hits += 0.72
            continue

        single_count += 1
        if ranked[0] == truth:
            single_hits += 1
            inclusive_hits += 1
            weighted_hits += 1

        if ranked[0] == 1:
            draw_single_count += 1
            if truth == 1:
                draw_single_hits += 1

    total = len(y_true)
    return {
        "top1Accuracy": top1_hits / total,
        "singleRate": single_count / total,
        "singlePredictionAccuracy": single_hits / max(single_count, 1),
        "exactSingleHitRate": single_hits / total,
        "inclusiveHitRate": inclusive_hits / total,
        "weightedHitRate": weighted_hits / total,
        "doubleRate": double_count / total,
        "drawSingleRate": draw_single_count / total,
        "drawSinglePrecision": draw_single_hits / max(draw_single_count, 1),
    }


def objective(metrics):
    score = metrics["inclusiveHitRate"] * 0.7
    score += metrics["singlePredictionAccuracy"] * 0.35
    score += metrics["top1Accuracy"] * 0.25
    score += metrics["weightedHitRate"] * 0.1
    score -= max(0, metrics["doubleRate"] - DECISION_SEARCH["max_double_rate_target"]) * 3.4
    score -= max(0, 0.18 - metrics["doubleRate"]) * 0.15
    score -= max(0, 0.08 - metrics["drawSingleRate"]) * 0.6
    score -= max(0, metrics["drawSingleRate"] - 0.22) * 0.25
    score -= max(0, 0.28 - metrics["drawSinglePrecision"]) * 0.35
    return score


def tune_threshold(y_true, probabilities):
    best = None
    threshold = DECISION_SEARCH["min_gap"]
    while threshold <= DECISION_SEARCH["max_gap"] + 1e-9:
        metrics = evaluate(y_true, probabilities, threshold)
        score = objective(metrics)
        candidate = {
            "threshold": round(threshold, 3),
            "score": score,
            "metrics": metrics,
        }
        if best is None or candidate["score"] > best["score"]:
            best = candidate
        threshold += DECISION_SEARCH["step"]
    return best


def round_metrics(metrics):
    return {key: round(value, 4) for key, value in metrics.items()}


def main():
    x_train, y_train = load_dataset(SEASONS_TRAIN)
    x_validation, y_validation = load_dataset(SEASONS_VALIDATION)

    experiments = [
        (
            "hist_gbdt_depth4",
            HistGradientBoostingClassifier(
                loss="log_loss",
                learning_rate=0.05,
                max_iter=320,
                max_depth=4,
                min_samples_leaf=20,
                random_state=42,
            ),
        ),
        (
            "hist_gbdt_depth6",
            HistGradientBoostingClassifier(
                loss="log_loss",
                learning_rate=0.035,
                max_iter=420,
                max_depth=6,
                min_samples_leaf=18,
                random_state=42,
            ),
        ),
        (
            "extra_trees",
            ExtraTreesClassifier(
                n_estimators=700,
                max_depth=None,
                min_samples_leaf=3,
                random_state=42,
                n_jobs=-1,
            ),
        ),
        (
            "random_forest",
            RandomForestClassifier(
                n_estimators=700,
                max_depth=None,
                min_samples_leaf=3,
                random_state=42,
                n_jobs=-1,
            ),
        ),
    ]

    results = []
    for name, model in experiments:
        model.fit(x_train, y_train)
        probabilities_train = model.predict_proba(x_train)
        probabilities_validation = model.predict_proba(x_validation)
        tuned = tune_threshold(y_train, probabilities_train)
        validation_metrics = evaluate(y_validation, probabilities_validation, tuned["threshold"])
        results.append(
            {
                "model": name,
                "train_matches": int(len(y_train)),
                "validation_matches": int(len(y_validation)),
                "threshold": tuned["threshold"],
                "train": round_metrics(tuned["metrics"]),
                "validation": round_metrics(validation_metrics),
            }
        )

    output_path = Path("/tmp/football_tree_backtest_results.json")
    output_path.write_text(json.dumps(results, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(results, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
