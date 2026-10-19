#!/usr/bin/env bash
# 画像アセット（アイコン・OGP画像・README用スクリーンショット）を再生成する。
#
# 必要なもの: ImageMagick (convert) と Google Chrome
# 使い方: ./scripts/build_images.sh
set -euo pipefail

cd "$(dirname "$0")/.."

PORT="${PORT:-8812}"
CHROME="${CHROME:-google-chrome}"
TMP="$(mktemp -d)"
SERVER_PID=""

cleanup() {
  [ -n "$SERVER_PID" ] && kill "$SERVER_PID" 2>/dev/null || true
  rm -rf "$TMP"
}
trap cleanup EXIT

for bin in convert identify python3 "$CHROME"; do
  command -v "$bin" >/dev/null 2>&1 || { echo "エラー: $bin が見つかりません" >&2; exit 1; }
done

# 1枚撮る（$1=url $2=出力 $3=幅 $4=高さ $5=追加オプション）
shot() {
  local url="$1" out="$2" w="$3" h="$4" extra="${5:-}"
  # shellcheck disable=SC2086
  "$CHROME" --headless=new --disable-gpu --no-sandbox --disable-dev-shm-usage \
    --hide-scrollbars --user-data-dir="$TMP/profile" \
    --window-size="$w,$h" --virtual-time-budget=8000 $extra \
    --screenshot="$out" "$url" >/dev/null 2>&1
}

echo "→ アイコンを生成しています"
shot "file://$PWD/assets/icon.svg" "$TMP/icon-512.png" 512 512 \
  "--default-background-color=00000000"
convert "$TMP/icon-512.png" -resize 180x180 -background "#1F4FD8" -flatten -strip \
  assets/apple-touch-icon.png
for size in 16 32 48; do
  convert "$TMP/icon-512.png" -resize "${size}x${size}" -strip "$TMP/i${size}.png"
done
convert "$TMP/i16.png" "$TMP/i32.png" "$TMP/i48.png" -strip favicon.ico

echo "→ ページを撮影しています (port ${PORT})"
python3 -m http.server "$PORT" --bind 127.0.0.1 >/dev/null 2>&1 &
SERVER_PID=$!
sleep 1.5

shot "http://127.0.0.1:${PORT}/" "$TMP/og.png" 1200 630
convert "$TMP/og.png" -strip -define png:compression-level=9 assets/og.png

mkdir -p docs
shot "http://127.0.0.1:${PORT}/" "$TMP/preview.png" 1200 900
convert "$TMP/preview.png" -strip -define png:compression-level=9 docs/preview.png

echo
identify -format '%f  %wx%h  %b\n' \
  favicon.ico assets/icon.svg assets/apple-touch-icon.png assets/og.png docs/preview.png 2>/dev/null ||
  ls -l favicon.ico assets/og.png docs/preview.png
