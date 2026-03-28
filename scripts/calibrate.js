#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const https = require("node:https");

const ROOT_DIR = path.resolve(__dirname, "..");
const OUTPUT_PATH = path.join(ROOT_DIR, "calibration", "latest.json");

const DATA_SOURCE = {
  site: "football-data.co.uk",
  seasonsTrain: ["2122", "2223"],
  seasonsValidation: ["2324"],
  leagues: ["E0", "E1", "E2", "E3", "EC", "SP1", "SP2", "D1", "D2", "I1", "I2", "F1", "F2", "N1", "P1", "T1", "B1"],
  companyCoverage: ["Bet365", "Bwin", "William Hill", "Interwetten", "Pinnacle", "BetVictor"],
  pluginCompanies: ["Bet365", "William Hill", "Bwin", "Interwetten", "Pinnacle", "BetVictor"],
  note:
    "监督学习模型基于 football-data.co.uk 长期公开且交集稳定的 6 家公司：Bet365、Bwin、William Hill、Interwetten、Pinnacle、BetVictor，并额外加入开盘到临场的 1X2 赔率变化特征。训练集覆盖 10000+ 场比赛，并用独立赛季做验证。"
};

const COMPANY_COLUMNS = [
  {
    name: "Bet365",
    openingColumns: ["B365H", "B365D", "B365A"],
    closingColumns: ["B365CH", "B365CD", "B365CA"]
  },
  {
    name: "Bwin",
    openingColumns: ["BWH", "BWD", "BWA"],
    closingColumns: ["BWCH", "BWCD", "BWCA"]
  },
  {
    name: "William Hill",
    openingColumns: ["WHH", "WHD", "WHA"],
    closingColumns: ["WHCH", "WHCD", "WHCA"]
  },
  {
    name: "Interwetten",
    openingColumns: ["IWH", "IWD", "IWA"],
    closingColumns: ["IWCH", "IWCD", "IWCA"]
  },
  {
    name: "Pinnacle",
    openingColumns: ["PSH", "PSD", "PSA"],
    closingColumns: ["PSCH", "PSCD", "PSCA"]
  },
  {
    name: "BetVictor",
    openingColumns: ["VCH", "VCD", "VCA"],
    closingColumns: ["VCCH", "VCCD", "VCCA"]
  }
];

const CLASS_ORDER = ["H", "D", "A"];
const OUTCOME_KEYS = ["home", "draw", "away"];
const OUTCOME_MAP = {
  H: "home",
  D: "draw",
  A: "away"
};

const TRAINING_OPTIONS = {
  epochs: 120,
  batchSize: 256,
  learningRate: 0.02,
  l2: 0.0005,
  beta1: 0.9,
  beta2: 0.999,
  epsilon: 1e-8,
  classWeightPower: 0
};

const DECISION_POLICY_SEARCH = {
  minGap: 0,
  maxGap: 0.2,
  step: 0.002,
  maxDoubleRateTarget: 0.3
};

const HIGH_CONFIDENCE_SEARCH = {
  topProbMinValues: [0.46, 0.48, 0.5, 0.52, 0.54, 0.56, 0.58, 0.6],
  topGapMinValues: [0.08, 0.1, 0.12, 0.14, 0.16, 0.18],
  consensusMinValues: [0.5, 0.6, 0.7, 0.8],
  favoriteVoteShareMinValues: [0.5, 0.67, 0.83, 1],
  minAcceptedMatches: 180,
  minAcceptedAccuracyTarget: 0.6
};

