#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
APP_NAME="FoundFish"

cd "$PROJECT_DIR"

echo "🚀 开始一键预览：FoundFish"
echo "🧹 清理历史产物（保留最近 build 日志）..."
rm -rf release/build/mac release/build/mac-arm64 >/dev/null 2>&1 || true
mkdir -p release/build

if ! command -v pnpm >/dev/null 2>&1; then
  echo "❌ 未检测到 pnpm，请先安装 pnpm（例如：npm i -g pnpm）后重试。"
  exit 1
fi

if [ ! -d "node_modules" ]; then
  echo "📦 依赖缺失，先补齐..."
  pnpm install
fi

echo "🛠️  编译 .app..."
pnpm package-mac

ARCH="$(uname -m)"
if [ "$ARCH" = "arm64" ]; then
  APP_DIR="release/build/mac-arm64"
else
  APP_DIR="release/build/mac"
fi

if [ ! -d "$APP_DIR/$APP_NAME.app" ]; then
  APP_DIR="release/build/mac"
fi

APP_PATH="$APP_DIR/$APP_NAME.app"

if [ ! -d "$APP_PATH" ]; then
  APP_PATH="$(find release/build -type d -name "${APP_NAME}.app" | head -n 1 || true)"
fi

if [ -z "$APP_PATH" ] || [ ! -d "$APP_PATH" ]; then
  echo "❌ 未找到构建产物 .app，请检查 build 日志。"
  exit 1
fi

APP_BIN="$APP_PATH/Contents/MacOS/$APP_NAME"

if [ ! -x "$APP_BIN" ]; then
  echo "❌ 未找到可执行文件：$APP_BIN"
  exit 1
fi

echo "✅ 找到产物：$APP_PATH"
echo "🧪 以普通窗口模式启动（跳过托盘），避免菜单栏初始化崩溃"
FOUNDFISH_PLAIN_PREVIEW=1 "$APP_BIN" >/tmp/foundfish-plain-preview.log 2>&1 &
PREVIEW_PID=$!
echo "🎉 已启动：$APP_PATH (PID: $PREVIEW_PID)"
open -R "$APP_PATH"

sleep 1
if ! kill -0 "$PREVIEW_PID" 2>/dev/null; then
  echo "⚠️ 进程已退出，查看日志：/tmp/foundfish-plain-preview.log"
  tail -n 40 /tmp/foundfish-plain-preview.log 2>/dev/null
  exit 1
fi
