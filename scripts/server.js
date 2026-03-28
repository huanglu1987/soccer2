#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const ROOT_DIR = path.resolve(__dirname, "..");
const WIDGET_URI = "ui://football-odds-predictor/widget";
const WIDGET_HTML = fs.readFileSync(path.join(ROOT_DIR, "assets", "widget.html"), "utf8");
const PROTOCOL_VERSION = "2026-01-26";
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

const FALLBACK_CALIBRATION = {
  version: "2026-03-28",
  label: "公开历史回测校准",
  sampleSize: {
    train: 12451,
    validation: 3099,
    total: 15550
  },
  sourceSummary: "football-data.co.uk 多联赛 2021-22 至 2023-24",
  accuracySummary: {
    singlePredictionAccuracy: 0.5251,
    inclusiveHitRate: 0.585,
    doubleRate: 0.2995
  },
  note:
    "固定 6 家公司改为 Bet365、Bwin、William Hill、Interwetten、Pinnacle、BetVictor，并基于 15550 场公开历史初赔和独立赛季验证做了回测校准。"
};

const FALLBACK_SUPERVISED_SUMMARY = {
  version: "2026-03-28",
  label: "监督学习实验模型",
  accuracySummary: {
    top1Accuracy: 0.5069,
    singlePredictionAccuracy: 0.5381,
    inclusiveHitRate: 0.5878,
    doubleRate: 0.2588
  },
  note:
    "当前页面已收敛为纯初赔版本，监督学习增强版不再作为默认使用入口。"
};

const FALLBACK_HIGH_CONFIDENCE_SUMMARY = {
  enabled: true,
  policy: {
    topProbabilityMin: 0.6,
    topGapMin: 0.08,
    consensusMin: 0.7,
    favoriteVoteShareMin: 1
  },
  metrics: {
    acceptedRate: 0.3525,
    acceptedAccuracy: 0.6398,
    acceptedCount: 1080,
    matches: 3064
  },
  note:
    "高置信模式只保留最有把握的单结果场次，验证集接受准确率约 64.0%，但只覆盖约 35.3% 的比赛。"
};