const FEATURE_NAMES = [
  ...COMPANY_COLUMNS.flatMap((company) => [
    `${company.name}:home_prob`,
    `${company.name}:draw_prob`,
    `${company.name}:away_prob`
  ]),
  "mean:home_prob",
  "mean:draw_prob",
  "mean:away_prob",
  "std:home_prob",
  "std:draw_prob",
  "std:away_prob",
  "range:home_prob",
  "range:draw_prob",
  "range:away_prob",
  "votes:home_share",
  "votes:draw_share",
  "votes:away_share",
  "market:top_prob",
  "market:second_prob",
  "market:top_gap",
  "market:home_away_gap",
  "market:skew_signed",
  "market:draw_vs_side",
  "market:consensus",
  "market:outlier_share",
  "market:dispersion",
  "market:overround_mean",
  ...COMPANY_COLUMNS.flatMap((company) => [
    `${company.name}:close_home_prob`,
    `${company.name}:close_draw_prob`,
    `${company.name}:close_away_prob`
  ]),
  "close:mean_home_prob",
  "close:mean_draw_prob",
  "close:mean_away_prob",
  "close:std_home_prob",
  "close:std_draw_prob",
  "close:std_away_prob",
  "close:range_home_prob",
  "close:range_draw_prob",
  "close:range_away_prob",
  "close:votes_home_share",
  "close:votes_draw_share",
  "close:votes_away_share",
  "close:top_prob",
  "close:second_prob",
  "close:top_gap",
  "close:home_away_gap",
  "close:skew_signed",
  "close:draw_vs_side",
  "close:consensus",
  "close:outlier_share",
  "close:dispersion",
  "close:overround_mean",
  "delta:mean_home_prob",
  "delta:mean_draw_prob",
  "delta:mean_away_prob",
  "delta:absolute_home_prob",
  "delta:absolute_draw_prob",
  "delta:absolute_away_prob",
  "delta:favorite_flip_share",
  "delta:top_gap_change",
  "delta:skew_change",
  "delta:draw_vs_side_change",
  "delta:consensus_change",
  "delta:overround_change",
  "poly:home_draw",
  "poly:home_away",
  "poly:draw_away",
  "poly:top_gap_sq",
  "poly:skew_sq",
  "poly:draw_vs_side_sq"
];

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function average(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function standardDeviation(values) {
  const mean = average(values);
  return Math.sqrt(average(values.map((value) => (value - mean) ** 2)));
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

function distance(left, right) {
  return Math.sqrt(
    (left.home - right.home) ** 2 +
      (left.draw - right.draw) ** 2 +
      (left.away - right.away) ** 2
  );
}

function roundMetric(value) {
  return Number(value.toFixed(4));
}

function roundArray(values, digits = 6) {
  return values.map((value) => Number(value.toFixed(digits)));
}

function roundMatrix(matrix, digits = 6) {
  return matrix.map((row) => roundArray(row, digits));
}

function createRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffleIndices(length, random) {
  const indices = Array.from({ length }, (_, index) => index);
  for (let index = indices.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [indices[index], indices[swapIndex]] = [indices[swapIndex], indices[index]];
  }
  return indices;
}

function parseCsvLine(line) {
  const fields = [];
  let current = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];

    if (char === "\"") {
      if (quoted && line[index + 1] === "\"") {
        current += "\"";
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }

    if (char === "," && !quoted) {
      fields.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  fields.push(current);
  return fields;
}

function parseCsv(text) {
  const lines = text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((line) => line.trim() !== "");

  if (lines.length === 0) {
    return [];
  }

  const header = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const cells = parseCsvLine(line);
    const row = {};
    header.forEach((key, index) => {
      row[key] = cells[index] ?? "";
    });
    return row;
  });
}

function fetchText(url) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, (response) => {
      const statusCode = response.statusCode ?? 0;

      if (statusCode >= 300 && statusCode < 400 && response.headers.location) {
        response.resume();
        resolve(fetchText(response.headers.location));
        return;
      }

      if (statusCode !== 200) {
        response.resume();
        reject(new Error(`Failed to fetch ${url}: ${statusCode}`));
        return;
      }

      response.setEncoding("utf8");
      let data = "";
      response.on("data", (chunk) => {
        data += chunk;
      });
      response.on("end", () => resolve(data));
    });

    request.on("error", reject);
    request.setTimeout(30000, () => {
      request.destroy(new Error(`Timed out while fetching ${url}`));
    });
  });
}

function parseOddsRows(rawRow, phase = "opening") {
  const oddsRows = [];

  for (const company of COMPANY_COLUMNS) {
    const columns = phase === "closing" ? company.closingColumns : company.openingColumns;
    const values = columns.map((column) => Number(rawRow[column]));
    if (!values.every((value) => Number.isFinite(value) && value > 1.01)) {
      return null;
    }

    oddsRows.push({
      company: company.name,
      home: values[0],
      draw: values[1],
      away: values[2]
    });
  }

  return oddsRows;
}

