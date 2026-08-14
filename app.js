(() => {
  "use strict";

  if (window.self !== window.top) return;
  document.documentElement.classList.remove("frame-check");

  const API_URL = "https://ugs-chat-api.kysliakov.workers.dev";
  const MAX_TURNS = 20;
  const MOBILE_DAILY_CHAT_LIMIT = 5;
  const MAX_ARTIFACT_GENERATIONS = 3;
  const MOBILE_DEVICE_KEY = "ugs_chat_mobile_device_v1";
  const ARTIFACT_SANDBOX_URL = "sandbox.html?v=21";
  const TECHNICAL_CONTACT = "Якщо проблема повторюється, звернися до пана Артема, вчителя інформатики.";

  const state = {
    chats: [],
    activeChatId: null,
    activeRequest: null,
    requestSequence: 0,
    networkAllowed: false,
    isMobile: detectMobileDevice(),
    deviceId: null,
    mobileSessionsRemaining: null,
    mobileDailyBlocked: false,
    sidebarCollapsed: false,
    artifactCleanups: []
  };

  const el = {
    shell: document.querySelector(".app-shell"),
    workspace: document.querySelector(".workspace"),
    mainPanel: document.querySelector(".main-panel"),
    sidebar: document.querySelector("#chatSidebar"),
    sidebarToggle: document.querySelector("#sidebarToggle"),
    sidebarClose: document.querySelector("#sidebarClose"),
    sidebarBackdrop: document.querySelector("#sidebarBackdrop"),
    sidebarNewChat: document.querySelector("#sidebarNewChat"),
    sidebarPrivacy: document.querySelector("#sidebarPrivacyBtn"),
    copyConversation: document.querySelector("#copyConversationBtn"),
    savePdf: document.querySelector("#savePdfBtn"),
    conversationBar: document.querySelector("#conversationBar"),
    conversationBarName: document.querySelector("#conversationBarName"),
    aiUse: document.querySelector("#aiUseBtn"),
    help: document.querySelector("#helpBtn"),
    chatList: document.querySelector("#chatList"),
    gate: document.querySelector("#networkGate"),
    gateMessage: document.querySelector("#networkMessage"),
    chat: document.querySelector("#chatApp"),
    viewport: document.querySelector("#conversationViewport"),
    intro: document.querySelector("#introBlock"),
    messages: document.querySelector("#messages"),
    form: document.querySelector("#chatForm"),
    input: document.querySelector("#promptInput"),
    send: document.querySelector("#sendBtn"),
    counter: document.querySelector("#counter"),
    newChat: document.querySelector("#newChatBtn"),
    retry: document.querySelector("#retryBtn"),
    starters: [...document.querySelectorAll(".starter")],
    privacyBtn: document.querySelector("#privacyBtn"),
    privacyDialog: document.querySelector("#privacyDialog"),
    closePrivacy: document.querySelector("#closePrivacyBtn"),
    helpDialog: document.querySelector("#helpDialog"),
    closeHelp: document.querySelector("#closeHelpBtn"),
    aiUseDialog: document.querySelector("#aiUseDialog"),
    closeAiUse: document.querySelector("#closeAiUseBtn"),
    aiUseTemplate: document.querySelector("#aiUseTemplate"),
    copyAiUse: document.querySelector("#copyAiUseBtn"),
    printConversation: document.querySelector("#printConversation"),
    mobileLimitInfo: document.querySelector("#mobileLimitInfo")
  };

  function createChat() {
    return {
      id: crypto.randomUUID(),
      title: "Новий чат",
      createdAt: Date.now(),
      sessionId: crypto.randomUUID(),
      conversationState: null,
      turns: 0,
      sessionBroken: false,
      entries: [],
      busy: false,
      pendingText: "",
      unread: false,
      mobileSessionActivated: false,
      lastArtifact: null,
      artifactsUsed: 0,
      artifactGenerationsRemaining: MAX_ARTIFACT_GENERATIONS
    };
  }

  function getActiveChat() {
    return state.chats.find((chat) => chat.id === state.activeChatId) || null;
  }

  function getChat(chatId) {
    return state.chats.find((chat) => chat.id === chatId) || null;
  }

  function ensureChat() {
    let chat = getActiveChat();
    if (!chat) {
      chat = createChat();
      state.chats.unshift(chat);
      state.activeChatId = chat.id;
    }
    return chat;
  }

  function createNewChat() {
    const current = getActiveChat();
    if (state.isMobile && state.mobileDailyBlocked) {
      if (current) {
        appendEntry(current, {
          type: "guardrail",
          kind: "focus",
          text: "На сьогодні ліміт нових чатів з цього мобільного пристрою вичерпано. Уже активовані чати можна продовжувати до їхнього ліміту."
        });
      }
      return;
    }

    if (current && current.entries.length === 0 && !current.busy) {
      switchChat(current.id);
      return;
    }

    const chat = createChat();
    state.chats.unshift(chat);
    switchChat(chat.id);
  }

  function switchChat(chatId) {
    const chat = getChat(chatId);
    if (!chat) return;
    state.activeChatId = chat.id;
    chat.unread = false;
    renderChatList();
    renderActiveChat();
    closeSidebarOnMobile();
  }

  function chatTitleFromMessage(text) {
    const title = String(text || "")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/[.!?…]+$/u, "")
      .slice(0, 52);
    return title || "Новий чат";
  }

  function chatMeta(chat) {
    if (chat.busy) return "Готується відповідь…";
    if (chat.entries.length === 0) return "Порожній чат";
    if (chat.sessionBroken) return "Потрібен новий чат";
    const n = chat.turns;
    return n > 0 ? `${n} ${wordForRequests(n)} використано` : "Локальна відповідь";
  }

  function renderChatList() {
    el.chatList.replaceChildren();
    for (const chat of state.chats) {
      const item = document.createElement("div");
      item.className = `chat-list-item${chat.id === state.activeChatId ? " active" : ""}`;
      item.setAttribute("role", "listitem");

      const button = document.createElement("button");
      button.type = "button";
      button.className = "chat-list-button";
      button.setAttribute("aria-current", chat.id === state.activeChatId ? "true" : "false");

      const title = document.createElement("span");
      title.className = "chat-item-title";
      title.textContent = chat.title;

      const meta = document.createElement("span");
      meta.className = "chat-item-meta";
      meta.textContent = chatMeta(chat);

      button.append(title, meta);
      button.addEventListener("click", () => switchChat(chat.id));
      item.appendChild(button);

      if (chat.busy || chat.unread) {
        const status = document.createElement("span");
        status.className = `chat-item-status${chat.busy ? " busy" : ""}`;
        status.setAttribute("aria-label", chat.busy ? "Відповідь готується" : "Є нова відповідь");
        item.appendChild(status);
      }

      el.chatList.appendChild(item);
    }
  }

  function detectMobileDevice() {
    if (navigator.userAgentData && typeof navigator.userAgentData.mobile === "boolean" && navigator.userAgentData.mobile) {
      return true;
    }
    const ua = navigator.userAgent || "";
    if (/Android|iPhone|iPod|IEMobile|Opera Mini|Mobile/i.test(ua)) return true;
    return /Macintosh/i.test(ua) && navigator.maxTouchPoints > 1;
  }

  function getOrCreateMobileDeviceId() {
    if (!state.isMobile) return null;
    try {
      let id = localStorage.getItem(MOBILE_DEVICE_KEY);
      if (!id) {
        id = crypto.randomUUID();
        localStorage.setItem(MOBILE_DEVICE_KEY, id);
      }
      return id;
    } catch {
      return crypto.randomUUID();
    }
  }

  function updateMobileLimitUI() {
    if (!el.mobileLimitInfo) return;
    if (!state.isMobile) {
      el.mobileLimitInfo.hidden = true;
    } else {
      el.mobileLimitInfo.hidden = false;
      if (Number.isInteger(state.mobileSessionsRemaining)) {
        const n = Math.max(0, state.mobileSessionsRemaining);
        el.mobileLimitInfo.textContent = `${n} ${wordForChats(n)} сьогодні`;
      } else {
        el.mobileLimitInfo.textContent = `до ${MOBILE_DAILY_CHAT_LIMIT} чатів на день`;
      }
    }
    el.newChat.disabled = state.isMobile && state.mobileDailyBlocked;
    el.sidebarNewChat.disabled = state.isMobile && state.mobileDailyBlocked;
  }

  function wordForChats(n) {
    const mod10 = n % 10;
    const mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return "новий чат";
    if ([2, 3, 4].includes(mod10) && ![12, 13, 14].includes(mod100)) return "нові чати";
    return "нових чатів";
  }

  function wordForRequests(n) {
    const mod10 = n % 10;
    const mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return "запит";
    if ([2, 3, 4].includes(mod10) && ![12, 13, 14].includes(mod100)) return "запити";
    return "запитів";
  }

  function setConversationMode(active) {
    el.chat.classList.toggle("conversation-active", active);
    el.shell.classList.toggle("has-conversation", active);
    document.body.classList.toggle("has-conversation", active);
    el.intro.hidden = active;
  }

  async function checkNetwork() {
    el.retry.disabled = true;
    try {
      const response = await fetch(`${API_URL}/health`, { method: "GET", cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (response.ok && data.allowed === true) {
        state.networkAllowed = true;
        el.gate.hidden = true;
        el.chat.hidden = false;
        el.sidebar.hidden = false;
        el.sidebarToggle.hidden = false;
        renderActiveChat();
        el.input.focus();
      } else {
        showGate(data.message || "UGS Chat працює лише у шкільній мережі UGS.");
      }
    } catch {
      showGate(`Не вдалося з’єднатися зі шкільним шлюзом. Перевір підключення до мережі. ${TECHNICAL_CONTACT}`);
    } finally {
      el.retry.disabled = false;
    }
  }

  function showGate(message) {
    state.networkAllowed = false;
    el.chat.hidden = true;
    el.sidebar.hidden = true;
    el.sidebarToggle.hidden = true;
    el.gate.hidden = false;
    el.gateMessage.textContent = message;
  }

  function updateCounter() {
    const chat = ensureChat();
    const remaining = Math.max(0, MAX_TURNS - chat.turns);
    el.counter.textContent = `${remaining} ${wordForRequests(remaining)} залишилося`;
  }

  function updateComposerState() {
    const chat = ensureChat();
    const otherChatBusy = state.activeRequest && state.activeRequest.chatId !== chat.id;
    const mobileBlocked = state.isMobile && state.mobileDailyBlocked && !chat.mobileSessionActivated;
    let disabled = false;
    let placeholder = "Запитай UGS Chat…";

    if (!state.networkAllowed) {
      disabled = true;
    } else if (chat.busy) {
      disabled = true;
      placeholder = "Готую відповідь у цьому чаті…";
    } else if (otherChatBusy) {
      disabled = true;
      placeholder = "Відповідь готується в іншому чаті…";
    } else if (chat.sessionBroken) {
      disabled = true;
      placeholder = "Почни новий чат";
    } else if (chat.turns >= MAX_TURNS) {
      disabled = true;
      placeholder = "Ліміт цього чату вичерпано";
    } else if (mobileBlocked) {
      disabled = true;
      placeholder = "Ліміт нових чатів на сьогодні вичерпано";
    }

    el.input.disabled = disabled;
    el.send.disabled = disabled;
    el.input.placeholder = placeholder;
    updateCounter();
  }

  function scrollConversationToBottom(smooth = true) {
    requestAnimationFrame(() => {
      el.viewport.scrollTo({
        top: el.viewport.scrollHeight,
        behavior: smooth ? "smooth" : "auto"
      });
    });
  }

  function appendEntry(chat, entry) {
    chat.entries.push(entry);
    if (chat.id === state.activeChatId) {
      renderEntry(entry);
      setConversationMode(true);
      scrollConversationToBottom();
    } else {
      chat.unread = true;
    }
    renderChatList();
    updateConversationActions();
  }

  function renderActiveChat() {
    const chat = ensureChat();
    cleanupArtifacts();
    el.messages.replaceChildren();
    for (const entry of chat.entries) renderEntry(entry);
    if (chat.busy) renderThinkingMessage(chat.pendingText);
    setConversationMode(chat.entries.length > 0 || chat.busy);
    updateComposerState();
    updateMobileLimitUI();
    renderChatList();
    updateConversationActions();
    el.viewport.scrollTo({ top: el.viewport.scrollHeight, behavior: "auto" });
  }

  function renderEntry(entry) {
    if (entry.type === "support") return renderSupportMessage(entry.text);
    if (entry.type === "guardrail") return renderGuardrailMessage(entry.text, entry.kind);
    if (entry.type === "artifact") return renderArtifactMessage(entry.text, entry.artifact);
    return renderStandardMessage(entry.role, entry.text, entry.extraClass || "");
  }

  function renderStandardMessage(role, text, extraClass = "") {
    const row = document.createElement("div");
    row.className = `message ${role} ${extraClass}`.trim();

    const bubble = document.createElement("div");
    bubble.className = "bubble";
    if (role === "assistant") renderRichText(bubble, text);
    else bubble.textContent = text;
    row.appendChild(bubble);

    if (role === "assistant") {
      const copy = document.createElement("button");
      copy.type = "button";
      copy.className = "message-copy";
      copy.textContent = "Копіювати відповідь";
      copy.addEventListener("click", () => copyText(copy, text));
      row.appendChild(copy);
    }

    el.messages.appendChild(row);
    return row;
  }

  function renderRichText(container, text) {
    const source = String(text || "");
    const parts = source.split(/```(?:[\w-]+)?\s*\n?/g);
    parts.forEach((part, index) => {
      if (index % 2 === 1) {
        const pre = document.createElement("pre");
        const code = document.createElement("code");
        code.textContent = part.replace(/\n$/, "");
        pre.appendChild(code);
        container.appendChild(pre);
        return;
      }
      renderTextBlocks(container, part);
    });
  }

  function renderTextBlocks(container, text) {
    const lines = String(text || "").split("\n");
    let paragraph = [];
    let list = null;

    const flushParagraph = () => {
      if (!paragraph.length) return;
      const p = document.createElement("p");
      appendInlineMarkdown(p, paragraph.join(" ").trim());
      if (p.textContent) container.appendChild(p);
      paragraph = [];
    };
    const flushList = () => {
      if (list) container.appendChild(list);
      list = null;
    };

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) {
        flushParagraph();
        flushList();
        continue;
      }
      const heading = line.match(/^(#{1,3})\s+(.+)$/);
      if (heading) {
        flushParagraph();
        flushList();
        const h = document.createElement(heading[1].length === 1 ? "h3" : "h4");
        appendInlineMarkdown(h, heading[2]);
        container.appendChild(h);
        continue;
      }
      const bullet = line.match(/^[-*]\s+(.+)$/);
      const numbered = line.match(/^\d+[.)]\s+(.+)$/);
      if (bullet || numbered) {
        flushParagraph();
        const tag = numbered ? "ol" : "ul";
        if (!list || list.tagName.toLowerCase() !== tag) {
          flushList();
          list = document.createElement(tag);
        }
        const li = document.createElement("li");
        appendInlineMarkdown(li, (bullet || numbered)[1]);
        list.appendChild(li);
        continue;
      }
      flushList();
      paragraph.push(line);
    }
    flushParagraph();
    flushList();
  }

  function appendInlineMarkdown(parent, text) {
    const pattern = /(\*\*[^*]+\*\*|`[^`]+`)/g;
    let last = 0;
    for (const match of String(text || "").matchAll(pattern)) {
      if (match.index > last) parent.appendChild(document.createTextNode(text.slice(last, match.index)));
      const token = match[0];
      const node = document.createElement(token.startsWith("**") ? "strong" : "code");
      node.textContent = token.startsWith("**") ? token.slice(2, -2) : token.slice(1, -1);
      parent.appendChild(node);
      last = match.index + token.length;
    }
    if (last < text.length) parent.appendChild(document.createTextNode(text.slice(last)));
  }

  async function writeClipboard(text) {
    const value = String(text || "");
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return;
    }
    const fallback = document.createElement("textarea");
    fallback.value = value;
    fallback.setAttribute("readonly", "");
    fallback.style.position = "fixed";
    fallback.style.opacity = "0";
    document.body.appendChild(fallback);
    fallback.select();
    const copied = document.execCommand("copy");
    fallback.remove();
    if (!copied) throw new Error("Clipboard unavailable");
  }

  async function copyText(button, text) {
    const old = button.textContent;
    try {
      await writeClipboard(text);
      button.textContent = "Скопійовано";
    } catch {
      button.textContent = "Не вдалося";
    }
    window.setTimeout(() => { button.textContent = old; }, 1300);
  }

  function conversationEntries(chat) {
    return chat?.entries?.filter((entry) => entry && typeof entry.text === "string") || [];
  }

  function entryForExport(entry) {
    if (entry.type === "artifact") {
      const title = entry.artifact?.title || artifactTypeLabel(entry.artifact?.type);
      return {
        role: "assistant",
        label: "UGS Chat",
        text: `${entry.text || "Створено інтерактивний проєкт."}\n[Проєкт: ${title}. HTML-файл зберігається окремо.]`
      };
    }
    if (entry.type === "support") return { role: "assistant", label: "UGS Chat — підтримка", text: entry.text };
    if (entry.type === "guardrail") return { role: "system", label: "Повідомлення безпеки", text: entry.text };
    if (entry.role === "user") return { role: "user", label: "Учень", text: entry.text };
    if (entry.role === "assistant") return { role: "assistant", label: "UGS Chat", text: entry.text };
    return { role: "system", label: "Система", text: entry.text };
  }

  function chatDate(chat) {
    return new Intl.DateTimeFormat("uk-UA", {
      dateStyle: "medium",
      timeStyle: "short"
    }).format(new Date(chat?.createdAt || Date.now()));
  }

  function buildConversationText(chat) {
    const lines = [
      `UGS Chat — ${chat.title}`,
      `Дата початку: ${chatDate(chat)}`,
      "",
      "ШІ може помилятися. Важливу інформацію потрібно перевіряти.",
      ""
    ];
    for (const entry of conversationEntries(chat)) {
      const exported = entryForExport(entry);
      lines.push(`${exported.label}:`, exported.text.trim(), "");
    }
    lines.push("Створено за допомогою UGS Chat. Розмова була тимчасовою та зберігалася лише в поточній вкладці.");
    return lines.join("\n").trim();
  }

  // Панель дій ховаємо, поки чат порожній: мертві кнопки збивають учня з пантелику
  // сильніше, ніж їхня відсутність.
  function updateConversationActions() {
    const chat = getActiveChat();
    const hasEntries = conversationEntries(chat).length > 0;
    el.conversationBar.hidden = !hasEntries;
    if (hasEntries) el.conversationBarName.textContent = chat.title;
  }

  function appendPrintText(parent, className, text) {
    const node = document.createElement("p");
    node.className = className;
    node.textContent = text;
    parent.appendChild(node);
  }

  function preparePrintConversation(chat) {
    el.printConversation.replaceChildren();

    const title = document.createElement("h1");
    title.textContent = chat.title;
    el.printConversation.appendChild(title);
    appendPrintText(el.printConversation, "print-meta", `UGS Chat · ${chatDate(chat)}`);
    appendPrintText(el.printConversation, "print-note", "ШІ може помилятися. Перевіряй важливу інформацію та дотримуйся правил учителя для конкретного завдання.");

    for (const entry of conversationEntries(chat)) {
      const exported = entryForExport(entry);
      const article = document.createElement("article");
      article.className = `print-message print-message-${exported.role}`;
      appendPrintText(article, "print-role", exported.label);
      appendPrintText(article, "print-text", exported.text.trim());
      el.printConversation.appendChild(article);
    }

    appendPrintText(el.printConversation, "print-footer", "Створено за допомогою UGS Chat. Ця копія збережена користувачем локально; UGS Chat не зберігає історію розмов у власній базі.");
  }

  function printActiveConversation() {
    const chat = getActiveChat();
    if (!chat || conversationEntries(chat).length === 0) return;
    preparePrintConversation(chat);
    const previousTitle = document.title;
    document.title = `UGS Chat — ${chat.title}`;
    el.printConversation.setAttribute("aria-hidden", "false");
    let cleanedUp = false;
    const cleanup = () => {
      if (cleanedUp) return;
      cleanedUp = true;
      document.title = previousTitle;
      el.printConversation.setAttribute("aria-hidden", "true");
      window.removeEventListener("afterprint", cleanup);
    };
    window.addEventListener("afterprint", cleanup);
    window.print();
    window.setTimeout(cleanup, 1500);
  }

  function looksLikeArtifactRequest(text) {
    const s = String(text || "");
    const strong = /(створи|зроби|згенеруй|побудуй|розроби|create|build|make|generate)/iu;
    const noun = /(гру|гра|сайт|веб[- ]?сторін|презентац|слайд|game|website|presentation)/iu;
    const tech = /(html|javascript|css|\bjs\b|код)/iu;
    const near = new RegExp(`(?:${strong.source})[\\s\\S]{0,52}(?:${noun.source})|(?:${noun.source})[\\s\\S]{0,52}(?:${strong.source})`, "iu");
    if (near.test(s)) return true;
    return tech.test(s) && /(напиши|write).{0,52}(гру|сайт|презентац|game|website|presentation)/iu.test(s);
  }

  function renderThinkingMessage(requestText) {
    const row = document.createElement("div");
    row.className = "message assistant thinking";
    row.setAttribute("role", "status");
    row.setAttribute("aria-live", "polite");

    const bubble = document.createElement("div");
    bubble.className = "bubble thinking-bubble";
    const dots = document.createElement("span");
    dots.className = "thinking-dots";
    dots.setAttribute("aria-hidden", "true");
    for (let i = 0; i < 3; i += 1) dots.appendChild(document.createElement("span"));

    const label = document.createElement("span");
    label.className = "thinking-label";
    const isArtifact = looksLikeArtifactRequest(requestText);
    label.textContent = isArtifact
      ? "Створюю та перевіряю проєкт…"
      : "Готую відповідь…";
    bubble.append(dots, label);
    row.appendChild(bubble);
    el.messages.appendChild(row);

    window.setTimeout(() => {
      if (!row.isConnected) return;
      label.textContent = isArtifact
        ? "Ще трохи — перевіряю проєкт перед показом…"
        : "Ще трохи — майже готово…";
    }, 7000);
    return row;
  }

  function renderArtifactMessage(text, artifact) {
    const row = document.createElement("div");
    row.className = "message assistant artifact-message";
    const wrap = document.createElement("div");
    wrap.className = "artifact-wrap";

    if (text) {
      const bubble = document.createElement("div");
      bubble.className = "bubble artifact-intro";
      renderRichText(bubble, text);
      wrap.appendChild(bubble);
    }

    const card = document.createElement("section");
    card.className = "artifact-card";
    const header = document.createElement("div");
    header.className = "artifact-header";
    const meta = document.createElement("div");
    meta.className = "artifact-meta";
    const badge = document.createElement("span");
    badge.className = `artifact-badge artifact-${artifact.type}`;
    badge.textContent = artifactTypeLabel(artifact.type);
    const title = document.createElement("strong");
    title.className = "artifact-title";
    title.textContent = artifact.title || artifactTypeLabel(artifact.type);
    meta.append(badge, title);

    // Перемикачі режиму і дії з файлом — різні за суттю, тому й групи різні:
    // раніше всі п'ять кнопок виглядали однаково.
    const tabs = document.createElement("div");
    tabs.className = "artifact-tabs";
    tabs.setAttribute("aria-label", "Режим перегляду проєкту");
    const previewBtn = artifactAction("Перегляд", "artifact-tab active");
    previewBtn.setAttribute("aria-pressed", "true");
    const codeBtn = artifactAction("Код", "artifact-tab");
    codeBtn.setAttribute("aria-pressed", "false");
    tabs.append(previewBtn, codeBtn);

    const actions = document.createElement("div");
    actions.className = "artifact-actions";
    const fullscreenBtn = artifactAction("Розгорнути", "artifact-fullscreen-btn");
    fullscreenBtn.setAttribute("aria-label", "Розгорнути проєкт на весь екран");
    const downloadBtn = artifactAction("Завантажити", "artifact-download");
    downloadBtn.setAttribute("aria-label", "Завантажити захищену копію проєкту");
    const copyBtn = artifactAction("Копіювати код", "artifact-copy");
    actions.append(fullscreenBtn, downloadBtn, copyBtn);
    header.append(meta, tabs, actions);

    const body = document.createElement("div");
    body.className = "artifact-body";
    const preview = document.createElement("div");
    preview.className = "artifact-preview";
    const frame = document.createElement("iframe");
    frame.className = "artifact-frame";
    frame.title = `Ізольований перегляд: ${artifact.title || artifactTypeLabel(artifact.type)}`;
    frame.setAttribute("sandbox", "allow-scripts");
    frame.setAttribute("referrerpolicy", "no-referrer");
    mountArtifactPreview(frame, buildSandboxedHtml(artifact.html), () => {
      const note = document.createElement("div");
      note.className = "artifact-preview-fallback";
      note.textContent = "Перегляд не вдалося показати в цьому браузері. Відкрий вкладку «Код» або завантаж файл — проєкт працює локально.";
      preview.appendChild(note);
    });
    preview.appendChild(frame);

    const codePanel = document.createElement("div");
    codePanel.className = "artifact-code";
    codePanel.hidden = true;
    const pre = document.createElement("pre");
    const code = document.createElement("code");
    code.textContent = artifact.html;
    pre.appendChild(code);
    codePanel.appendChild(pre);

    previewBtn.addEventListener("click", () => selectArtifactTab(true));
    codeBtn.addEventListener("click", () => selectArtifactTab(false));

    const selectArtifactTab = (showPreview) => {
      preview.hidden = !showPreview;
      codePanel.hidden = showPreview;
      previewBtn.classList.toggle("active", showPreview);
      codeBtn.classList.toggle("active", !showPreview);
      previewBtn.setAttribute("aria-pressed", String(showPreview));
      codeBtn.setAttribute("aria-pressed", String(!showPreview));
      if (!showPreview) scrollConversationToBottom(false);
    };

    const onEscape = (event) => {
      if (event.key === "Escape" && card.classList.contains("artifact-fullscreen")) setArtifactFullscreen(false);
    };
    const setArtifactFullscreen = (active) => {
      card.classList.toggle("artifact-fullscreen", active);
      document.body.classList.toggle("artifact-fullscreen-open", active);
      fullscreenBtn.classList.toggle("active", active);
      fullscreenBtn.textContent = active ? "Згорнути" : "Розгорнути";
      fullscreenBtn.setAttribute("aria-label", active ? "Вийти з повноекранного перегляду" : "Розгорнути проєкт на весь екран");
      if (active) {
        selectArtifactTab(true);
        document.addEventListener("keydown", onEscape);
      } else {
        document.removeEventListener("keydown", onEscape);
      }
    };
    fullscreenBtn.addEventListener("click", () => setArtifactFullscreen(!card.classList.contains("artifact-fullscreen")));
    state.artifactCleanups.push(() => {
      document.removeEventListener("keydown", onEscape);
      document.body.classList.remove("artifact-fullscreen-open");
    });

    downloadBtn.addEventListener("click", () => {
      const blob = new Blob([buildSandboxedHtml(artifact.html)], { type: "text/html;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = artifactDownloadFilename(artifact);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1200);
    });
    copyBtn.addEventListener("click", () => copyText(copyBtn, buildSandboxedHtml(artifact.html)));

    body.append(preview, codePanel);
    card.append(header, body);

    const safetyNote = document.createElement("div");
    safetyNote.className = "artifact-safety-note";
    safetyNote.textContent = "Проєкт працює в ізольованому режимі без мережі. Скопійована й завантажена версії містять ті самі захисні обмеження.";
    card.appendChild(safetyNote);

    if (Number.isInteger(artifact.generationsRemaining)) {
      const limitNote = document.createElement("div");
      limitNote.className = "artifact-limit-note";
      const n = Math.max(0, artifact.generationsRemaining);
      limitNote.textContent = n > 0
        ? `Ще ${n} ${n === 1 ? "генерація проєкту" : "генерації проєктів"} у цьому чаті`
        : "Ліміт проєктів у цьому чаті використано · текстовий чат працює далі";
      card.appendChild(limitNote);
    }

    wrap.appendChild(card);
    row.appendChild(wrap);
    el.messages.appendChild(row);
    return row;
  }

  function artifactAction(label, className) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = className;
    button.textContent = label;
    return button;
  }

  function cleanupArtifacts() {
    for (const cleanup of state.artifactCleanups.splice(0)) cleanup();
  }

  function artifactTypeLabel(type) {
    if (type === "game") return "Гра";
    if (type === "presentation") return "Презентація";
    return "Сайт";
  }

  function artifactDownloadFilename(artifact) {
    const fallback = artifact.type === "game"
      ? "UGS_гра"
      : artifact.type === "presentation"
        ? "UGS_презентація"
        : "UGS_сайт";
    const base = String(artifact.title || fallback)
      .replace(/[\/:*?"<>|]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/[. ]+$/g, "")
      .slice(0, 80) || fallback;
    return `${base}.html`;
  }

  // Проєкт показуємо через окремий документ sandbox.html, а не через srcdoc:
  // кадр із srcdoc успадковує CSP основної сторінки, і тоді інлайновий код
  // проєкту (разом із нашими власними захисними скриптами) блокується.
  function mountArtifactPreview(frame, html, onUnavailable) {
    let delivered = false;
    let confirmed = false;

    const deliver = () => {
      if (delivered || !frame.contentWindow) return;
      delivered = true;
      frame.contentWindow.postMessage({ ugsSandbox: "render", html }, "*");
    };

    const onMessage = (event) => {
      if (!frame.contentWindow || event.source !== frame.contentWindow) return;
      const kind = event.data && event.data.ugsSandbox;
      if (kind === "ready") {
        deliver();
      } else if (kind === "rendered") {
        confirmed = true;
        window.clearTimeout(timer);
      }
    };

    // Якщо пісочниця не підтвердила показ, залишати порожній кадр не можна:
    // підказуємо учневі перейти на «Код» або завантажити файл.
    const timer = window.setTimeout(() => {
      if (!confirmed) onUnavailable();
    }, 4000);

    window.addEventListener("message", onMessage);
    frame.addEventListener("load", deliver);
    state.artifactCleanups.push(() => {
      window.removeEventListener("message", onMessage);
      window.clearTimeout(timer);
    });

    frame.src = ARTIFACT_SANDBOX_URL;
  }

  function buildSandboxedHtml(html) {
    const csp = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data: blob:; media-src 'none'; connect-src 'none'; font-src 'none'; frame-src 'none'; child-src 'none'; worker-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'; navigate-to 'none'">`;
    const viewport = `<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">`;
    const responsiveGuard = `<style id="ugs-responsive-guard">html,body{max-width:100%;min-width:0;overflow-x:hidden;scroll-behavior:smooth}*,*::before,*::after{box-sizing:border-box}img,svg,video,canvas{max-width:100%}img,svg,video{height:auto}table{max-width:100%}pre,code{max-width:100%;white-space:pre-wrap;overflow-wrap:anywhere}body{margin:0}body *{max-width:100%}</style>`;
    const navigationGuard = `<script id="ugs-navigation-guard">(()=>{const scrollToHash=raw=>{if(!raw||raw==="#")return;let id=raw.slice(1);try{id=decodeURIComponent(id)}catch{}const target=document.getElementById(id);if(target)target.scrollIntoView({behavior:"smooth",block:"start"})};addEventListener("click",event=>{const anchor=event.target&&event.target.closest?event.target.closest("a[href]"):null;if(!anchor)return;const href=(anchor.getAttribute("href")||"").trim();event.preventDefault();if(href.startsWith("#"))scrollToHash(href)},true);addEventListener("submit",event=>event.preventDefault(),true);try{window.open=()=>null;history.pushState=()=>null;history.replaceState=()=>null}catch{}})();</script>`;
    const source = String(html || "");
    if (/<head[\s>]/i.test(source)) {
      return source.replace(/<head([^>]*)>/i, `<head$1>${csp}${viewport}${responsiveGuard}${navigationGuard}`);
    }
    return `<!doctype html><html><head><meta charset="utf-8">${csp}${viewport}${responsiveGuard}${navigationGuard}</head><body>${source}</body></html>`;
  }

  function shouldIncludeArtifactContext(text, chat) {
    if (!chat.lastArtifact) return false;
    return /(зміни|змінити|додай|додати|прибери|видали|виправ|онови|перероби|перепиши|зроби\s+(?:його|її|це|фон|кнопк|текст|гру|сайт|презентац)|change|add|remove|fix|update|redo|make\s+it)/iu.test(text);
  }

  function renderSupportMessage(text) {
    const row = document.createElement("div");
    row.className = "message support";
    const card = document.createElement("section");
    card.className = "support-card";
    card.setAttribute("aria-label", "Підтримка");
    const label = document.createElement("div");
    label.className = "support-label";
    label.textContent = "Важливо";
    const title = document.createElement("h3");
    title.textContent = "Потрібен дорослий поруч";
    const copy = document.createElement("p");
    copy.textContent = text;
    const button = document.createElement("button");
    button.className = "support-action";
    button.type = "button";
    button.textContent = "Що робити зараз";
    const steps = document.createElement("div");
    steps.className = "support-steps";
    steps.hidden = true;
    const stepTexts = [
      "Зупинись і не залишайся наодинці.",
      "У школі звернися до шкільного психолога, вчителя або іншого дорослого поруч.",
      "Якщо важко пояснити словами — просто покажи дорослому цей екран."
    ];
    const list = document.createElement("ol");
    for (const stepText of stepTexts) {
      const li = document.createElement("li");
      li.textContent = stepText;
      list.appendChild(li);
    }
    steps.appendChild(list);
    button.addEventListener("click", () => {
      steps.hidden = false;
      button.hidden = true;
      scrollConversationToBottom();
    });
    card.append(label, title, copy, button, steps);
    row.appendChild(card);
    el.messages.appendChild(row);
    return row;
  }

  function renderGuardrailMessage(text, kind = "safety") {
    const row = document.createElement("div");
    row.className = `message guardrail ${kind}`;
    const card = document.createElement("div");
    card.className = "guardrail-card";
    const badge = document.createElement("span");
    badge.className = "guardrail-badge";
    badge.textContent = kind === "focus" ? "Навчальний режим" : "Фільтри безпеки";
    const copy = document.createElement("div");
    copy.className = "guardrail-copy";
    copy.textContent = text;
    card.append(badge, copy);
    row.appendChild(card);
    el.messages.appendChild(row);
    return row;
  }

  function resetInputHeight() {
    el.input.style.height = "auto";
  }

  async function sendMessage(text) {
    const clean = String(text || "").trim();
    const chat = ensureChat();
    if (!clean || state.activeRequest || !state.networkAllowed || chat.turns >= MAX_TURNS || chat.sessionBroken) return;
    if (state.isMobile && state.mobileDailyBlocked && !chat.mobileSessionActivated) return;

    const requestId = ++state.requestSequence;
    state.activeRequest = { id: requestId, chatId: chat.id };
    chat.busy = true;
    chat.pendingText = clean;
    chat.unread = false;
    if (chat.title === "Новий чат") chat.title = chatTitleFromMessage(clean);
    appendEntry(chat, { type: "message", role: "user", text: clean });
    el.input.value = "";
    resetInputHeight();
    renderActiveChat();

    try {
      const response = await fetch(`${API_URL}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: chat.sessionId,
          message: clean,
          conversationState: chat.conversationState,
          clientMobile: state.isMobile,
          deviceId: state.isMobile ? state.deviceId : null,
          artifactState: shouldIncludeArtifactContext(clean, chat) && chat.lastArtifact
            ? chat.lastArtifact.stateToken || null
            : null
        })
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        handleRequestError(chat, response.status, data);
        return;
      }

      if (typeof data.conversationState === "string" && data.conversationState) chat.conversationState = data.conversationState;
      if (Number.isInteger(data.turnsUsed)) chat.turns = Math.max(0, Math.min(MAX_TURNS, data.turnsUsed));

      if (state.isMobile && Number.isInteger(data.mobileSessionsRemaining)) {
        state.mobileSessionsRemaining = data.mobileSessionsRemaining;
        state.mobileDailyBlocked = data.mobileSessionsRemaining <= 0;
        chat.mobileSessionActivated = true;
      }

      const answer = String(data.answer || "").trim();
      if (!answer) {
        appendEntry(chat, { type: "message", role: "system", extraClass: "error", text: "Не вдалося отримати текст відповіді. Цей запит не зараховано — спробуй ще раз." });
        return;
      }

      const countTurn = data.countTurn !== false;
      const kind = String(data.kind || "model");
      if (kind === "support") {
        appendEntry(chat, { type: "support", text: answer });
      } else if (kind === "safety" || kind === "focus") {
        appendEntry(chat, { type: "guardrail", kind, text: answer });
      } else if (data.artifact && typeof data.artifact.html === "string") {
        const remaining = Number.isInteger(data.artifactGenerationsRemaining)
          ? Math.max(0, data.artifactGenerationsRemaining)
          : Math.max(0, chat.artifactGenerationsRemaining - 1);
        chat.artifactGenerationsRemaining = remaining;
        chat.artifactsUsed = MAX_ARTIFACT_GENERATIONS - remaining;
        const artifact = {
          type: ["site", "game", "presentation"].includes(data.artifact.type) ? data.artifact.type : "site",
          title: String(data.artifact.title || "Новий проєкт"),
          html: String(data.artifact.html),
          stateToken: typeof data.artifactState === "string" ? data.artifactState : null,
          generationsRemaining: remaining
        };
        chat.lastArtifact = artifact;
        appendEntry(chat, { type: "artifact", text: answer, artifact });
      } else {
        appendEntry(chat, {
          type: "message",
          role: "assistant",
          text: answer,
          extraClass: kind === "local_education" ? "local-education" : ""
        });
      }

      if (countTurn && !Number.isInteger(data.turnsUsed)) chat.turns += 1;
    } catch {
      appendEntry(chat, { type: "message", role: "system", extraClass: "error", text: `Не вдалося з’єднатися з ШІ. Цей запит не зараховано — спробуй ще раз. ${TECHNICAL_CONTACT}` });
    } finally {
      chat.busy = false;
      chat.pendingText = "";
      if (state.activeRequest?.id === requestId) state.activeRequest = null;
      if (chat.id !== state.activeChatId) chat.unread = true;
      renderChatList();
      updateMobileLimitUI();
      if (chat.id === state.activeChatId) {
        renderActiveChat();
        if (!el.input.disabled) el.input.focus();
      } else {
        updateComposerState();
      }
    }
  }

  function handleRequestError(chat, status, data) {
    const message = String(data?.message || "");
    if (status === 403 && data.code === "NETWORK_ONLY") {
      showGate(message || "UGS Chat працює лише у шкільній мережі UGS.");
      return;
    }
    if (data.code === "PII_DETECTED") {
      appendEntry(chat, { type: "guardrail", kind: "safety", text: message || "Прибери особисті дані та спробуй ще раз." });
      return;
    }
    if (data.code === "TURN_LIMIT") {
      chat.turns = MAX_TURNS;
      appendEntry(chat, { type: "guardrail", kind: "focus", text: message || "У цьому чаті вже використано 20 запитів. Почни новий чат, щоб продовжити." });
      return;
    }
    if (data.code === "RATE_LIMIT" || data.code === "SCHOOL_RATE_LIMIT" || data.code === "SCHOOL_DAILY_LIMIT") {
      appendEntry(chat, { type: "guardrail", kind: "focus", text: message || "Зараз надто багато запитів. Зачекай трохи й спробуй ще раз." });
      return;
    }
    if (["STATE_REQUIRED", "STATE_INVALID", "STATE_EXPIRED"].includes(data.code)) {
      chat.sessionBroken = true;
      appendEntry(chat, { type: "guardrail", kind: "focus", text: message || "Не вдалося перевірити стан цього чату. Почни новий чат." });
      return;
    }
    if (["ARTIFACT_STATE_INVALID", "ARTIFACT_STATE_EXPIRED"].includes(data.code)) {
      chat.lastArtifact = null;
      appendEntry(chat, { type: "guardrail", kind: "focus", text: message || "Попередній проєкт більше не можна безпечно редагувати. Створи новий проєкт." });
      return;
    }
    if (data.code === "ARTIFACT_UNSAFE") {
      appendEntry(chat, { type: "guardrail", kind: "safety", text: message || "Проєкт містив недозволену можливість, тому його не показано. Попроси простіший офлайн-проєкт." });
      return;
    }
    if (data.code === "ARTIFACT_LIMIT") {
      chat.artifactGenerationsRemaining = 0;
      chat.artifactsUsed = MAX_ARTIFACT_GENERATIONS;
      appendEntry(chat, { type: "guardrail", kind: "focus", text: message || "У цьому чаті вже використано 3 генерації проєктів. Текстовий чат працює далі." });
      return;
    }
    if (data.code === "MOBILE_SESSION_LIMIT") {
      state.mobileDailyBlocked = true;
      state.mobileSessionsRemaining = 0;
      appendEntry(chat, { type: "guardrail", kind: "focus", text: message || "На сьогодні ліміт нових чатів із цього мобільного пристрою вичерпано." });
      return;
    }
    appendEntry(chat, { type: "message", role: "system", extraClass: "error", text: `${message || "Сталася технічна помилка."} Цей запит не зараховано. ${TECHNICAL_CONTACT}` });
  }

  function openPrivacy() {
    if (!el.privacyDialog.open) el.privacyDialog.showModal();
  }

  function openHelp() {
    if (!el.helpDialog.open) el.helpDialog.showModal();
  }

  function openAiUse() {
    if (!el.aiUseDialog.open) el.aiUseDialog.showModal();
  }

  function closeDialogFromBackdrop(dialog, event) {
    if (event.target === dialog) dialog.close();
  }

  function toggleSidebar() {
    if (window.matchMedia("(max-width: 700px)").matches) {
      const open = !el.workspace.classList.contains("sidebar-open");
      el.workspace.classList.toggle("sidebar-open", open);
      el.sidebarBackdrop.hidden = !open;
      el.sidebarToggle.setAttribute("aria-expanded", String(open));
      document.body.classList.toggle("sidebar-open", open);
      syncSidebarAccessibility();
      if (open) el.sidebarClose.focus();
    } else {
      state.sidebarCollapsed = !state.sidebarCollapsed;
      el.workspace.classList.toggle("sidebar-collapsed", state.sidebarCollapsed);
      el.sidebarToggle.setAttribute("aria-expanded", String(!state.sidebarCollapsed));
      syncSidebarAccessibility();
    }
  }

  function syncSidebarAccessibility() {
    const mobile = window.matchMedia("(max-width: 700px)").matches;
    const visible = mobile
      ? el.workspace.classList.contains("sidebar-open")
      : !state.sidebarCollapsed;
    el.sidebar.toggleAttribute("inert", !visible);
    el.sidebar.setAttribute("aria-hidden", String(!visible));
  }

  function closeSidebarOnMobile() {
    if (!window.matchMedia("(max-width: 700px)").matches) return;
    el.workspace.classList.remove("sidebar-open");
    el.sidebarBackdrop.hidden = true;
    el.sidebarToggle.setAttribute("aria-expanded", "false");
    document.body.classList.remove("sidebar-open");
    syncSidebarAccessibility();
  }

  el.form.addEventListener("submit", (event) => {
    event.preventDefault();
    sendMessage(el.input.value);
  });
  el.input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      el.form.requestSubmit();
    }
  });
  el.input.addEventListener("input", () => {
    el.input.style.height = "auto";
    el.input.style.height = `${Math.min(el.input.scrollHeight, 160)}px`;
  });
  el.starters.forEach((button) => {
    button.addEventListener("click", () => {
      el.input.value = button.dataset.prompt || "";
      el.input.dispatchEvent(new Event("input"));
      el.input.focus();
    });
  });
  el.newChat.addEventListener("click", createNewChat);
  el.sidebarNewChat.addEventListener("click", createNewChat);
  el.retry.addEventListener("click", checkNetwork);
  el.copyConversation.addEventListener("click", () => {
    const chat = getActiveChat();
    if (chat) copyText(el.copyConversation, buildConversationText(chat));
  });
  el.savePdf.addEventListener("click", printActiveConversation);
  el.aiUse.addEventListener("click", openAiUse);
  el.help.addEventListener("click", openHelp);
  el.privacyBtn.addEventListener("click", openPrivacy);
  el.sidebarPrivacy.addEventListener("click", openPrivacy);
  el.closePrivacy.addEventListener("click", () => el.privacyDialog.close());
  el.privacyDialog.addEventListener("click", (event) => closeDialogFromBackdrop(el.privacyDialog, event));
  el.closeHelp.addEventListener("click", () => el.helpDialog.close());
  el.helpDialog.addEventListener("click", (event) => closeDialogFromBackdrop(el.helpDialog, event));
  el.closeAiUse.addEventListener("click", () => el.aiUseDialog.close());
  el.aiUseDialog.addEventListener("click", (event) => closeDialogFromBackdrop(el.aiUseDialog, event));
  el.copyAiUse.addEventListener("click", () => copyText(el.copyAiUse, el.aiUseTemplate.textContent));
  el.sidebarToggle.addEventListener("click", toggleSidebar);
  el.sidebarClose.addEventListener("click", closeSidebarOnMobile);
  el.sidebarBackdrop.addEventListener("click", closeSidebarOnMobile);
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeSidebarOnMobile();
  });
  window.addEventListener("resize", () => {
    if (!window.matchMedia("(max-width: 700px)").matches) {
      el.workspace.classList.remove("sidebar-open");
      document.body.classList.remove("sidebar-open");
      el.sidebarBackdrop.hidden = true;
      el.sidebarToggle.setAttribute("aria-expanded", String(!state.sidebarCollapsed));
    } else {
      el.sidebarToggle.setAttribute("aria-expanded", String(el.workspace.classList.contains("sidebar-open")));
    }
    syncSidebarAccessibility();
  });

  state.deviceId = getOrCreateMobileDeviceId();
  ensureChat();
  el.sidebarToggle.setAttribute("aria-expanded", String(!window.matchMedia("(max-width: 700px)").matches));
  syncSidebarAccessibility();
  renderChatList();
  updateConversationActions();
  updateMobileLimitUI();
  updateCounter();
  setConversationMode(false);
  checkNetwork();
})();
