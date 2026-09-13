#!/usr/bin/env bash
# package.json のバージョンを上げる。
# ヘッダーの版表示 (src/components/chrome/AppHeader.tsx) はビルド時に package.json の version を
# 埋め込むので、バージョンアップ後に ./doDeploy.sh すれば表示も更新される。
#
# 使い方:
#   ./doVersion.sh [patch|minor|major]   (省略時: patch)
#
# git の作業ツリーがクリーンなら「chore: release vX.Y.Z」のコミットと
# タグ vX.Y.Z まで作る。変更が残っている場合はバージョンだけ上げて、
# コミットは手動に任せる。
set -euo pipefail
cd "$(dirname "$0")"

BUMP="${1:-patch}"
case "$BUMP" in
  patch|minor|major) ;;
  *) echo "usage: $0 [patch|minor|major]" >&2; exit 1 ;;
esac

if git diff --quiet && git diff --cached --quiet; then
  WAS_CLEAN=1
else
  WAS_CLEAN=0
fi

NEW_VERSION="$(npm version "$BUMP" --no-git-tag-version)"
echo "version: $NEW_VERSION"

if [ "$WAS_CLEAN" = 1 ]; then
  git add package.json package-lock.json
  git commit -m "chore: release $NEW_VERSION"
  git tag "$NEW_VERSION"
  echo "コミットとタグ $NEW_VERSION を作成した。push は: git push && git push --tags"
else
  echo "作業ツリーに未コミットの変更があるため、コミットとタグは作成していない。"
  echo "まとめてコミットするか、次を実行:"
  echo "  git add package.json package-lock.json && git commit -m \"chore: release $NEW_VERSION\" && git tag $NEW_VERSION"
fi