function buildMarketSummary(rows) {
  const probabilityRows = rows.map((row) => toProbabilityRow(row.home, row.draw, row.away));
  const lowestVotes = { home: 0, draw: 0, away: 0 };

  rows.forEach((row) => {
    const ordered = [
      { key: "home", odds: row.home },
      { key: "draw", odds: row.draw },
      { key: "away", odds: row.away }
    ].sort((left, right) => left.odds - right.odds);
    lowestVotes[ordered[0].key] += 1;
  });

  const meanProb = {
    home: average(probabilityRows.map((row) => row.home)),
    draw: average(probabilityRows.map((row) => row.draw)),
    away: average(probabilityRows.map((row) => row.away))
  };

  const stdProb = {
    home: standardDeviation(probabilityRows.map((row) => row.home)),
    draw: standardDeviation(probabilityRows.map((row) => row.draw)),
    away: standardDeviation(probabilityRows.map((row) => row.away))
  };

  const rangeProb = {
    home:
      Math.max(...probabilityRows.map((row) => row.home)) -
      Math.min(...probabilityRows.map((row) => row.home)),
    draw:
      Math.max(...probabilityRows.map((row) => row.draw)) -
      Math.min(...probabilityRows.map((row) => row.draw)),
    away:
      Math.max(...probabilityRows.map((row) => row.away)) -
      Math.min(...probabilityRows.map((row) => row.away))
  };

  const distances = probabilityRows.map((row) => distance(row, meanProb));
  const meanDistance = average(distances);
  const stdDistance = standardDeviation(distances);
  const outlierCutoff = Math.max(0.045, meanDistance + stdDistance);
  const outlierShare = distances.filter((value) => value > outlierCutoff).length / rows.length;
  const consensus = clamp(1 - meanDistance / 0.09, 0, 1);
  const dispersion = average([stdProb.home, stdProb.draw, stdProb.away]);

  const ranked = [
    { key: "home", value: meanProb.home },
    { key: "draw", value: meanProb.draw },
    { key: "away", value: meanProb.away }
  ].sort((left, right) => right.value - left.value);

  const topProb = ranked[0].value;
  const secondProb = ranked[1].value;
  const topGap = topProb - secondProb;
  const homeAwayGap = Math.abs(meanProb.home - meanProb.away);
  const skewSigned = meanProb.home - meanProb.away;
  const drawVsSide = meanProb.draw - Math.max(meanProb.home, meanProb.away);
  const overroundMean = average(rows.map((row) => 1 / row.home + 1 / row.draw + 1 / row.away));

  return {
    probabilityRows,
    metrics: {
      meanProb,
      stdProb,
      rangeProb,
      consensus,
      outlierShare,
      dispersion,
      outlierCount: Math.round(outlierShare * rows.length),
      favoriteVoteShare:
        Math.max(lowestVotes.home, lowestVotes.draw, lowestVotes.away) / rows.length,
      homeVoteShare: lowestVotes.home / rows.length,
      drawVoteShare: lowestVotes.draw / rows.length,
      awayVoteShare: lowestVotes.away / rows.length,
      topGap,
      homeAwayGap,
      topProb,
      secondProb,
      skewSigned,
      drawVsSide,
      overroundMean
    }
  };
}

