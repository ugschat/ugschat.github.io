(() => {
  "use strict";

  const API_URL = "https://ugs-chat-api.kysliakov.workers.dev";
  const MAX_TURNS = 20;
  const MOBILE_DAILY_CHAT_LIMIT = 5;
  const MAX_ARTIFACT_GENERATIONS = 3;
  const MOBILE_DEVICE_KEY = "ugs_chat_mobile_device_v1";

  const state = {
    uiMessages: [],
    turns: 0,
    busy: false,
    sessionBroken: false,
    sessionId: crypto.randomUUID(),
    conversationState: null,
    networkAllowed: false,
    isMobile: detectMobileDevice(),
    deviceId: null,
    mobileSessionsRemaining: null,
    mobileDailyBlocked: false,
    mobileSessionActivated: false,
    lastArtifact: null,
    artifactsUsed: 0,
    artifactGenerationsRemaining: MAX_ARTIFACT_GENERATIONS
  };

  const el = {
    shell: document.querySelector(".app-shell"),
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
    mobileLimitInfo: document.querySelector("#mobileLimitInfo")
  };


  function detectMobileDevice() {
    if (navigator.userAgentData && typeof navigator.userAgentData.mobile === "boolean") {
      if (navigator.userAgentData.mobile) return true;
    }

    const ua = navigator.userAgent || "";
    if (/Android|iPhone|iPod|IEMobile|Opera Mini|Mobile/i.test(ua)) return true;

    // iPadOS може маскуватися під desktop Safari.
    if (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1) return true;

    return false;
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
      // У приватному режимі деякі браузери можуть обмежувати localStorage.
      return crypto.randomUUID();
    }
  }

  function updateMobileLimitUI() {
    if (!el.mobileLimitInfo) return;

    if (!state.isMobile) {
      el.mobileLimitInfo.hidden = true;
      return;
    }

    el.mobileLimitInfo.hidden = false;
    if (Number.isInteger(state.mobileSessionsRemaining)) {
      const n = Math.max(0, state.mobileSessionsRemaining);
      el.mobileLimitInfo.textContent = `${n} ${wordForChats(n)} сьогодні`;
    } else {
      el.mobileLimitInfo.textContent = `до ${MOBILE_DAILY_CHAT_LIMIT} чатів на день`;
    }

    if (state.mobileDailyBlocked) {
      el.newChat.disabled = true;
    }
  }

  function wordForChats(n) {
    const mod10 = n % 10;
    const mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return "новий чат";
    if ([2, 3, 4].includes(mod10) && ![12, 13, 14].includes(mod100)) return "нові чати";
    return "нових чатів";
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
        setConversationMode(state.uiMessages.length > 0 || el.messages.children.length > 0);
        el.input.focus();
      } else {
        showGate(data.message || "UGS Chat працює лише у шкільній мережі UGS.");
      }
    } catch {
      showGate("Не вдалося з’єднатися зі шкільним шлюзом. Перевір підключення до мережі або звернися до вчителя.");
    } finally {
      el.retry.disabled = false;
    }
  }

  function showGate(message) {
    state.networkAllowed = false;
    el.chat.hidden = true;
    el.gate.hidden = false;
    el.gateMessage.textContent = message;
  }

  function updateCounter() {
    const remaining = Math.max(0, MAX_TURNS - state.turns);
    el.counter.textContent = `${remaining} ${wordForRequests(remaining)} залишилося`;
    if (remaining === 0) {
      el.input.disabled = true;
      el.send.disabled = true;
      el.input.placeholder = "Ліміт цього чату вичерпано";
    }
  }

  function wordForRequests(n) {
    const mod10 = n % 10;
    const mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return "запит";
    if ([2, 3, 4].includes(mod10) && ![12, 13, 14].includes(mod100)) return "запити";
    return "запитів";
  }

  function scrollConversationToBottom(smooth = true) {
    requestAnimationFrame(() => {
      el.viewport.scrollTo({
        top: el.viewport.scrollHeight,
        behavior: smooth ? "smooth" : "auto"
      });
    });
  }

  function addMessage(role, text, extraClass = "") {
    const row = document.createElement("div");
    row.className = `message ${role} ${extraClass}`.trim();

    const bubble = document.createElement("div");
    bubble.className = "bubble";
    bubble.textContent = text;

    row.appendChild(bubble);
    el.messages.appendChild(row);

    setConversationMode(true);
    scrollConversationToBottom();
    return row;
  }

  function looksLikeArtifactRequest(text) {
    const s = String(text || "");
    const strong = /(створи|зроби|згенеруй|побудуй|розроби|create|build|make|generate)/iu;
    const noun = /(гру|гра|сайт|веб[- ]?сторін|презентац|слайд|game|website|presentation)/iu;
    const tech = /(html|javascript|css|\bjs\b|код)/iu;
    const near = new RegExp(`(?:${strong.source})[\s\S]{0,52}(?:${noun.source})|(?:${noun.source})[\s\S]{0,52}(?:${strong.source})`, "iu");
    if (near.test(s)) return true;
    return tech.test(s) && /(напиши|write).{0,52}(гру|сайт|презентац|game|website|presentation)/iu.test(s);
  }

  function addThinkingMessage(requestText) {
    const row = document.createElement("div");
    row.className = "message assistant thinking";
    row.setAttribute("role", "status");
    row.setAttribute("aria-live", "polite");

    const bubble = document.createElement("div");
    bubble.className = "bubble thinking-bubble";

    const dots = document.createElement("span");
    dots.className = "thinking-dots";
    dots.setAttribute("aria-hidden", "true");
    for (let i = 0; i < 3; i += 1) {
      dots.appendChild(document.createElement("span"));
    }

    const label = document.createElement("span");
    label.className = "thinking-label";
    const isArtifact = looksLikeArtifactRequest(requestText);
    label.textContent = isArtifact
      ? "Зачекай, створюю проєкт… Це може зайняти кілька секунд"
      : "Зачекай, готую відповідь…";

    bubble.append(dots, label);
    row.appendChild(bubble);
    el.messages.appendChild(row);
    setConversationMode(true);
    scrollConversationToBottom();

    const slowTimer = window.setTimeout(() => {
      if (!row.isConnected) return;
      label.textContent = isArtifact
        ? "Ще трохи — збираю проєкт і перевіряю результат…"
        : "Ще трохи — майже готово…";
      scrollConversationToBottom();
    }, 7000);

    return {
      remove() {
        window.clearTimeout(slowTimer);
        row.remove();
      }
    };
  }

  function addArtifactMessage(text, artifact) {
    const row = document.createElement("div");
    row.className = "message assistant artifact-message";

    const wrap = document.createElement("div");
    wrap.className = "artifact-wrap";

    if (text) {
      const bubble = document.createElement("div");
      bubble.className = "bubble artifact-intro";
      bubble.textContent = text;
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

    const actions = document.createElement("div");
    actions.className = "artifact-actions";

    const previewBtn = document.createElement("button");
    previewBtn.type = "button";
    previewBtn.className = "artifact-tab active";
    previewBtn.textContent = "Перегляд";

    const codeBtn = document.createElement("button");
    codeBtn.type = "button";
    codeBtn.className = "artifact-tab";
    codeBtn.textContent = "Код";

    const fullscreenBtn = document.createElement("button");
    fullscreenBtn.type = "button";
    fullscreenBtn.className = "artifact-fullscreen-btn";
    fullscreenBtn.innerHTML = '<span class="artifact-fullscreen-icon" aria-hidden="true">⛶</span><span>Розгорнути</span>';
    fullscreenBtn.setAttribute("aria-label", "Розгорнути проєкт на весь екран");

    const downloadBtn = document.createElement("button");
    downloadBtn.type = "button";
    downloadBtn.className = "artifact-download";
    downloadBtn.textContent = "Завантажити";
    downloadBtn.setAttribute("aria-label", "Завантажити проєкт як HTML-файл");

    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.className = "artifact-copy";
    copyBtn.textContent = "Копіювати";

    actions.append(previewBtn, codeBtn, fullscreenBtn, downloadBtn, copyBtn);
    header.append(meta, actions);

    const body = document.createElement("div");
    body.className = "artifact-body";

    const preview = document.createElement("div");
    preview.className = "artifact-preview";

    const frame = document.createElement("iframe");
    frame.className = "artifact-frame";
    frame.title = `Перегляд: ${artifact.title || artifactTypeLabel(artifact.type)}`;
    frame.setAttribute("sandbox", "allow-scripts");
    frame.setAttribute("referrerpolicy", "no-referrer");
    frame.srcdoc = buildSandboxedHtml(artifact.html);
    preview.appendChild(frame);

    const codePanel = document.createElement("div");
    codePanel.className = "artifact-code";
    codePanel.hidden = true;
    const pre = document.createElement("pre");
    const code = document.createElement("code");
    code.textContent = artifact.html;
    pre.appendChild(code);
    codePanel.appendChild(pre);

    previewBtn.addEventListener("click", () => {
      preview.hidden = false;
      codePanel.hidden = true;
      previewBtn.classList.add("active");
      codeBtn.classList.remove("active");
    });

    codeBtn.addEventListener("click", () => {
      preview.hidden = true;
      codePanel.hidden = false;
      codeBtn.classList.add("active");
      previewBtn.classList.remove("active");
      scrollConversationToBottom(false);
    });

    function setArtifactFullscreen(active) {
      card.classList.toggle("artifact-fullscreen", active);
      document.body.classList.toggle("artifact-fullscreen-open", active);
      fullscreenBtn.classList.toggle("active", active);
      fullscreenBtn.innerHTML = active
        ? '<span class="artifact-fullscreen-icon" aria-hidden="true">↙</span><span>Згорнути</span>'
        : '<span class="artifact-fullscreen-icon" aria-hidden="true">⛶</span><span>Розгорнути</span>';
      fullscreenBtn.setAttribute("aria-label", active ? "Вийти з повноекранного перегляду" : "Розгорнути проєкт на весь екран");
      if (active) {
        preview.hidden = false;
        codePanel.hidden = true;
        previewBtn.classList.add("active");
        codeBtn.classList.remove("active");
      }
    }

    fullscreenBtn.addEventListener("click", () => {
      setArtifactFullscreen(!card.classList.contains("artifact-fullscreen"));
    });

    const onEscape = (event) => {
      if (event.key === "Escape" && card.classList.contains("artifact-fullscreen")) {
        setArtifactFullscreen(false);
      }
    };
    document.addEventListener("keydown", onEscape);

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

    copyBtn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(artifact.html);
        const old = copyBtn.textContent;
        copyBtn.textContent = "Скопійовано";
        setTimeout(() => { copyBtn.textContent = old; }, 1300);
      } catch {
        copyBtn.textContent = "Не вдалося";
      }
    });

    body.append(preview, codePanel);
    card.append(header, body);

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

    setConversationMode(true);
    scrollConversationToBottom();
    return row;
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

  function buildSandboxedHtml(html) {
    const csp = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data: blob:; media-src 'none'; connect-src 'none'; font-src 'none'; frame-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'">`;
    const viewport = `<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">`;
    const responsiveGuard = `<style id="ugs-responsive-guard">html,body{max-width:100%;min-width:0;overflow-x:hidden;scroll-behavior:smooth}*,*::before,*::after{box-sizing:border-box}img,svg,video,canvas{max-width:100%}img,svg,video{height:auto}table{max-width:100%}pre,code{max-width:100%;white-space:pre-wrap;overflow-wrap:anywhere}body{margin:0}body *{max-width:100%}</style>`;
    const navigationGuard = `<script id="ugs-navigation-guard">(()=>{const scrollToHash=(raw)=>{if(!raw||raw==="#")return;let id=raw.slice(1);try{id=decodeURIComponent(id)}catch{}const target=document.getElementById(id);if(target)target.scrollIntoView({behavior:"smooth",block:"start"})};document.addEventListener("click",(event)=>{const anchor=event.target&&event.target.closest?event.target.closest("a[href]"):null;if(!anchor)return;const href=(anchor.getAttribute("href")||"").trim();if(href.startsWith("#")){event.preventDefault();scrollToHash(href);return}event.preventDefault()},true);try{window.open=()=>null}catch{}document.addEventListener("submit",(event)=>event.preventDefault(),true)})();</script>`;
    const source = String(html || "");
    if (/<head[\s>]/i.test(source)) {
      return source.replace(/<head([^>]*)>/i, `<head$1>${csp}${viewport}${responsiveGuard}${navigationGuard}`);
    }
    return `<!doctype html><html><head><meta charset="utf-8">${csp}${viewport}${responsiveGuard}${navigationGuard}</head><body>${source}</body></html>`;
  }

  function shouldIncludeArtifactContext(text) {
    if (!state.lastArtifact) return false;
    return /(зміни|змінити|додай|додати|прибери|видали|виправ|онови|перероби|перепиши|зроби\s+(?:його|її|це|фон|кнопк|текст|гру|сайт|презентац)|change|add|remove|fix|update|redo|make\s+it)/iu.test(text);
  }

  function addSupportMessage(text) {
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
    steps.innerHTML = "<strong>1.</strong> Зупинись і не залишайся наодинці. <strong>2.</strong> Поклич учителя, психолога або іншого дорослого поруч. <strong>3.</strong> Якщо важко пояснити словами — просто покажи дорослому цей екран.";

    button.addEventListener("click", () => {
      steps.hidden = false;
      button.hidden = true;
      scrollConversationToBottom();
    });

    card.append(label, title, copy, button, steps);
    row.appendChild(card);
    el.messages.appendChild(row);
    setConversationMode(true);
    scrollConversationToBottom();
    return row;
  }

  function addGuardrailMessage(text, kind = "safety") {
    const row = document.createElement("div");
    row.className = `message guardrail ${kind}`;

    const card = document.createElement("div");
    card.className = "guardrail-card";

    const badge = document.createElement("span");
    badge.className = "guardrail-badge";
    badge.textContent = kind === "focus" ? "Навчальний режим" : "Безпечний режим";

    const copy = document.createElement("div");
    copy.className = "guardrail-copy";
    copy.textContent = text;

    card.append(badge, copy);
    row.appendChild(card);
    el.messages.appendChild(row);
    setConversationMode(true);
    scrollConversationToBottom();
    return row;
  }

  function resetInputHeight() {
    el.input.style.height = "auto";
  }

  function resetChat() {
    if (state.isMobile && state.mobileDailyBlocked) {
      addGuardrailMessage("На сьогодні ліміт нових чатів з цього мобільного пристрою вичерпано. Поточний чат можна продовжувати до його ліміту, а нові сесії знову будуть доступні завтра.", "focus");
      return;
    }

    state.uiMessages = [];
    state.turns = 0;
    state.busy = false;
    state.sessionBroken = false;
    state.sessionId = crypto.randomUUID();
    state.conversationState = null;
    state.mobileSessionActivated = false;
    state.lastArtifact = null;
    state.artifactsUsed = 0;
    state.artifactGenerationsRemaining = MAX_ARTIFACT_GENERATIONS;
    el.messages.replaceChildren();
    setConversationMode(false);
    el.input.disabled = false;
    el.send.disabled = false;
    el.input.value = "";
    el.input.placeholder = "Запитай UGS Chat…";
    resetInputHeight();
    updateCounter();
    el.viewport.scrollTo({ top: 0, behavior: "auto" });
    updateMobileLimitUI();
    el.input.focus();
  }

  async function sendMessage(text) {
    const clean = text.trim();
    if (!clean || state.busy || !state.networkAllowed || state.turns >= MAX_TURNS) return;

    state.busy = true;
    el.send.disabled = true;
    el.input.disabled = true;
    setConversationMode(true);

    const userHistoryItem = { role: "user", content: clean };
    state.uiMessages.push(userHistoryItem);
    addMessage("user", clean);
    el.input.value = "";
    resetInputHeight();

    const typing = addThinkingMessage(clean);

    try {
      const response = await fetch(`${API_URL}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: state.sessionId,
          message: clean,
          conversationState: state.conversationState,
          clientMobile: state.isMobile,
          deviceId: state.isMobile ? state.deviceId : null,
          artifactState: shouldIncludeArtifactContext(clean) && state.lastArtifact
            ? state.lastArtifact.stateToken || null
            : null
        })
      });

      const data = await response.json().catch(() => ({}));
      typing.remove();

      if (!response.ok) {
        if (response.status === 403 && data.code === "NETWORK_ONLY") {
          state.uiMessages.pop();
          showGate(data.message || "UGS Chat працює лише у шкільній мережі UGS.");
          return;
        }
        if (data.code === "PII_DETECTED") {
          state.uiMessages.pop();
          addGuardrailMessage(data.message || "Прибери особисті дані та спробуй ще раз.", "safety");
          return;
        }
        if (data.code === "TURN_LIMIT") {
          state.uiMessages.pop();
          state.turns = MAX_TURNS;
          updateCounter();
          addGuardrailMessage(data.message || "У цьому чаті вже використано 20 запитів. Почни новий чат, щоб продовжити.", "focus");
          return;
        }
        if (data.code === "RATE_LIMIT" || data.code === "SCHOOL_RATE_LIMIT") {
          state.uiMessages.pop();
          addGuardrailMessage(data.message || "Зараз надто багато запитів. Зачекай трохи й спробуй ще раз.", "focus");
          return;
        }
        if (data.code === "SCHOOL_DAILY_LIMIT") {
          state.uiMessages.pop();
          addGuardrailMessage(data.message || "UGS Chat досяг добового ліміту використання. Звернися до вчителя.", "focus");
          return;
        }
        if (["STATE_REQUIRED", "STATE_INVALID", "STATE_EXPIRED"].includes(data.code)) {
          state.uiMessages.pop();
          state.sessionBroken = true;
          el.input.disabled = true;
          el.send.disabled = true;
          el.input.placeholder = "Почни новий чат";
          addGuardrailMessage(data.message || "Не вдалося перевірити стан цього чату. Почни новий чат.", "focus");
          return;
        }
        if (["ARTIFACT_STATE_INVALID", "ARTIFACT_STATE_EXPIRED"].includes(data.code)) {
          state.uiMessages.pop();
          state.lastArtifact = null;
          addGuardrailMessage(data.message || "Попередній проєкт більше не можна безпечно редагувати в цій сесії. Створи новий проєкт; звичайний чат продовжує працювати.", "focus");
          return;
        }
        if (data.code === "ARTIFACT_LIMIT") {
          state.uiMessages.pop();
          state.artifactGenerationsRemaining = 0;
          state.artifactsUsed = MAX_ARTIFACT_GENERATIONS;
          addGuardrailMessage(data.message || "У цьому чаті вже використано 3 генерації проєктів. Звичайні текстові запитання залишаються доступними.", "focus");
          return;
        }
        if (data.code === "MOBILE_SESSION_LIMIT") {
          state.uiMessages.pop();
          state.mobileDailyBlocked = true;
          state.mobileSessionsRemaining = 0;
          updateMobileLimitUI();
          el.input.disabled = true;
          el.send.disabled = true;
          el.input.placeholder = "Ліміт нових чатів на сьогодні вичерпано";
          addGuardrailMessage(data.message || "На сьогодні ліміт нових чатів з цього мобільного пристрою вичерпано.", "focus");
          return;
        }

        state.uiMessages.pop();
        addMessage("system", `${data.message || "Сталася технічна помилка."} Цей запит не зараховано.`, "error");
        return;
      }

      if (typeof data.conversationState === "string" && data.conversationState) {
        state.conversationState = data.conversationState;
      }
      if (Number.isInteger(data.turnsUsed)) {
        state.turns = Math.max(0, Math.min(MAX_TURNS, data.turnsUsed));
        updateCounter();
      }

      if (state.isMobile && Number.isInteger(data.mobileSessionsRemaining)) {
        state.mobileSessionsRemaining = data.mobileSessionsRemaining;
        state.mobileDailyBlocked = data.mobileSessionsRemaining <= 0;
        state.mobileSessionActivated = true;
        updateMobileLimitUI();
      }

      const answer = String(data.answer || "").trim();
      if (!answer) {
        state.uiMessages.pop();
        addMessage("system", "Не вдалося отримати текст відповіді. Цей запит не зараховано — спробуй ще раз.", "error");
        return;
      }

      const countTurn = data.countTurn !== false;
      const includeInHistory = data.includeInHistory !== false;
      const kind = String(data.kind || "model");

      if (!includeInHistory && state.uiMessages.at(-1) === userHistoryItem) {
        state.uiMessages.pop();
      }

      if (kind === "support") {
        addSupportMessage(answer);
      } else if (kind === "safety" || kind === "focus") {
        addGuardrailMessage(answer, kind);
      } else if (data.artifact && typeof data.artifact.html === "string") {
        const remaining = Number.isInteger(data.artifactGenerationsRemaining)
          ? Math.max(0, data.artifactGenerationsRemaining)
          : Math.max(0, state.artifactGenerationsRemaining - 1);
        state.artifactGenerationsRemaining = remaining;
        state.artifactsUsed = MAX_ARTIFACT_GENERATIONS - remaining;
        const artifact = {
          type: ["site", "game", "presentation"].includes(data.artifact.type) ? data.artifact.type : "site",
          title: String(data.artifact.title || "Новий проєкт"),
          html: String(data.artifact.html),
          stateToken: typeof data.artifactState === "string" ? data.artifactState : null,
          generationsRemaining: remaining
        };
        state.lastArtifact = artifact;
        addArtifactMessage(answer, artifact);
      } else {
        addMessage("assistant", answer, kind === "local_education" ? "local-education" : "");
      }

      if (includeInHistory) {
        state.uiMessages.push({ role: "assistant", content: answer });
      }

      if (countTurn && !Number.isInteger(data.turnsUsed)) {
        state.turns += 1;
        updateCounter();
      }
    } catch {
      typing.remove();
      if (state.uiMessages.at(-1) === userHistoryItem) state.uiMessages.pop();
      addMessage("system", "Не вдалося з’єднатися з ШІ. Цей запит не зараховано — спробуй ще раз.", "error");
    } finally {
      state.busy = false;
      if (!state.sessionBroken && state.turns < MAX_TURNS && state.networkAllowed && !(state.isMobile && state.mobileDailyBlocked && !state.mobileSessionActivated)) {
        el.input.disabled = false;
        el.send.disabled = false;
        el.input.focus();
      }
      scrollConversationToBottom();
    }
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

  el.newChat.addEventListener("click", resetChat);
  el.retry.addEventListener("click", checkNetwork);
  el.privacyBtn.addEventListener("click", () => el.privacyDialog.showModal());
  el.closePrivacy.addEventListener("click", () => el.privacyDialog.close());
  el.privacyDialog.addEventListener("click", (event) => {
    if (event.target === el.privacyDialog) el.privacyDialog.close();
  });

  // Історія навмисно НЕ пишеться у localStorage/sessionStorage/IndexedDB.
  // На мобільних localStorage містить лише випадковий технічний ID для добового ліміту сесій.
  state.deviceId = getOrCreateMobileDeviceId();
  updateMobileLimitUI();
  updateCounter();
  setConversationMode(false);
  checkNetwork();
})();
