"use strict";

const fs = require("node:fs");
const path = require("node:path");

const ROOT_DIR = path.resolve(__dirname, "..");
const CALIBRATION_PATH = path.join(ROOT_DIR, "calibration", "latest.json");

const FIXED_COMPANIES = [
  "Bet365",
  "William Hill",
  "Bwin",
  "Interwetten",
  "Pinnacle",
  "BetVictor"
];

const FALLBACK_THRESHOLDS = {
  drawMinimum: 0.283,
  drawLeadSlack: 0.014,
  drawSplitLeadSlack: 0.024,
  drawHomeAwayGapMax: 0.048,
  drawDispersionMax: 0.03,
  strongSingleProbabilityMin: 0.459,
  strongSingleGapMin: 0.099,
  strongSingleVoteShareMin: 1,
  strongSingleDrawMax: 0.298,
  favoriteVoteShareMin: 0.67,
  sideDrawDoubleMin: 0.281,
  sideDrawDoubleGapMax: 0.055,
  splitVoteShareMax: 0.67,
  homeAwayDoubleGapMax: 0.05,
  dispersionMin: 0.018
};

const outcomeLabels = {
  home: "主胜",
  draw: "平局",
  away: "客胜"
};

function loadThresholds() {
  try {
    const parsed = JSON.parse(fs.readFileSync(CALIBRATION_PATH, "utf8"));
    return parsed.selectedThresholds ?? FALLBACK_THRESHOLDS;
  } catch {
    return FALLBACK_THRESHOLDS;
  }
}

