# Louver Lyric Shorts Maker (MVP)

> 사진 1장 + 음원 1개 + 가사 → 9:16 세로 영상 (1080×1920 MP4)

A desktop tool that turns a single image, an audio file, and lyrics into a
vertical short video. MVP focus:

- 이미지 + 오디오 업로드
- 직접 입력 가사 (영어 위 / 한국어 아래 2줄, 한국어 색상 강조 옵션)
- 10개 비주얼 템플릿 (3개 풀 튜닝, 7개 스캐폴드)
- 9:16 H.264 MP4, bundled ffmpeg
- 출력 길이 15s / 30s / 60s 선택

## 빠른 시작

```bash
npm install
npm run dev          # Electron + Vite dev 서버
npm run demo-pack    # 20+ 데모 영상 일괄 생성 (output/demo-pack/)
```

프로덕션:

```bash
npm run build        # main / preload / renderer 빌드
npm run dist         # 현재 OS용 패키징 (electron-builder)
```

## 폴더 구조

```
.
├── electron.vite.config.ts     # main / preload / renderer 빌드 설정
├── package.json
├── scripts/
│   └── demo-render-pack.ts     # 20+ 합성 데모 영상 일괄 생성기
└── src/
    ├── shared/
    │   ├── api.ts              # window.lyric IPC 인터페이스
    │   └── types.ts            # 공유 타입 (Template / RenderRequest 등)
    ├── main/                   # Electron 메인 프로세스
    │   ├── index.ts
    │   ├── ipc/
    │   │   ├── files.ts        # 파일 다이얼로그, ffprobe, dataURL
    │   │   └── render.ts       # 렌더 IPC 핸들러
    │   └── render/
    │       ├── binaries.ts     # ffmpeg/ffprobe 경로 (asar.unpacked 처리)
    │       ├── pipeline.ts     # ffmpeg 실행 + 진행률
    │       └── filters.ts      # filter_complex 그래프 생성 (drawtext-free)
    ├── preload/index.ts        # contextBridge 노출
    └── renderer/               # React + Tailwind UI
        ├── App.tsx
        ├── screens/
        │   ├── StartScreen.tsx
        │   ├── EditorScreen.tsx
        │   └── ExportScreen.tsx
        ├── components/
        │   ├── LivePreview.tsx
        │   ├── LyricsEditor.tsx
        │   ├── AudioRangeSelector.tsx
        │   └── TemplateGallery.tsx
        ├── lib/
        │   ├── api.ts          # window.lyric 래퍼
        │   └── overlays.ts     # 가사 → 1080×1920 transparent PNG (canvas)
        ├── store/projectStore.ts
        └── templates/templates.ts   # 10개 템플릿 정의
```

## 렌더 파이프라인

자막 텍스트는 **렌더러 쪽 `<canvas>` 에서 1080×1920 투명 PNG 로 그린 다음**
그 PNG 들을 ffmpeg `overlay` 필터로 합성합니다. 이 방식의 장점:

- ffmpeg 의 `drawtext` 필터에 의존하지 않음 (`ffmpeg-static` Linux 빌드에는
  drawtext 가 빠져 있습니다)
- 한국어/이모지/임의 폰트 모두 OS 폰트로 깨끗하게 렌더링
- 화면 미리보기와 픽셀 단위로 일치하는 결과

### filter_complex 요약

```
[0:v] split=2 [src1][src2]
[src1] scale → crop → boxblur → eq         [bg]   # 배경 (블러/다크/세피아)
[src2] scale 카드 사이즈                    [fg]   # 전경 카드
[bg][fg] overlay (W-w)/2:(H-h)/2-80         [stage0]
[stage0] drawbox 풀스크린 틴트              [stage1]
[stage1][2:v] overlay enable=between(t,a,b) [ov0]
[ov0]    [3:v] overlay enable=between(t,a,b) [ov1]
...
[ovN] drawbox 트랙 + 진행 바
      drawbox 재생 아이콘 (옵션)
      drawbox × 32 페이크 웨이브폼 (옵션)
[final] format=yuv420p, fps=30 [vout]
```

