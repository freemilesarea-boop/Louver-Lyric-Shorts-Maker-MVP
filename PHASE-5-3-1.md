# Phase 5-3.1 — Windows CI Green Stabilization

이번 단계는 **새 기능 추가 0건**. 목표는 windows-latest CI가 RC QA + smoke
+ dist + verify-packaged-binaries 까지 통과하는지 확인하는 것이었음.

결론: **3 OS 모두 green, 코드 변경 없이 통과**. Phase 5-2의 Windows ESM
수정 (LSM_USER_DATA_DIR 환경 변수 + in-process 테스트) 이 Phase 5-3 의
배경 분리 / styleOverrides / 템플릿 anti-cover 변경에도 그대로 유지됨.

---

## 1. 최신 CI 결과

PR #1, run `25629354639` (commit `323873a` "feat: add layered media uploads
and style overrides", Phase 5-3 Block A):

| OS | 결과 | 시간 |
| --- | --- | --- |
| ubuntu-latest | ✅ success | 1m 39s |
| macos-latest | ✅ success | 1m 40s |
| windows-latest | ✅ success | 3m 43s |

전체 시작: 2026-05-10 12:58:53 UTC. Windows 종료: 13:02:36 UTC.

---

## 2. 통과한 모든 step

3 OS 모두 다음 10단계를 끝까지 실행 완료:

1. Checkout
2. Setup Node 20
3. Install dependencies (`npm ci`)
4. Type-check
5. Build sources
6. Smoke test - fonts registry
7. Smoke test - watermark painter
8. Smoke test - export presets
9. RC QA harness
10. (macOS only) Ad-hoc codesign
11. Build dist installer (linux=AppImage / mac=dmg+zip / win=NSIS exe)
12. Verify packaged ffmpeg/ffprobe binaries (ELF / Mach-O / PE 매직 검증)
13. Upload installer artifact

특히 windows-latest 에서 통과한 항목:

- Custom preset round-trip (Phase 5-2 fix)
- 한글/공백 경로 렌더 (rc-qa item 8)
- Whisper graceful fallback (rc-qa item 7)
- Korean i18n + emoji 인쇄
- ffmpeg 4-preset bitrate 검증 (test:export-presets)
- watermark 5위치 sub-quadrant 검증 (test:watermark)
- 폰트 등록 graceful 처리 (test:fonts)
- electron-builder NSIS 빌드
- ffmpeg.exe / ffprobe.exe PE 매직 검증

---

## 3. 생성된 artifact

