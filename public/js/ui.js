/**
 * ui.js — DOM Updates & UI State
 *
 * Provides a clean interface for all UI mutations so other modules
 * don't have to touch the DOM directly.
 */

const UI = (() => {
  // ── Element references ──────────────────────────────────────────────────────
  const statusBadge   = document.getElementById('status-badge');
  const statusText    = document.getElementById('status-text');
  const overlayEl     = document.getElementById('overlay-stranger');
  const overlayMsg    = document.getElementById('overlay-msg');
  const overlaySpinner = document.getElementById('overlay-spinner');
  const camOffOverlay = document.getElementById('cam-off-overlay');
  const toastEl       = document.getElementById('toast');

  const btnStart = document.getElementById('btn-start');
  const btnNext  = document.getElementById('btn-next');
  const btnEnd   = document.getElementById('btn-end');
  const btnMic   = document.getElementById('btn-mic');
  const btnCam   = document.getElementById('btn-cam');
  const btnToggleChat = document.getElementById('btn-toggle-chat');
  const btnCloseChat  = document.getElementById('btn-close-chat');
  
  const chatSidebar   = document.getElementById('chat-sidebar');
  const chatMessages  = document.getElementById('chat-messages');
  const chatInput     = document.getElementById('chat-input');
  const btnSendChat   = document.getElementById('btn-send-chat');
  const chatForm      = document.getElementById('chat-form');

  // ── Toast ───────────────────────────────────────────────────────────────────

  let toastTimer = null;

  /**
   * Show a brief toast notification.
   * @param {string} message
   * @param {number} [duration=3000] ms to display
   */
  function showToast(message, duration = 3000) {
    toastEl.textContent = message;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastEl.classList.remove('show');
    }, duration);
  }

  // ── Status Badge ────────────────────────────────────────────────────────────

  /**
   * Update the top-bar connection status badge.
   * @param {'idle'|'waiting'|'connecting'|'connected'|'disconnected'} state
   * @param {string} [label] Optional override text
   */
  function setStatus(state, label) {
    const labels = {
      idle:         'Idle',
      waiting:      'Waiting…',
      connecting:   'Connecting…',
      connected:    'Connected',
      disconnected: 'Disconnected',
    };
    statusBadge.dataset.status = state;
    statusText.textContent = label || labels[state] || state;
  }

  // ── Overlay ─────────────────────────────────────────────────────────────────

  /**
   * Update the stranger-tile overlay content.
   * @param {'idle'|'waiting'|'connecting'|'hidden'} mode
   */
  function setOverlay(mode) {
    overlaySpinner.classList.remove('visible');

    switch (mode) {
      case 'idle':
        overlayEl.classList.remove('hidden');
        overlayMsg.innerHTML = 'Click <strong>Start</strong> to find someone';
        break;

      case 'waiting':
        overlayEl.classList.remove('hidden');
        overlaySpinner.classList.add('visible');
        overlayMsg.innerHTML = 'Waiting for a stranger…';
        break;

      case 'connecting':
        overlayEl.classList.remove('hidden');
        overlaySpinner.classList.add('visible');
        overlayMsg.innerHTML = 'Connecting…';
        break;

      case 'hidden':
        overlayEl.classList.add('hidden');
        break;

      default:
        overlayEl.classList.remove('hidden');
        overlayMsg.textContent = mode;
    }
  }

  // ── Button States ───────────────────────────────────────────────────────────

  /**
   * Enter the "searching/waiting" UI mode.
   * Start is disabled, Next/End are enabled.
   */
  function enterWaitingMode() {
    btnStart.disabled = true;
    btnNext.disabled  = false;
    btnEnd.disabled   = false;
    disableChat();
  }

  /**
   * Enter the "connected" UI mode.
   */
  function enterConnectedMode() {
    btnStart.disabled = true;
    btnNext.disabled  = false;
    btnEnd.disabled   = false;
    enableChat();
  }

  /**
   * Return to idle (Start available, Next/End disabled).
   */
  function enterIdleMode() {
    btnStart.disabled = false;
    btnNext.disabled  = true;
    btnEnd.disabled   = true;
    disableChat();
  }

  // ── Chat UI ─────────────────────────────────────────────────────────────────

  function toggleChat() {
    chatSidebar.classList.toggle('hidden');
    btnToggleChat.classList.toggle('active');
  }

  function enableChat() {
    chatInput.disabled = false;
    btnSendChat.disabled = false;
  }

  function disableChat() {
    chatInput.disabled = true;
    btnSendChat.disabled = true;
  }

  function appendChatMessage(text, sender) {
    const msgEl = document.createElement('div');
    msgEl.classList.add('chat-msg', `chat-msg--${sender}`);
    msgEl.textContent = text;
    chatMessages.appendChild(msgEl);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  function clearChat() {
    chatMessages.innerHTML = '<div class="chat-system-msg">Chat is ready. Say hi!</div>';
  }

  // ── Camera/Mic Toggle Visual ────────────────────────────────────────────────

  /**
   * Update the mic button visual state.
   * @param {boolean} active — true = mic on
   */
  function setMicActive(active) {
    btnMic.dataset.active = active ? 'true' : 'false';
  }

  /**
   * Update the cam button visual state and show/hide cam-off overlay.
   * @param {boolean} active — true = camera on
   */
  function setCamActive(active) {
    btnCam.dataset.active = active ? 'true' : 'false';
    if (active) {
      camOffOverlay.classList.remove('visible');
    } else {
      camOffOverlay.classList.add('visible');
    }
  }

  // ── Public API ──────────────────────────────────────────────────────────────
  return {
    showToast,
    setStatus,
    setOverlay,
    enterWaitingMode,
    enterConnectedMode,
    enterIdleMode,
    setMicActive,
    setCamActive,
    toggleChat,
    appendChatMessage,
    clearChat,

    // Expose buttons so modules can attach event listeners
    buttons: { btnStart, btnNext, btnEnd, btnMic, btnCam, btnToggleChat, btnCloseChat, chatForm, chatInput },
  };
})();