`-map [vout] -map 1:a -c:v libx264 -crf 20 -pix_fmt yuv420p -movflags +faststart -c:a aac -b:a 192k`.

## 산출물

- 기본 위치: `~/Videos/LyricShorts/lyric_short_YYYYMMDD_HHMMSS.mp4`
- Export 화면에서 폴더 열기 / 재생 가능

## 우선순위 / 로드맵

| Pri | 기능                                  | 상태       |
| --- | ------------------------------------- | ---------- |
| 1   | 이미지+오디오+직접 입력 가사로 출력   | ✅         |
| 2   | 템플릿 10개 시각 완성                 | ✅ (1.5)   |
| 3   | 영어/한국어 2줄 자막                  | ✅         |
| 4   | progress bar / play icon / waveform   | ✅         |
| 4.5 | 언어 자동 감지 (KO/EN/JA/ZH/ES)       | ✅ (1.5)   |
| 4.5 | 줄별 타임싱크 편집 + 오디오 연동      | ✅ (1.5)   |
| 4.5 | 프리뷰/출력 동일 scene renderer       | ✅ (1.5)   |
| 4.6 | 사진 모션 (Ken Burns / pan / float)   | ✅ (2-1)   |
| 4.7 | 가사 등장/퇴장 애니메이션             | ✅ (2-2)   |
| 4.8 | 오디오 amplitude 리액티브             | ✅ (2-3)   |
| 4.9 | 시네마틱 FX (grain/bloom/leak/...)    | ✅ (2-4)   |
| 5   | QA / 안정화 / 샘플 프리셋             | ✅ (2-5)   |
| 5.1 | 데모 렌더 팩 (20+ 합성 시안)          | ✅ (3-1)   |
| 6   | Whisper 자동 가사 추출                | ✅ (3-2)   |
| 6.5 | Batch Render (한 번에 여러 스타일)    | ✅ (3-3)   |
| 6.6 | Custom Preset 저장/불러오기           | ✅ (3-4)   |
| 6.7 | Karaoke 단어 하이라이트 (lite)        | ✅ (3-5)   |
| 6.8 | Safe Zone / 모바일 미리보기           | ✅ (3-6)   |
| 6.9 | Auto Safe Position 추천               | ✅ (3-7)   |
| 7   | BPM detection / forced alignment      | ⬜ 다음 단계 |

### 1.5 변경 요약

- **언어 자동 인식**: `src/shared/lang.ts` 의 휴리스틱 디텍터가
  Hangul / Hiragana / Katakana / CJK / Latin + Spanish 단서 (악센트, 빈출
  단어) 를 점수화. 사용자가 select 로 수동 오버라이드 가능 (자동 감지값과
  분리 저장).
- **공유 scene renderer**: `src/shared/scene.ts` 가 위치/폰트/그림자/프레임/
  치프롬 계산을 모두 담당. `LivePreview` 도 canvas 로 동작해 export 와
  픽셀 단위 일치 (양쪽 다 `renderScene()` 호출).
- **10개 템플릿**: 각 템플릿이 frame style (polaroid / cassette / vinyl /
  circle / neon-border / photo / rounded), shadow style (soft / hard / glow /
  outline), play icon style (triangle / rounded / minimal / none),
  decoration (grain / scanlines / sparkles / reels) 의 고유 조합을 갖는다.
- **줄별 타임라인 편집**: `LyricTimeline` 컴포넌트가 라인마다 start/end 입력,
  현재 재생 위치 캡처(⏱), 이 줄부터 재생(▶), "균등 분배" 버튼 제공.
  duration 변경 시 자동 재분배.
- **포토 모션 (2-1)**: `src/shared/motion.ts` 의 단일 motion 모델이 canvas
  preview 와 ffmpeg `zoompan` 을 동시에 구동. 6개 preset (`none` /
  `slow_zoom_in` / `slow_zoom_out` / `pan_left` / `pan_right` /
  `float_soft`). 템플릿마다 기본값 지정, 사용자가 select 로 오버라이드 가능.
  Frame 데코레이션은 화면 고정, 사진은 그 안에서 움직이는 Ken Burns 방식.
