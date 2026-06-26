/**
 * socket.js — Socket.IO Connection & Chat Orchestration
 *
 * Key fixes vs v1:
 *  - getUserMedia is deferred until Start is clicked (not on page load)
 *  - isInitiator is properly reset on Next/End/peer-disconnected
 *  - "peer-disconnected" auto re-queues the user cleanly
 *  - "waiting" event correctly fires when no match is available
 */

(async function initChat() {
  // ── Connect to Socket.IO ───────────────────────────────────────────────────
  const socket = io({ autoConnect: true });

  // ── State ──────────────────────────────────────────────────────────────────
  let isInitiator  = false;
  let mediaReady   = false;  // true once getUserMedia has succeeded

  // ── Signaling Callbacks ────────────────────────────────────────────────────
  // Set them up once — these never change
  WebRTCManager.setSignalingCallbacks({
    // Initiator sends offer → relay through server
    offer: (sdp) => socket.emit('offer', { sdp }),

    // Non-initiator sends answer → relay through server AND update its own UI
    answer: (sdp) => {
      socket.emit('answer', { sdp });
      // Non-initiator side: connection is established from its perspective
      UI.setStatus('connected');
      UI.setOverlay('hidden');
      UI.enterConnectedMode();
      UI.showToast('✓ Connected to a stranger!', 2500);
    },

    // Both sides relay ICE candidates through server
    ice: (candidate) => socket.emit('ice-candidate', { candidate }),
  });

  // ── Helper: acquire media ──────────────────────────────────────────────────

  /**
   * Request camera/mic. Shows a toast if it fails.
   * Returns true if successful, false otherwise.
   */
  async function acquireMedia() {
    if (mediaReady) return true;

    const stream = await WebRTCManager.getLocalStream();
    if (stream) {
      mediaReady = true;
      
      const hasVideo = stream.getVideoTracks().length > 0;
      UI.setCamActive(hasVideo);
      
      const hasAudio = stream.getAudioTracks().length > 0;
      UI.setMicActive(hasAudio);
      
      if (!hasVideo && hasAudio) {
        UI.showToast('⚠️ Camera not found or in use. Audio only.', 5000);
      } else if (!hasVideo && !hasAudio) {
        UI.showToast('⚠️ Camera and mic not available.', 5000);
      }
      
      return true;
    } else {
      UI.showToast('⚠️ Camera/mic access denied. Check browser permissions.', 5000);
      return false;
    }
  }

  // ── Socket Core Events ─────────────────────────────────────────────────────

  socket.on('connect', () => {
    console.log('[Socket] Connected:', socket.id);
  });

  socket.on('disconnect', (reason) => {
    console.warn('[Socket] Disconnected:', reason);
    UI.setStatus('disconnected');
    UI.showToast('Connection lost. Reconnecting…');
  });

  socket.on('reconnect', () => {
    console.log('[Socket] Reconnected');
    UI.setStatus('idle');
    UI.setOverlay('idle');
    UI.enterIdleMode();
  });

  // ── Matchmaking Events ─────────────────────────────────────────────────────

  // Nobody else in queue right now — we're waiting
  socket.on('waiting', () => {
    console.log('[Chat] Waiting for a stranger…');
    UI.setStatus('waiting');
    UI.setOverlay('waiting');
    UI.enterWaitingMode();
  });

  // A match was found!
  socket.on('matched', async ({ initiator }) => {
    console.log(`[Chat] Matched! initiator=${initiator}`);
    isInitiator = initiator;

    UI.setStatus('connecting');
    UI.setOverlay('connecting');

    if (isInitiator) {
      // Initiator: create connection now and send the offer
      await WebRTCManager.createPeerConnection(true);
    }
    // Non-initiator: waits for the 'offer' event before creating its connection
  });

  // ── WebRTC Signaling ───────────────────────────────────────────────────────

  // Offer arrives at non-initiator
  socket.on('offer', async ({ sdp }) => {
    console.log('[Chat] Received offer');
    if (!isInitiator) {
      // Non-initiator creates its peer connection and responds with an answer
      await WebRTCManager.createPeerConnection(false);
      await WebRTCManager.handleOffer(sdp);
      // UI is updated inside the onAnswer callback above
    }
  });

  // Answer arrives at initiator
  socket.on('answer', async ({ sdp }) => {
    console.log('[Chat] Received answer');
    await WebRTCManager.handleAnswer(sdp);

    // Initiator side: connection is established
    UI.setStatus('connected');
    UI.setOverlay('hidden');
    UI.enterConnectedMode();
    UI.showToast('✓ Connected to a stranger!', 2500);
  });

  // ICE candidates from partner
  socket.on('ice-candidate', async ({ candidate }) => {
    await WebRTCManager.handleIceCandidate(candidate);
  });

  // ── Chat Messages ──────────────────────────────────────────────────────────
  socket.on('chat-message', ({ message }) => {
    console.log('[Chat] Received message');
    UI.appendChatMessage(message, 'stranger');
  });

  // ── Peer Disconnect ────────────────────────────────────────────────────────

  socket.on('peer-disconnected', () => {
    console.log('[Chat] Stranger left');
    WebRTCManager.closePeerConnection();
    isInitiator = false;

    UI.showToast('Stranger disconnected. Finding someone new…', 3000);
    // The server automatically re-queues us, so we just update the UI
    UI.setStatus('waiting');
    UI.setOverlay('waiting');
    UI.enterWaitingMode();
    UI.clearChat();
  });

  // ── Button Handlers ────────────────────────────────────────────────────────

  const { btnStart, btnNext, btnEnd, btnMic, btnCam, btnToggleChat, btnCloseChat, chatForm, chatInput } = UI.buttons;

  // ── Start ──────────────────────────────────────────────────────────────────
  btnStart.addEventListener('click', async () => {
    console.log('[Chat] Start clicked');

    // Request camera/mic first (deferred from page load)
    const ok = await acquireMedia();
    if (!ok) return; // can't proceed without media

    socket.emit('join-queue');
    UI.setStatus('waiting');
    UI.setOverlay('waiting');
    UI.enterWaitingMode();
  });

  // ── Next ───────────────────────────────────────────────────────────────────
  btnNext.addEventListener('click', () => {
    if (!socket.connected) return;
    console.log('[Chat] Next clicked');

    WebRTCManager.closePeerConnection();
    isInitiator = false;

    socket.emit('next');
    // Server will trigger 'matched' or 'waiting' back to us
    UI.setStatus('waiting');
    UI.setOverlay('waiting');
    UI.clearChat();
  });

  // ── End ────────────────────────────────────────────────────────────────────
  btnEnd.addEventListener('click', () => {
    console.log('[Chat] End clicked');

    WebRTCManager.closePeerConnection();
    isInitiator = false;

    socket.emit('end-session');

    UI.setStatus('idle');
    UI.setOverlay('idle');
    UI.enterIdleMode();
    UI.showToast('Call ended.');
    UI.clearChat();
  });

  // ── Mic Toggle ─────────────────────────────────────────────────────────────
  btnMic.addEventListener('click', () => {
    const active = WebRTCManager.toggleMic();
    UI.setMicActive(active);
    UI.showToast(active ? '🎙 Microphone on' : '🔇 Microphone muted', 1800);
  });

  // ── Camera Toggle ──────────────────────────────────────────────────────────
  btnCam.addEventListener('click', () => {
    const active = WebRTCManager.toggleCam();
    UI.setCamActive(active);
    UI.showToast(active ? '📷 Camera on' : '📷 Camera off', 1800);
  });

  // ── Chat Handlers ──────────────────────────────────────────────────────────
  btnToggleChat.addEventListener('click', () => {
    UI.toggleChat();
  });

  btnCloseChat.addEventListener('click', () => {
    UI.toggleChat();
  });

  chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const msg = chatInput.value.trim();
    if (msg) {
      socket.emit('chat-message', { message: msg });
      UI.appendChatMessage(msg, 'you');
      chatInput.value = '';
    }
  });

  // ── Initial UI State ────────────────────────────────────────────────────────
  UI.setStatus('idle');
  UI.setOverlay('idle');
  UI.enterIdleMode();
  UI.setMicActive(true);
  UI.setCamActive(true);
  
  // Start with chat hidden on mobile by default
  if (window.innerWidth <= 900) {
    document.getElementById('chat-sidebar').classList.add('hidden');
  }

})();
