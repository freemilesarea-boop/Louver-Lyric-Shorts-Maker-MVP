# Phase 5-1 — Beta Feedback Fixes + Installer Stabilization

긴급 수정. 새 기능 추가 없이 사용자 피드백 8개 항목과 macOS/Windows 설치
문제를 다룬다. 사용자와 합의한 스코프: **Tier 1 + Tier 2 + Tier 3 plumbing**.

---

## 8개 피드백 항목 처리 결과

| # | 피드백 | 처리 | 변경 파일 / 핵심 변경 |
| --- | --- | --- | --- |
| 1 | 샘플 프리셋 적용 시 큰 카드가 사진을 가림 | ✅ 수정 완료 | `src/shared/scene.ts` (`resolvePhotoBox` 0.86×0.62 → 0.92×0.74, polaroid pad 28→16, bottom 4× → 2.5×). `src/renderer/templates/templates.ts` (모든 `overlayOpacity` 0.4-0.85 → 0.2-0.4). 사진이 영상의 시각적 주인공이 되도록. |
| 2 | UI 영어 중심 → 어르신/초보자에게 어려움 | ✅ 수정 완료 | EditorScreen 섹션 제목, SamplePresetPicker, MotionSelector, AnimationSelector, ReactiveSelector, CinematicFxSelector, LanguageSelector, FontSelector, ExportPresetSelector 텍스트, ExportScreen 진행 라벨, StartScreen "DURATION"→"길이", App.tsx 단계 버튼 "Start/Editor/Export"→"시작/편집/출력", `MOTION_LABEL`/`ANIMATION_LABEL`/`REACTIVE_LABEL`/`FX_LABEL` 한글화. 모든 sample preset name + description + lyricStyleHint 한글. 모든 template name 한글. |
| 3 | Whisper 외부 설치 의존 → 일반 사용자 사용 불가 | 🟡 plumbing 완료 (binaries는 별도 fetch) | `src/main/audio/transcribe.ts` `detectWhisperBinary()` 가 이제 `resources/whisper/bin/<platform>/whisper-cli`를 PATH 보다 먼저 검사. `bundledWhisperModelPath()` 추가 — 기본 모델로 `ggml-base.bin` → `ggml-tiny.bin` 순으로 탐색. `package.json` `extraResources` 에 `resources/whisper/` 추가. **바이너리 자체는 Phase 5-2 빌드 스크립트가 채울 예정**. fallback 체인: 번들 → 시스템 → 수동입력. |
| 4 | UI 한글화 보강 (3번과 동일 항목) | ✅ 수정 완료 | "Amplitude curve / system fallback / Manual / Auto / Template default" → "음악 반응 분석 완료 / 기본 글씨체로 표시 / 직접 선택 / 자동 / 템플릿 기본". 에러문 / placeholder / 도움말도 사용자 언어로. |
| 5 | Louver 브랜딩 왼쪽 하단 고정 | ✅ 수정 완료 | `src/renderer/App.tsx` 에 `LouverAppBrand` 컴포넌트 추가 — `pointer-events-none fixed bottom-2 left-3 z-20`. "Louver" + "Lyric Shorts Maker · v0.1.0" 항상 노출. 출력 영상 워터마크와는 별도. |
| 6 | Motion 선택 전 미리보기/설명 부족 | ✅ 수정 완료 | `src/shared/motion.ts` 에 `MOTION_DESCRIPTION` 한글 설명 맵 추가. `MotionSelector.tsx` 가 선택된 motion의 한 줄 설명 표시. "미리보기에서 바로 확인할 수 있어요" 안내. (썸네일은 Phase 5-2.) |
| 7 | Waveform이 정적, 음악 반응 약함 | ✅ Preview 완료, Export 미완 | `src/shared/scene.ts` `paintWaveform()` 시그니처에 `amplitude: number\|null` 추가. 라이브 amplitude 가 `pulse`/`waveformBoost` reactive 상태에서 추출되어 bar 높이 + 알파를 변조. `paintChrome()` 호출부에서 wireup. **Export 쪽 ffmpeg drawbox bars 는 여전히 sin 합성** — 진짜 amplitude 기반으로 바꾸려면 ffmpeg 표현식에 amplitude curve 임베드 필요 (대규모 리팩터, Phase 5-2). |
| 8 | Apple/Spotify/YouTube Music 템플릿이 플레이어 느낌 부족 | ✅ 수정 완료 | 신규 `src/shared/playerChrome.ts` — `paintAppleLikePlayer` / `paintSpotifyLikePlayer` / `paintYoutubeLikePlayer`. 글래스 카드 + 트랙 라인 + 진행바 + 재생 컨트롤 + (Spotify) 7-bar reactive equalizer. 자체 디자인, 어떤 브랜드 로고/UI도 복제하지 않음. `Template` 타입에 `playerChrome` 필드 추가. 세 "inspired" 템플릿이 각자 chrome 지정. `renderScene` 에 6b 단계 추가 (preview + export 모두). 진행바는 키프레임당 sample 되어 keyframe density 만큼 step. |
| 9 | macOS/Windows 설치 불안정, ffmpeg 번들 위험 | 🟡 부분 수정 — CI 인프라/문서 완비, 실제 host 확인 필요 | `.github/workflows/build-release.yml` 에 macOS ad-hoc codesign 단계 추가 (`codesign --force --deep --sign -`) — Gatekeeper "손상되었기" 메시지 회피. `INSTALL.md` 신규: 사용자용 우클릭→열기 / 시스템 설정 / `xattr -cr` 가이드. Windows SmartScreen "추가 정보 → 실행" 가이드. AppImage `chmod +x` + libfuse2 안내. 정식 서명/notarization 은 RC-QA.md §4 P1 그대로. |

