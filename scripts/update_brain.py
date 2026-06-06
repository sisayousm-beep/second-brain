import os
import json
import time
import hashlib
from pathlib import Path
from google import genai

ROOT = Path(".")
OUTPUT_DIR = Path("ai-index")
OUTPUT_DIR.mkdir(exist_ok=True)

OUTPUT_PATH = OUTPUT_DIR / "summary.json"

client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])

TARGET_EXTENSIONS = {".md", ".txt"}
EXCLUDE_DIRS = {".git", ".github", "scripts", "ai-index", ".obsidian"}
MAX_FILES_PER_RUN = 5
SLEEP_SECONDS = 15


def should_skip(path: Path) -> bool:
    return any(part in EXCLUDE_DIRS for part in path.parts)


def file_hash(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def clean_json(raw: str) -> str:
    raw = raw.strip()
    raw = raw.removeprefix("```json").removeprefix("```")
    raw = raw.removesuffix("```")
    return raw.strip()


def load_existing() -> list:
    if not OUTPUT_PATH.exists():
        return []

    try:
        return json.loads(OUTPUT_PATH.read_text(encoding="utf-8"))
    except Exception:
        return []


def save_results(results: list) -> None:
    OUTPUT_PATH.write_text(
        json.dumps(results, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def summarize_file(path: Path, text: str, content_hash: str) -> dict:
    prompt = f"""
다음 문서를 세컨드 브레인용으로 정리해줘.

반드시 JSON만 출력해.

형식:
{{
  "file": "{str(path)}",
  "hash": "{content_hash}",
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
            data = json.loads(raw)

            data["file"] = str(path)
            data["hash"] = content_hash
            return data

        except Exception as e:
            print(f"Error processing {path}: {e}")
            time.sleep(30)

    return {
        "file": str(path),
        "hash": content_hash,
        "summary": "처리 실패",
        "keywords": [],
        "tags": [],
        "related_topics": [],
    }


def main():
    results = load_existing()
    result_map = {item.get("file"): item for item in results if item.get("file")}

    candidates = []

    for path in sorted(ROOT.rglob("*")):
        if not path.is_file():
            continue

        if path.suffix.lower() not in TARGET_EXTENSIONS:
            continue

        if should_skip(path):
            continue

        text = path.read_text(encoding="utf-8", errors="ignore")
        content_hash = file_hash(text)

        existing = result_map.get(str(path))

        if existing is None:
            candidates.append((path, text, content_hash))
            continue

        if existing.get("hash") != content_hash:
            candidates.append((path, text, content_hash))
            continue

        if existing.get("summary") == "처리 실패":
            candidates.append((path, text, content_hash))
            continue

    print(f"Pending files: {len(candidates)}")

    processed = 0

    for path, text, content_hash in candidates[:MAX_FILES_PER_RUN]:
        print(f"Processing: {path}")

        result_map[str(path)] = summarize_file(path, text, content_hash)

        processed += 1
        time.sleep(SLEEP_SECONDS)

    final_results = [result_map[key] for key in sorted(result_map.keys())]

    save_results(final_results)

    print(f"Processed this run: {processed}")
    print(f"Saved: {OUTPUT_PATH}")


if __name__ == "__main__":
    main()