const THRESHOLDS = loadThresholds();

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function average(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function standardDeviation(values) {
  const mean = average(values);
  const variance = average(values.map((value) => (value - mean) ** 2));
  return Math.sqrt(variance);
}

function normalizeProbabilities(values) {
  const total = values.home + values.draw + values.away;
  return {
    home: values.home / total,
    draw: values.draw / total,
    away: values.away / total
  };
}

function toProbabilityRow(homeOdds, drawOdds, awayOdds) {
  return normalizeProbabilities({
    home: 1 / homeOdds,
    draw: 1 / drawOdds,
    away: 1 / awayOdds
  });
}

function distance(a, b) {
  return Math.sqrt(
    (a.home - b.home) ** 2 +
      (a.draw - b.draw) ** 2 +
      (a.away - b.away) ** 2
  );
}

function confidenceLabel(consensus, topGap) {
  if (consensus >= 0.79 && topGap >= 0.175) {
    return "高";
  }
  if (consensus >= 0.74 && topGap >= 0.015) {
    return "中";
  }
  return "谨慎";
}

function buildRuleConfidenceProfile(baseConfidence, ranked, finalProb, topGap) {
  const leaderKey = ranked[0].key;
  const secondKey = ranked[1].key;
  const drawProb = finalProb.draw;

  if (baseConfidence === "高") {
    if (secondKey === "draw") {
      if (leaderKey === "home" && drawProb < 0.24 && topGap >= 0.25) {
        return {
          label: "高-强主",
          note: "主胜排第一、平局排第二，而且平局概率较低、前二差值已经明显拉开，这类是高档里最强的主胜结构。"
        };
      }
      if (leaderKey === "away" && drawProb < 0.24 && topGap >= 0.25) {
        return {
          label: "高-强客",
          note: "客胜排第一、平局排第二，而且平局概率较低、前二差值已经明显拉开，这类是高档里最强的客胜结构。"
        };
      }
      if (leaderKey === "home" && drawProb < 0.27 && topGap >= 0.2) {
        return {
          label: "高-强主",
          note: "主胜排第一、平局排第二，且主和平之间已经有足够差距，当前更接近高档强主结构。"
        };
      }
      if (leaderKey === "away" && drawProb < 0.27 && topGap >= 0.2) {
        return {
          label: "高-强客",
          note: "客胜排第一、平局排第二，且客和平之间已经有足够差距，当前更接近高档强客结构。"
        };
      }
    }

    return {
      label: "高-高档防平",
      note: "当前虽然达到高档阈值，但结构里平局仍有一定存在感，或主客排序不够纯，建议按高档场次同时保留防平意识。"
    };
  }

  if (baseConfidence === "中") {
    if (secondKey === "draw") {
      if (topGap < 0.1 || drawProb >= 0.3) {
        return {
          label: "中-偏平",
          note: "平局排第二且和第一名接近，或平局概率已明显抬高，优先按平局候选理解。"
        };
      }
      return {
        label: leaderKey === "home" ? "中-偏主" : "中-偏客",
        note: "平局虽然排第二，但第一名仍保持领先，当前更适合按单边方向加防平来理解。"
      };
    }

    if (leaderKey === "home") {
      if (topGap >= 0.1) {
        return {
          label: "中-偏主",
          note: "主胜排第一且前二差值已有一定拉开，当前更偏向主队。"
        };
      }
      if (drawProb >= 0.28) {
        return {
          label: "中-偏平",
          note: "虽然主胜排第一，但差值不大且平局概率不低，建议把平局作为更强候选。"
        };
      }
      return {
        label: "中-偏主",
        note: "主胜排第一，但主客仍有拉扯，当前只是偏主而不是强主。"
      };
    }

    if (topGap >= 0.1) {
      return {
        label: "中-偏客",
        note: "客胜排第一且前二差值已有一定拉开，当前更偏向客队。"
      };
    }
    if (drawProb >= 0.27) {
      return {
        label: "中-偏平",
        note: "虽然客胜排第一，但差值不大且平局概率偏高，当前更适合优先防平。"
      };
    }
    return {
      label: "中-偏客",
      note: "客胜排第一，但领先优势不算大，当前只是偏客而不是强客。"
    };
  }

  if (topGap < 0.05 && secondKey !== "draw") {
    return {
      label: "谨慎-主客胶着",
      note: "第一和第二概率几乎贴在一起，而且是主客直接对冲，这类更像主客胶着盘。"
    };
  }

  return {
    label: "谨慎-不建议单押",
    note: "当前结构缺乏足够清晰的单边信号，更适合放弃单押或改看双结果。"
  };
}

function buildRuleExplanation(finalProb, metrics, decision) {
  const parts = [];
  const leadOutcome = outcomeLabels[decision.primaryKey];
  const secondOutcome = decision.secondaryKey ? outcomeLabels[decision.secondaryKey] : "";

  if (metrics.consensus >= 0.75) {
    parts.push("6 家公司的初始赔率方向较一致");
  } else if (metrics.consensus >= 0.6) {
    parts.push("市场存在温和共识");
  } else {
    parts.push("公司之间分歧较明显");
  }

  if (metrics.outlierCount > 0) {
    parts.push("已对偏离市场的公司做轻度降权");
  }

  if (finalProb.draw >= 0.28) {
    parts.push("平局概率没有被明显拉开");
  }

  if (metrics.favoriteVoteShare < THRESHOLDS.favoriteVoteShareMin) {
    parts.push("各家公司最低赔方向并不完全一致");
  }

  if (decision.type === "abstain") {
    return `${parts.join("，")}，当前更适合把这场视为低确定性场次，主动放弃单押。`;
  }

  if (decision.type === "draw-single") {
    return `${parts.join("，")}，同时主客两端接近，因此把平局提升为单结果。`;
  }

  if (decision.type === "double") {
    return `${parts.join("，")}，因此将结果收敛为 ${leadOutcome}/${secondOutcome} 双结果。`;
  }

  return `${parts.join("，")}，最终偏向 ${leadOutcome}。`;
}

function validateRows(rows) {
  if (!Array.isArray(rows) || rows.length !== FIXED_COMPANIES.length) {
    throw new Error(`必须提供 ${FIXED_COMPANIES.length} 家公司的初始赔率。`);
  }

  return rows.map((row, index) => {
    const normalized = {
      company: FIXED_COMPANIES[index],
      home: Number(row.home),
      draw: Number(row.draw),
      away: Number(row.away)
    };

    for (const key of ["home", "draw", "away"]) {
      const value = normalized[key];
      if (!Number.isFinite(value) || value <= 1.01 || value >= 100) {
        throw new Error(`${FIXED_COMPANIES[index]} 的${outcomeLabels[key]}赔率无效。`);
      }
    }

    return normalized;
  });
}

function computeRulePrediction(rows) {
  const cleanRows = validateRows(rows);
  const favoriteVotes = { home: 0, draw: 0, away: 0 };

  cleanRows.forEach((row) => {
    const ordered = [
      { key: "home", odds: row.home },
      { key: "draw", odds: row.draw },
      { key: "away", odds: row.away }
    ].sort((left, right) => left.odds - right.odds);
    favoriteVotes[ordered[0].key] += 1;
  });

  const probabilityRows = cleanRows.map((row) =>
    toProbabilityRow(row.home, row.draw, row.away)
  );

  const meanProb = {
    home: average(probabilityRows.map((row) => row.home)),
    draw: average(probabilityRows.map((row) => row.draw)),
    away: average(probabilityRows.map((row) => row.away))
  };

  const distances = probabilityRows.map((row) => distance(row, meanProb));
  const meanDistance = average(distances);
  const stdDistance = standardDeviation(distances);
  const outlierCutoff = Math.max(0.045, meanDistance + stdDistance);

  const weights = distances.map((value) => {
    if (value <= outlierCutoff) {
      return 1;
    }
    return clamp(1 - (value - outlierCutoff) * 8, 0.52, 0.92);
  });

  const weightSum = weights.reduce((sum, value) => sum + value, 0);
  const finalProb = normalizeProbabilities({
    home:
      probabilityRows.reduce((sum, row, index) => sum + row.home * weights[index], 0) /
      weightSum,
    draw:
      probabilityRows.reduce((sum, row, index) => sum + row.draw * weights[index], 0) /
      weightSum,
    away:
      probabilityRows.reduce((sum, row, index) => sum + row.away * weights[index], 0) /
      weightSum
  });

  const dispersion = average([
    standardDeviation(probabilityRows.map((row) => row.home)),
    standardDeviation(probabilityRows.map((row) => row.draw)),
    standardDeviation(probabilityRows.map((row) => row.away))
  ]);

  const consensus = clamp(1 - meanDistance / 0.09, 0, 1);
  const outlierCount = distances.filter((value) => value > outlierCutoff).length;
  const homeAwayGap = Math.abs(finalProb.home - finalProb.away);
  const drawPressure = finalProb.draw - average([finalProb.home, finalProb.away]);
  const strongestSide = Math.max(finalProb.home, finalProb.away);
  const drawGapToLeader = strongestSide - finalProb.draw;

  const ranked = [
    { key: "home", value: finalProb.home },
    { key: "draw", value: finalProb.draw },
    { key: "away", value: finalProb.away }
  ].sort((left, right) => right.value - left.value);

  const topGap = ranked[0].value - ranked[1].value;
  const favoriteVoteShare = favoriteVotes[ranked[0].key] / cleanRows.length;
  const homeVoteShare = favoriteVotes.home / cleanRows.length;
  const drawVoteShare = favoriteVotes.draw / cleanRows.length;
  const awayVoteShare = favoriteVotes.away / cleanRows.length;
  const sideLeaderKey = finalProb.home >= finalProb.away ? "home" : "away";
  const sideLeaderProb = finalProb[sideLeaderKey];
  const splitSides = Math.max(homeVoteShare, awayVoteShare) <= THRESHOLDS.splitVoteShareMax;
  const leaderKey = ranked[0].key;
  const secondKey = ranked[1].key;

  const drawSingle =
    finalProb.draw >= THRESHOLDS.drawMinimum &&
    homeAwayGap <= THRESHOLDS.drawHomeAwayGapMax &&
    dispersion <= THRESHOLDS.drawDispersionMax &&
    (
      drawGapToLeader <= THRESHOLDS.drawLeadSlack ||
      (splitSides && drawGapToLeader <= THRESHOLDS.drawSplitLeadSlack)
    );

  const strongNonDrawSingle =
    ranked[0].key !== "draw" &&
    ranked[0].value >= THRESHOLDS.strongSingleProbabilityMin &&
    topGap >= THRESHOLDS.strongSingleGapMin &&
    favoriteVoteShare >= THRESHOLDS.strongSingleVoteShareMin &&
    finalProb.draw <= THRESHOLDS.strongSingleDrawMax;

  const sideDrawDouble =
    !drawSingle &&
    !strongNonDrawSingle &&
    sideLeaderKey !== "draw" &&
    finalProb.draw >= THRESHOLDS.sideDrawDoubleMin &&
    sideLeaderProb - finalProb.draw <= THRESHOLDS.sideDrawDoubleGapMax;

  const homeAwayDouble =
    !drawSingle &&
    !strongNonDrawSingle &&
    !sideDrawDouble &&
    splitSides &&
    homeAwayGap <= THRESHOLDS.homeAwayDoubleGapMax &&
    finalProb.draw < THRESHOLDS.drawMinimum;

  const baseConfidence = confidenceLabel(consensus, topGap);
  const confidenceProfile = buildRuleConfidenceProfile(
    baseConfidence,
    ranked,
    finalProb,
    topGap
  );

  let decision;
  if (drawSingle) {
    decision = { type: "draw-single", primaryKey: "draw", secondaryKey: null };
  } else if (baseConfidence === "高" && strongNonDrawSingle) {
    decision = { type: "single", primaryKey: ranked[0].key, secondaryKey: null };
  } else if (baseConfidence === "高") {
    if (sideDrawDouble) {
      decision = { type: "double", primaryKey: sideLeaderKey, secondaryKey: "draw" };
    } else if (homeAwayDouble) {
      decision = { type: "double", primaryKey: "home", secondaryKey: "away" };
    } else if (leaderKey === "draw" || finalProb.draw >= THRESHOLDS.drawMinimum) {
      decision = { type: "draw-single", primaryKey: "draw", secondaryKey: null };
    } else {
      decision = {
        type: "double",
        primaryKey: leaderKey,
        secondaryKey: secondKey === leaderKey ? ranked[2].key : secondKey
      };
    }
  } else if (baseConfidence === "中") {
    if (confidenceProfile.label === "中-偏平") {
      const preferredSide =
        leaderKey === "draw" ? (finalProb.home >= finalProb.away ? "home" : "away") : leaderKey;
      decision = { type: "double", primaryKey: preferredSide, secondaryKey: "draw" };
    } else if (confidenceProfile.label === "中-偏主") {
      decision = {
        type: "double",
        primaryKey: "home",
        secondaryKey: secondKey === "draw" || finalProb.draw >= 0.27 ? "draw" : "away"
      };
    } else {
      decision = {
        type: "double",
        primaryKey: "away",
        secondaryKey: secondKey === "draw" || finalProb.draw >= 0.27 ? "draw" : "home"
      };
    }
  } else if (
    confidenceProfile.label === "谨慎-主客胶着" &&
    topGap >= 0.04
  ) {
    decision = { type: "double", primaryKey: "home", secondaryKey: "away" };
  } else {
    decision = { type: "abstain", primaryKey: leaderKey, secondaryKey: null };
  }

  return {
    companies: FIXED_COMPANIES,
    recommendation:
      decision.type === "abstain"
        ? "不建议单押"
        : decision.type === "double"
        ? `${outcomeLabels[decision.primaryKey]}/${outcomeLabels[decision.secondaryKey]}`
        : outcomeLabels[decision.primaryKey],
    allowDouble: decision.type === "double",
    abstained: decision.type === "abstain",
    drawSingle: decision.type === "draw-single",
    decision,
    confidence: baseConfidence,
    confidenceProfile,
    finalProb,
    metrics: {
      consensus,
      dispersion,
      outlierCount,
      homeAwayGap,
      drawPressure,
      drawGapToLeader,
      homeVoteShare,
      drawVoteShare,
      awayVoteShare,
      favoriteVoteShare,
      topGap,
      strongNonDrawSingle
    },
    engine: "rule",
    engineLabel: "默认规则模型",
    explanation: buildRuleExplanation(
      finalProb,
      {
        consensus,
        outlierCount,
        favoriteVoteShare
      },
      decision
    )
  };
}

module.exports = {
  FIXED_COMPANIES,
  computeRulePrediction
};
