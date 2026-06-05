---
type: project
created: 2026-06-05
tags:
  - development
  - obsidian
  - plugin
  - link
  - gemini
---

# General Gemini Link Summarizer

## 개요

- Obsidian 커뮤니티 플러그인 형태로 만든 일반 웹 링크 요약 도구.
- YouTube가 아닌 웹페이지 링크를 가져와 [[제미나이|Gemini API]]로 한국어 요약 노트를 만든다.
- 플러그인 위치: `.obsidian/plugins/general-gemini-link-summarizer`

## 사용 방법

- Obsidian을 다시 시작하거나 Community plugins 화면에서 플러그인을 새로고침한다.
- 플러그인 설정에서 Gemini API 키를 입력한다.
- 명령 팔레트에서 다음 명령을 사용할 수 있다.
  - 현재 노트의 모든 일반 링크 요약
  - 선택 영역의 일반 링크 요약
  - 일반 링크 입력해서 요약

## 입력

- `http://` 또는 `https://`로 시작하는 일반 웹 링크.
- YouTube 링크는 제외하며, [[YouTube Gemini Summarizer]]를 사용한다.

## 출력

- 기본 저장 폴더: `자료/링크 요약`
- 생성 노트는 원본 URL, 사이트명, 페이지 제목, 출처 노트, Gemini 요약을 포함한다.
- 원본 노트에서 실행한 경우 `- 링크 요약: [[요약 노트]] (URL)` 형태로 링크가 추가된다.

## 한계

- 로그인, paywall, 접근 차단, JavaScript 렌더링 전용 페이지는 본문 추출이 실패하거나 부족할 수 있다.
- 첫 버전은 HTML/text 페이지 중심이며 PDF, 이미지, YouTube 전용 요약은 제외한다.
- API 키는 로컬 vault의 플러그인 설정 파일에 저장된다.