function buildMarketFeatures(openingRows, closingRows) {
  const opening = buildMarketSummary(openingRows);
  const closing = buildMarketSummary(closingRows);
  const favoriteFlipShare =
    openingRows.filter((row, index) => {
      const openingFavorite = [
        { key: "home", odds: row.home },
        { key: "draw", odds: row.draw },
        { key: "away", odds: row.away }
      ].sort((left, right) => left.odds - right.odds)[0].key;
      const closingFavorite = [
        { key: "home", odds: closingRows[index].home },
        { key: "draw", odds: closingRows[index].draw },
        { key: "away", odds: closingRows[index].away }
      ].sort((left, right) => left.odds - right.odds)[0].key;
      return openingFavorite !== closingFavorite;
    }).length / openingRows.length;

  const deltaMean = {
    home: closing.metrics.meanProb.home - opening.metrics.meanProb.home,
    draw: closing.metrics.meanProb.draw - opening.metrics.meanProb.draw,
    away: closing.metrics.meanProb.away - opening.metrics.meanProb.away
  };

  const deltaAbsMean = {
    home: average(
      opening.probabilityRows.map((row, index) =>
        Math.abs(closing.probabilityRows[index].home - row.home)
      )
    ),
    draw: average(
      opening.probabilityRows.map((row, index) =>
        Math.abs(closing.probabilityRows[index].draw - row.draw)
      )
    ),
    away: average(
      opening.probabilityRows.map((row, index) =>
        Math.abs(closing.probabilityRows[index].away - row.away)
      )
    )
  };

  return {
    vector: [
      ...opening.probabilityRows.flatMap((row) => [row.home, row.draw, row.away]),
      opening.metrics.meanProb.home,
      opening.metrics.meanProb.draw,
      opening.metrics.meanProb.away,
      opening.metrics.stdProb.home,
      opening.metrics.stdProb.draw,
      opening.metrics.stdProb.away,
      opening.metrics.rangeProb.home,
      opening.metrics.rangeProb.draw,
      opening.metrics.rangeProb.away,
      opening.metrics.homeVoteShare,
      opening.metrics.drawVoteShare,
      opening.metrics.awayVoteShare,
      opening.metrics.topProb,
      opening.metrics.secondProb,
      opening.metrics.topGap,
      opening.metrics.homeAwayGap,
      opening.metrics.skewSigned,
      opening.metrics.drawVsSide,
      opening.metrics.consensus,
      opening.metrics.outlierShare,
      opening.metrics.dispersion,
      opening.metrics.overroundMean,
      ...closing.probabilityRows.flatMap((row) => [row.home, row.draw, row.away]),
      closing.metrics.meanProb.home,
      closing.metrics.meanProb.draw,
      closing.metrics.meanProb.away,
      closing.metrics.stdProb.home,
      closing.metrics.stdProb.draw,
      closing.metrics.stdProb.away,
      closing.metrics.rangeProb.home,
      closing.metrics.rangeProb.draw,
      closing.metrics.rangeProb.away,
      closing.metrics.homeVoteShare,
      closing.metrics.drawVoteShare,
      closing.metrics.awayVoteShare,
      closing.metrics.topProb,
      closing.metrics.secondProb,
      closing.metrics.topGap,
      closing.metrics.homeAwayGap,
      closing.metrics.skewSigned,
      closing.metrics.drawVsSide,
      closing.metrics.consensus,
      closing.metrics.outlierShare,
      closing.metrics.dispersion,
      closing.metrics.overroundMean,
      deltaMean.home,
      deltaMean.draw,
      deltaMean.away,
      deltaAbsMean.home,
      deltaAbsMean.draw,
      deltaAbsMean.away,
      favoriteFlipShare,
      closing.metrics.topGap - opening.metrics.topGap,
      closing.metrics.skewSigned - opening.metrics.skewSigned,
      closing.metrics.drawVsSide - opening.metrics.drawVsSide,
      closing.metrics.consensus - opening.metrics.consensus,
      closing.metrics.overroundMean - opening.metrics.overroundMean,
      opening.metrics.meanProb.home * opening.metrics.meanProb.draw,
      opening.metrics.meanProb.home * opening.metrics.meanProb.away,
      opening.metrics.meanProb.draw * opening.metrics.meanProb.away,
      opening.metrics.topGap * opening.metrics.topGap,
      opening.metrics.skewSigned * opening.metrics.skewSigned,
      opening.metrics.drawVsSide * opening.metrics.drawVsSide
    ],
    metrics: opening.metrics
  };
}

function loadMatchesRows(rows, season, league) {
  const matches = [];

  rows.forEach((row) => {
    if (!CLASS_ORDER.includes(row.FTR)) {
      return;
    }

    const openingRows = parseOddsRows(row, "opening");
    const closingRows = parseOddsRows(row, "closing");
    if (!openingRows || !closingRows) {
      return;
    }

    const market = buildMarketFeatures(openingRows, closingRows);
    matches.push({
      season,
      league,
      homeTeam: row.HomeTeam,
      awayTeam: row.AwayTeam,
      result: row.FTR,
      oddsRows: openingRows,
      closingRows,
      features: market.vector,
      marketMetrics: market.metrics
    });
  });

  return matches;
}

