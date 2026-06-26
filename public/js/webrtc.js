/**
 * webrtc.js — WebRTC Peer Connection & Media
 *
 * Key fixes vs v1:
 *  - getUserMedia is NOT called on page load; only on demand (avoids "Device in use")
 *  - ICE candidates are queued if remote description isn't set yet (race condition fix)
 *  - Proper cleanup of pending ICE queue on connection close
 */

const WebRTCManager = (() => {
  // ── STUN Servers ────────────────────────────────────────────────────────────
  const ICE_SERVERS = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' },
      { urls: 'stun:stun3.l.google.com:19302' },
    ],
  };

  // ── State ────────────────────────────────────────────────────────────────────
  let localStream       = null;  // MediaStream from getUserMedia
  let peerConn          = null;  // RTCPeerConnection
  let pendingCandidates = [];    // ICE candidates queued before remoteDesc is set
  let remoteDescSet     = false; // tracks if setRemoteDescription has been called
  let micActive         = true;
  let camActive         = true;

  // Callbacks injected by socket.js for signaling
  let onOffer  = null;
  let onAnswer = null;
  let onIce    = null;

  const localVideo  = document.getElementById('local-video');
  const remoteVideo = document.getElementById('remote-video');

  // ── Local Media ──────────────────────────────────────────────────────────────

  /**
   * Request camera + microphone access.
   * Safe to call multiple times — returns cached stream.
   * Does NOT throw — returns null on failure so caller can handle gracefully.
   */
  async function getLocalStream() {
    if (localStream) return localStream;

    // Constraints: try HD first, fall back gracefully
    const constraints = {
      video: {
        width:  { ideal: 1280 },
        height: { ideal: 720 },
        facingMode: 'user',
      },
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl:  true,
      },
    };

    // First try full constraints
    try {
      localStream = await navigator.mediaDevices.getUserMedia(constraints);
    } catch (e1) {
      console.warn('[WebRTC] HD getUserMedia failed, trying basic:', e1.message);
      // Fall back to basic constraints
      try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      } catch (e2) {
        console.warn('[WebRTC] Basic video+audio failed, trying audio only:', e2.message);
        // Final fallback: audio only
        try {
          localStream = await navigator.mediaDevices.getUserMedia({ video: false, audio: true });
        } catch (e3) {
          console.error('[WebRTC] All getUserMedia attempts failed:', e3);
          return null;
        }
      }
    }

    if (localStream) {
      localVideo.srcObject = localStream;
      // Restore enabled state in case toggles were pressed before stream acquired
      localStream.getAudioTracks().forEach(t => { t.enabled = micActive; });
      localStream.getVideoTracks().forEach(t => { t.enabled = camActive; });
      console.log('[WebRTC] Local stream acquired:', localStream.getTracks().map(t => t.kind).join(', '));
    }

    return localStream;
  }

  // ── Peer Connection ──────────────────────────────────────────────────────────

  /**
   * Create a new RTCPeerConnection and attach local tracks.
   * @param {boolean} isInitiator — true = this client creates and sends the offer
   */
  async function createPeerConnection(isInitiator) {
    closePeerConnection(); // clean up any previous connection

    console.log(`[WebRTC] Creating peer connection (initiator=${isInitiator})`);

    peerConn          = new RTCPeerConnection(ICE_SERVERS);
    pendingCandidates = [];
    remoteDescSet     = false;

    // ── Attach local tracks ──────────────────────────────────────────────────
    if (localStream) {
      localStream.getTracks().forEach((track) => {
        peerConn.addTrack(track, localStream);
      });
    } else {
      // Stream wasn't available — RTCPeerConnection can still be created
      // for signaling (but no local video/audio will be sent)
      console.warn('[WebRTC] No local stream to add tracks from');
    }

    // ── Remote track handler ─────────────────────────────────────────────────
    peerConn.ontrack = (event) => {
      console.log('[WebRTC] Remote track received:', event.track.kind);
      if (event.streams && event.streams[0]) {
        remoteVideo.srcObject = event.streams[0];
      }
    };

    // ── ICE Candidate handler ─────────────────────────────────────────────────
    peerConn.onicecandidate = (event) => {
      if (event.candidate && onIce) {
        onIce(event.candidate);
      }
    };

    // ── Connection state logging ─────────────────────────────────────────────
    peerConn.onconnectionstatechange = () => {
      console.log(`[WebRTC] Connection state: ${peerConn.connectionState}`);
    };

    peerConn.oniceconnectionstatechange = () => {
      console.log(`[WebRTC] ICE state: ${peerConn.iceConnectionState}`);
    };

    // ── Create Offer (initiator only) ─────────────────────────────────────────
    if (isInitiator) {
      try {
        const offer = await peerConn.createOffer({
          offerToReceiveVideo: true,
          offerToReceiveAudio: true,
        });
        await peerConn.setLocalDescription(offer);
        console.log('[WebRTC] Offer created');
        if (onOffer) onOffer(offer);
      } catch (err) {
        console.error('[WebRTC] createOffer error:', err);
      }
    }
  }

  /**
   * Handle an incoming offer from the remote peer.
   * Creates an answer and sends it back via the onAnswer callback.
   * @param {RTCSessionDescriptionInit} sdp
   */
  async function handleOffer(sdp) {
    if (!peerConn) {
      console.warn('[WebRTC] handleOffer: no peerConn');
      return;
    }

    try {
      await peerConn.setRemoteDescription(new RTCSessionDescription(sdp));
      console.log('[WebRTC] Remote offer set');
      remoteDescSet = true;

      // Flush any queued ICE candidates now that remote desc is ready
      await flushPendingCandidates();

      const answer = await peerConn.createAnswer();
      await peerConn.setLocalDescription(answer);
      console.log('[WebRTC] Answer created');

      if (onAnswer) onAnswer(answer);
    } catch (err) {
      console.error('[WebRTC] handleOffer error:', err);
    }
  }

  /**
   * Handle an incoming answer (called on the initiator side).
   * @param {RTCSessionDescriptionInit} sdp
   */
  async function handleAnswer(sdp) {
    if (!peerConn) return;
    try {
      await peerConn.setRemoteDescription(new RTCSessionDescription(sdp));
      console.log('[WebRTC] Remote answer set');
      remoteDescSet = true;

      // Flush queued ICE candidates
      await flushPendingCandidates();
    } catch (err) {
      console.error('[WebRTC] handleAnswer error:', err);
    }
  }

  /**
   * Add a remote ICE candidate.
   * If remoteDescription isn't set yet, queue it for later.
   * @param {RTCIceCandidateInit} candidate
   */
  async function handleIceCandidate(candidate) {
    if (!peerConn) return;

    if (!remoteDescSet) {
      // Queue the candidate — it will be applied after setRemoteDescription
      console.log('[WebRTC] Queuing ICE candidate (remote desc not set yet)');
      pendingCandidates.push(candidate);
      return;
    }

    try {
      await peerConn.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (err) {
      console.warn('[WebRTC] addIceCandidate error:', err.message);
    }
  }

  /**
   * Apply any ICE candidates that arrived before setRemoteDescription.
   */
  async function flushPendingCandidates() {
    if (pendingCandidates.length === 0) return;
    console.log(`[WebRTC] Flushing ${pendingCandidates.length} queued ICE candidates`);
    for (const candidate of pendingCandidates) {
      try {
        await peerConn.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (err) {
        console.warn('[WebRTC] Flush addIceCandidate error:', err.message);
      }
    }
    pendingCandidates = [];
  }

  /**
   * Close the peer connection and clear the remote video.
   */
  function closePeerConnection() {
    if (peerConn) {
      peerConn.ontrack                   = null;
      peerConn.onicecandidate            = null;
      peerConn.onconnectionstatechange   = null;
      peerConn.oniceconnectionstatechange = null;
      peerConn.close();
      peerConn = null;
      console.log('[WebRTC] Peer connection closed');
    }
    remoteVideo.srcObject = null;
    pendingCandidates     = [];
    remoteDescSet         = false;
  }

  // ── Track Toggling ───────────────────────────────────────────────────────────

  /**
   * Toggle microphone. Returns the new active state.
   */
  function toggleMic() {
    micActive = !micActive;
    if (localStream) {
      localStream.getAudioTracks().forEach(t => { t.enabled = micActive; });
    }
    console.log(`[WebRTC] Mic ${micActive ? 'on' : 'off'}`);
    return micActive;
  }

  /**
   * Toggle camera. Returns the new active state.
   */
  function toggleCam() {
    camActive = !camActive;
    if (localStream) {
      localStream.getVideoTracks().forEach(t => { t.enabled = camActive; });
    }
    console.log(`[WebRTC] Cam ${camActive ? 'on' : 'off'}`);
    return camActive;
  }

  // ── Signaling Callback Registration ─────────────────────────────────────────

  function setSignalingCallbacks({ offer, answer, ice }) {
    onOffer  = offer;
    onAnswer = answer;
    onIce    = ice;
  }

  // ── Public API ───────────────────────────────────────────────────────────────
  return {
    getLocalStream,
    createPeerConnection,
    handleOffer,
    handleAnswer,
    handleIceCandidate,
    closePeerConnection,
    toggleMic,
    toggleCam,
    setSignalingCallbacks,
  };
})();
