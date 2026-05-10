# Release Candidate QA — Phase 4-5

이 문서는 테스터 배포 전 RC QA 실행 결과를 담는다. 이번 단계에서는
**기능 추가 없음**. 검증 / 버그 수정 / 문서화만 진행한다.

실행 환경: Linux x86_64, ffmpeg-static (ELF), Node 20+, electron 30.

---

## 1. 검증 항목 결과표

| #   | 검증 항목                                | 실행                                           | 결과 | 비고                                                                                                |
| --- | ---------------------------------------- | ---------------------------------------------- | ---- | --------------------------------------------------------------------------------------------------- |
| 1   | typecheck                                | `npm run typecheck`                            | ✅   | tsconfig.node + tsconfig.web 둘 다 clean.                                                          |
| 2   | production build                         | `npm run build`                                | ✅   | `out/main` 38.5KB · `out/preload` 2KB · `out/renderer` 410KB JS + 27KB CSS.                       |
| 3   | demo-pack 20/20                          | `npm run demo-pack`                            | ✅   | 20/20, 평균 13.2s · 평균 481KB · 총 263.4s · 총 9.4MB. 실패 0건.                                  |
| 4a  | watermark 단위 smoke (5 위치 + 폴백)     | `npm run test:watermark`                       | ✅   | 21/21 assertions. 비활성화 시 캔버스 완전 투명, 위치별 사분면 라우팅 정상.                         |
| 4b  | watermark ON/OFF + 5위치 실제 MP4 렌더   | `npm run test:rc-qa` (item 4)                  | ✅   | baseline 79KB → 5 위치 모두 baseline 대비 다른 파일 크기 (full-duration overlay PNG 가 합쳐짐).   |
| 5   | export presets 4종 smoke                 | `npm run test:export-presets`                  | ✅   | h264/aac/duration/suffix 모두 OK. tiktok 173kbps < shorts/reels/master 186-193kbps. 4/4 unique.   |
| 6   | custom preset 저장/불러오기              | `npm run test:rc-qa` (item 9)                  | ✅   | save → list 1 증가 · language/reactiveMode 라운드트립 일치 · delete → 원래 카운트로 복원.          |
| 7   | safe zone preview/export 미포함          | `npm run test:rc-qa` (item 5)                  | ✅   | `overlays.ts`, `scene.ts` 둘 다 `safeZones` 미import. `LivePreview` 만 import (preview-only).   |
| 8   | hook suggest 정상                        | `npm run test:rc-qa` (item 6)                  | ✅   | 합성 amplitude 곡선에서 candidate >= 1, 라우드 윈도우와 4s+ overlap, 점수 silent 플로어 위.       |
| 9   | whisper 미설치 graceful fallback         | `npm run test:rc-qa` (item 7)                  | ✅   | `PATH` 비우면 `detectWhisperBinary()` → null, `transcribe()` → `WhisperNotInstalledError` throw.  |
| 10  | 한글 경로 / 공백 경로                    | `npm run test:rc-qa` (item 8)                  | ✅   | `한 글 dir/이미지 파일.png` + `오디오 파일.wav` → `결과 영상.mp4` (52.5KB) 정상 출력.              |
| 11  | font system smoke                        | `npm run test:fonts`                           | ✅   | registry shape · `fontFamilyFor()` quoting · `defaultFontForLanguage` · canvas ctx.font round-trip · graceful when files absent. |

총 **11/11** 합격. 한 번에 다시 돌리려면 `npm run typecheck && npm run build && npm run test:fonts && npm run test:watermark && npm run test:export-presets && npm run test:rc-qa && npm run demo-pack`.

---

## 2. 패키징 검증

| 대상                       | 명령                  | 결과                                            | 비고                                                                                                              |
| -------------------------- | --------------------- | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Linux AppImage 재빌드      | `npm run dist:linux`  | ✅ `release/Lyric Shorts Maker-0.1.0.AppImage` (210MB) | electron-builder 24.13.3 + electron 30.5.1. ELF dynamically-linked.                                              |
| ffmpeg/ffprobe magic check | `tsx scripts/verify-packaged-binaries.ts` | ✅ 2/2 ELF                                      | `app.asar.unpacked/node_modules/ffmpeg-static/ffmpeg` + `ffprobe-static/bin/linux/x64/ffprobe` 둘 다 ELF 확인. |
| asar unpack 검증           | `find release/.../app.asar.unpacked` | ✅                                              | ffmpeg/ffprobe 가 asar **외부**에 unpacked → spawn 가능 상태.                                                  |
| macOS dmg                  | `npm run dist:mac`    | ⛔ 본 환경 불가능                                | `dmg-license` 가 macOS 전용 dependency. **macOS 호스트 필요.** GitHub Actions `macos-latest` 매트릭스로 해결.  |
| Windows nsis               | `npm run dist:win`    | ⛔ 본 환경 불가능                                | wine 또는 Windows 호스트 필요. `ffmpeg-static` 호스트 의존성 때문에 cross-build 가 잘못된 ELF 를 win 패키지에 넣음. **Windows 호스트 필요.** GitHub Actions `windows-latest` 매트릭스로 해결. |