[Run #25629354639 Artifacts](https://github.com/freemilesarea-boop/Louver-Lyric-Shorts-Maker-MVP/actions/runs/25629354639):

| Artifact | 크기 | 내용 |
| --- | --- | --- |
| `dist-linux` | 208 MB | `Lyric Shorts Maker-0.1.0.AppImage` |
| `dist-mac` | 187 MB | `Lyric Shorts Maker-0.1.0.dmg` + `.zip` (ad-hoc codesigned) |
| `dist-win` | 181 MB | `Lyric Shorts Maker Setup 0.1.0.exe` (NSIS, unsigned) |

14일 보존. Actions 탭 → 해당 run → 페이지 하단 Artifacts 섹션에서 다운로드.

---

## 4. Windows 안정성 확인 — 점검한 항목

이번 라운드에서 의심하던 영역들. 모두 현재 코드 기준으로 깨끗:

| 영역 | 점검 결과 |
| --- | --- |
| `await import('<absolute path>')` 의 `file:///C:/...` URL 요건 | rc-qa.ts 가 spawn-child + Module._resolveFilename 패턴을 폐기하고 in-process 다이내믹 import 로 전환. customPresets 가 `LSM_USER_DATA_DIR` env 를 우선 읽어 `app.getPath('userData')` 의존을 우회. |
| Backslash path | `path.join` 위주, ffmpeg argv 는 배열 전달 (셸 인터폴레이션 없음). |
| Temp dir | `os.tmpdir()` + `fs.mkdtemp` 사용, OS 가 `%TEMP%` 로 매핑. |
| AppData path | 테스트는 env 우회로 `app.getPath('userData')` 미호출. 실제 패키지 빌드는 Electron 이 `%APPDATA%\<appId>` 로 자동 라우팅. |
| `process.resourcesPath` | `transcribe.ts bundledWhisperPath()` 가 packaged 모드에서만 사용, dev 모드 fallback 은 cwd. Windows 에서 빈 `resources/whisper/bin/win32-x64/` 를 graceful 처리. |
| `import.meta.url` 의 leading slash | `test-fonts.ts` 가 의도적으로 graceful 핸들러로 처리 — registered=0, missing=N 분기로 통과. |
| `pathToFileURL` 사용 | rc-qa.ts 에서 dynamic import 가 in-process 상대 경로로만 동작 — 절대 경로 import 자체 없음. |
| `npx.cmd` | rc-qa.ts 의 `spawnSync('npx', ...)` 는 spawn-child 자체를 폐기했으므로 더 이상 호출 안 됨. |
| `tsx` 실행 | npm scripts 통해서만 실행, Windows 에서 npm-wrapper 가 자동 처리. |
| `fs.rename` Windows 잠금 | `customPresets.ts` atomic write 는 단일 디렉토리 내 rename — Windows EXDEV 위험 없음, 활성 핸들 미충돌. |
| Korean path UTF-8 | rc-qa item 8 "한 글 dir/이미지 파일.png" 가 Windows 에서 통과 (NTFS 는 UTF-16 native). |
| ELF / PE / Mach-O magic | `verify-packaged-binaries.ts` 가 호스트 platform 자동 감지, Windows 에서 `4D 5A` (`MZ`) 매칭 통과 = ffmpeg.exe / ffprobe.exe 진짜 PE 확인. |

---

## 5. 수정 파일

**0건.** Phase 5-3.1 은 검증 + 문서화 only. 코드 / 워크플로 변경 없음.

추가된 파일:
- `PHASE-5-3-1.md` — 본 문서.

---

## 6. 남은 리스크

### 정식 배포 전 (P1)

- 실제 macOS / Windows 호스트에서 install + 1 영상 렌더 검증
  - macOS: ad-hoc codesign 만으로 Gatekeeper 우회 가능한지 (`xattr -cr` 또는 우클릭→열기 우회 확인됨)
  - Windows: SmartScreen "추가 정보 → 실행" 절차 1회 검증
- Apple Developer ID 서명 + notarization
- Windows Authenticode 서명

### 안정화 (P2)

- electron-builder dist 빌드의 가끔 발생하는 flake (electron 릴리즈 CDN rate-limit). 현재는 같은 commit 을 다시 트리거하면 통과. 영구 fix 는 retry-on-network-error 로직.
- whisper.cpp 바이너리 + ggml 모델 fetch 자동화 (`scripts/fetch-whisper.sh`).

### 작은 개선 (P3)

- 실제 아이콘 에셋 1024×1024 (mac/win/linux 3종 포맷)
- `assets/fonts/` 에 OFL 한글 폰트 번들
- `electron-updater` 통합

---

## 7. 다음 단계

Phase 5-3.1 의 성공 기준 모두 충족:

- [x] ubuntu-latest green
- [x] macos-latest green
- [x] windows-latest green
- [x] 3 artifacts 업로드 확인
- [x] verify-packaged-binaries 3 OS 통과
- [x] RC QA harness Windows 통과

권장 다음 단계 — Phase 5-4:

1. 실 사용자 테스터 macOS / Windows artifact 1회 install + 1 영상 렌더 검증
2. (병렬) Phase 5-3 Block B / Block C — 비디오 / GIF 미디어 지원 + 추가 override 컨트롤 + 템플릿 시각 재정리. 사용자 spec 의 항목 3 / 4 / 8.
3. 실 host 검증이 끝나면 정식 v1 배포 자동화 — 서명 / notarization 자동화.
