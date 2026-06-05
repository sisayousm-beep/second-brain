const {
  Modal,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  normalizePath,
  requestUrl,
} = require("obsidian");

const DEFAULT_SETTINGS = {
  apiKey: "",
  model: "gemini-2.5-flash",
  outputFolder: "자료/링크 요약",
  appendLinkToSource: true,
  prompt: [
    "아래 웹페이지 내용을 한국어로 정리해줘.",
    "",
    "형식:",
    "1. 이 링크가 어떤 사이트/문서인지",
    "2. 한 문단 핵심 요약",
    "3. 중요한 내용 5-10개",
    "4. 나중에 다시 볼 만한 포인트",
    "5. Obsidian에 남길 태그 3-7개",
    "",
    "광고, 메뉴, 댓글, 푸터처럼 본문과 관련 없는 내용은 무시해줘.",
    "영어로 된 자료는 한국어로 번역해줘.",
  ].join("\n"),
};

const URL_PATTERN = /https?:\/\/[^\s<>)\]]+/gi;
const MAX_EXTRACTED_TEXT_LENGTH = 40000;

module.exports = class GeneralGeminiLinkSummarizerPlugin extends Plugin {
  async onload() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());

    this.addSettingTab(new GeneralGeminiSettingTab(this.app, this));

    this.addCommand({
      id: "summarize-all-general-links-in-note",
      name: "현재 노트의 모든 일반 링크 요약",
      callback: () => this.summarizeAllLinksInActiveFile(),
    });

    this.addCommand({
      id: "summarize-selected-general-links",
      name: "선택 영역의 일반 링크 요약",
      editorCallback: (editor) => {
        const selectedText = editor.getSelection();
        const file = this.app.workspace.getActiveFile();
        this.summarizeLinksFromText(selectedText, file, "선택 영역에서 일반 링크를 찾지 못했습니다.");
      },
    });

    this.addCommand({
      id: "summarize-general-link-from-input",
      name: "일반 링크 입력해서 요약",
      callback: () => {
        new GeneralUrlModal(this.app, async (url) => {
          await this.summarizeUrl(url);
        }).open();
      },
    });
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  extractFirstGeneralUrl(text) {
    const urls = this.extractGeneralUrls(text);
    return urls[0] || null;
  }

  extractGeneralUrls(text) {
    const matches = String(text || "").match(URL_PATTERN) || [];
    const cleaned = matches.map((url) => url.replace(/[.,;:!?'"]+$/g, ""));
    return Array.from(new Set(cleaned)).filter((url) => this.isGeneralUrl(url));
  }

  isGeneralUrl(url) {
    try {
      const parsed = new URL(url);
      if (!["http:", "https:"].includes(parsed.protocol)) return false;
      const hostname = parsed.hostname.toLowerCase();
      return !(
        hostname === "youtu.be" ||
        hostname.endsWith(".youtu.be") ||
        hostname === "youtube.com" ||
        hostname.endsWith(".youtube.com") ||
        hostname === "youtube-nocookie.com" ||
        hostname.endsWith(".youtube-nocookie.com")
      );
    } catch {
      return false;
    }
  }

  async summarizeAllLinksInActiveFile() {
    const file = this.app.workspace.getActiveFile();
    if (!file) {
      new Notice("활성 노트가 없습니다.");
      return;
    }

    const content = await this.app.vault.read(file);
    await this.summarizeLinksFromText(content, file, "현재 노트에서 일반 링크를 찾지 못했습니다.");
  }

  async summarizeLinksFromText(text, sourceFile, emptyMessage) {
    const urls = this.extractGeneralUrls(text);
    if (urls.length === 0) {
      new Notice(emptyMessage);
      return;
    }

    new Notice(`일반 링크 ${urls.length}개를 요약합니다.`);
    for (const url of urls) {
      await this.summarizeUrl(url, sourceFile);
    }
  }

  async summarizeUrl(input, sourceFile = null) {
    if (!this.settings.apiKey.trim()) {
      new Notice("Gemini API 키가 없습니다. 플러그인 설정에서 API 키를 입력하세요.");
      return;
    }

    const url = this.extractFirstGeneralUrl(input);
    if (!url) {
      new Notice("요약할 수 있는 일반 웹 링크가 아닙니다. YouTube 링크는 YouTube 요약 플러그인을 사용하세요.");
      return;
    }

    new Notice("웹페이지 내용을 가져오는 중입니다...");
    try {
      const page = await this.fetchPage(url);
      new Notice("Gemini로 웹페이지를 요약하는 중입니다...");
      const summary = await this.callGemini(page);
      const outputFile = await this.createSummaryNote(page, summary, sourceFile);
      new Notice(`요약 노트를 만들었습니다: ${outputFile.path}`);

      if (sourceFile && this.settings.appendLinkToSource) {
        await this.appendSummaryLink(sourceFile, outputFile, page.url);
      }

      await this.app.workspace.getLeaf(false).openFile(outputFile);
    } catch (error) {
      console.error(error);
      new Notice(`링크 요약 실패: ${error.message || error}`);
    }
  }

  async fetchPage(url) {
    const response = await requestUrl({
      url,
      method: "GET",
      headers: {
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.5",
        "User-Agent": "Mozilla/5.0 Obsidian General Gemini Link Summarizer",
      },
    });

    if (response.status < 200 || response.status >= 300) {
      throw new Error(`페이지 요청 오류 ${response.status}`);
    }

    const contentType = this.getHeader(response.headers, "content-type").toLowerCase();
    const isTextPage = !contentType ||
      contentType.includes("text/html") ||
      contentType.includes("text/plain") ||
      contentType.includes("application/xhtml+xml") ||
      contentType.includes("application/xml") ||
      contentType.includes("text/xml");

    if (!isTextPage) {
      throw new Error(`HTML/text 페이지가 아닙니다: ${contentType}`);
    }

    const html = response.text || "";
    if (!html.trim()) {
      throw new Error("페이지 본문이 비어 있습니다.");
    }

    const parsed = contentType.includes("text/plain")
      ? this.parsePlainTextPage(url, html, contentType)
      : this.parseHtmlPage(url, html, contentType);
    if (!parsed.text) {
      throw new Error("요약할 본문 텍스트를 추출하지 못했습니다.");
    }
    const truncated = parsed.text.length > MAX_EXTRACTED_TEXT_LENGTH;

    return Object.assign({}, parsed, {
      text: truncated ? parsed.text.slice(0, MAX_EXTRACTED_TEXT_LENGTH) : parsed.text,
      truncated,
      originalTextLength: parsed.text.length,
    });
  }

  parsePlainTextPage(url, text, contentType) {
    const host = this.extractHostname(url);
    return {
      url,
      contentType,
      hostname: host,
      siteName: host,
      title: host,
      description: "",
      text: this.normalizeWhitespace(text),
    };
  }

  parseHtmlPage(url, html, contentType) {
    if (typeof DOMParser === "undefined") {
      return this.parseHtmlPageFallback(url, html, contentType);
    }

    const document = new DOMParser().parseFromString(html, "text/html");
    const host = this.extractHostname(url);
    const title = this.getMetaContent(document, [
      'meta[property="og:title"]',
      'meta[name="twitter:title"]',
    ]) || document.querySelector("title")?.textContent || document.querySelector("h1")?.textContent || host;
    const description = this.getMetaContent(document, [
      'meta[name="description"]',
      'meta[property="og:description"]',
      'meta[name="twitter:description"]',
    ]);
    const siteName = this.getMetaContent(document, [
      'meta[property="og:site_name"]',
      'meta[name="application-name"]',
    ]) || host;

    document.querySelectorAll("script, style, noscript, svg, canvas, iframe, nav, footer, aside, form, button, input, select").forEach((element) => {
      element.remove();
    });

    const contentRoot = document.querySelector("article") ||
      document.querySelector("main") ||
      document.querySelector('[role="main"]') ||
      document.body;
    const text = this.normalizeWhitespace(contentRoot?.textContent || "");

    return {
      url,
      contentType,
      hostname: host,
      siteName: this.normalizeWhitespace(siteName),
      title: this.normalizeWhitespace(title),
      description: this.normalizeWhitespace(description),
      text,
    };
  }

  parseHtmlPageFallback(url, html, contentType) {
    const host = this.extractHostname(url);
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const title = titleMatch ? this.decodeBasicHtmlEntities(titleMatch[1]) : host;
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ");

    return {
      url,
      contentType,
      hostname: host,
      siteName: host,
      title: this.normalizeWhitespace(title),
      description: "",
      text: this.normalizeWhitespace(this.decodeBasicHtmlEntities(text)),
    };
  }

  async callGemini(page) {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.settings.model)}:generateContent`;
    const prompt = [
      this.settings.prompt,
      "",
      "웹페이지 정보:",
      `- URL: ${page.url}`,
      `- 사이트: ${page.siteName || page.hostname}`,
      `- 제목: ${page.title || "제목 없음"}`,
      page.description ? `- 설명: ${page.description}` : "",
      `- 본문 추출 길이: ${page.originalTextLength}자`,
      page.truncated ? `- 참고: 본문이 길어서 처음 ${MAX_EXTRACTED_TEXT_LENGTH}자만 사용함` : "",
      "",
      "본문:",
      page.text,
    ].filter((line) => line !== "").join("\n");
    const body = {
      contents: [
        {
          parts: [
            { text: prompt },
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

  async createSummaryNote(page, summary, sourceFile) {
    const folder = normalizePath(this.settings.outputFolder || DEFAULT_SETTINGS.outputFolder);
    await this.ensureFolder(folder);

    const dateText = this.formatDate(new Date());
    const fileName = `${dateText} 링크 요약 ${this.safeFilePart(page.hostname)} ${this.safeFilePart(page.title || "page")}.md`;
    const title = await this.makeUniqueFilePath(folder, fileName);
    const sourceLine = sourceFile ? `source_note: "[[${this.escapeYaml(sourceFile.basename)}]]"` : "source_note: null";
    const content = [
      "---",
      "type: link-summary",
      `created: ${dateText}`,
      `source_url: "${this.escapeYaml(page.url)}"`,
      `site: "${this.escapeYaml(page.siteName || page.hostname)}"`,
      `page_title: "${this.escapeYaml(page.title || "")}"`,
      sourceLine,
      "tags:",
      "  - link",
      "  - gemini",
      "  - summary",
      "---",
      "",
      `# 링크 요약 - ${page.title || page.hostname}`,
      "",
      `- 원본: ${page.url}`,
      `- 사이트: ${page.siteName || page.hostname}`,
      page.title ? `- 제목: ${page.title}` : "",
      page.description ? `- 설명: ${page.description}` : "",
      sourceFile ? `- 출처 노트: [[${sourceFile.basename}]]` : "",
      "- 생성 도구: [[제미나이]]",
      `- 본문 추출: ${page.originalTextLength}자${page.truncated ? ` 중 처음 ${MAX_EXTRACTED_TEXT_LENGTH}자 사용` : ""}`,
      "",
      "## 요약",
      "",
      summary,
      "",
    ].filter((line) => line !== "").join("\n");

    return await this.app.vault.create(title, content);
  }

  async appendSummaryLink(sourceFile, outputFile, url) {
    const link = this.app.fileManager.generateMarkdownLink(outputFile, sourceFile.path);
    const content = await this.app.vault.read(sourceFile);
    const marker = `\n\n- 링크 요약: ${link} (${url})\n`;
    if (content.includes(link)) return;
    await this.app.vault.modify(sourceFile, content + marker);
  }

  getHeader(headers, name) {
    if (!headers) return "";
    const lowerName = name.toLowerCase();
    for (const key of Object.keys(headers)) {
      if (key.toLowerCase() === lowerName) return String(headers[key] || "");
    }
    return "";
  }

  getMetaContent(document, selectors) {
    for (const selector of selectors) {
      const content = document.querySelector(selector)?.getAttribute("content");
      if (content) return content;
    }
    return "";
  }

  extractHostname(url) {
    try {
      return new URL(url).hostname.replace(/^www\./i, "");
    } catch {
      return "unknown-site";
    }
  }

  normalizeWhitespace(text) {
    return String(text || "").replace(/\s+/g, " ").trim();
  }

  decodeBasicHtmlEntities(text) {
    return String(text || "")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");
  }

  escapeYaml(value) {
    return String(value || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  }

  safeFilePart(value) {
    const cleaned = String(value || "page")
      .replace(/[\\/:*?"<>|#^[\]]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return (cleaned || "page").slice(0, 60);
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

class GeneralUrlModal extends Modal {
  constructor(app, onSubmit) {
    super(app);
    this.onSubmit = onSubmit;
    this.url = "";
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "일반 링크 요약" });

    new Setting(contentEl)
      .setName("웹 링크")
      .addText((text) => {
        text.setPlaceholder("https://example.com/article")
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

class GeneralGeminiSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "General Gemini Link Summarizer" });

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
        text.setPlaceholder("자료/링크 요약")
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