- **가사 애니메이션 (2-2)**: `src/shared/animation.ts` 가 enter/hold/exit
  3-phase 모델을 정의. preview는 RAF 로 연속 샘플, export 는 `planKeyframes()`
  로 키프레임 PNG 시퀀스를 생성하고 ffmpeg `overlay enable=` 로 시점에 맞춰
  보여줌. 7개 preset (`none` / `fade` / `slide_up` / `slide_down` /
  `blur_fade` / `soft_pop` / `karaoke_glow`). 모든 preset 이 같은 scene
  renderer 의 `paintLyric` 을 통과하므로 preview 와 export 결과가 일치.
- **오디오 리액티브 (2-3)**: 메인 프로세스에서 ffmpeg 로 오디오 PCM 을
  추출 → `buildAmplitudeCurve()` (RMS + moving average + 95퍼센타일
  정규화) 로 0..1 normalized 진폭 곡선 생성 (~20 samples/sec). preview
  와 export 모두 같은 곡선을 `reactiveStateAt(mode, curve, t)` 로 샘플링
  → `{intensity, pulse, glow, bloom, waveformBoost}` 가 scene renderer 의
  `paintLyric` (글로우 가산) 과 새 `paintReactiveOverlay` (vignette /
  cinematic bloom / waveform halo) 를 구동. 6개 mode (`none` /
  `soft_pulse` / `lyric_glow` / `waveform_boost` / `cinematic_bloom` /
  `neon_pulse`). 모든 효과가 캔버스 오버레이 PNG 안에서 렌더되므로 export
  filter graph 변경 없이 preview 와 1:1 일치.
- **시네마틱 FX 팩 (2-4)**: `src/shared/cinematicFx.ts` 의 8개 preset
  (`none` / `clean_cinematic` / `subtle_bloom` / `soft_blur` / `dust_grain`
  / `aberration_grain` / `bloom_neon` / `film_texture`) 이 grain / vignette
  / chromatic aberration / bloom / dust / lightLeak / softBlur 인텐시티를
  번들로 정의. 캔버스 2D 만으로 구현 (mulberry32 결정론적 PRNG 기반 grain·
  dust + radial gradient vignette/bloom/leak + 가장자리 RGB stripe
  aberration). Preview 는 RAF 의 `tNowSec*1000` 을 시드로, export 는
  키프레임 `tClip*1000` 을 시드로 사용하므로 같은 시점은 같은 grain 패턴.
  EDM/glitch 회피, premium emotional 톤 유지. paintCinematicFx 는 scene
  renderer 의 마지막 레이어로 호출되어 모션·애니메이션·리액티브 모두 위에
  얹힘.
- **QA · 안정화 · 샘플 프리셋 (2-5)**: 기능 추가 동결, 실사용 검증 라운드.
  - 5개 샘플 프리셋 (`K-Ballad Emotional` / `English R&B Night` /
    `Neon Drive Pop` / `Polaroid Love Song` / `VHS Indie Mood`) — 한 번에
    template + motion + animation + reactive + FX + 권장 언어를 적용하는
    원클릭 프리셋. Editor 상단에 SamplePresetPicker 로 노출.
  - Editor 의 5개 스타일 셀렉터를 단일 "Style Controls" 섹션으로 묶어
    학습 곡선 완화.
  - `prettyErrorMessage()` (`src/shared/errors.ts`) 가 ffmpeg 원시 에러
    (Permission denied / ENOSPC / Invalid data / SIGTERM 등)를 한국어
    사용자 메시지로 매핑. main IPC 와 renderer 양쪽에서 모두 사용.
  - `RenderTimings` 가 IPC 결과에 포함되어 ExportScreen 이 total / ffmpeg
    / overlay bake / keyframe count / file size 표시.
  - `MAX_OVERLAY_PNGS = 120` 안전 상한선 — 가사 줄이 25개 이상으로 많아
    프로젝트된 키프레임이 ffmpeg 입력 한계를 넘을 때, 자동으로 애니메이션
    keyframe fps 를 비례 축소. (정상 케이스에서는 영향 없음.)
  - 종합 스모크 매트릭스 통과: 5 sample presets × 30s, 15s/30s 길이,
    1:1·4:5·16:9·9:16 이미지, 1줄/25줄 극단 가사, 한글 파일명+공백 경로,
    7가지 에러 매핑.
