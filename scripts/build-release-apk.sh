#!/usr/bin/env bash
# 本机构建正式签名 APK
# - 签名密码从 macOS 钥匙串读取（或调用方已设置的 MG_RELEASE_STORE_PASSWORD），只通过环境变量传给 Gradle
# - 不回显、不落盘任何密钥；产物为 android/app/build/outputs/apk/release/mini-games-v<版本>.apk
#
# 可选环境变量：
#   NODE_BIN              Node 可执行文件（默认取 PATH 中的 node）
#   JAVA_HOME             JDK 21（默认依次尝试 /usr/libexec/java_home -v 21、android/.gradle/jdk21）
#   ANDROID_HOME          Android SDK（默认 ~/Library/Android/sdk）
#   MG_SIGNING_DIR        签名目录（默认 ~/.minigames-signing）
#   MG_RELEASE_STORE_FILE keystore 路径（默认 $MG_SIGNING_DIR/mini-games-release.jks）
#   MG_RELEASE_KEY_ALIAS  密钥别名（默认 minigames）
#   MG_KEYCHAIN_SERVICE   钥匙串条目名（默认 mini-games-release-signing）
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

die() { echo "错误：$*" >&2; exit 1; }
step() { printf '\n==> %s\n' "$*"; }

NODE_BIN="${NODE_BIN:-$(command -v node || true)}"
[ -n "$NODE_BIN" ] && [ -x "$NODE_BIN" ] || die "未找到 Node，请通过 NODE_BIN 指定"
export PATH="$(dirname "$NODE_BIN"):$PATH"

if [ -z "${JAVA_HOME:-}" ]; then
  JAVA_HOME="$(/usr/libexec/java_home -v 21 2>/dev/null || true)"
  if [ -z "$JAVA_HOME" ]; then
    for candidate in "$ROOT"/android/.gradle/jdk21/*/Contents/Home; do
      [ -x "$candidate/bin/java" ] && JAVA_HOME="$candidate" && break
    done
  fi
fi
[ -n "${JAVA_HOME:-}" ] && [ -x "$JAVA_HOME/bin/java" ] || die "未找到 JDK 21，请通过 JAVA_HOME 指定"
export JAVA_HOME

export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
[ -d "$ANDROID_HOME/build-tools" ] || die "未找到 Android SDK：$ANDROID_HOME"
BUILD_TOOLS="$(ls -d "$ANDROID_HOME"/build-tools/*/ | sort -V | tail -1)"
APKSIGNER="${BUILD_TOOLS%/}/apksigner"
[ -x "$APKSIGNER" ] || die "未找到 apksigner：$APKSIGNER"

SIGNING_DIR="${MG_SIGNING_DIR:-$HOME/.minigames-signing}"
export MG_RELEASE_STORE_FILE="${MG_RELEASE_STORE_FILE:-$SIGNING_DIR/mini-games-release.jks}"
export MG_RELEASE_KEY_ALIAS="${MG_RELEASE_KEY_ALIAS:-minigames}"
KEYCHAIN_SERVICE="${MG_KEYCHAIN_SERVICE:-mini-games-release-signing}"
[ -f "$MG_RELEASE_STORE_FILE" ] || die "未找到签名文件：$MG_RELEASE_STORE_FILE"

if [ -z "${MG_RELEASE_STORE_PASSWORD:-}" ]; then
  MG_RELEASE_STORE_PASSWORD="$(security find-generic-password -s "$KEYCHAIN_SERVICE" -a "$MG_RELEASE_KEY_ALIAS" -w 2>/dev/null)" \
    || die "钥匙串中没有条目 $KEYCHAIN_SERVICE（账户 $MG_RELEASE_KEY_ALIAS）"
fi
export MG_RELEASE_STORE_PASSWORD
# PKCS12 keystore 的密钥密码与库密码相同
export MG_RELEASE_KEY_PASSWORD="${MG_RELEASE_KEY_PASSWORD:-$MG_RELEASE_STORE_PASSWORD}"

VERSION="$("$NODE_BIN" -p "require('./package.json').version")"

step "校验版本号与运行测试（$VERSION）"
"$NODE_BIN" scripts/sync-version.mjs --check
"$NODE_BIN" --test tests/*.test.js >/dev/null || die "测试未通过"

step "同步网页资源到 Android 工程"
"$NODE_BIN" node_modules/@capacitor/cli/bin/capacitor sync android

step "构建正式签名 APK"
(cd android && ./gradlew assembleRelease --console=plain -q)

APK="android/app/build/outputs/apk/release/app-release.apk"
[ -f "$APK" ] || die "未生成 $APK"

step "校验签名"
"$APKSIGNER" verify --print-certs "$APK" | grep -E 'Signer #1 certificate (DN|SHA-256 digest)'
"$APKSIGNER" verify "$APK"

OUT="android/app/build/outputs/apk/release/mini-games-v$VERSION.apk"
cp "$APK" "$OUT"
step "完成"
echo "APK：$OUT"
shasum -a 256 "$OUT"
