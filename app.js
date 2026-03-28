const COMPANIES = [
  "Bet365",
  "William Hill",
  "Bwin",
  "Interwetten",
  "Pinnacle",
  "BetVictor"
];

const SAMPLE_ROWS = [
  [1.72, 3.75, 4.85],
  [1.74, 3.7, 4.75],
  [1.73, 3.68, 4.9],
  [1.75, 3.72, 4.8],
  [1.7, 3.8, 4.95],
  [1.76, 3.69, 4.7]
];

const outcomeLabels = {
  home: "主胜",
  draw: "平局",
  away: "客胜"
};

const rowsEl = document.querySelector("#rows");
const bulkPasteEl = document.querySelector("#bulkPaste");
const matchNameEl = document.querySelector("#matchName");
const noticeEl = document.querySelector("#notice");
const resultRootEl = document.querySelector("#resultRoot");
const predictButtonEl = document.querySelector("#predictButton");
const sampleButtonEl = document.querySelector("#sampleButton");
const resetButtonEl = document.querySelector("#resetButton");

function setNotice(message = "", type = "") {
  noticeEl.textContent = message;
  noticeEl.className = `notice${type ? ` ${type}` : ""}`;
}

function extractOddsTriplet(value) {
  const matches = String(value).match(/\d+(?:\.\d+)?/g);
  if (!matches || matches.length < 3) {
    return null;
  }
  const numbers = matches.map(Number).filter(Number.isFinite);
  if (numbers.length < 3) {
    return null;
  }
  const triplet = numbers.slice(-3);
  return {
    home: triplet[0],
    draw: triplet[1],
    away: triplet[2]
  };
}

function createRow(company, index) {
  const card = document.createElement("div");
  card.className = "row-card";
  card.innerHTML = `
    <div class="row-header">
      <div class="company">${company}</div>
      <div class="company-index">第 ${index + 1} 家</div>
    </div>
    <div class="mini-grid">
      <div>
        <label class="field-label">整行粘贴</label>
        <input data-index="${index}" data-kind="paste" placeholder="例如 1.72 3.75 4.85" />
      </div>
      <div class="three-grid">
        <div>
          <label class="field-label">主胜</label>
          <input data-index="${index}" data-kind="home" inputmode="decimal" placeholder="主胜" />
        </div>
        <div>
          <label class="field-label">平局</label>
          <input data-index="${index}" data-kind="draw" inputmode="decimal" placeholder="平局" />
        </div>
        <div>
          <label class="field-label">客胜</label>
          <input data-index="${index}" data-kind="away" inputmode="decimal" placeholder="客胜" />
        </div>
      </div>
    </div>
  `;
  return card;
}

function getInput(index, kind) {
  return document.querySelector(`input[data-index="${index}"][data-kind="${kind}"]`);
}

function applyTriplet(index, triplet, source = "") {
  getInput(index, "home").value = triplet.home;
  getInput(index, "draw").value = triplet.draw;
  getInput(index, "away").value = triplet.away;
  if (source) {
    getInput(index, "paste").value = source.trim();
  }
}

function handleCombinedPaste(index, rawValue) {
  const triplet = extractOddsTriplet(rawValue);
  if (!triplet) {
    setNotice(`无法识别 ${COMPANIES[index]} 的整行赔率，请粘贴 3 个数字。`, "error");
    return false;
  }
  applyTriplet(index, triplet, rawValue);
  setNotice("");
  return true;
}

function buildRows() {
  rowsEl.innerHTML = "";
  COMPANIES.forEach((company, index) => {
    rowsEl.appendChild(createRow(company, index));
  });

  rowsEl.addEventListener("input", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) {
      return;
    }
    if (target.dataset.kind !== "paste") {
      return;
    }
    if (!target.value.trim()) {
      return;
    }
    handleCombinedPaste(Number(target.dataset.index), target.value);
  });
}

