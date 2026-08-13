(() => {
  "use strict";

  const API_URL = "https://ugs-chat-api.kysliakov.workers.dev";
  const MAX_TURNS = 20;
  const MAX_HISTORY_ITEMS = 40;
  const MOBILE_DAILY_CHAT_LIMIT = 5;
  const MOBILE_DEVICE_KEY = "ugs_chat_mobile_device_v1";

  const state = {
    messages: [],
    turns: 0,
    busy: false,
    sessionId: crypto.randomUUID(),
    networkAllowed: false,
    isMobile: detectMobileDevice(),
    deviceId: null,
    mobileSessionsRemaining: null,
    mobileDailyBlocked: false,
    mobileSessionActivated: false
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
        setConversationMode(state.messages.length > 0 || el.messages.children.length > 0);
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

    state.messages = [];
    state.turns = 0;
    state.busy = false;
    state.sessionId = crypto.randomUUID();
    state.mobileSessionActivated = false;
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
    state.messages.push(userHistoryItem);
    addMessage("user", clean);
    el.input.value = "";
    resetInputHeight();

    const typing = addMessage("assistant", "", "typing");

    try {
      const response = await fetch(`${API_URL}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: state.sessionId,
          turnNumber: state.turns + 1,
          history: state.messages.slice(-MAX_HISTORY_ITEMS),
          clientMobile: state.isMobile,
          deviceId: state.isMobile ? state.deviceId : null
        })
      });

      const data = await response.json().catch(() => ({}));
      typing.remove();

      if (!response.ok) {
        if (response.status === 403 && data.code === "NETWORK_ONLY") {
          state.messages.pop();
          showGate(data.message || "UGS Chat працює лише у шкільній мережі UGS.");
          return;
        }
        if (data.code === "PII_DETECTED") {
          state.messages.pop();
          addGuardrailMessage(data.message || "Прибери особисті дані та спробуй ще раз.", "safety");
          return;
        }
        if (data.code === "MOBILE_SESSION_LIMIT") {
          state.messages.pop();
          state.mobileDailyBlocked = true;
          state.mobileSessionsRemaining = 0;
          updateMobileLimitUI();
          el.input.disabled = true;
          el.send.disabled = true;
          el.input.placeholder = "Ліміт нових чатів на сьогодні вичерпано";
          addGuardrailMessage(data.message || "На сьогодні ліміт нових чатів з цього мобільного пристрою вичерпано.", "focus");
          return;
        }

        state.messages.pop();
        addMessage("system", `${data.message || "Сталася технічна помилка."} Цей запит не зараховано.`, "error");
        return;
      }

      if (state.isMobile && Number.isInteger(data.mobileSessionsRemaining)) {
        state.mobileSessionsRemaining = data.mobileSessionsRemaining;
        state.mobileDailyBlocked = data.mobileSessionsRemaining <= 0;
        state.mobileSessionActivated = true;
        updateMobileLimitUI();
      }

      const answer = String(data.answer || "").trim();
      if (!answer) {
        state.messages.pop();
        addMessage("system", "Не вдалося отримати текст відповіді. Цей запит не зараховано — спробуй ще раз.", "error");
        return;
      }

      const countTurn = data.countTurn !== false;
      const includeInHistory = data.includeInHistory !== false;
      const kind = String(data.kind || "model");

      if (!includeInHistory && state.messages.at(-1) === userHistoryItem) {
        state.messages.pop();
      }

      if (kind === "support") {
        addSupportMessage(answer);
      } else if (kind === "safety" || kind === "focus") {
        addGuardrailMessage(answer, kind);
      } else {
        addMessage("assistant", answer, kind === "local_education" ? "local-education" : "");
      }

      if (includeInHistory) {
        state.messages.push({ role: "assistant", content: answer });
      }

      if (countTurn) {
        state.turns += 1;
        updateCounter();
      }
    } catch {
      typing.remove();
      if (state.messages.at(-1) === userHistoryItem) state.messages.pop();
      addMessage("system", "Не вдалося з’єднатися з ШІ. Цей запит не зараховано — спробуй ще раз.", "error");
    } finally {
      state.busy = false;
      if (state.turns < MAX_TURNS && state.networkAllowed && !(state.isMobile && state.mobileDailyBlocked && !state.mobileSessionActivated)) {
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
