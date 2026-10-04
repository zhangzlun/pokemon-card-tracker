#!/bin/bash
# macOS：在 Finder 裡對這個檔案按兩下，就會抓資料並啟動本機網站。
# 也可以在終端機執行 ./start.command，或直接用 npm start。

cd "$(dirname "$0")" || exit 1

# 從 Finder 啟動時不會載入 shell 設定，這裡補上常見的 Node 安裝位置
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" >/dev/null 2>&1

if ! command -v node >/dev/null 2>&1; then
  echo "找不到 Node.js。請先安裝 Node.js 20 以上的版本：https://nodejs.org/"
  read -r -p "按 Enter 關閉…"
  exit 1
fi

PORT="${PORT:-5173}"
echo "Node $(node -v)，開始抓資料（約半分鐘）…"
if ! node scripts/update.mjs --local; then
  echo "抓資料失敗，請檢查網路後再試一次。"
  read -r -p "按 Enter 關閉…"
  exit 1
fi

(sleep 1; open "http://localhost:$PORT") &
echo "要停止網站，按 Ctrl+C 或直接關掉這個視窗。"
PORT="$PORT" node scripts/dev.mjs