async function loadMatches(seasons) {
  const matches = [];

  for (const season of seasons) {
    for (const league of DATA_SOURCE.leagues) {
      const url = `https://www.football-data.co.uk/mmz4281/${season}/${league}.csv`;
      const rows = parseCsv(await fetchText(url));
      matches.push(...loadMatchesRows(rows, season, league));
    }
  }

  return matches;
}

function normalizeFeatureMatrix(matrix) {
  const featureCount = matrix[0].length;
  const means = Array(featureCount).fill(0);
  const scales = Array(featureCount).fill(1);

  for (let featureIndex = 0; featureIndex < featureCount; featureIndex += 1) {
    const column = matrix.map((row) => row[featureIndex]);
    means[featureIndex] = average(column);
    const deviation = standardDeviation(column);
    scales[featureIndex] = deviation > 1e-9 ? deviation : 1;
  }

  return {
    means,
    scales,
    normalized: matrix.map((row) =>
      row.map((value, featureIndex) => (value - means[featureIndex]) / scales[featureIndex])
    )
  };
}

function createClassWeights(labels, power) {
  const counts = Array(CLASS_ORDER.length).fill(0);
  labels.forEach((label) => {
    counts[label] += 1;
  });

  const total = labels.length;
  return counts.map((count) => Math.pow(total / (CLASS_ORDER.length * count), power));
}

function softmax(logits) {
  const maxLogit = Math.max(...logits);
  const exps = logits.map((value) => Math.exp(value - maxLogit));
  const total = exps.reduce((sum, value) => sum + value, 0);
  return exps.map((value) => value / total);
}

function dot(weights, vector) {
  let sum = 0;
  for (let index = 0; index < vector.length; index += 1) {
    sum += weights[index] * vector[index];
  }
  return sum;
}

function trainSoftmaxRegression(featureMatrix, labels, options) {
  const classCount = CLASS_ORDER.length;
  const featureCount = featureMatrix[0].length;
  const weights = Array.from({ length: classCount }, () => Array(featureCount).fill(0));
  const biases = Array(classCount).fill(0);
  const mWeights = Array.from({ length: classCount }, () => Array(featureCount).fill(0));
  const vWeights = Array.from({ length: classCount }, () => Array(featureCount).fill(0));
  const mBiases = Array(classCount).fill(0);
  const vBiases = Array(classCount).fill(0);
  const classWeights = createClassWeights(labels, options.classWeightPower);
  const random = createRandom(42);

  let step = 0;

  for (let epoch = 0; epoch < options.epochs; epoch += 1) {
    const indices = shuffleIndices(featureMatrix.length, random);

    for (let start = 0; start < indices.length; start += options.batchSize) {
      const batch = indices.slice(start, start + options.batchSize);
      const gradWeights = Array.from({ length: classCount }, () => Array(featureCount).fill(0));
      const gradBiases = Array(classCount).fill(0);
      let batchWeight = 0;

      batch.forEach((sampleIndex) => {
        const vector = featureMatrix[sampleIndex];
        const label = labels[sampleIndex];
        const sampleWeight = classWeights[label];
        const logits = CLASS_ORDER.map((_, classIndex) => dot(weights[classIndex], vector) + biases[classIndex]);
        const probabilities = softmax(logits);
        batchWeight += sampleWeight;

        for (let classIndex = 0; classIndex < classCount; classIndex += 1) {
          const error = (probabilities[classIndex] - (classIndex === label ? 1 : 0)) * sampleWeight;
          for (let featureIndex = 0; featureIndex < featureCount; featureIndex += 1) {
            gradWeights[classIndex][featureIndex] += error * vector[featureIndex];
          }
          gradBiases[classIndex] += error;
        }
      });

      const inverseWeight = 1 / Math.max(batchWeight, 1);
      step += 1;

      for (let classIndex = 0; classIndex < classCount; classIndex += 1) {
        for (let featureIndex = 0; featureIndex < featureCount; featureIndex += 1) {
          const gradient =
            gradWeights[classIndex][featureIndex] * inverseWeight +
            options.l2 * weights[classIndex][featureIndex];

          mWeights[classIndex][featureIndex] =
            options.beta1 * mWeights[classIndex][featureIndex] +
            (1 - options.beta1) * gradient;
          vWeights[classIndex][featureIndex] =
            options.beta2 * vWeights[classIndex][featureIndex] +
            (1 - options.beta2) * gradient * gradient;

          const mHat =
            mWeights[classIndex][featureIndex] / (1 - Math.pow(options.beta1, step));
          const vHat =
            vWeights[classIndex][featureIndex] / (1 - Math.pow(options.beta2, step));

          weights[classIndex][featureIndex] -=
            (options.learningRate * mHat) / (Math.sqrt(vHat) + options.epsilon);
        }

        const biasGradient = gradBiases[classIndex] * inverseWeight;
        mBiases[classIndex] =
          options.beta1 * mBiases[classIndex] + (1 - options.beta1) * biasGradient;
        vBiases[classIndex] =
          options.beta2 * vBiases[classIndex] + (1 - options.beta2) * biasGradient * biasGradient;

        const mHatBias = mBiases[classIndex] / (1 - Math.pow(options.beta1, step));
        const vHatBias = vBiases[classIndex] / (1 - Math.pow(options.beta2, step));
        biases[classIndex] -=
          (options.learningRate * mHatBias) / (Math.sqrt(vHatBias) + options.epsilon);
      }
    }
  }

  return {
    type: "multinomial-logistic-regression",
    classOrder: CLASS_ORDER,
    weights,
    biases,
    classWeights
  };
}

