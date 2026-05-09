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
| 2   | 템플릿 10개 적용                      | 🟡 3 풀튜닝 / 7 스캐폴드 |
| 3   | 영어/한국어 2줄 자막                  | ✅         |
| 4   | progress bar / play icon / waveform   | ✅         |
| 5   | Whisper 자동 가사 추출                | ⬜ 다음 단계 |
| 6   | 단어별 하이라이트 / BPM 반응형        | ⬜ 다음 단계 |

## 개발 메모

- DevTools 자동 오픈 비활성화
- 파일 경로에 공백/한글이 있어도 `-filter_complex_script` 파일을 통해 전달하므로 안전
- 렌더 실패 시 ffmpeg stderr 마지막 2KB 사용자에게 표시
- ffmpeg/ffprobe 바이너리는 `ffmpeg-static` / `ffprobe-static` 으로 OS별 자동 다운로드
- 패키징 시 `asarUnpack` 으로 바이너리 실행 가능
- `npm run typecheck` 로 main / preload / renderer 모두 타입 검사