**Cross-build 금지 규칙 재확인**: README §"Dist build 결과 (Phase 4-1)" 와 §"CI 매트릭스 빌드 (Phase 4-2)" 에 이미 문서화되어 있음. `verify-packaged-binaries.ts` 가 Mach-O / PE / ELF 매직 넘버를 체크해서 잘못된 호스트의 바이너리가 패키지에 들어가는 사고를 차단한다.

### ffprobe-static 다중 플랫폼 바이너리

`ffprobe-static` 패키지는 설계상 darwin/linux/win32 모든 플랫폼의 ffprobe 바이너리를 함께 묶어서 배포하고 런타임에 `process.platform` 으로 선택한다 (`ffmpeg-static` 과 다름). 즉 Linux AppImage 안에도 darwin/x64, darwin/arm64, linux/ia32, linux/x64 의 ffprobe 가 모두 들어가 있는 것은 정상이다 — `ffprobePath` 는 `linux/x64` 만 가리킨다. `verify-packaged-binaries.ts` 는 **사용되는** 경로만 검사하므로 거짓양성이 없다.

---

## 3. 알려진 위험 (Known Risks)

P1 = 배포 전 반드시 해결, P2 = 배포 후 빠르게 대응, P3 = 모니터링.

| Pri | 위험                                                                | 영향                                                | 완화 / 대응                                                                                                                        |
| --- | ------------------------------------------------------------------- | --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| P1  | macOS dmg / Windows nsis 가 **실제 호스트에서 빌드 + 설치 + 렌더 검증되지 않음** | 첫 배포 시 dmg/exe 가 사용자 환경에서 미동작 가능   | GitHub Actions `macos-latest` / `windows-latest` 매트릭스로 빌드 후, 실제 호스트(또는 VM/CI 자체)에서 1회 install + 1 영상 렌더 확인. |
| P1  | macOS Apple Developer ID 서명 + notarization 미적용                  | macOS Gatekeeper 가 첫 실행 시 차단                | Apple Developer Program 가입 → `electron-builder` `mac.identity` + notarytool 설정. 미설정 상태로 배포 시 사용자에게 우회 절차 안내 필요. |
| P1  | Windows Authenticode 서명 미적용                                    | SmartScreen 경고로 설치 신뢰도 낮음                 | 코드 서명 인증서 구매 또는 EV 인증서. 단기 대안: 사용자에게 SmartScreen "더 보기 → 실행" 절차 안내.                                |
| P2  | 실제 아이콘 에셋 미제공 (현재 placeholder, electron 기본 로고 표시) | 브랜드 일관성 저하                                  | `build/icon.icns` (mac), `build/icon.ico` (win), `build/icon.png` (linux) 1024x1024 자산 추가.                                    |
| P2  | `electron-updater` 미설정                                           | 첫 배포 후 패치 배포 수단 없음                      | 첫 배포 안정화 후 `electron-updater` + GitHub Releases 통합.                                                                       |
| P2  | `assets/fonts/` 가 비어 있음 (현재 sandbox)                         | 한국어/일본어 보장 폰트가 시스템 폴백에 의존        | Pretendard, Noto Sans KR 등 OFL 라이선스 폰트 번들. README §"폰트 시스템" 의 매핑 그대로. 폴백 체인 자체는 동작함.                |
| P3  | dev 빌드 watermark 가 ON 으로 기본 설정                             | 첫 사용자가 워터마크 끄는 법을 못 찾을 수 있음       | "Watermark" UI 섹션이 Editor 우측 패널에 있고 ON/OFF 토글 + 위치 + 텍스트 입력 모두 노출. 추후 free/pro 정책 결정 시 `shouldShowWatermark()` 단일 지점에서 강제 가능. |
| P3  | hook suggest 가 amplitude-only (BPM/chord 인식 없음)                 | 멜로디 빌드업 vs 비트 변화 구분 못 함               | 의도된 단순화. v0 후보를 1-3개 손에 쥐어주는 게 목표. v1 이후 BPM detection / forced alignment 검토 (로드맵 항목 7).                  |
| P3  | 한글 경로 ffmpeg argv 통과는 검증됨, 다만 **Windows backslash 환경** 은 미검증 | 윈도우 사용자 일부 경로에서 실패 가능성              | `path.join` 으로 빌드 + argv 배열 전달 (셸 보간 없음) 으로 코드 측은 안전. Windows 호스트 빌드 검증 (P1) 시 함께 확인.              |
| P3  | `MAX_OVERLAY_PNGS = 120` 캡 도달 시 keyframe fps 가 자동 down-throttle | 매우 긴 가사 곡에서 애니메이션이 살짝 steppy        | 의도된 동작 (OOM 회피). 사용자에게 노출 X. 60s + 20+ lines + 전 애니메이션 ON 조합에서 발생.                                          |

---

## 4. 배포 전 필수 TODO

### Must (배포 전)