function predictProbabilities(vector, model) {
  const standardized = vector.map(
    (value, featureIndex) =>
      (value - model.normalization.means[featureIndex]) / model.normalization.scales[featureIndex]
  );
  const logits = model.classOrder.map((_, classIndex) => dot(model.weights[classIndex], standardized) + model.biases[classIndex]);
  const probabilities = softmax(logits);

  return Object.fromEntries(
    model.classOrder.map((label, index) => [label, probabilities[index]])
  );
}

function buildProbabilityRecords(matches, model) {
  return matches.map((match) => ({
    result: match.result,
    probabilities: predictProbabilities(match.features, model),
    consensus: match.marketMetrics.consensus,
    favoriteVoteShare: match.marketMetrics.favoriteVoteShare
  }));
}

function summarizeCounters(counter) {
  return Object.fromEntries(
    Object.entries(counter).sort((left, right) => right[1] - left[1])
  );
}

function evaluateMajorityFavoriteBaseline(matches) {
  let hits = 0;
  let drawCount = 0;

  matches.forEach((match) => {
    const votes = { H: 0, D: 0, A: 0 };
    match.oddsRows.forEach((row) => {
      const ordered = [
        { label: "H", odds: row.home },
        { label: "D", odds: row.draw },
        { label: "A", odds: row.away }
      ].sort((left, right) => left.odds - right.odds);
      votes[ordered[0].label] += 1;
    });

    const prediction = Object.entries(votes).sort((left, right) => right[1] - left[1])[0][0];
    if (prediction === match.result) {
      hits += 1;
    }
    if (prediction === "D") {
      drawCount += 1;
    }
  });

  return {
    matches: matches.length,
    exactHitRate: roundMetric(hits / matches.length),
    drawShare: roundMetric(drawCount / matches.length)
  };
}

function applyDecision(probabilities, decisionPolicy) {
  const ranked = Object.entries(probabilities)
    .sort((left, right) => right[1] - left[1])
    .map(([label, probability]) => ({ label, probability }));

  if (ranked[0].probability - ranked[1].probability <= decisionPolicy.doubleGapThreshold) {
    return {
      type: "double",
      primary: ranked[0].label,
      secondary: ranked[1].label
    };
  }

  return {
    type: "single",
    primary: ranked[0].label,
    secondary: null
  };
}

function buildPredictionLabel(decision) {
  if (decision.type === "double") {
    return `${decision.primary}${decision.secondary}`;
  }
  return decision.primary;
}

