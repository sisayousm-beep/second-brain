const {
  Modal,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  TextAreaComponent,
  TFile,
  normalizePath,
  requestUrl,
} = require("obsidian");

const DEFAULT_SETTINGS = {
  apiKey: "",
  model: "gemini-2.5-flash",
  outputFolder: "자료/유튜브 요약",
  summaryLanguage: "ko",
  appendLinkToSource: true,
  promptVersion: 2,
  prompt: [
    "이 YouTube 영상을 한국어 Obsidian 노트로 정리해줘.",
    "",
    "목표:",
    "- 나중에 빠르게 다시 읽을 수 있게 글자 밀도를 낮춰줘.",
    "- 긴 문단보다 짧은 문장, 목록, 표를 우선해줘.",
    "- 영어 자료는 자연스러운 한국어로 번역해줘.",
    "",
    "출력 규칙:",
    "- 첫 줄은 반드시 `문서 제목: 영상 내용을 한 문장으로 정리한 짧은 주제` 형식으로 써줘.",
    "- 그 다음 줄부터는 아래 Markdown 구조만 사용해줘.",
    "- 한 문단은 최대 3문장으로 제한해줘.",
    "- 목록 항목은 한 항목당 1-2줄로 제한해줘.",
    "- 중요한 장면이나 주제는 가능한 경우 `[00:00]` 형식의 타임스탬프를 붙여줘.",
    "",
    "## 한눈에 보기",
    "> [!summary] 핵심 요약",
    "> 3줄 이하로 영상의 결론과 쓸모를 정리해줘.",
    "",
    "## 핵심 포인트",
    "- 중요한 내용 5-8개",
    "",
    "## 다시 볼 포인트",
    "- 나중에 확인할 부분 3-5개",
    "",
    "## 언급된 것",
    "| 유형 | 이름 | 메모 |",
    "|---|---|---|",
    "| 도구/인물/회사/개념 | 이름 | 왜 언급됐는지 짧게 |",
    "",
    "## 태그",
    "#태그 3-7개",
  ].join("\n"),
};

const YOUTUBE_URL_PATTERN = /https?:\/\/(?:www\.)?(?:youtube\.com\/(?:watch\?[^)\]\s>]*v=|shorts\/|live\/)|youtu\.be\/)[^\s<>)\]]+/gi;

