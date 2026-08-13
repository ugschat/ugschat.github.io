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
    gate: document.querySelector("#networkGate"),
    gateMessage: document.querySelector("#networkMessage"),
    chat: document.querySelector("#chatApp"),
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

  function apiConfigured() {
    return API_URL && !API_URL.includes("YOUR-WORKER") && /^https:\/\//i.test(API_URL);
  }

  async function checkNetwork() {
    if (!apiConfigured()) {
      showGate("UGS Chat ще не підключений до шкільного шлюзу. Вкажіть адресу Worker у config.js.");
      return;
    }

    el.retry.disabled = true;
    try {
      const response = await fetch(`${API_URL}/health`, { method: "GET", cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (response.ok && data.allowed === true) {
        state.networkAllowed = true;
        el.gate.hidden = true;
        el.chat.hidden = false;
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
    if ([2,3,4].includes(mod10) && ![12,13,14].includes(mod100)) return "запити";
    return "запитів";
  }

  function addMessage(role, text, extraClass = "") {
    const row = document.createElement("div");
    row.className = `message ${role} ${extraClass}`.trim();
    const bubble = document.createElement("div");
    bubble.className = "bubble";
    bubble.textContent = text;
    row.appendChild(bubble);
    el.messages.appendChild(row);
    el.intro.hidden = state.messages.length > 0 || role !== "system";
    row.scrollIntoView({ behavior: "smooth", block: "end" });
    return row;
  }

  function resetChat() {
    state.messages = [];
    state.turns = 0;
    state.busy = false;
    state.sessionId = crypto.randomUUID();
    el.messages.replaceChildren();
    el.intro.hidden = false;
    el.input.disabled = false;
    el.send.disabled = false;
    el.input.value = "";
    el.input.placeholder = "Напиши повідомлення…";
    updateCounter();
    el.input.focus();
  }

  async function sendMessage(text) {
    const clean = text.trim();
    if (!clean || state.busy || !state.networkAllowed || state.turns >= MAX_TURNS) return;

    state.busy = true;
    el.send.disabled = true;
    el.input.disabled = true;
    el.intro.hidden = true;

    state.messages.push({ role: "user", content: clean });
    addMessage("user", clean);
    el.input.value = "";

    const typing = addMessage("assistant", "Думаю…", "typing");

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
          const safeText = data.message || "Я не можу допомогти з цим запитом у такому вигляді. Спробуй поставити безпечне навчальне запитання.";
          state.messages.push({ role: "assistant", content: safeText });
          addMessage("assistant", safeText);
          updateCounter();
          return;
        }
        throw new Error(data.message || "Не вдалося отримати відповідь.");
      }

      const answer = String(data.answer || "Не вдалося сформувати відповідь.").trim();
      state.turns += 1;
      state.messages.push({ role: "assistant", content: answer });
      addMessage("assistant", answer);
      updateCounter();
    } catch (error) {
      typing.remove();
      state.messages.pop();
      addMessage("system", error?.message || "Сталася технічна помилка. Спробуй ще раз.");
    } finally {
      state.busy = false;
      if (state.turns < MAX_TURNS && state.networkAllowed) {
        el.input.disabled = false;
        el.send.disabled = false;
        el.input.focus();
      }
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
      el.input.focus();
    });
  });

  el.newChat.addEventListener("click", resetChat);
  el.retry.addEventListener("click", checkNetwork);
  el.privacyBtn.addEventListener("click", () => el.privacyDialog.showModal());
  el.closePrivacy.addEventListener("click", () => el.privacyDialog.close());

  // Історія навмисно НЕ пишеться у localStorage/sessionStorage/IndexedDB.
  // Після перезавантаження або закриття вкладки JS-пам'ять зникає.
  updateCounter();
  checkNetwork();
})();