function readRows() {
  return COMPANIES.map((company, index) => {
    const home = Number(getInput(index, "home").value);
    const draw = Number(getInput(index, "draw").value);
    const away = Number(getInput(index, "away").value);

    if (![home, draw, away].every(Number.isFinite)) {
      throw new Error(`${company} 的赔率还没填完整。`);
    }

    return { company, home, draw, away };
  });
}

function applyBulkPaste(rawText) {
  const lines = rawText
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  lines.slice(0, COMPANIES.length).forEach((line, index) => {
    handleCombinedPaste(index, line);
  });
}

function renderResult(result, matchName = "") {
  const structureLabel = result.confidenceProfile?.label ?? result.confidence;
  const bars = [
    ["home", result.finalProb.home],
    ["draw", result.finalProb.draw],
    ["away", result.finalProb.away]
  ]
    .map(
      ([key, value]) => `
        <div class="probability-row">
          <div>${outcomeLabels[key]}</div>
          <div class="bar"><div class="bar-fill" style="width:${(value * 100).toFixed(1)}%"></div></div>
          <div>${(value * 100).toFixed(1)}%</div>
        </div>
      `
    )
    .join("");

  resultRootEl.innerHTML = `
    <div class="result-hero">
      <div class="result-kicker">默认规则模型</div>
      <div class="result-title">${result.recommendation}</div>
      <div class="result-meta">${matchName ? `${matchName} · ` : ""}结构标签：${structureLabel}</div>
    </div>
    <div class="summary-grid">
      <div class="summary-card">
        <h3>三结果概率</h3>
        <div class="probability-list">${bars}</div>
      </div>
      <div class="summary-card">
        <h3>结构摘要</h3>
        <div class="probability-list">
          <div>市场共识：${Math.round(result.metrics.consensus * 100)}分</div>
          <div>前二差值：${(result.metrics.topGap * 100).toFixed(1)}%</div>
          <div>最低赔一致度：${(result.metrics.favoriteVoteShare * 100).toFixed(1)}%</div>
          <div>异常公司数：${result.metrics.outlierCount}</div>
        </div>
      </div>
    </div>
    <div class="tag-row">
      <span class="tag">推荐结果：${result.recommendation}</span>
      <span class="tag">信心等级：${result.confidence}</span>
      <span class="tag">结构标签：${structureLabel}</span>
    </div>
    <div class="explanation">${result.explanation}${result.confidenceProfile?.note ? ` 结构判读：${result.confidenceProfile.note}` : ""}</div>
  `;
}

async function handlePredict() {
  try {
    setNotice("正在生成预测...");
    const rows = readRows();
    const response = await fetch("/api/predict", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ rows })
    });

    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "预测失败。");
    }

    renderResult(payload, matchNameEl.value.trim());
    setNotice("预测已生成。");
  } catch (error) {
    setNotice(error instanceof Error ? error.message : "预测失败。", "error");
  }
}

function fillSample() {
  SAMPLE_ROWS.forEach((row, index) => {
    applyTriplet(
      index,
      { home: row[0], draw: row[1], away: row[2] },
      row.join(" ")
    );
  });
  setNotice("已填入示例赔率。");
}

function resetAll() {
  matchNameEl.value = "";
  bulkPasteEl.value = "";
  COMPANIES.forEach((_, index) => {
    ["paste", "home", "draw", "away"].forEach((kind) => {
      getInput(index, kind).value = "";
    });
  });
  resultRootEl.innerHTML = `
    <div class="result-hero">
      <div class="result-kicker">等待计算</div>
      <div class="result-title">尚未生成预测</div>
      <div class="result-meta">输入 6 家公司的初始赔率后点击“生成预测”。</div>
    </div>
  `;
  setNotice("");
}

buildRows();

bulkPasteEl.addEventListener("input", () => {
  if (bulkPasteEl.value.trim()) {
    applyBulkPaste(bulkPasteEl.value);
  }
});

predictButtonEl.addEventListener("click", handlePredict);
sampleButtonEl.addEventListener("click", fillSample);
resetButtonEl.addEventListener("click", resetAll);
