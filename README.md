# 足球赔率预测器

这是一个可本地运行的 Codex 插件工程，用于根据固定 6 家博彩公司初始 `1X2` 赔率生成足球比赛结果预测。

## 当前能力

- 固定 6 家公司输入：`Bet365 / William Hill / Bwin / Interwetten / Pinnacle / BetVictor`
- 支持逐行粘贴赔率，也支持批量粘贴多行赔率
- 输出主胜 / 平局 / 客胜概率、推荐结果、结构标签和解释文案
- 预测逻辑基于公开历史赔率与赛果回测校准

## 目录说明

- [assets/widget.html](/Users/huanglu/Projects/WORD 编辑/plugins/football-odds-predictor/assets/widget.html)：前端页面与主要预测逻辑
- [scripts/server.js](/Users/huanglu/Projects/WORD 编辑/plugins/football-odds-predictor/scripts/server.js)：MCP 服务入口
- [calibration/latest.json](/Users/huanglu/Projects/WORD 编辑/plugins/football-odds-predictor/calibration/latest.json)：最新校准结果
- [scripts/calibrate.js](/Users/huanglu/Projects/WORD 编辑/plugins/football-odds-predictor/scripts/calibrate.js)：历史回测与阈值校准脚本

## 本地运行

```bash
node scripts/smoke-test.js
```

## 安装为本地插件

当前 `.mcp.json` 里的 `server.js` 路径指向当前这台 Mac 上的工作区绝对路径，因此这个仓库克隆到别的目录后，需要按实际路径更新一次 [`.mcp.json`](/Users/huanglu/Projects/WORD 编辑/plugins/football-odds-predictor/.mcp.json)。

如果要迁移到 `~/plugins/football-odds-predictor`：

1. 将整个目录移动到 `~/plugins/football-odds-predictor`
2. 把 [`.mcp.json`](/Users/huanglu/Projects/WORD 编辑/plugins/football-odds-predictor/.mcp.json) 中 `args[0]` 改成新的 `server.js` 路径
3. 在 `~/.agents/plugins/marketplace.json` 中新增本插件条目

参考命令：

```bash
mkdir -p ~/plugins
mv "/Users/huanglu/Projects/WORD 编辑/plugins/football-odds-predictor" ~/plugins/
python3 - <<'PY'
from pathlib import Path
import json

path = Path.home() / "plugins" / "football-odds-predictor" / ".mcp.json"
data = json.loads(path.read_text())
data["mcpServers"]["football-odds-predictor"]["args"][0] = str(Path.home() / "plugins" / "football-odds-predictor" / "scripts" / "server.js")
path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n")
PY
```