module.exports = class YouTubeGeminiSummarizerPlugin extends Plugin {
  async onload() {
    const savedSettings = await this.loadData();
    this.settings = Object.assign({}, DEFAULT_SETTINGS, savedSettings);
    if (!savedSettings?.promptVersion || savedSettings.promptVersion < DEFAULT_SETTINGS.promptVersion) {
      this.settings.prompt = DEFAULT_SETTINGS.prompt;
      this.settings.promptVersion = DEFAULT_SETTINGS.promptVersion;
      await this.saveSettings();
    }

    this.addSettingTab(new YouTubeGeminiSettingTab(this.app, this));

    this.addCommand({
      id: "summarize-youtube-link-in-note",
      name: "현재 노트의 첫 YouTube 링크 요약",
      callback: () => this.summarizeFirstLinkInActiveFile(),
    });

    this.addCommand({
      id: "summarize-selected-youtube-link",
      name: "선택한 YouTube 링크 요약",
      editorCallback: (editor) => {
        const selectedText = editor.getSelection();
        const url = this.extractFirstYouTubeUrl(selectedText);
        if (!url) {
          new Notice("선택 영역에서 YouTube 링크를 찾지 못했습니다.");
          return;
        }
        this.summarizeUrl(url);
      },
    });

    this.addCommand({
      id: "summarize-all-youtube-links-in-note",
      name: "현재 노트의 모든 YouTube 링크 요약",
      callback: () => this.summarizeAllLinksInActiveFile(),
    });

    this.addCommand({
      id: "summarize-unsummarized-youtube-links-in-note",
      name: "현재 노트의 미요약 YouTube 링크만 요약",
      callback: () => this.summarizeUnsummarizedLinksInActiveFile(),
    });

    this.addCommand({
      id: "summarize-youtube-link-from-input",
      name: "YouTube 링크 입력해서 요약",
      callback: () => {
        new YouTubeUrlModal(this.app, async (url) => {
          await this.summarizeUrl(url);
        }).open();
      },
    });

    this.registerMarkdownCodeBlockProcessor("youtube-gemini", (source, el) => {
      const url = this.extractFirstYouTubeUrl(source);
      const container = el.createDiv({ cls: "youtube-gemini-block" });
      container.createEl("div", {
        cls: "youtube-gemini-url",
        text: url || "YouTube 링크를 찾지 못했습니다.",
      });
      const button = container.createEl("button", { text: "Gemini로 요약" });
      button.disabled = !url;
      button.addEventListener("click", () => this.summarizeUrl(url));
    });
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  extractFirstYouTubeUrl(text) {
    const urls = this.extractYouTubeUrls(text);
    return urls[0] || null;
  }

  extractYouTubeUrls(text) {
    const matches = text.match(YOUTUBE_URL_PATTERN) || [];
    const cleaned = matches.map((url) => url.replace(/[.,;:!?]+$/g, ""));
    return Array.from(new Set(cleaned));
  }

  async summarizeFirstLinkInActiveFile() {
    const file = this.app.workspace.getActiveFile();
    if (!file) {
      new Notice("활성 노트가 없습니다.");
      return;
    }

    const content = await this.app.vault.read(file);
    const url = this.extractFirstYouTubeUrl(content);
    if (!url) {
      new Notice("현재 노트에서 YouTube 링크를 찾지 못했습니다.");
      return;
    }
    await this.summarizeUrl(url, file);
  }

  async summarizeAllLinksInActiveFile() {
    const file = this.app.workspace.getActiveFile();
    if (!file) {
      new Notice("활성 노트가 없습니다.");
      return;
    }

    const content = await this.app.vault.read(file);
    const urls = this.extractYouTubeUrls(content);
    if (urls.length === 0) {
      new Notice("현재 노트에서 YouTube 링크를 찾지 못했습니다.");
      return;
    }

    for (const url of urls) {
      await this.summarizeUrl(url, file);
    }
  }

  async summarizeUnsummarizedLinksInActiveFile() {
    const file = this.app.workspace.getActiveFile();
    if (!file) {
      new Notice("활성 노트가 없습니다.");
      return;
    }

    const content = await this.app.vault.read(file);
    const urls = this.extractYouTubeUrls(content);
    if (urls.length === 0) {
      new Notice("현재 노트에서 YouTube 링크를 찾지 못했습니다.");
      return;
    }

    const summarizedVideoIds = this.extractSummarizedVideoIds(content);
    const pendingUrls = urls.filter((url) => {
      const videoId = this.extractVideoId(url);
      return !videoId || !summarizedVideoIds.has(videoId);
    });
    const skippedCount = urls.length - pendingUrls.length;

    if (pendingUrls.length === 0) {
      new Notice(`이미 요약한 YouTube 링크 ${skippedCount}개를 건너뛰었습니다. 새로 요약할 링크가 없습니다.`);
      return;
    }

    new Notice(`미요약 YouTube 링크 ${pendingUrls.length}개를 요약합니다. 이미 요약한 링크 ${skippedCount}개는 건너뜁니다.`);
    for (const url of pendingUrls) {
      await this.summarizeUrl(url, file);
    }
  }

  extractSummarizedVideoIds(content) {
    const summarizedVideoIds = new Set();
    const summaryLines = content
      .split(/\r?\n/)
      .filter((line) => line.includes("YouTube") && line.includes("[[") && line.includes("]]"));

    for (const line of summaryLines) {
      const urls = this.extractYouTubeUrls(line);
      for (const url of urls) {
        const videoId = this.extractVideoId(url);
        if (videoId) {
          summarizedVideoIds.add(videoId);
        }
      }
    }

    return summarizedVideoIds;
  }

  async summarizeUrl(url, sourceFile = null) {
    if (!this.settings.apiKey.trim()) {
      new Notice("Gemini API 키가 없습니다. 플러그인 설정에서 API 키를 입력하세요.");
      return;
    }

    if (!this.extractFirstYouTubeUrl(url)) {
      new Notice("올바른 YouTube 링크가 아닙니다.");
      return;
    }

    new Notice("Gemini로 YouTube 영상을 요약하는 중입니다...");
    try {
      const summary = await this.callGemini(url);
      const outputFile = await this.createSummaryNote(url, summary, sourceFile);
      new Notice(`요약 노트를 만들었습니다: ${outputFile.path}`);

      if (sourceFile && this.settings.appendLinkToSource) {
        await this.appendSummaryLink(sourceFile, outputFile, url);
      }

      await this.app.workspace.getLeaf(false).openFile(outputFile);
    } catch (error) {
      console.error(error);
      new Notice(`YouTube 요약 실패: ${error.message || error}`);
    }
  }

  async callGemini(url) {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.settings.model)}:generateContent`;
    const body = {
      contents: [
        {
          parts: [
            { text: this.settings.prompt },
            {
              file_data: {
                file_uri: url,
              },
            },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.2,
      },
    };

    const response = await requestUrl({
      url: endpoint,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": this.settings.apiKey.trim(),
      },
      body: JSON.stringify(body),
    });

    if (response.status < 200 || response.status >= 300) {
      throw new Error(`Gemini API 오류 ${response.status}: ${response.text}`);
    }

    const data = response.json;
    const text = data?.candidates?.[0]?.content?.parts
      ?.map((part) => part.text || "")
      .join("\n")
      .trim();

    if (!text) {
      throw new Error("Gemini 응답에서 요약 텍스트를 찾지 못했습니다.");
    }
    return text;
  }

  async createSummaryNote(url, summary, sourceFile) {
    const folder = normalizePath(this.settings.outputFolder || DEFAULT_SETTINGS.outputFolder);
    await this.ensureFolder(folder);

    const now = new Date();
    const dateText = this.formatDate(now);
    const summaryTitle = this.extractSummaryTitle(summary);
    const fallbackTitle = `YouTube 요약 ${this.extractVideoId(url) || "video"}`;
    const noteTitle = summaryTitle || fallbackTitle;
    const readableSummary = this.removeSummaryTitleLine(summary);
    const title = await this.makeUniqueFilePath(folder, `${dateText} ${this.safeFilePart(noteTitle)}.md`);
    const sourceLine = sourceFile ? `source_note: "[[${sourceFile.basename}]]"` : "source_note: null";
    const sourceInfo = [
      `> - 원본: ${url}`,
      sourceFile ? `> - 출처 노트: [[${sourceFile.basename}]]` : "",
      "> - 생성 도구: [[제미나이]]",
    ];
    const content = [
      "---",
      "type: youtube-summary",
      `created: ${dateText}`,
      `source_url: "${url.replace(/"/g, '\\"')}"`,
      `summary_title: "${this.escapeYaml(noteTitle)}"`,
      sourceLine,
      "cssclasses:",
      "  - youtube-readable-summary",
      "tags:",
      "  - youtube",
      "  - gemini",
      "  - summary",
      "---",
      "",
      `# ${noteTitle}`,
      "",
      "> [!info] 원본 정보",
      ...sourceInfo,
      "",
      readableSummary,
      "",
    ].filter((line) => line !== "").join("\n");

    return await this.app.vault.create(title, content);
  }

  extractSummaryTitle(summary) {
    const firstLine = String(summary || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean);
    if (!firstLine) return "";

    const normalizedLine = firstLine
      .replace(/^#{1,6}\s*/, "")
      .replace(/^`+|`+$/g, "")
      .replace(/\*\*/g, "")
      .trim();
    const match = normalizedLine.match(/^(?:문서\s*제목|제목)\s*[:：]\s*(.+)$/i);
    if (!match) return "";

    return match[1]
      .replace(/^["'“”‘’]+|["'“”‘’]+$/g, "")
      .trim();
  }

  removeSummaryTitleLine(summary) {
    const lines = String(summary || "").split(/\r?\n/);
    const firstContentIndex = lines.findIndex((line) => line.trim());
    if (firstContentIndex === -1) return "";

    const normalizedLine = lines[firstContentIndex]
      .trim()
      .replace(/^#{1,6}\s*/, "")
      .replace(/^`+|`+$/g, "")
      .replace(/\*\*/g, "")
      .trim();

    if (/^(?:문서\s*제목|제목)\s*[:：]\s*/i.test(normalizedLine)) {
      lines.splice(firstContentIndex, 1);
    }

    return lines.join("\n").trim();
  }

  safeFilePart(value) {
    const cleaned = String(value || "video")
      .replace(/[\\/:*?"<>|#^[\]]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return (cleaned || "video").slice(0, 80);
  }

  escapeYaml(value) {
    return String(value || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  }

  async appendSummaryLink(sourceFile, outputFile, url) {
    const link = this.app.fileManager.generateMarkdownLink(outputFile, sourceFile.path);
    const content = await this.app.vault.read(sourceFile);
    const marker = `\n\n- YouTube 요약: ${link} (${url})\n`;
    if (content.includes(link)) return;
    await this.app.vault.modify(sourceFile, content + marker);
  }

  async ensureFolder(folder) {
    const parts = folder.split("/").filter(Boolean);
    let current = "";
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      if (!this.app.vault.getAbstractFileByPath(current)) {
        await this.app.vault.createFolder(current);
      }
    }
  }

  async makeUniqueFilePath(folder, fileName) {
    const baseName = fileName.replace(/\.md$/i, "");
    let candidate = normalizePath(`${folder}/${fileName}`);
    let counter = 2;
    while (this.app.vault.getAbstractFileByPath(candidate)) {
      candidate = normalizePath(`${folder}/${baseName} ${counter}.md`);
      counter += 1;
    }
    return candidate;
  }

  extractVideoId(url) {
    try {
      const parsed = new URL(url);
      if (parsed.hostname.includes("youtu.be")) {
        return parsed.pathname.split("/").filter(Boolean)[0] || "";
      }
      if (parsed.searchParams.get("v")) {
        return parsed.searchParams.get("v");
      }
      const parts = parsed.pathname.split("/").filter(Boolean);
      return parts[1] || parts[0] || "";
    } catch {
      return "";
    }
  }

  formatDate(date) {
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    return formatter.format(date);
  }
};

class YouTubeUrlModal extends Modal {
  constructor(app, onSubmit) {
    super(app);
    this.onSubmit = onSubmit;
    this.url = "";
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "YouTube 링크 요약" });

    new Setting(contentEl)
      .setName("YouTube 링크")
      .addText((text) => {
        text.setPlaceholder("https://www.youtube.com/watch?v=...")
          .onChange((value) => {
            this.url = value.trim();
          });
        text.inputEl.focus();
      });

    new Setting(contentEl)
      .addButton((button) => {
        button
          .setButtonText("요약")
          .setCta()
          .onClick(async () => {
            this.close();
            await this.onSubmit(this.url);
          });
      })
      .addButton((button) => {
        button
          .setButtonText("취소")
          .onClick(() => this.close());
      });
  }

  onClose() {
    this.contentEl.empty();
  }
}

class YouTubeGeminiSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "YouTube Gemini Summarizer" });

    new Setting(containerEl)
      .setName("Gemini API 키")
      .setDesc("Google AI Studio에서 발급한 API 키. 이 vault의 플러그인 data.json에 저장됩니다.")
      .addText((text) => {
        text.inputEl.type = "password";
        text.setPlaceholder("AIza...")
          .setValue(this.plugin.settings.apiKey)
          .onChange(async (value) => {
            this.plugin.settings.apiKey = value.trim();
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("모델")
      .setDesc("YouTube URL 입력은 Gemini 2.5 계열에서 지원됩니다.")
      .addText((text) => {
        text.setPlaceholder("gemini-2.5-flash")
          .setValue(this.plugin.settings.model)
          .onChange(async (value) => {
            this.plugin.settings.model = value.trim() || DEFAULT_SETTINGS.model;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("요약 저장 폴더")
      .addText((text) => {
        text.setPlaceholder("자료/유튜브 요약")
          .setValue(this.plugin.settings.outputFolder)
          .onChange(async (value) => {
            this.plugin.settings.outputFolder = value.trim() || DEFAULT_SETTINGS.outputFolder;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("원본 노트에 요약 링크 추가")
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.settings.appendLinkToSource)
          .onChange(async (value) => {
            this.plugin.settings.appendLinkToSource = value;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("요약 프롬프트")
      .setDesc("Gemini에 전달할 기본 지시문입니다.")
      .addTextArea((textArea) => {
        textArea
          .setValue(this.plugin.settings.prompt)
          .onChange(async (value) => {
            this.plugin.settings.prompt = value.trim() || DEFAULT_SETTINGS.prompt;
            await this.plugin.saveSettings();
          });
        textArea.inputEl.rows = 12;
        textArea.inputEl.cols = 70;
      });
  }
}
