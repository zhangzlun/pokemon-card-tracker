# 卡牌行情

寶可夢卡牌與未拆商品的每日行情追蹤。純靜態網站，放在 GitHub Pages，由 GitHub Actions 每天自動抓價，不需要伺服器，也不需要任何付費服務。

- **我的清單**：追蹤的商品、台幣行情、近期走勢，填入持有數量和成本後會算出總值與損益。
- **搜尋**：查任何一張卡或一盒未拆商品（美版、日版），支援常見的中文暱稱，例如「梵谷皮卡丘」。
- **設定**：手動商品（來源沒有的，例如繁中版）、備份與還原。

## 資料來源與限制

- 價格來自 [tcgcsv.com](https://tcgcsv.com/) 每日彙整的 TCGplayer 資料，取的是「市價」（依美國市場近期成交計算），單位是美元。
- 台幣是用當天匯率換算的參考值，匯率來自 open.er-api.com。**不代表在台灣實際賣得掉的價格。**
- 日版商品的價格是它在美國市場的價格，不是日本當地的日圓行情。
- 沒有繁中版商品的資料，請用「手動商品」自己填。
- 來源一天更新一次（約 20:00 UTC），所以這裡也是一天一次，不是即時報價。

## 運作方式

```
.github/workflows/update.yml   每天 21:30 UTC（台北 05:30）執行，也可以手動執行
scripts/update.mjs             抓商品與價格、寫入每日紀錄、組出網站
scripts/dev.mjs                本機開發用的靜態伺服器
data/watchlist.json            要每天記錄走勢的商品清單
data/aliases.json              中文暱稱對照表（搜尋用）
data/history/<商品編號>.json    每日價格紀錄（由 Actions 自動提交）
data/latest.json               追蹤清單的最新價格（由 Actions 自動提交）
site/                          網頁本體（HTML、CSS、JS，沒有建置步驟）
```

完整的商品目錄（十幾萬筆）只放在部署出去的網站裡，不會提交進儲存庫，所以儲存庫不會越長越大。

## 第一次設定

1. 到儲存庫的 **Settings → Pages**，把 **Source** 設成 **GitHub Actions**。
2. 到 **Actions** 分頁，選「Update prices and deploy」，按 **Run workflow** 跑第一次。
3. 跑完後網站會在 `https://<帳號>.github.io/<儲存庫名稱>/`。

之後每天會自動更新。公開儲存庫如果連續 60 天完全沒有活動，GitHub 會暫停排程；這個專案每天都會自動提交價格紀錄，正常情況下不會遇到。

## 新增要每日記錄的商品

在網站的「搜尋」找到商品，按「加入清單」，它會先出現在清單裡（標示「尚未每日紀錄」）。要讓它每天記錄走勢，有兩種做法：

- **自己編輯** `data/watchlist.json`，在 `items` 裡加一行，例如：

  ```json
  { "pid": 518861, "cat": 3, "zh": "梵谷皮卡丘" }
  ```

  `pid` 是 TCGplayer 的商品編號（商品頁網址裡的數字），`cat` 是 `3`（美版）或 `85`（日版），`zh` 是清單上顯示的中文名稱，可以省略。同一個商品有多種版本（Normal、Holofoil…）時，可以加 `"sub": "Holofoil"` 指定要記錄哪一種。

- **從網頁直接加**：在「設定」填入一組只限這個儲存庫、有 Contents 讀寫權限的 fine-grained personal access token。Token 只會存在你的瀏覽器。

`watchlist.json` 一有變動，Actions 會自動重新跑一次。

## 個人資料

持有數量、成本、手動商品都只存在瀏覽器的 localStorage，不會上傳，也不會出現在這個儲存庫。換裝置或清除瀏覽器資料前，請到「設定」匯出備份。

## 在自己的電腦上執行

需要 Node.js 20 以上，不用安裝任何套件。

```bash
git clone https://github.com/zhangzlun/pokemon-card-tracker.git
cd pokemon-card-tracker
npm start
```

`npm start` 會先抓一次資料（約半分鐘），再啟動本機網站，網址是 <http://localhost:5173>。

| 指令 | 作用 |
|---|---|
| `npm run update:local` | 抓資料、產生 `dist/`，不改動儲存庫裡的 `data/` |
| `npm run dev` | 啟動本機網站。網頁檔案直接讀 `site/`，改了存檔、重新整理就看得到 |
| `npm start` | 上面兩個依序執行 |
| `npm run update` | 跟 GitHub Actions 跑的一樣，會把今天的價格寫進 `data/history` 和 `data/latest.json` |

平常開發用 `update:local` 就好。`npm run update` 會改到 `data/`，那些檔案每天由 Actions 自動提交，自己再提交一次容易衝突。

要換連接埠：`PORT=8080 npm run dev`。一定要透過本機網站開啟，直接用瀏覽器開 `index.html` 會讀不到資料。

## 對來源的禮貌

`update.mjs` 每天約對 tcgcsv 發出 700 個請求（每個系列一次價格；商品清單有快取），同時最多 4 個。請不要把排程調得比一天一次更頻繁，來源本身一天只更新一次。