function evaluateDecisionPolicy(records, decisionPolicy) {
  let top1Hits = 0;
  let singleHits = 0;
  let inclusiveHits = 0;
  let weightedHits = 0;
  let singleCount = 0;
  let doubleCount = 0;
  let drawSingleCount = 0;
  let drawSingleHits = 0;
  const predictionCounter = {};

  records.forEach((record) => {
    const ranked = Object.entries(record.probabilities)
      .sort((left, right) => right[1] - left[1])
      .map(([label, probability]) => ({ label, probability }));

    if (ranked[0].label === record.result) {
      top1Hits += 1;
    }

    const decision = applyDecision(record.probabilities, decisionPolicy);
    const label = buildPredictionLabel(decision);
    predictionCounter[label] = (predictionCounter[label] ?? 0) + 1;

    if (decision.type === "double") {
      doubleCount += 1;
      if (label.includes(record.result)) {
        inclusiveHits += 1;
        weightedHits += 0.72;
      }
      return;
    }

    singleCount += 1;
    if (decision.primary === record.result) {
      singleHits += 1;
      inclusiveHits += 1;
      weightedHits += 1;
    }

    if (decision.primary === "D") {
      drawSingleCount += 1;
      if (record.result === "D") {
        drawSingleHits += 1;
      }
    }
  });

  return {
    matches: records.length,
    top1Accuracy: roundMetric(top1Hits / records.length),
    singleRate: roundMetric(singleCount / records.length),
    singlePredictionAccuracy: roundMetric(singleHits / Math.max(singleCount, 1)),
    exactSingleHitRate: roundMetric(singleHits / records.length),
    inclusiveHitRate: roundMetric(inclusiveHits / records.length),
    weightedHitRate: roundMetric(weightedHits / records.length),
    doubleRate: roundMetric(doubleCount / records.length),
    drawSingleRate: roundMetric(drawSingleCount / records.length),
    drawSinglePrecision: roundMetric(drawSingleHits / Math.max(drawSingleCount, 1)),
    predictionBreakdown: summarizeCounters(predictionCounter)
  };
}

function decisionPolicyObjective(metrics) {
  let score = metrics.inclusiveHitRate * 0.7;
  score += metrics.singlePredictionAccuracy * 0.35;
  score += metrics.top1Accuracy * 0.25;
  score += metrics.weightedHitRate * 0.1;

  score -= Math.max(0, metrics.doubleRate - DECISION_POLICY_SEARCH.maxDoubleRateTarget) * 3.4;
  score -= Math.max(0, 0.18 - metrics.doubleRate) * 0.15;
  score -= Math.max(0, 0.08 - metrics.drawSingleRate) * 0.6;
  score -= Math.max(0, metrics.drawSingleRate - 0.22) * 0.25;
  score -= Math.max(0, 0.28 - metrics.drawSinglePrecision) * 0.35;

  return score;
}

function chooseDecisionPolicy(records) {
  let best = null;

  for (
    let threshold = DECISION_POLICY_SEARCH.minGap;
    threshold <= DECISION_POLICY_SEARCH.maxGap + 1e-9;
    threshold += DECISION_POLICY_SEARCH.step
  ) {
    const policy = {
      doubleGapThreshold: Number(threshold.toFixed(3)),
      maxDoubleRateTarget: DECISION_POLICY_SEARCH.maxDoubleRateTarget
    };
    const metrics = evaluateDecisionPolicy(records, policy);
    const score = decisionPolicyObjective(metrics);

    if (!best || score > best.score) {
      best = { policy, metrics, score };
    }
  }

  return best;
}

function evaluateHighConfidencePolicy(records, policy) {
  let acceptedCount = 0;
  let acceptedHits = 0;

  records.forEach((record) => {
    const ranked = Object.entries(record.probabilities)
      .sort((left, right) => right[1] - left[1])
      .map(([label, probability]) => ({ label, probability }));

    const topProbability = ranked[0].probability;
    const topGap = ranked[0].probability - ranked[1].probability;

    if (topProbability < policy.topProbabilityMin) {
      return;
    }
    if (topGap < policy.topGapMin) {
      return;
    }
    if (record.consensus < policy.consensusMin) {
      return;
    }
    if (record.favoriteVoteShare < policy.favoriteVoteShareMin) {
      return;
    }

    acceptedCount += 1;
    if (ranked[0].label === record.result) {
      acceptedHits += 1;
    }
  });

  return {
    matches: records.length,
    acceptedCount,
    acceptedRate: roundMetric(acceptedCount / records.length),
    acceptedAccuracy: roundMetric(acceptedHits / Math.max(acceptedCount, 1))
  };
}

