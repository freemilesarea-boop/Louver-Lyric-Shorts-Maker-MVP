# 설치 가이드 (테스터용)

이 문서는 베타 빌드를 받은 테스터를 위한 설치/실행 안내입니다. 이 빌드는
Apple Developer ID 서명과 Windows Authenticode 서명이 적용되어 있지 않아
처음 실행할 때 한 번 수동 확인 절차가 필요합니다. 정식 배포 전 정리 예정.

---

## macOS

### 증상

첫 실행 시 다음 중 하나가 나타날 수 있습니다:

- "Lyric Shorts Maker.app이(가) 손상되었기 때문에 열 수 없습니다."
- "확인되지 않은 개발자가 만든 앱이라서 열 수 없습니다."

이건 **앱이 망가진 게 아닙니다**. macOS Gatekeeper가 서명이 없는 앱에 대해
보호 장치를 발동한 것뿐입니다.

### 해결 (3가지 중 편한 것)

**방법 1 — 우클릭 → 열기 (추천)**

1. Finder에서 `Lyric Shorts Maker.app`을 우클릭 (또는 Control + 클릭)
2. 메뉴에서 **열기** 선택
3. 경고 창이 나오면 다시 **열기** 클릭
4. 이후부터는 더블클릭으로 그냥 실행됩니다.

**방법 2 — 시스템 설정 → 개인정보 보호 및 보안**

macOS 15+ 에서는 위 방법이 막히는 경우가 있습니다.

1. 한 번 더블클릭 (차단 메시지 확인)
2. **시스템 설정** → **개인정보 보호 및 보안** 으로 이동
3. 화면 아래쪽에 "Lyric Shorts Maker 사용을 차단했습니다" 항목이 있으면
   **그래도 열기** 버튼 클릭
4. 관리자 비밀번호 입력 후 실행

**방법 3 — quarantine 속성 제거 (터미널)**

위 둘 다 안 되거나 "손상되었기" 메시지가 계속 뜨면:

```sh
xattr -cr "/Applications/Lyric Shorts Maker.app"
```

(앱을 설치한 경로에 맞춰 경로를 바꿔주세요. dmg에서 드래그 직후라면
`~/Downloads/Lyric Shorts Maker.app`일 수도 있습니다.)

### 왜 이렇게 번거로운가요?

정식 macOS 배포는 Apple Developer Program 가입과 notarization 절차가
필요합니다. 베타 단계에서는 이 비용/시간을 들이기 전에 동작 확인이 우선
이라 위 절차로 안내드리는 중입니다. 정식 v1 배포 시 서명/notarization
이 적용되면 위 절차는 필요 없어집니다.

---

## Windows

### 증상

설치 파일을 더블클릭하면 다음 화면이 뜰 수 있습니다:

- "Windows의 PC 보호 — Microsoft Defender SmartScreen에서 인식할 수 없는
  앱의 시작을 차단했습니다."

### 해결

1. 화면의 **추가 정보** 링크를 클릭
2. 그 아래에 **실행** 버튼이 새로 나타납니다 — 클릭
3. 정상적으로 NSIS 설치 마법사가 시작됩니다.

### 왜 이런가요?

Authenticode 코드 서명 인증서가 적용되지 않아 SmartScreen이 "처음 보는
파일"로 분류합니다. 정식 배포 시 코드 서명이 적용되면 이 경고는 사라집니다.

---

## Linux (AppImage)

### 설치 / 실행

1. 다운로드한 `.AppImage` 파일에 실행 권한 부여:

   ```sh
   chmod +x "Lyric Shorts Maker-0.1.0.AppImage"
   ```

2. 더블클릭 또는 터미널에서 직접 실행:

   ```sh
   ./Lyric\ Shorts\ Maker-0.1.0.AppImage
   ```

### libfuse2 누락 시

일부 최신 배포판 (Ubuntu 22.04+ 등) 에서 `libfuse2`가 기본 설치되지
않을 수 있습니다:

```sh
sudo apt install libfuse2
```

또는 AppImage를 추출해서 실행:

```sh
./Lyric\ Shorts\ Maker-0.1.0.AppImage --appimage-extract
./squashfs-root/AppRun
```

---

## 모든 OS — 첫 실행 후

- 시작 화면에서 이미지 1장 + 오디오 1개를 업로드합니다.
- 추천 스타일 중 하나를 선택하면 모든 설정이 자동으로 맞춰집니다.
- 가사를 직접 입력하거나 "AI 가사 추출" 버튼을 누릅니다 (해당 빌드에
  whisper 엔진이 포함된 경우).
- "영상 만들기"를 누르면 출력 폴더에 1080×1920 MP4가 생성됩니다.

문제 발생 시 `Help → 콘솔 보기`(개발자 도구) 의 출력을 캡쳐해 보내주세요.
