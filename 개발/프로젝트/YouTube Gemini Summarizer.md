---
type: project
created: 2026-06-05
tags:
  - development
  - obsidian
  - plugin
  - youtube
  - gemini
---

# YouTube Gemini Summarizer

## 개요

- Obsidian 커뮤니티 플러그인 형태로 만든 로컬 vault 커스터마이징.
- YouTube 링크를 [[제미나이|Gemini API]]로 요약하고 Markdown 노트로 저장한다.
- 플러그인 위치: `.obsidian/plugins/youtube-gemini-summarizer`

## 사용 방법

- Obsidian을 다시 시작하거나 Community plugins 화면에서 플러그인을 새로고침한다.
- 플러그인 설정에서 Gemini API 키를 입력한다.
- 명령 팔레트에서 다음 명령을 사용할 수 있다.
  - 현재 노트의 첫 YouTube 링크 요약
  - 현재 노트의 모든 YouTube 링크 요약
  - 선택한 YouTube 링크 요약
  - YouTube 링크 입력해서 요약

## 코드블록 사용

````
```youtube-gemini
https://www.youtube.com/watch?v=...
```
````

## 출력

- 기본 저장 폴더: `자료/유튜브 요약`
- 생성 노트는 원본 URL, 출처 노트, Gemini 요약을 포함한다.

## 한계

- Gemini의 YouTube URL 입력 기능은 미리보기 기능이다.
- 공개 영상만 안정적으로 동작하며, 비공개/일부 제한 영상은 실패할 수 있다.
- API 키는 로컬 vault의 플러그인 설정 파일에 저장된다.
