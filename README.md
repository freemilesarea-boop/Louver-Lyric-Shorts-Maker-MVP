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
| 5   | Whisper 자동 가사 추출                | ⬜ 다음 단계 |
| 6   | BPM detection / 단어별 하이라이트     | ⬜ 다음 단계 |

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