---

## 새/수정 파일 요약

신규:
- `src/shared/playerChrome.ts` — Apple/Spotify/YT Music 자체 디자인 chrome painter
- `INSTALL.md` — 베타 테스터용 macOS/Windows/Linux 설치 가이드
- `resources/whisper/README.md` — whisper 번들 layout + 라이선스 + 사이즈 영향 문서
- `resources/whisper/bin/`, `resources/whisper/models/` — 빈 디렉토리 (빌드 시 채움)
- `PHASE-5-1.md` — 본 문서

수정:
- `src/shared/scene.ts` — 사진 박스 확대, polaroid 패드 축소, paintWaveform amplitude 인자, paintPlayerChrome 호출, durationSec 옵션
- `src/shared/motion.ts` — `MOTION_LABEL` 한글, `MOTION_DESCRIPTION` 신규
- `src/shared/animation.ts` / `audioReactive.ts` / `cinematicFx.ts` — 라벨 한글화
- `src/shared/exportPresets.ts` — preset 라벨 한글
- `src/shared/types.ts` — `Template.playerChrome` 추가
- `src/main/audio/transcribe.ts` — bundled whisper 우선 탐색, model path 자동 검색
- `src/renderer/App.tsx` — `LouverAppBrand` 추가, topbar 한글
- `src/renderer/templates/templates.ts` — opacity 일괄 하향, name 한글, 3 template에 playerChrome 지정
- `src/renderer/samples/samplePresets.ts` — 5개 preset 한글
- `src/renderer/screens/EditorScreen.tsx` — 모든 섹션 제목 + 버튼 한글
- `src/renderer/screens/StartScreen.tsx` — "DURATION" → "길이"
- `src/renderer/screens/ExportScreen.tsx` — 모든 사용자-노출 영어 한글화
- `src/renderer/components/MotionSelector.tsx` — 한글 + description 표시
- `src/renderer/components/AnimationSelector.tsx` / `ReactiveSelector.tsx` / `CinematicFxSelector.tsx` / `LanguageSelector.tsx` / `FontSelector.tsx` — 한글
- `src/renderer/components/TranscribeButton.tsx` — "설치 필요" 메시지 → "이 빌드에 미포함, 직접 입력" 안내
- `src/renderer/components/LivePreview.tsx` — `durationSec` prop 전달
- `src/renderer/lib/overlays.ts` — keyframe별 timeRatio + durationSec 전달, `BuildOpts` / `OverlayPngOpts` 확장
- `package.json` `build.extraResources` — `resources/whisper/` 추가
- `.github/workflows/build-release.yml` — macOS ad-hoc codesign 단계

---

## 검증 결과

| 항목 | 결과 |
| --- | --- |
| `npm run typecheck` | ✅ clean |
| `npm run build` | ✅ clean (out/renderer 27.43KB CSS / 420KB JS) |
| `npm run test:fonts` | ✅ all checks |
| `npm run test:watermark` | ✅ 21/21 |
| `npm run test:export-presets` | ✅ tiktok 179kbps < shorts 204 < reels 203 < master 226 |
| `npm run test:rc-qa` | ✅ items 4-9 all green |
| `npm run demo-pack` | ✅ 20/20 · 평균 10.7s · 평균 477KB |

