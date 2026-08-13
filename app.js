(() => {
  "use strict";

  const API_URL = "https://ugs-chat-api.kysliakov.workers.dev";
  const MAX_TURNS = 20;
  const MAX_HISTORY_ITEMS = 40;

  const state = {
    messages: [],
    turns: 0,
    busy: false,
    sessionId: crypto.randomUUID(),
    networkAllowed: false
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
    closePrivacy: document.querySelector("#closePrivacyBtn")
  };

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
        setConversationMode(state.messages.length > 0);
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

    if (role !== "system" || state.messages.length > 0) setConversationMode(true);
    scrollConversationToBottom();
    return row;
  }

  function resetInputHeight() {
    el.input.style.height = "auto";
  }

  function resetChat() {
    state.messages = [];
    state.turns = 0;
    state.busy = false;
    state.sessionId = crypto.randomUUID();
    el.messages.replaceChildren();
    setConversationMode(false);
    el.input.disabled = false;
    el.send.disabled = false;
    el.input.value = "";
    el.input.placeholder = "Запитай UGS Chat…";
    resetInputHeight();
    updateCounter();
    el.viewport.scrollTo({ top: 0, behavior: "auto" });
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
          history: state.messages.slice(-MAX_HISTORY_ITEMS)
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
          addMessage("system", data.message || "Прибери особисті дані та спробуй ще раз.");
          return;
        }
        if (data.code === "SAFETY_BLOCK") {
          state.turns += 1;
          const safeText = data.message || "Я не можу допомогти з небезпечною частиною цього запиту. Спробуй сформулювати його як навчальне питання.";
          state.messages.push({ role: "assistant", content: safeText });
          addMessage("assistant", safeText);
          updateCounter();
          return;
        }

        // Не зараховуємо технічну помилку в ліміт і не додаємо її в історію моделі.
        state.messages.pop();
        addMessage("system", `${data.message || "Сталася технічна помилка."} Цей запит не зараховано.`, "error");
        return;
      }

      const answer = String(data.answer || "").trim();
      if (!answer) {
        state.messages.pop();
        addMessage("system", "Не вдалося отримати текст відповіді. Цей запит не зараховано — спробуй ще раз.", "error");
        return;
      }

      state.turns += 1;
      state.messages.push({ role: "assistant", content: answer });
      addMessage("assistant", answer);
      updateCounter();
    } catch {
      typing.remove();
      if (state.messages.at(-1) === userHistoryItem) state.messages.pop();
      addMessage("system", "Не вдалося з’єднатися з ШІ. Цей запит не зараховано — спробуй ще раз.", "error");
    } finally {
      state.busy = false;
      if (state.turns < MAX_TURNS && state.networkAllowed) {
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
  updateCounter();
  setConversationMode(false);
  checkNetwork();
})();
