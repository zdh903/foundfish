#!/bin/bash
set -e

echo "=== 推送 FoundFish 公开版到 GitHub ==="
echo ""

# 确认认证
if ! gh auth status >/dev/null 2>&1; then
  echo "未登录 GitHub，请先执行：gh auth login"
  exit 1
fi

# 确认仓库
REPO="zdh903/foundfish"
if gh repo view "$REPO" >/dev/null 2>&1; then
  echo "仓库 $REPO 已存在，直接推送"
else
  echo "创建仓库 $REPO ..."
  gh repo create "$REPO" --public --source=. --remote=origin --push
  echo "完成"
  exit 0
fi

# 仓库已存在：配置 remote 并推送
if git remote get-url origin >/dev/null 2>&1; then
  git remote set-url origin "https://github.com/$REPO.git"
else
  git remote add origin "https://github.com/$REPO.git"
fi

echo "推送到 main 分支..."
git push -u origin main --force
echo "完成"