function loadCalibration() {
  try {
    const parsed = JSON.parse(fs.readFileSync(CALIBRATION_PATH, "utf8"));
    return {
      thresholds: parsed.selectedThresholds ?? FALLBACK_THRESHOLDS,
      calibration: {
        version: parsed.version ?? FALLBACK_CALIBRATION.version,
        label: parsed.label ?? FALLBACK_CALIBRATION.label,
        sampleSize: parsed.sampleSize ?? FALLBACK_CALIBRATION.sampleSize,
        accuracySummary:
          parsed.selectedModel?.validation
            ? {
                singlePredictionAccuracy:
                  parsed.selectedModel.validation.singlePredictionAccuracy ??
                  FALLBACK_CALIBRATION.accuracySummary.singlePredictionAccuracy,
                inclusiveHitRate:
                  parsed.selectedModel.validation.inclusiveHitRate ??
                  FALLBACK_CALIBRATION.accuracySummary.inclusiveHitRate,
                doubleRate:
                  parsed.selectedModel.validation.doubleRate ??
                  FALLBACK_CALIBRATION.accuracySummary.doubleRate
              }
            : FALLBACK_CALIBRATION.accuracySummary,
        sourceSummary:
          parsed.source?.site && parsed.source?.leagues && parsed.source?.seasonsTrain
            ? `${parsed.source.site} ${parsed.source.seasonsTrain[0]}-${parsed.source.seasonsValidation?.[0] ?? parsed.source.seasonsTrain.at(-1)}，联赛数 ${parsed.source.leagues.length}`
            : FALLBACK_CALIBRATION.sourceSummary,
        note: parsed.source?.note ?? FALLBACK_CALIBRATION.note
      },
      supervisedModel: parsed.supervisedModel ?? null,
      supervisedSummary: parsed.supervisedModel?.metrics?.validation
        ? {
            version: parsed.version ?? FALLBACK_SUPERVISED_SUMMARY.version,
            label: parsed.label ?? FALLBACK_SUPERVISED_SUMMARY.label,
            accuracySummary: {
              top1Accuracy:
                parsed.supervisedModel.metrics.validation.top1Accuracy ??
                FALLBACK_SUPERVISED_SUMMARY.accuracySummary.top1Accuracy,
              singlePredictionAccuracy:
                parsed.supervisedModel.metrics.validation.singlePredictionAccuracy ??
                FALLBACK_SUPERVISED_SUMMARY.accuracySummary.singlePredictionAccuracy,
              inclusiveHitRate:
                parsed.supervisedModel.metrics.validation.inclusiveHitRate ??
                FALLBACK_SUPERVISED_SUMMARY.accuracySummary.inclusiveHitRate,
              doubleRate:
                parsed.supervisedModel.metrics.validation.doubleRate ??
                FALLBACK_SUPERVISED_SUMMARY.accuracySummary.doubleRate
            },
            note: FALLBACK_SUPERVISED_SUMMARY.note
          }
        : FALLBACK_SUPERVISED_SUMMARY,
      highConfidenceSummary:
        parsed.supervisedModel?.highConfidencePolicy && parsed.supervisedModel?.metrics?.highConfidenceValidation
          ? {
              enabled: true,
              policy: {
                topProbabilityMin:
                  parsed.supervisedModel.highConfidencePolicy.topProbabilityMin ??
                  FALLBACK_HIGH_CONFIDENCE_SUMMARY.policy.topProbabilityMin,
                topGapMin:
                  parsed.supervisedModel.highConfidencePolicy.topGapMin ??
                  FALLBACK_HIGH_CONFIDENCE_SUMMARY.policy.topGapMin,
                consensusMin:
                  parsed.supervisedModel.highConfidencePolicy.consensusMin ??
                  FALLBACK_HIGH_CONFIDENCE_SUMMARY.policy.consensusMin,
                favoriteVoteShareMin:
                  parsed.supervisedModel.highConfidencePolicy.favoriteVoteShareMin ??
                  FALLBACK_HIGH_CONFIDENCE_SUMMARY.policy.favoriteVoteShareMin
              },
              metrics: {
                acceptedRate:
                  parsed.supervisedModel.metrics.highConfidenceValidation.acceptedRate ??
                  FALLBACK_HIGH_CONFIDENCE_SUMMARY.metrics.acceptedRate,
                acceptedAccuracy:
                  parsed.supervisedModel.metrics.highConfidenceValidation.acceptedAccuracy ??
                  FALLBACK_HIGH_CONFIDENCE_SUMMARY.metrics.acceptedAccuracy,
                acceptedCount:
                  parsed.supervisedModel.metrics.highConfidenceValidation.acceptedCount ??
                  FALLBACK_HIGH_CONFIDENCE_SUMMARY.metrics.acceptedCount,
                matches:
                  parsed.supervisedModel.metrics.highConfidenceValidation.matches ??
                  FALLBACK_HIGH_CONFIDENCE_SUMMARY.metrics.matches
              },
              note: FALLBACK_HIGH_CONFIDENCE_SUMMARY.note
            }
          : FALLBACK_HIGH_CONFIDENCE_SUMMARY
    };
  } catch {
    return {
      thresholds: FALLBACK_THRESHOLDS,
      calibration: FALLBACK_CALIBRATION,
      supervisedModel: null,
      supervisedSummary: FALLBACK_SUPERVISED_SUMMARY,
      highConfidenceSummary: FALLBACK_HIGH_CONFIDENCE_SUMMARY
    };
  }
}

const CALIBRATION = loadCalibration();

function writePacket(message) {
  const payload = JSON.stringify(message);
  const header = `Content-Length: ${Buffer.byteLength(payload, "utf8")}\r\n\r\n`;
  process.stdout.write(header + payload);
}

function sendResult(id, result) {
  writePacket({
    jsonrpc: "2.0",
    id,
    result
  });
}

function sendError(id, code, message, data) {
  writePacket({
    jsonrpc: "2.0",
    id,
    error: {
      code,
      message,
      ...(data === undefined ? {} : { data })
    }
  });
}

