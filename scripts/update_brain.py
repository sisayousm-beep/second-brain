import os
import json
import time
from pathlib import Path
from google import genai

ROOT = Path(".")
OUTPUT_DIR = Path("ai-index")
OUTPUT_DIR.mkdir(exist_ok=True)

client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])

TARGET_EXTENSIONS = {".md", ".txt"}
EXCLUDE_DIRS = {".git", ".github", "scripts", "ai-index", ".obsidian"}

def should_skip(path: Path) -> bool:
    return any(part in EXCLUDE_DIRS for part in path.parts)

def clean_json(raw: str) -> str:
    raw = raw.strip()
    raw = raw.removeprefix("```json").removeprefix("```")
    raw = raw.removesuffix("```")
    return raw.strip()

def summarize_file(path: Path) -> dict:
    text = path.read_text(encoding="utf-8", errors="ignore")

    prompt = f"""
다음 문서를 세컨드 브레인용으로 정리해줘.

반드시 JSON만 출력해.

형식:
{{
  "file": "{str(path)}",
  "summary": "문서 요약",
  "keywords": ["키워드1", "키워드2"],
  "tags": ["태그1", "태그2"],
  "related_topics": ["관련 주제1", "관련 주제2"]
}}

문서 내용:
{text[:12000]}
"""

    for attempt in range(3):
        try:
            response = client.models.generate_content(
                model="gemini-2.5-flash",
                contents=prompt,
            )

            raw = clean_json(response.text)

            try:
                return json.loads(raw)
            except json.JSONDecodeError:
                return {
                    "file": str(path),
                    "summary": raw,
                    "keywords": [],
                    "tags": [],
                    "related_topics": [],
                }

        except Exception as e:
            print(f"Error processing {path}: {e}")
            time.sleep(15)

    return {
        "file": str(path),
        "summary": "처리 실패",
        "keywords": [],
        "tags": [],
        "related_topics": [],
    }

def main():
    results = []

    for path in ROOT.rglob("*"):
        if path.is_file() and path.suffix.lower() in TARGET_EXTENSIONS and not should_skip(path):
            print(f"Processing: {path}")
            results.append(summarize_file(path))
            time.sleep(12)

    output_path = OUTPUT_DIR / "summary.json"
    output_path.write_text(
        json.dumps(results, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    print(f"Saved: {output_path}")

if __name__ == "__main__":
    main()