# 設計決策記錄

---

## [2026-10-04] 拍照辨識商品採用 Claude API，僅支援本機與 NAS 模式

**情境**：想讓 AI 看照片判斷是哪張卡或哪盒商品，省去手動輸入英文卡名與編號。需決定視覺模型供應商，以及 API key 的存放位置。

**決策內容**：
- 使用 Claude API（官方 `@anthropic-ai/sdk`，模型 `claude-opus-5-5`），金鑰以環境變數 `ANTHROPIC_API_KEY` 放在伺服器端。
- 僅本機與 NAS 模式提供 `/api/identify`；GitHub Pages 靜態版不顯示「拍照辨識」按鈕。
- AI 只輸出搜尋關鍵字與美版／日版判斷，實際商品由既有目錄搜尋比對，使用者從候選中確認後才加入清單。

**採用理由**：金鑰不進瀏覽器，外洩風險低；AI 不直接決定商品編號，辨識錯誤時不會把錯的商品寫入清單。

**影響範圍**：`scripts/identify.mjs`（新增）、`scripts/dev.mjs`、`site/app.js`、`site/index.html`、`compose.yaml`、`.env.example`、`README.md`、`test/identify.test.mjs`；新增相依套件 `@anthropic-ai/sdk`。

---
