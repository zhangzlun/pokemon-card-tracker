# 專案進度

> 最後更新：2026-10-04

## 目前狀態

進行中

## 本次完成

- 新增 `scripts/identify.mjs`：`createIdentifier()` 把照片送 Claude API（`claude-opus-5-5`），回傳 `language`、`sealed`、`queries`、`summary`
- `scripts/dev.mjs` 新增 `POST /api/identify`（同來源檢查、body 上限 7MB、不受行情更新鎖影響），`/data/config.json` 增加 `identify` 旗標
- `site/index.html`、`site/app.js`：搜尋分頁新增「拍照辨識」按鈕，瀏覽器先縮圖再上傳，依結果切換美版／日版並帶入搜尋
- `compose.yaml`、`.env.example`、`README.md`：新增選用的 `ANTHROPIC_API_KEY` 設定與說明
- `test/identify.test.mjs`：以假 client 驗證輸入檢查、回應清理、拒絕處理與端點行為

## 下次繼續

- 設定真實的 `ANTHROPIC_API_KEY`，用實際卡片與未拆商品照片驗證辨識準確度，必要時調整 `scripts/identify.mjs` 的提示詞
- 提交目前尚未 commit 的變更（含先前的 NAS、推播等功能）

## 已知問題 / 待確認

- 尚未以真實 API key 呼叫過 Claude API，目前只有假 client 的測試與瀏覽器流程驗證
- `/api/identify` 沒有次數限制，須維持只在區網／VPN 內使用
- 繁中版等目錄沒有的商品無法比對
