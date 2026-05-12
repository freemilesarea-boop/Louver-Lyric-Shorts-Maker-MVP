#!/bin/bash
# Lyric Shorts Maker — macOS "손상되었기 때문에 열 수 없습니다" 해결 헬퍼.
#
# 이 파일을 더블클릭하면 터미널이 열리면서 자동으로 quarantine
# (Gatekeeper가 다운로드한 파일에 붙이는 격리 속성)을 제거합니다.
# 그 다음 Lyric Shorts Maker.app을 정상 실행할 수 있어요.
#
# 왜 필요한가요?
# Lyric Shorts Maker RC.1은 아직 Apple Developer ID 인증서가 없는
# 자가 서명 빌드라서, macOS가 "확인되지 않은 개발자"로 차단합니다.
# 정식 V1.0.0부터는 인증서가 적용되어 이 스크립트가 필요 없게 됩니다.

set -e

cd "$(dirname "$0")"
APP="/Applications/Lyric Shorts Maker.app"

echo "==========================================="
echo "  Lyric Shorts Maker — macOS 실행 도우미"
echo "==========================================="
echo ""

# 1) Applications에 설치되어 있는지 확인
if [ ! -d "$APP" ]; then
  # 같은 DMG에서 실행됐을 수도 있음 — 그 경우 DMG 내부 위치 시도
  ALT="$(dirname "$0")/Lyric Shorts Maker.app"
  if [ -d "$ALT" ]; then
    APP="$ALT"
    echo "참고: 앱이 아직 Applications에 복사되지 않은 것 같아요."
    echo "      먼저 Lyric Shorts Maker.app을 Applications 폴더로 드래그한 뒤"
    echo "      다시 이 파일을 더블클릭해주세요."
    echo ""
    echo "엔터를 누르면 종료됩니다."
    read -r
    exit 0
  else
    echo "❌ Lyric Shorts Maker.app을 찾을 수 없습니다."
    echo "   먼저 DMG 창에서 앱을 Applications 폴더로 드래그한 뒤"
    echo "   다시 이 파일을 더블클릭해주세요."
    echo ""
    echo "엔터를 누르면 종료됩니다."
    read -r
    exit 1
  fi
fi

echo "✓ 앱 발견: $APP"
echo ""
echo "Gatekeeper 격리 속성을 제거합니다..."
xattr -dr com.apple.quarantine "$APP" 2>/dev/null || true
echo "✓ 완료"
echo ""
echo "지금 Lyric Shorts Maker를 실행할까요? (y/n, 기본 y)"
read -r -n 1 ans
echo ""
case "$ans" in
  n|N)
    echo "OK. 나중에 Launchpad 또는 Applications 폴더에서 실행하세요."
    ;;
  *)
    open "$APP" || {
      echo "❌ 실행 실패. Applications 폴더에서 수동으로 더블클릭해보세요."
      read -r
      exit 1
    }
    echo "✓ 실행됨"
    ;;
esac

echo ""
echo "엔터를 누르면 이 창이 닫힙니다."
read -r