- **데모 렌더 팩 (3-1)**: `npm run demo-pack` 으로 20개 합성 데모 영상을
  `output/demo-pack/` 에 일괄 생성. 헤드리스 캔버스(`@napi-rs/canvas`) +
  실제 shared 모듈 + 번들 ffmpeg 으로 동작. 5 샘플 프리셋 + 10개 템플릿
  전체 + motion / animation / reactive / FX 다양 조합 × 7개 무드 (K-pop ·
  드라이브 · 인디 · R&B · 발라드 · 네온 · 폴라로이드). 합성 photo /
  audio / 가사 사용 — 외부 파일 의존성 없음.
- **Whisper 자동 가사 추출 (3-2)**: Editor 가사 섹션에 "✨ AI 가사 추출"
  버튼 추가. 클릭 시 메인 프로세스가 (1) 시스템 PATH 에서 `whisper`
  (OpenAI Python whisper) 또는 `whisper-cpp` / `whisper-cli` 바이너리를
  탐지 → (2) 선택된 오디오 구간을 ffmpeg 로 16kHz mono WAV 로 잘라내고
  → (3) whisper 를 실행해 segment 단위 timing JSON 을 받아 → (4) 줄
  단위 LyricLine 으로 변환해 가사 textarea + 타임라인에 자동 반영. 감지
  된 언어 코드는 manualLanguage 로 setting 되어 폰트 스택까지 전환됨.
  whisper 미설치 시 → 친절한 한국어 안내 (`pip install openai-whisper`
  또는 `brew install whisper-cpp`) + 버튼 비활성화. 추출 중 SIGTERM
  취소 가능. **수동 입력은 영향 없음** — 버튼은 LyricsEditor 위에
  추가되었을 뿐이고, textarea / 타임라인 / 렌더 경로는 그대로 유지.
- **Batch Render (3-3)**: Editor 의 "배치 출력" 섹션에 두 버튼 추가 —
  "Sample Preset 5개로 생성" / "전체 템플릿 10개로 생성". 한 번 누르면
  큐를 만들어 ExportScreen 의 batch 뷰로 이동, 각 항목을 순차 렌더 (동시
  실행 없음). 한 항목이 실패해도 다음 항목 계속 진행 — 실패 사유는 행
  옆에 한국어로 표시. 출력 파일명은 `lyric_short_<tag>_<stamp>.mp4` 로
  태그가 들어가서 같은 폴더 안에서 변형들을 구분 가능. 배치 취소는
  진행 중 항목을 SIGTERM 으로 끊고 남은 항목은 자동으로 "건너뜀" 처리.
  완료 후 생성/실패/건너뜀 카운트 + 총 소요 시간 + "폴더 열기" 버튼.
  단일 렌더 UX 는 그대로 유지 — 단일 vs 배치는 `batchItems.length` 로
  ExportScreen 이 자동 분기.
- **안정성**:
  - 입력 파일 검증 (존재/사이즈/타입) + 친절한 에러 메시지
  - 출력 폴더 쓰기 권한 사전 체크
  - 가사/타임라인 overflow 경고 다이얼로그
  - 렌더 취소 (`cancelActiveRender`, SIGTERM)
  - ffmpeg 경로/한글/공백 안전 (argv 배열 + `-filter_complex_script`)

## 개발 메모

- DevTools 자동 오픈 비활성화
- 파일 경로에 공백/한글이 있어도 `-filter_complex_script` 파일을 통해 전달하므로 안전
- 렌더 실패 시 ffmpeg stderr 마지막 2KB 사용자에게 표시
- ffmpeg/ffprobe 바이너리는 `ffmpeg-static` / `ffprobe-static` 으로 OS별 자동 다운로드
- 패키징 시 `asarUnpack` 으로 바이너리 실행 가능
- `npm run typecheck` 로 main / preload / renderer 모두 타입 검사
