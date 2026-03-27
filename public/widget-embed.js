(function () {
  if (window.__escl8WebsiteWidgetLoaded) return;
  window.__escl8WebsiteWidgetLoaded = true;

  var script = document.currentScript;
  if (!script) return;

  var scriptUrl = new URL(script.src, window.location.href);
  var widgetKey = scriptUrl.searchParams.get("key") || script.getAttribute("data-key") || "";
  var apiBase = scriptUrl.origin;
  if (!widgetKey) return;

  var visitorStorageKey = "escl8_widget_visitor_" + widgetKey;
  var host = document.createElement("div");
  host.style.all = "initial";
  host.style.position = "fixed";
  host.style.right = "20px";
  host.style.bottom = "20px";
  host.style.zIndex = "2147483000";
  document.body.appendChild(host);

  var shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = `
    <style>
      :host {
        all: initial;
      }
      .escl8-widget {
        --escl8-accent: #2563eb;
        --escl8-accent-dark: #1d4ed8;
        --escl8-text: #0f172a;
        --escl8-muted: #64748b;
        --escl8-border: rgba(148, 163, 184, 0.28);
        --escl8-surface: #ffffff;
        --escl8-surface-soft: #f8fafc;
        --escl8-shadow: 0 24px 80px rgba(15, 23, 42, 0.22);
        font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        color: var(--escl8-text);
      }
      .launcher {
        width: 62px;
        height: 62px;
        border: 0;
        border-radius: 999px;
        background: linear-gradient(135deg, var(--escl8-accent), var(--escl8-accent-dark));
        color: #fff;
        display: grid;
        place-items: center;
        cursor: pointer;
        box-shadow: 0 18px 40px rgba(37, 99, 235, 0.34);
        transition: transform 180ms ease, box-shadow 180ms ease;
      }
      .launcher:hover {
        transform: translateY(-2px);
        box-shadow: 0 24px 50px rgba(37, 99, 235, 0.38);
      }
      .panel {
        position: absolute;
        right: 0;
        bottom: 78px;
        width: min(380px, calc(100vw - 28px));
        height: min(620px, calc(100vh - 110px));
        background: var(--escl8-surface);
        border: 1px solid var(--escl8-border);
        border-radius: 24px;
        box-shadow: var(--escl8-shadow);
        overflow: hidden;
        display: grid;
        grid-template-rows: auto 1fr auto;
        opacity: 0;
        pointer-events: none;
        transform: translateY(14px) scale(0.96);
        transform-origin: bottom right;
        transition: opacity 180ms ease, transform 180ms ease;
      }
      .escl8-open .panel {
        opacity: 1;
        pointer-events: auto;
        transform: translateY(0) scale(1);
      }
      .header {
        padding: 16px 18px;
        border-bottom: 1px solid var(--escl8-border);
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        background:
          radial-gradient(circle at top right, rgba(59, 130, 246, 0.14), transparent 42%),
          linear-gradient(180deg, #ffffff, #f8fbff);
      }
      .title-wrap {
        display: grid;
        gap: 2px;
      }
      .eyebrow {
        font-size: 11px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.12em;
        color: var(--escl8-accent);
      }
      .title {
        font-size: 16px;
        font-weight: 700;
        color: var(--escl8-text);
      }
      .subtitle {
        font-size: 12px;
        color: var(--escl8-muted);
      }
      .close {
        width: 34px;
        height: 34px;
        border: 1px solid var(--escl8-border);
        border-radius: 12px;
        background: rgba(255, 255, 255, 0.85);
        color: var(--escl8-text);
        cursor: pointer;
        font-size: 18px;
        line-height: 1;
      }
      .messages {
        padding: 18px;
        overflow-y: auto;
        background:
          linear-gradient(180deg, rgba(248, 250, 252, 0.72), rgba(255, 255, 255, 0.96)),
          radial-gradient(circle at top left, rgba(37, 99, 235, 0.05), transparent 28%);
        display: grid;
        align-content: start;
        gap: 12px;
      }
      .message {
        display: flex;
      }
      .message.inbound {
        justify-content: flex-end;
      }
      .message.outbound {
        justify-content: flex-start;
      }
      .bubble {
        max-width: 82%;
        padding: 12px 14px;
        border-radius: 18px;
        font-size: 14px;
        line-height: 1.5;
        box-shadow: 0 8px 24px rgba(15, 23, 42, 0.08);
        word-break: break-word;
        white-space: pre-wrap;
      }
      .message.inbound .bubble {
        background: linear-gradient(135deg, var(--escl8-accent), var(--escl8-accent-dark));
        color: #fff;
        border-bottom-right-radius: 6px;
      }
      .message.outbound .bubble {
        background: #fff;
        color: var(--escl8-text);
        border: 1px solid rgba(148, 163, 184, 0.22);
        border-bottom-left-radius: 6px;
      }
      .message.outbound.error .bubble {
        border-color: rgba(239, 68, 68, 0.24);
        background: #fff7f7;
      }
      .image {
        display: block;
        width: 100%;
        max-width: 220px;
        border-radius: 14px;
        margin-top: 8px;
      }
      .status {
        min-height: 18px;
        padding: 0 18px 10px;
        font-size: 12px;
        color: var(--escl8-muted);
        background: var(--escl8-surface);
      }
      .composer {
        padding: 14px;
        border-top: 1px solid var(--escl8-border);
        background: var(--escl8-surface);
      }
      .composer-row {
        display: grid;
        grid-template-columns: 1fr auto;
        gap: 10px;
        align-items: end;
      }
      .input {
        min-height: 46px;
        max-height: 120px;
        border-radius: 16px;
        border: 1px solid var(--escl8-border);
        background: var(--escl8-surface-soft);
        padding: 12px 14px;
        font-size: 14px;
        line-height: 1.4;
        color: var(--escl8-text);
        resize: none;
        outline: none;
      }
      .input:focus {
        border-color: rgba(37, 99, 235, 0.34);
        box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.12);
      }
      .send {
        height: 46px;
        min-width: 46px;
        border: 0;
        border-radius: 14px;
        background: linear-gradient(135deg, var(--escl8-accent), var(--escl8-accent-dark));
        color: #fff;
        cursor: pointer;
        font-weight: 700;
        padding: 0 16px;
      }
      .send[disabled] {
        opacity: 0.58;
        cursor: not-allowed;
      }
      .empty {
        display: grid;
        place-items: center;
        text-align: center;
        gap: 10px;
        min-height: 100%;
        color: var(--escl8-muted);
      }
      .empty-icon {
        width: 44px;
        height: 44px;
        border-radius: 14px;
        background: rgba(37, 99, 235, 0.09);
        display: grid;
        place-items: center;
        color: var(--escl8-accent);
        font-size: 22px;
      }
      @media (max-width: 640px) {
        .panel {
          width: min(100vw - 18px, 390px);
          height: min(100vh - 96px, 620px);
          bottom: 74px;
        }
        .launcher {
          width: 58px;
          height: 58px;
        }
      }
    </style>
    <div class="escl8-widget">
      <div class="panel">
        <div class="header">
          <div class="title-wrap">
            <div class="eyebrow">Live Assistant</div>
            <div class="title">Chat with us</div>
            <div class="subtitle">Ask anything and get a fast reply.</div>
          </div>
          <button type="button" class="close" aria-label="Close chat">×</button>
        </div>
        <div class="messages">
          <div class="empty">
            <div class="empty-icon">💬</div>
            <div>Start the conversation when you are ready.</div>
          </div>
        </div>
        <div>
          <div class="status"></div>
          <form class="composer">
            <div class="composer-row">
              <textarea class="input" rows="1" placeholder="Type your message..."></textarea>
              <button type="submit" class="send">Send</button>
            </div>
          </form>
        </div>
      </div>
      <button type="button" class="launcher" aria-label="Open chat">
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M7 10h10M7 14h6m-8 6 2.1-3.2A9 9 0 1 1 21 12a9 9 0 0 1-9 9 8.96 8.96 0 0 1-4.9-1.45L5 20Z" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></path>
        </svg>
      </button>
    </div>
  `;

  var widgetRoot = shadow.querySelector(".escl8-widget");
  var launcher = shadow.querySelector(".launcher");
  var closeButton = shadow.querySelector(".close");
  var titleEl = shadow.querySelector(".title");
  var subtitleEl = shadow.querySelector(".subtitle");
  var messagesEl = shadow.querySelector(".messages");
  var statusEl = shadow.querySelector(".status");
  var formEl = shadow.querySelector(".composer");
  var inputEl = shadow.querySelector(".input");
  var sendEl = shadow.querySelector(".send");

  var state = {
    open: false,
    historyLoaded: false,
    loadingSession: null,
    sending: false,
  };

  function getVisitorId() {
    try {
      var existing = window.localStorage.getItem(visitorStorageKey);
      if (existing) return existing;
    } catch {}

    var created = "";
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      created = "web_" + window.crypto.randomUUID();
    } else {
      created = "web_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
    }

    try {
      window.localStorage.setItem(visitorStorageKey, created);
    } catch {}
    return created;
  }

  var visitorId = getVisitorId();

  function setAccent(color) {
    var safe = color || "#2563eb";
    widgetRoot.style.setProperty("--escl8-accent", safe);
    widgetRoot.style.setProperty("--escl8-accent-dark", safe);
  }

  function setOpen(nextOpen) {
    state.open = !!nextOpen;
    if (state.open) {
      widgetRoot.classList.add("escl8-open");
      launcher.setAttribute("aria-expanded", "true");
      window.setTimeout(function () {
        inputEl.focus();
      }, 120);
      void ensureSession();
    } else {
      widgetRoot.classList.remove("escl8-open");
      launcher.setAttribute("aria-expanded", "false");
    }
  }

  function clearMessages() {
    while (messagesEl.firstChild) {
      messagesEl.removeChild(messagesEl.firstChild);
    }
  }

  function scrollMessagesToBottom() {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function setStatus(message) {
    statusEl.textContent = message || "";
  }

  function appendMessage(entry) {
    if (!entry) return;
    if (messagesEl.querySelector(".empty")) {
      clearMessages();
    }

    var direction = entry.direction === "inbound" ? "inbound" : "outbound";
    var tone = entry.error ? " error" : "";
    var row = document.createElement("div");
    row.className = "message " + direction + tone;

    var bubble = document.createElement("div");
    bubble.className = "bubble";

    if (entry.type === "image" && entry.imageUrl) {
      if (entry.text) {
        var caption = document.createElement("div");
        caption.textContent = entry.text;
        bubble.appendChild(caption);
      }
      var img = document.createElement("img");
      img.className = "image";
      img.src = entry.imageUrl;
      img.alt = entry.text || "Shared image";
      bubble.appendChild(img);
    } else if (entry.text) {
      bubble.textContent = entry.text;
    }

    row.appendChild(bubble);
    messagesEl.appendChild(row);
    scrollMessagesToBottom();
  }

  async function callApi(path, payload) {
    var response = await fetch(apiBase + path, {
      method: "POST",
      mode: "cors",
      credentials: "omit",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    var data = {};
    try {
      data = await response.json();
    } catch {}

    if (!response.ok) {
      throw new Error(data.error || "Request failed");
    }

    return data;
  }

  async function ensureSession() {
    if (state.historyLoaded) return;
    if (state.loadingSession) return state.loadingSession;

    setStatus("Connecting...");
    state.loadingSession = callApi("/api/widget/session", {
      key: widgetKey,
      visitorId: visitorId,
    })
      .then(function (data) {
        state.historyLoaded = true;
        setAccent(data.widget && data.widget.accentColor ? data.widget.accentColor : "#2563eb");
        titleEl.textContent = data.widget && data.widget.title ? data.widget.title : "Chat with us";
        subtitleEl.textContent = data.businessName ? "Live with " + data.businessName : "Ask anything and get a fast reply.";
        clearMessages();

        if (Array.isArray(data.history) && data.history.length > 0) {
          data.history.forEach(function (message) {
            appendMessage(message);
          });
        } else if (data.welcomeMessage) {
          appendMessage({
            direction: "outbound",
            type: "text",
            text: data.welcomeMessage,
          });
        } else {
          clearMessages();
          messagesEl.innerHTML = '<div class="empty"><div class="empty-icon">💬</div><div>Start the conversation when you are ready.</div></div>';
        }
        setStatus("");
      })
      .catch(function (error) {
        setStatus("Connection failed");
        appendMessage({
          direction: "outbound",
          type: "text",
          text: error && error.message ? error.message : "Could not start the chat.",
          error: true,
        });
      })
      .finally(function () {
        state.loadingSession = null;
      });

    return state.loadingSession;
  }

  function autosizeInput() {
    inputEl.style.height = "46px";
    inputEl.style.height = Math.min(inputEl.scrollHeight, 120) + "px";
  }

  launcher.addEventListener("click", function () {
    setOpen(!state.open);
  });

  closeButton.addEventListener("click", function () {
    setOpen(false);
  });

  inputEl.addEventListener("input", autosizeInput);

  formEl.addEventListener("submit", async function (event) {
    event.preventDefault();

    var value = inputEl.value.trim();
    if (!value || state.sending) return;

    await ensureSession();

    appendMessage({
      direction: "inbound",
      type: "text",
      text: value,
    });

    inputEl.value = "";
    autosizeInput();
    state.sending = true;
    inputEl.disabled = true;
    sendEl.disabled = true;
    setStatus("Assistant is typing...");

    try {
      var response = await callApi("/api/widget/chat", {
        key: widgetKey,
        visitorId: visitorId,
        message: value,
      });

      if (Array.isArray(response.messages) && response.messages.length > 0) {
        response.messages.forEach(function (message) {
          appendMessage({
            direction: "outbound",
            type: message.type === "image" ? "image" : "text",
            text: message.type === "text" ? message.text : message.caption || "",
            imageUrl: message.type === "image" ? message.imageUrl : null,
          });
        });
      } else {
        appendMessage({
          direction: "outbound",
          type: "text",
          text: "I could not generate a reply just now. Please try again.",
          error: true,
        });
      }
      setStatus(response.botPaused ? "A team member will continue from here." : "");
    } catch (error) {
      appendMessage({
        direction: "outbound",
        type: "text",
        text: error && error.message ? error.message : "Something went wrong. Please try again.",
        error: true,
      });
      setStatus("Message failed");
    } finally {
      state.sending = false;
      inputEl.disabled = false;
      sendEl.disabled = false;
      if (!statusEl.textContent || statusEl.textContent === "Assistant is typing...") {
        setStatus("");
      }
      inputEl.focus();
    }
  });

  autosizeInput();
})();