async function handleRequest(method, params = {}) {
  switch (method) {
    case "initialize":
      return {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {
          tools: {
            listChanged: false
          },
          resources: {
            listChanged: false
          }
        },
        serverInfo: {
          name: "football-odds-predictor",
          version: "0.1.0"
        }
      };

    case "ping":
      return {};

    case "notifications/initialized":
      return null;

    case "tools/list":
      return {
        tools: [
          {
            name: "open_football_odds_predictor",
            title: "打开足球赔率预测器",
            description:
              "当用户想录入 6 家博彩公司初始 1X2 赔率，并基于初赔直接生成结果预测时使用。",
            inputSchema: {
              type: "object",
              properties: {
                matchName: {
                  type: "string",
                  description: "可选比赛名称，用于页面展示。"
                }
              },
              additionalProperties: false
            },
            annotations: {
              readOnlyHint: true,
              destructiveHint: false,
              openWorldHint: false,
              idempotentHint: true
            },
            _meta: {
              ui: {
                resourceUri: WIDGET_URI
              },
              "openai/toolInvocation/invoking": "正在打开足球赔率预测器",
              "openai/toolInvocation/invoked": "足球赔率预测器已就绪"
            }
          }
        ]
      };

    case "tools/call": {
      const toolName = params.name;
      if (toolName !== "open_football_odds_predictor") {
        throw new Error(`Unknown tool: ${toolName}`);
      }

      const matchName =
        typeof params.arguments?.matchName === "string"
          ? params.arguments.matchName.trim()
          : "";

      return {
        content: [
          {
            type: "text",
            text:
              "已打开足球赔率预测器。输入固定 6 家公司的主胜、平局、客胜初始赔率后，页面会在本地生成可解释预测。当前页面版本只使用初赔。"
          }
        ],
        structuredContent: {
          title: "足球赔率预测器",
          matchName,
          companies: FIXED_COMPANIES,
          thresholds: CALIBRATION.thresholds,
          calibration: CALIBRATION.calibration,
          supervisedModel: CALIBRATION.supervisedModel,
          supervisedSummary: CALIBRATION.supervisedSummary,
          highConfidenceSummary: CALIBRATION.highConfidenceSummary,
          doublePolicyLabel: "严格模式",
          methodSummary:
            "先去水，再按偏离度轻度降权，最后根据公开历史回测校准过的共识与分歧阈值判断单双结果。"
        },
        _meta: {
          "openai/outputTemplate": WIDGET_URI
        }
      };
    }

    case "resources/list":
      return {
        resources: [
          {
            uri: WIDGET_URI,
            name: "Football Odds Predictor Widget",
            description: "固定 6 家博彩公司初始赔率输入页与本地预测输出页。",
            mimeType: "text/html;profile=mcp-app"
          }
        ]
      };

    case "resources/read": {
      const uri = params.uri;
      if (uri !== WIDGET_URI) {
        throw new Error(`Unknown resource: ${uri}`);
      }

      return {
        contents: [
          {
            uri: WIDGET_URI,
            mimeType: "text/html;profile=mcp-app",
            text: WIDGET_HTML,
            _meta: {
              ui: {
                prefersBorder: true,
                csp: {
                  connectDomains: [],
                  resourceDomains: []
                }
              },
              "openai/widgetDescription":
                "输入固定 6 家公司的主平负初始赔率，查看主胜、平局、客胜概率和单双结果判断。"
            }
          }
        ]
      };
    }

    default:
      throw new Error(`Unsupported method: ${method}`);
  }
}

let buffer = Buffer.alloc(0);

function consumeMessages() {
  while (true) {
    const separator = buffer.indexOf("\r\n\r\n");
    if (separator === -1) {
      return;
    }

    const headerText = buffer.slice(0, separator).toString("utf8");
    const headers = {};
    for (const line of headerText.split("\r\n")) {
      const colonIndex = line.indexOf(":");
      if (colonIndex === -1) {
        continue;
      }
      const key = line.slice(0, colonIndex).trim().toLowerCase();
      const value = line.slice(colonIndex + 1).trim();
      headers[key] = value;
    }

    const contentLength = Number(headers["content-length"]);
    if (!Number.isFinite(contentLength) || contentLength < 0) {
      process.stderr.write("Invalid Content-Length header\n");
      buffer = Buffer.alloc(0);
      return;
    }

    const messageStart = separator + 4;
    const messageEnd = messageStart + contentLength;
    if (buffer.length < messageEnd) {
      return;
    }

    const messageBuffer = buffer.slice(messageStart, messageEnd);
    buffer = buffer.slice(messageEnd);

    let message;
    try {
      message = JSON.parse(messageBuffer.toString("utf8"));
    } catch (error) {
      process.stderr.write(`Failed to parse JSON message: ${error.message}\n`);
      continue;
    }

    dispatchMessage(message);
  }
}

async function dispatchMessage(message) {
  const hasId = Object.prototype.hasOwnProperty.call(message, "id");

  if (!message || message.jsonrpc !== "2.0" || typeof message.method !== "string") {
    if (hasId) {
      sendError(message.id, -32600, "Invalid Request");
    }
    return;
  }

  try {
    const result = await handleRequest(message.method, message.params);
    if (hasId) {
      sendResult(message.id, result);
    }
  } catch (error) {
    if (hasId) {
      sendError(message.id, -32000, error.message);
    }
  }
}

process.stdin.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  consumeMessages();
});

process.stdin.on("end", () => {
  process.exit(0);
});

process.on("uncaughtException", (error) => {
  process.stderr.write(`Uncaught exception: ${error.stack || error.message}\n`);
});
