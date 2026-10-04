# 卡牌行情

寶可夢卡牌與未拆商品的每日行情追蹤。可放在 GitHub Pages，由 GitHub Actions 每天自動抓價，也可放在 Synology Container Manager，讓 NAS 保存清單與行情、每天自動更新。

- **我的清單**：追蹤的商品、台幣行情、近期走勢，填入持有數量和成本後會算出總值與損益。
- **搜尋**：查任何一張卡或一盒未拆商品（美版、日版），支援常見的中文暱稱，例如「梵谷皮卡丘」。
- **設定**：手動商品（來源沒有的，例如繁中版）、備份與還原。

## 資料來源與限制

- 已設定日本來源的商品，自動抓 [SNKRDUNK](https://snkrdunk.com/) 與 [PRICE BASE](https://price-base.com/) 的日圓報價。「日版烈空 補充盒」與「日版 30 週年補充盒」已有有封膜單盒版本的來源對照，加入時會自動帶入。
- SNKRDUNK 讀取公開商品規格價格，採指定規格的**新品最低掛價**，不是最新成交價。必須精確指定規格（例如 `1個`）；不會把兩盒合售、二手價或買方出價當成單盒價格。
- PRICE BASE 讀取單一商品文章的「最新取引相場価格」區塊，或與文章標題一致、註明相場年月的當期結論段落，屬於獨自調查的**相場參考價**，不是店家保證買取價。保留原文的相場月份與更新日期；每天抓取不代表文章每天更新。缺少支援格式或商品不明確時會報錯，不會猜測任意金額。
- 美版及未設定日本來源的商品，使用 [tcgcsv.com](https://tcgcsv.com/) 每日彙整的 TCGplayer 美元市價（依美國市場近期成交計算）。商品搜尋目錄仍來自 TCGplayer。追蹤商品在彙整資料缺少市價時，會自動查 TCGplayer 原站 `pricepoints` 的相同版本 Market Price；沒有賣家掛單不代表沒有市價。補抓不使用最近成交、Listed Median 或買取價代替市價，失敗沿用的舊報價保留原日期，不新增假紀錄。
- 台幣是用當天匯率換算的參考值，匯率來自 open.er-api.com。**不代表在台灣實際賣得掉的價格。**
- 日本估值預設優先 SNKRDUNK，也可以改成 PRICE BASE。優先來源失敗時採另一個本次成功的來源；兩者都失敗則沿用上次成功報價並標示日期，不會記成今天的新紀錄。尚無任何可用日本報價時，可使用原本保留的自填備用日圓價。
- 日本報價會用於台幣估值及損益。每個來源各自累積日圓走勢，不會和既有美元紀錄或另一個來源接成一條線。價格未含運費、平台費用。
- 沒有繁中版商品的資料，請用「手動商品」自己填。
- GitHub Pages 每天抓取一次；本機在啟動 `npm start` 時更新全部行情，新增商品或儲存日本來源時會立即抓該商品報價。本機關閉時不會更新。TCGplayer 彙整約在 20:00 UTC 更新；日本來源按抓取當時公開內容為準。

## 運作方式

```
.github/workflows/update.yml   每天 21:30 UTC（台北 05:30）執行，也可以手動執行
scripts/update.mjs             抓商品與價格、寫入每日紀錄、組出網站
scripts/japan-prices.mjs       SNKRDUNK／PRICE BASE 解析、失敗回退與日圓紀錄
scripts/japan-history.mjs      補入來源公布的近 30 天歷史（與掛價分開）
scripts/nas.mjs                NAS 網站與台北 05:30 排程
scripts/dev.mjs                本機網站與追蹤清單 API
scripts/local-watchlist.mjs    本機清單儲存與單一商品抓價
scripts/data-store.mjs         原子寫檔、本機快取與歷史合併
data/watchlist.json            要每天記錄走勢的商品清單
data/japan-sources.json        已核對的商品來源對照（按商品編號）
data/aliases.json              中文暱稱對照表（搜尋用）
data/history/<商品編號>.json    每日價格紀錄（由 Actions 自動提交）
data/history/<商品編號>-jpy.json 各日本來源獨立的每日日圓紀錄
data/latest.json               追蹤清單的最新價格（由 Actions 自動提交）
site/                          網頁本體（HTML、CSS、JS，沒有建置步驟）
.cache/local-data/             本機行情與歷史（不提交，重新建置後仍保留）
```

完整的商品目錄（十幾萬筆）只放在部署出去的網站裡，不會提交進儲存庫，所以儲存庫不會越長越大。

## 第一次設定

1. 到儲存庫的 **Settings → Pages**，把 **Source** 設成 **GitHub Actions**。
2. 到 **Actions** 分頁，選「Update prices and deploy」，按 **Run workflow** 跑第一次。
3. 跑完後網站會在 `https://<帳號>.github.io/<儲存庫名稱>/`。

之後每天會自動更新。公開儲存庫如果連續 60 天完全沒有活動，GitHub 會暫停排程；這個專案每天都會自動提交價格紀錄，正常情況下不會遇到。

## 新增要每日記錄的商品

**本機網站**：在「搜尋」按「加入清單」會直接儲存到本機 `data/watchlist.json`，有日本來源的商品立即抓價，不需要 GitHub token。之前標示「尚未每日紀錄」的商品，也可直接按「加入每日紀錄」。持有數量、成本與備註仍只留在瀏覽器。

**GitHub Pages**：按「加入清單」會先出現在瀏覽器的清單裡（標示「尚未每日紀錄」）。要讓它每天記錄走勢，有兩種做法：

- **自己編輯** `data/watchlist.json`，在 `items` 裡加一行，例如：

  ```json
  { "pid": 518861, "cat": 3, "zh": "梵谷皮卡丘" }
  ```

  `pid` 是 TCGplayer 的商品編號（商品頁網址裡的數字），`cat` 是 `3`（美版）或 `85`（日版），`zh` 是清單上顯示的中文名稱，可以省略。同一個商品有多種版本（Normal、Holofoil…）時，可以加 `"sub": "Holofoil"` 指定要記錄哪一種。

- **從網頁直接加**：在「設定」填入一組只限這個儲存庫、有 Contents 讀寫權限的 fine-grained personal access token。Token 只會存在你的瀏覽器。

`watchlist.json` 的變動提交到 GitHub 後，Actions 會自動重新跑一次。本機編輯不會自動上傳。

## 設定自動日本報價

來源對照表已有的商品會自動填入，不必再貼網址。若要調整，展開商品的「日本報價來源」；尚無對照的商品可以填入同一版本、卡況及包裝的網址與規格，可只填一個來源。本機直接儲存並更新行情；GitHub Pages 有 token 時寫入遠端，沒有 token 時會產生可貼入 `data/watchlist.json` 的內容。

也可以直接在既有商品加入 `japan` 設定：

```json
{
  "pid": 709110,
  "cat": 85,
  "zh": "日版烈空 補充盒",
  "japan": {
    "preferred": "snkrdunk",
    "snkrdunk": { "apparelId": 846048, "size": "1個" },
    "pricebase": { "url": "https://price-base.com/useful/stormemeralda-box-market" }
  }
}
```

`apparelId` 是 SNKRDUNK 商品網址 `/apparels/` 後的編號，`size` 必須與來源規格文字相同，省略時為 `1個`。`preferred` 可填 `snkrdunk` 或 `pricebase`。來源不同、換規格或換文章會分開記錄，原有日圓歷史會保留。網站不會依模糊名稱自動配對，以免把有／無封膜、PSA 與未鑑定卡混在一起。

也可在 `data/japan-sources.json` 以商品編號作 key 新增預設來源。追蹤清單明確設定的 `japan` 會優先使用；`"japan": null` 表示停用自動日本來源。

這兩個來源沒有使用付費服務或登入憑證。公開端點／網頁格式若改版或暫時限制請求，會顯示來源更新失敗，需調整解析器。

## 其他網站報價

梵谷皮卡丘（英文 SVP 085，TCGplayer 518861）的其他網站報價直接列在商品明細中，與日版來源採相同的「來源／價格」顯示方式：

- TCGplayer：目前使用的美元市場價。
- SNKRDUNK：從單卡品相資料只取未鑑定 A 等級與 PSA10 各自的最低掛價（日圓）；B、C、PSA8 等不會混入。兩個價格會在清單的「行情」欄位與明細分開顯示。
- PRICE BASE：同張英文卡的未拆封、已拆美品買取參考上限，分列日圓價格，並標示文章相場月份及更新日期。不能當成保證買取價或市售價。
- PriceCharting、Cardmarket：提供已核對商品的原站連結。2026-10-04 自動請求遇到網站驗證，暫不填入網路搜尋快取價格。

`data/comparison-sources.json` 保存已核對的商品對照。每日排程與本機「更新其他來源價格」會刷新可用來源；只抓追蹤商品。不同來源／卡況各自寫入 `history/<pid>-comparisons.json`，不會混入主要估值或美元曲線。清單主價格仍採用原有 TCGplayer 市價；A 與 PSA10 是另外顯示的參考價。失敗保留舊報價及原日期並標示，不補出虛假的今日紀錄。目前報價歷史已保存，尚未另畫成曲線。

## 自動補入近 30 天走勢

加入日本來源或每日更新時，會自動嘗試取得包含今天的最近 30 個日曆日，不需要先等滿一個月：

- **SNKRDUNK 成交相場**：公開成交圖表，先確認商品，再以 `variant_id` 限定與報價相同的規格（例如 `1個`）。時間戳依日本日期解讀。需要另外指定品況的商品暫不補抓，以免混入不同卡況。
- **PRICE BASE 文章相場**：解析與文章商品標題相符的單一 M-chart 圖表，只接受完整年月日，月份表格不會被虛構成每日資料。
- **每日抓價**：從開始追蹤當天累積新品最低掛價或文章當期參考價，獨立保存；不與來源的歷史成交混接。

展開商品可切換上述曲線，顯示近 30 天的實際筆數。來源未公布、商品尚無資料或抓取失敗的日期保留空缺；不補零、不拿今天的價格填回以前。缺日不連線。已存歷史不會在 30 天後刪除，未來更新會合併新紀錄及來源修正。

只有有正確日本來源對照的商品能補抓。TCGplayer 美元行情目前仍從開始追蹤後累積；不是每件商品都保證有 30 筆。[TCGCSV FAQ](https://tcgcsv.com/faq) 雖列出歷史壓縮檔，但在 2026-10-04 實測官方下載端點回覆歷史檔因成本及管理因素暫停公開，這不代表原站沒有歷史：TCGplayer 商品頁仍可能顯示走勢。2026-10-04 實測原站 `price/history` 端點回覆 HTTP 403，因此尚未接入自動美版歷史補抓；當前市價的 `pricepoints` 公開端點則正常可用。

## 部署到 Synology Container Manager

適合 NAS 長期開機、手機透過 VPN 連回家中區網的使用方式。容器內建每日 **台北時間 05:30** 排程，電腦與手機關閉也會執行。錯過當天排程後重啟會補跑，失敗一小時後重試。無需額外設定 DSM 排程。

1. 將專案放在 NAS，例如 `/volume1/docker/pokemon-card-tracker`，須包含 `Dockerfile`、`compose.yaml`、`scripts/`、`site/` 及 `data/`。
2. 複製 `.env.example` 為 `.env`。將兩處 `192.168.1.20` 改成 NAS 的固定區網 IP。例如 `NAS_BIND_IP=192.168.1.20`、`PUBLIC_ORIGINS=http://192.168.1.20:5173`。網址不要加結尾斜線。若使用反向代理，需把實際 HTTPS origin 也加入 `PUBLIC_ORIGINS`（逗號分隔），並保留原始 Host。
3. Container Manager → **專案** → **新增**，選擇此資料夾與現有的 `compose.yaml`，建置並啟動。或在 NAS 此資料夾執行 `docker compose up -d --build`。
4. 第一次啟動會抓取完整商品目錄及追蹤行情，完成前網站可能顯示資料尚未就緒。在專案容器的日誌看到「完成：追蹤…」後，開啟 `http://NAS區網IP:5173`。
5. 手機連上 VPN，確認 VPN 可路由到 NAS 區網 IP，再開同一網址。VPN 是能到達相同網段，不一定是相同網域名稱。

`./storage` 會自動掛載到容器 `/storage`，包含：

| NAS 目錄 | 用途 |
|---|---|
| `storage/data/watchlist.json` | 共用追蹤清單及來源設定 |
| `storage/.cache/local-data/` | 持久保存的行情及歷史 |
| `storage/.cache/schedule.json` | 排程成功日期及錯誤 |
| `storage/dist/` | 目前發布的商品目錄及行情 |

容器重建保留 `storage` 就能保留資料；請將**整個 `storage` 資料夾**納入 NAS 備份。若要搬入這台電腦已有的行情，在 NAS 第一次啟動前，將專案的 `data/`、`.cache/`、`dist/` 分別複製到 `storage/data/`、`storage/.cache/`、`storage/dist/`（須包含隱藏資料夾）。初始清單只在檔案不存在時建立，不會覆寫已儲存設定。

更新程式時保留 `storage`，重新建置專案即可。每日更新會先完整產生新版資料再替換；更新期間仍可看舊行情，暫停儲存清單以避免互相覆寫。勿另外排程 `update.mjs` 或讓兩個容器共用同一個 `storage`。

NAS 版共用清單與行情；**持有數量、成本、備註和手動商品仍在各裝置瀏覽器**，手機不會自動同步這些個人欄位，可用設定頁匯出／匯入。此版沒有帳號登入，請限區網／VPN 使用，不需對外開路由器埠。

### 關注價與 iPhone 推播

在已加入每日紀錄的商品明細設定價格來源、到價方向與門檻。可選 TCGplayer、已設定的 SNKRDUNK／PRICE BASE，或同一商品的比較來源。NAS 每天更新後檢查新報價；首次到價推播一次，價格回到門檻外才重新待命。來源抓取失敗或只剩舊報價時不觸發。關注價與推播訂閱保存在 `storage/.cache/alerts.json`，推播密鑰保存在 `storage/.cache/push-keys.json`；兩者不可公開，請備份整個 `storage`。

iPhone 網站推播需要 iOS 16.4 以上、Safari「加入主畫面」，以及**受 iPhone 信任的 HTTPS 網址**。只透過 VPN 開 `http://NAS區網IP:5173` 可以看網站，但不能啟用網站推播。你若使用 Tailscale，可透過 **Tailscale Serve** 取得只限 tailnet 存取的 `https://NAS名稱.tailnet名稱.ts.net`：

1. 在 [Tailscale 管理後台 DNS 頁](https://login.tailscale.com/admin/dns) 啟用 MagicDNS 與 HTTPS 憑證。請用 Serve，不要用會公開網站的 Funnel。
2. Synology 專案的 `.env` 設 `NAS_BIND_IP`（NAS 區網 IP）、`TAILSCALE_BACKEND_PORT=5174` 與原有 `PUBLIC_ORIGINS=http://NAS區網IP:5173`；重建並啟動 Container Manager 專案。Compose 會另外把容器接到 NAS 自己的 `127.0.0.1:5174`，供 Serve 使用。
3. 以 Synology SSH 的管理員帳號執行 `sudo /var/packages/Tailscale/target/bin/tailscale serve --bg http://127.0.0.1:5174`（在 NAS 自己的終端機輸入 sudo 密碼），再執行 `/var/packages/Tailscale/target/bin/tailscale serve status` 確認輸出的 HTTPS 網址。一般 SSH 帳號可能只能讀取 Serve 狀態，設定 Serve 需要 root 或 Tailscale operator 權限。如果套件太舊、不認得 `serve --bg`，先更新 Tailscale 套件。
4. 把該**完整 HTTPS origin** 加到 `.env` 的 `PUBLIC_ORIGINS`，例如 `PUBLIC_ORIGINS=http://192.168.1.20:5173,https://nas.your-tailnet.ts.net`，再重建專案。網址不要有路徑或尾端斜線。
5. iPhone 連上 Tailscale，用 Safari 開此 HTTPS 網址，分享 →「加入主畫面」。從主畫面打開「卡牌行情」，在「設定 → 手機關注價推播」點啟用，再點「傳送測試通知」。

Tailscale Serve 的 HTTPS 網址只限 tailnet 存取，不需開放路由器埠。iPhone 在 VPN 斷線時仍可能收到推播，但點通知開 NAS 網站需要先連回 Tailscale。Tailscale 的 HTTPS 憑證會在公開憑證透明度紀錄中顯示機器名稱與 tailnet 網域；網站內容並不因此公開。

若專案檔案已放在 `/volume1/docker/pokemon-card-tracker`，且 NAS SSH 帳號不能直接使用 Docker 或設定 Serve，可在自己的 SSH 終端機執行 `sudo sh /volume1/docker/pokemon-card-tracker/activate-nas.sh`，在終端機內輸入 DSM 管理員密碼。這個指令會建置並啟動容器，再啟用只限 tailnet 的 Serve；腳本只使用專案資料夾與本機 `127.0.0.1:5174`，不會啟用 Funnel。

本機 `http://localhost:5173` 可在電腦測試推播，但電腦關閉後不會定時檢查。公開 GitHub Pages 版沒有私人的關注價 API，因此此功能以本機／NAS 版為準。

### 拍照辨識商品（選用）

本機與 NAS 模式可以讓 AI 看照片判斷是哪張卡或哪盒商品。設定 `ANTHROPIC_API_KEY`（[Anthropic Console](https://console.anthropic.com/) 申請，按次計費）後，「搜尋」分頁會出現「拍照辨識」按鈕；沒設定就不顯示。GitHub Pages 靜態版不支援。

- NAS：在 `.env` 加上 `ANTHROPIC_API_KEY=sk-ant-…`，重新建置專案。
- 本機：`ANTHROPIC_API_KEY=sk-ant-… npm start`。

照片會在瀏覽器縮到長邊 1568px 後送到本機伺服器，再由伺服器轉送 Claude API（模型 `claude-opus-5-5`）；金鑰只存在伺服器端。AI 只負責產生搜尋關鍵字並切換美版／日版，實際商品仍從目錄比對，需自行從候選中確認後再加入清單。繁中版等目錄沒有的商品無法比對。此功能沒有次數限制，網站請維持只在區網／VPN 內使用。

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

macOS 也可以在 Finder 裡對 `start.command` 按兩下，效果相同，還會自動開啟瀏覽器。

| 指令 | 作用 |
|---|---|
| `npm run update:local` | 抓資料、產生 `dist/` 與 `.cache/local-data/`，不改動儲存庫裡的 `data/` |
| `npm run dev` | 啟動本機網站。網頁檔案直接讀 `site/`，改了存檔、重新整理就看得到 |
| `npm start` | 上面兩個依序執行 |
| `npm run update` | 跟 GitHub Actions 跑的一樣，會把今天的價格寫進 `data/history` 和 `data/latest.json` |
| `npm test` | 驗證兩個日本來源的解析、規格匹配、失敗回退及歷史資料 |

平常開發用 `update:local` 就好。`npm run update` 會改到 `data/`，那些檔案每天由 Actions 自動提交，自己再提交一次容易衝突。

要換連接埠：`PORT=8080 npm run dev`。一定要透過本機網站開啟，直接用瀏覽器開 `index.html` 會讀不到資料。

本機伺服器只監聽 `127.0.0.1`，寫入清單只接受同來源 JSON 請求。網頁新增或修改清單會改動 `data/watchlist.json`；行情與歷史只寫入 `dist/` 和 `.cache/local-data/`，避免和 Actions 的紀錄互相覆寫。修改 `scripts/dev.mjs` 後須重新啟動伺服器。

## 對來源的禮貌

`update.mjs` 每天約對 tcgcsv 發出 700 個請求（每個系列一次價格；商品清單有快取），同時最多 4 個。請不要把排程調得比一天一次更頻繁，來源本身一天只更新一次。

日本來源只抓追蹤清單中明確設定的商品，依序執行。SNKRDUNK 每次抓價一個請求，當天首次補抓歷史另需三個請求（商品、規格、指定規格圖表）；PRICE BASE 優先重用同次下載的文章。當日成功的歷史補抓不重複請求，抓價失敗最多重試一次。GitHub Actions 在抓價前先執行解析器測試。