function chooseHighConfidencePolicy(trainRecords, validationRecords) {
  let best = null;

  HIGH_CONFIDENCE_SEARCH.topProbMinValues.forEach((topProbabilityMin) => {
    HIGH_CONFIDENCE_SEARCH.topGapMinValues.forEach((topGapMin) => {
      HIGH_CONFIDENCE_SEARCH.consensusMinValues.forEach((consensusMin) => {
        HIGH_CONFIDENCE_SEARCH.favoriteVoteShareMinValues.forEach((favoriteVoteShareMin) => {
          const policy = {
            topProbabilityMin,
            topGapMin,
            consensusMin,
            favoriteVoteShareMin
          };

          const trainMetrics = evaluateHighConfidencePolicy(trainRecords, policy);
          if (trainMetrics.acceptedCount < HIGH_CONFIDENCE_SEARCH.minAcceptedMatches) {
            return;
          }
          if (trainMetrics.acceptedAccuracy < HIGH_CONFIDENCE_SEARCH.minAcceptedAccuracyTarget) {
            return;
          }

          const validationMetrics = evaluateHighConfidencePolicy(validationRecords, policy);
          const score =
            validationMetrics.acceptedAccuracy * 1.2 +
            validationMetrics.acceptedRate * 0.35 +
            trainMetrics.acceptedAccuracy * 0.15;

          if (!best || score > best.score) {
            best = {
              policy,
              trainMetrics,
              validationMetrics,
              score
            };
          }
        });
      });
    });
  });

  return best;
}

function buildDataset(matches) {
  return {
    features: matches.map((match) => match.features),
    labels: matches.map((match) => CLASS_ORDER.indexOf(match.result))
  };
}

async function main() {
  const trainMatches = await loadMatches(DATA_SOURCE.seasonsTrain);
  const validationMatches = await loadMatches(DATA_SOURCE.seasonsValidation);

  const trainDataset = buildDataset(trainMatches);
  const normalization = normalizeFeatureMatrix(trainDataset.features);
  const modelCore = trainSoftmaxRegression(normalization.normalized, trainDataset.labels, TRAINING_OPTIONS);

  const supervisedModel = {
    ...modelCore,
    featureNames: FEATURE_NAMES,
    normalization: {
      means: normalization.means,
      scales: normalization.scales
    }
  };

  const trainRecords = buildProbabilityRecords(trainMatches, supervisedModel);
  const validationRecords = buildProbabilityRecords(validationMatches, supervisedModel);
  const chosenPolicy = chooseDecisionPolicy(trainRecords);
  const highConfidencePolicy = chooseHighConfidencePolicy(trainRecords, validationRecords);

  const output = {
    generatedAt: new Date().toISOString(),
    version: new Date().toISOString().slice(0, 10),
    label: "监督学习回测模型",
    source: DATA_SOURCE,
    sampleSize: {
      train: trainMatches.length,
      validation: validationMatches.length,
      total: trainMatches.length + validationMatches.length
    },
    baselines: {
      majorityFavorite: {
        train: evaluateMajorityFavoriteBaseline(trainMatches),
        validation: evaluateMajorityFavoriteBaseline(validationMatches)
      }
    },
    supervisedModel: {
      type: supervisedModel.type,
      classOrder: supervisedModel.classOrder,
      featureNames: supervisedModel.featureNames,
      normalization: {
        means: roundArray(supervisedModel.normalization.means),
        scales: roundArray(supervisedModel.normalization.scales)
      },
      weights: roundMatrix(supervisedModel.weights),
      biases: roundArray(supervisedModel.biases),
      trainingOptions: {
        ...TRAINING_OPTIONS,
        classWeights: roundArray(supervisedModel.classWeights)
      },
      decisionPolicy: chosenPolicy.policy,
      highConfidencePolicy: highConfidencePolicy?.policy ?? null,
      metrics: {
        train: evaluateDecisionPolicy(trainRecords, chosenPolicy.policy),
        validation: evaluateDecisionPolicy(validationRecords, chosenPolicy.policy),
        highConfidenceTrain: highConfidencePolicy?.trainMetrics ?? null,
        highConfidenceValidation: highConfidencePolicy?.validationMetrics ?? null
      }
    }
  };

  fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  console.log(`Wrote calibration to ${OUTPUT_PATH}`);
  console.log(JSON.stringify(output, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