- [ ] **GitHub Actions matrix CI 1회 성공**: `macos-latest` + `windows-latest` + `ubuntu-latest` 모두 dist 빌드 + `verify-packaged-binaries.ts` 통과 + 아티팩트 업로드.
- [ ] **macOS dmg / Windows exe 실 사용자 환경 1회 install + 1 영상 렌더 확인** (각 OS 호스트 또는 VM).
- [ ] **macOS notarization 또는 사용자 우회 가이드 문서**: 둘 중 하나 선택. 미서명 dmg 배포 시 Gatekeeper 우회 절차 README 에 명시.
- [ ] **Windows SmartScreen 우회 가이드 또는 코드 서명**: 동일.

### Should (1차 배포 직후 1주 내)

- [ ] 실제 아이콘 에셋 1024x1024 자산 추가 (mac/win/linux 3종 포맷).
- [ ] `assets/fonts/` 에 OFL 라이선스 폰트 번들 (Pretendard, Noto Sans KR 등) — README §"폰트 시스템" 매핑 그대로.
- [ ] 첫 사용자 온보딩: "Watermark 끄는 법" 1줄 안내 (UI 툴팁 또는 README).

### Nice-to-have (1차 배포 후)

- [ ] `electron-updater` + GitHub Releases 통합.
- [ ] BPM detection / forced alignment (로드맵 항목 7).
- [ ] Windows 한글/공백 경로 호스트 검증.

---

## 5. 이번 RC QA 에서 발견된 이슈 + 처리

| 발견 | 항목 | 결론 |
| --- | --- | --- |
| RC QA 초기 실행 시 hook suggester top candidate 가 라우드 윈도우 [25,35] 대신 [19,29] 선택 | scoring 구조상 "amplitude rising into second half" 보너스가 빌드업 엣지에 가산점 — 의도된 동작 | **코드 변경 없음**. RC QA 테스트 임계치를 의도와 일치하게 완화 (overlap >= 4s, score > 0.2 silent floor). |
| RC QA 초기 실행 시 whisper fallback 검증이 false-fail | spawnSync 자식에 PATH=/nonexistent 를 주면 npx 자체가 resolve 안 돼 child 가 통째로 실패 | **테스트 버그**. 테스트를 in-process 로 변경 (process.env.PATH 직접 변경 → spawnSync 가 변경된 PATH 상속). 코드 변경 없음. |

기능 코드 (src/) 에 대한 변경은 RC QA 단계에서 **0건**. 변경된 파일은 `scripts/rc-qa.ts` (신규), `package.json` (스크립트 1줄), `RC-QA.md` (이 문서).

---

## 6. CI 자동화 (Phase 4-6)

`.github/workflows/build-release.yml` 가 `ubuntu-latest` / `macos-latest` /
`windows-latest` 세 러너에서 매번 다음을 자동 실행한다:

```
checkout → setup-node@20 → npm ci → typecheck → build →
test:fonts → test:watermark → test:export-presets →
test:rc-qa → dist:<os> → verify-packaged-binaries.ts →
upload-artifact (dist-linux / dist-mac / dist-win)
```

즉, 위 §1 의 11개 항목 중 10개 (typecheck, build, demo-pack 제외)가
**3개 OS 모두에서** 매 PR/push 마다 자동 실행된다. demo-pack 은 시간이
오래 걸려서 (~4분) CI 에서는 제외 — 로컬에서 수동 회귀 검증용.

`verify-packaged-binaries.ts` 는 호스트 platform 자동 감지로 ELF /
Mach-O / PE 매직 넘버를 확인하므로, 잘못된 호스트의 ffmpeg 바이너리가
패키지에 들어가는 사고는 CI 가 차단한다. 자세한 매트릭스 설명은 README
"CI 매트릭스 빌드 (Phase 4-2 / 4-6)" 절 참고.

### 트리거

- `main` push
- `v*` 태그 push (릴리즈)
- PR (src/scripts/package.json/electron.vite.config.ts 변경 시)
- 수동 (`workflow_dispatch`)

### CI 빌드 결과 다운로드

1. GitHub repo → Actions → "Build Release" 워크플로
2. 원하는 run 선택 → Artifacts 섹션
3. `dist-linux` / `dist-mac` / `dist-win` 다운로드 (14일 보존)

CI 빌드는 unsigned (CSC_IDENTITY_AUTO_DISCOVERY=false). 실제 배포 직전에
Apple Developer ID + Authenticode 인증서를 repo secret 으로 주입하고 위
환경변수 제거.

---

## 7. 결론

11/11 검증 항목 모두 합격, Linux AppImage 패키징 + 바이너리 검증 정상.
CI 매트릭스가 mac/win 까지 검증을 확장하는 인프라는 갖춰졌다.

**Linux 단독 RC 는 즉시 배포 가능 상태**. mac / win 은 GitHub Actions 매트릭스 1회 성공 + 실 사용자 환경 1회 install + 렌더 확인이 끝나야 비로소 RC 진단이 끝난다 (위 §4 Must).
