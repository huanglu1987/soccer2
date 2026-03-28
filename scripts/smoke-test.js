#!/usr/bin/env node

const { spawn } = require("node:child_process");
const path = require("node:path");

const serverPath = path.join(__dirname, "server.js");
const child = spawn("node", [serverPath], {
  stdio: ["pipe", "pipe", "pipe"]
});

let buffer = Buffer.alloc(0);
let requestId = 0;
const pending = new Map();

function writePacket(message) {
  const payload = JSON.stringify(message);
  const header = `Content-Length: ${Buffer.byteLength(payload, "utf8")}\r\n\r\n`;
  child.stdin.write(header + payload);
}

function send(method, params) {
  return new Promise((resolve, reject) => {
    const id = ++requestId;
    pending.set(id, { resolve, reject });
    writePacket({
      jsonrpc: "2.0",
      id,
      method,
      params
    });
  });
}

function consume() {
  while (true) {
    const separator = buffer.indexOf("\r\n\r\n");
    if (separator === -1) {
      return;
    }
    const headerText = buffer.slice(0, separator).toString("utf8");
    const lengthLine = headerText
      .split("\r\n")
      .find((line) => line.toLowerCase().startsWith("content-length:"));

    if (!lengthLine) {
      throw new Error("Missing Content-Length");
    }

    const contentLength = Number(lengthLine.split(":")[1].trim());
    const start = separator + 4;
    const end = start + contentLength;
    if (buffer.length < end) {
      return;
    }

    const payload = JSON.parse(buffer.slice(start, end).toString("utf8"));
    buffer = buffer.slice(end);

    const pendingRequest = pending.get(payload.id);
    if (!pendingRequest) {
      continue;
    }
    pending.delete(payload.id);
    if (payload.error) {
      pendingRequest.reject(new Error(payload.error.message));
      continue;
    }
    pendingRequest.resolve(payload.result);
  }
}

child.stdout.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  consume();
});

child.stderr.on("data", (chunk) => {
  process.stderr.write(chunk);
});

(async () => {
  const initialize = await send("initialize", {
    protocolVersion: "2026-01-26",
    capabilities: {},
    clientInfo: { name: "smoke-test", version: "0.1.0" }
  });
  const tools = await send("tools/list", {});
  const resources = await send("resources/list", {});
  const resource = await send("resources/read", {
    uri: "ui://football-odds-predictor/widget"
  });
  const toolCall = await send("tools/call", {
    name: "open_football_odds_predictor",
    arguments: {
      matchName: "Smoke Test Match"
    }
  });

  console.log(
    JSON.stringify(
      {
        initialize,
        toolNames: tools.tools.map((tool) => tool.name),
        resourceUris: resources.resources.map((resource) => resource.uri),
        widgetLoaded: Boolean(resource.contents?.[0]?.text?.includes("足球赔率预测器")),
        hasStructuredContent: Boolean(toolCall.structuredContent),
        recommendationWidget: toolCall._meta["openai/outputTemplate"],
        companies: toolCall.structuredContent?.companies ?? [],
        hasSupervisedModel: Boolean(toolCall.structuredContent?.supervisedModel?.weights),
        supervisedTop1Accuracy:
          toolCall.structuredContent?.supervisedSummary?.accuracySummary?.top1Accuracy ?? null
      },
      null,
      2
    )
  );
  child.kill();
})().catch((error) => {
  console.error(error.message);
  child.kill();
  process.exitCode = 1;
});