---

## macOS/Windows 설치 문제 — 원인 + 해결

### macOS "손상되었기" 원인

Apple Developer ID 서명 + notarization이 적용되지 않은 .app + 사용자가
다운로드한 파일에는 macOS가 자동으로 `com.apple.quarantine` 확장 속성을
붙임. Gatekeeper는 서명이 없는 quarantined .app을 실행 거부 + "손상되었기
때문에 열 수 없습니다" 라는 (오해 소지가 있는) 메시지 표시.

### 이번 처리

1. **CI 단계에 ad-hoc codesign 추가** (`codesign -s -`) — Gatekeeper가
   "신뢰할 수 없는 개발자" 분류로 떨어뜨려서 사용자가 우클릭→열기로
   넘어갈 수 있게 함. notarization은 아니므로 macOS 15+ 에서는 시스템
   설정 1회 확인 절차가 더 필요할 수 있음.
2. **`INSTALL.md` 작성** — 우클릭→열기, 시스템 설정 → 개인정보 보호 및
   보안, `xattr -cr` 세 가지 우회 방법 단계별 안내.
3. 정식 v1 배포 시 Apple Developer Program 가입 + notarytool 적용 필요.
   비용/일정은 별도 결정.

### Windows SmartScreen

Authenticode 인증서 미적용 → "처음 보는 파일" 분류. 이번 처리는 INSTALL.md
의 "추가 정보 → 실행" 가이드. 정식 배포는 코드 서명 인증서 필요.

### ffmpeg 번들 무결성

기존 Phase 4-2 의 `verify-packaged-binaries.ts` 가 OS별 magic 검증
(ELF/Mach-O/PE) 으로 잘못된 호스트의 ffmpeg 가 패키지에 들어가는 사고를
이미 차단. 이번 단계에서 추가 변경 없음.

---

## 남은 리스크 (Phase 5-2 이후)

| Pri | 항목 |
| --- | --- |
| **P1** | whisper.cpp 바이너리 + ggml 모델 fetch 자동화 — `scripts/fetch-whisper.sh` 작성 후 CI matrix step 추가. 이게 끝나야 진짜 "zero install" AI 가사 추출이 동작. |
| **P1** | macOS 실 host install 1회 검증 — CI ad-hoc codesign 만으로 충분한지 vs 정식 notarization 필요한지 결정. |
| **P1** | Windows 실 host install 1회 검증. |
| P2 | 진짜 amplitude-driven 도형 ffmpeg drawbox waveform — sin 합성 대신 amplitude curve 임베드. (기술적으로 가능하지만 표현식 길이 ~120 samples × 32 bars). |
| P2 | Motion selector 썸네일/플레이 버튼. |
| P2 | Apple Developer Program / Authenticode 인증서 구매 + notarization 자동화. |
| P3 | 실제 아이콘 에셋 1024×1024 (mac/win/linux). |
| P3 | `assets/fonts/` 에 OFL 한글 폰트 번들 (Pretendard 등). |
| P3 | `electron-updater` 통합. |

---

## 실제 배포 가능 artifact (Phase 5-1 시점)

CI matrix가 PR #1 의 새 commit 으로 재트리거되면 다음 artifact 가
업로드되어야 함:

- `dist-linux` — `Lyric Shorts Maker-0.1.0.AppImage` (~210 MB)
- `dist-mac` — `Lyric Shorts Maker-0.1.0.dmg` + `.zip` (ad-hoc 서명 적용)
- `dist-win` — `Lyric Shorts Maker Setup 0.1.0.exe` (NSIS, unsigned)

세 artifact 모두 `verify-packaged-binaries.ts` 통과해야 업로드. 사용자
설치 시 INSTALL.md 의 OS별 우회 절차 1회 필요.

---

## 다음에 해야 할 일 (Phase 5-2 권장 순서)

1. `scripts/fetch-whisper.sh` 작성 + CI matrix 에 추가 → 실제 whisper
   번들 동작 확인.
2. macOS / Windows 실 host install 검증 (테스터 1명씩 확보).
3. 첫 install 검증이 통과하면 → 정식 v1 배포를 위한 서명 자동화 결정.
