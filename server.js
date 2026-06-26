/**
 * server.js — Random Video Chat Backend
 *
 * Handles:
 *  - Serving static files from /public
 *  - Strict state-machine matchmaking
 *  - WebRTC signaling relay
 *  - Skip logic, disconnect cleanup, and atomic room management
 */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
  pingTimeout: 60000,
});

// ─── State Definitions ────────────────────────────────────────────────────────

const UserState = {
  IDLE: 'idle',
  WAITING: 'waiting',
  CONNECTING: 'connecting',
  CONNECTED: 'connected',
  SKIPPING: 'skipping',
  DISCONNECTED: 'disconnected'
};

const MAX_RECENT_PARTNERS = 3;

/**
 * users: Map of socketId -> User object
 * {
 *   socketId: string,
 *   state: string (UserState),
 *   roomId: string | null,
 *   recentPartners: string[] (array of socketIds)
 * }
 */
const users = new Map();

/**
 * rooms: Map of roomId -> Room object
 * {
 *   roomId: string,
 *   user1: string (socketId),
 *   user2: string (socketId)
 * }
 */
const rooms = new Map();

/** Array of socketIds waiting for a match (FIFO) */
let waitingQueue = [];

// ─── Core Helpers ─────────────────────────────────────────────────────────────

function getUser(socketId) {
  return users.get(socketId);
}

function getRoom(roomId) {
  return rooms.get(roomId);
}

function removeFromQueue(socketId) {
  const index = waitingQueue.indexOf(socketId);
  if (index !== -1) {
    waitingQueue.splice(index, 1);
  }
}

function addToQueue(socketId) {
  // Ensure no duplicates
  removeFromQueue(socketId);
  
  const user = getUser(socketId);
  if (!user || user.state === UserState.DISCONNECTED || user.state === UserState.CONNECTED || user.state === UserState.CONNECTING) {
    return; // Don't queue invalid states
  }
  
  waitingQueue.push(socketId);
}

function destroyRoom(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;
  
  const user1 = getUser(room.user1);
  const user2 = getUser(room.user2);
  
  if (user1) user1.roomId = null;
  if (user2) user2.roomId = null;
  
  rooms.delete(roomId);
}

function addRecentPartner(user, partnerId) {
  if (!user) return;
  user.recentPartners = user.recentPartners.filter(id => id !== partnerId); // Remove if exists
  user.recentPartners.push(partnerId);
  if (user.recentPartners.length > MAX_RECENT_PARTNERS) {
    user.recentPartners.shift(); // Keep only the last MAX_RECENT_PARTNERS
  }
}

// ─── Matchmaking Engine ───────────────────────────────────────────────────────

function tryMatch(socketId) {
  const user = getUser(socketId);
  
  // If user is gone, or not waiting/skipping/idle, ignore
  // tryMatch is typically called when they want to match. Their state should be WAITING.
  if (!user || user.state === UserState.DISCONNECTED || user.state === UserState.CONNECTING || user.state === UserState.CONNECTED) {
    return;
  }
  
  user.state = UserState.WAITING;
  
  // Remove self from queue temporarily to search
  removeFromQueue(socketId);

  // Clean the queue of any invalid users before searching
  waitingQueue = waitingQueue.filter(id => {
    const u = getUser(id);
    return u && u.state === UserState.WAITING;
  });

  if (waitingQueue.length > 0) {
    // 1. Try to find a non-recent partner
    let matchIndex = -1;
    for (let i = 0; i < waitingQueue.length; i++) {
      const potentialPartnerId = waitingQueue[i];
      const potentialPartner = getUser(potentialPartnerId);
      
      const userHasPartner = user.recentPartners.includes(potentialPartnerId);
      const partnerHasUser = potentialPartner && potentialPartner.recentPartners.includes(socketId);
      
      if (!userHasPartner && !partnerHasUser) {
        matchIndex = i;
        break;
      }
    }
    
    // 2. If no non-recent partner found, fallback to the oldest person in queue (first element)
    if (matchIndex === -1) {
      matchIndex = 0;
    }
    
    const partnerId = waitingQueue[matchIndex];
    const partner = getUser(partnerId);
    
    // Safety check
    if (!partner || partner.state !== UserState.WAITING) {
      // Partner disappeared or invalid, put user back in queue and retry
      addToQueue(socketId);
      return; 
    }
    
    // Remove partner from queue
    waitingQueue.splice(matchIndex, 1);
    
    // Pair them up
    const roomId = crypto.randomUUID();
    
    rooms.set(roomId, {
      roomId,
      user1: socketId,
      user2: partnerId
    });
    
    user.roomId = roomId;
    user.state = UserState.CONNECTING;
    
    partner.roomId = roomId;
    partner.state = UserState.CONNECTING;
    
    // Notify clients
    const socket = io.sockets.sockets.get(socketId);
    const partnerSocket = io.sockets.sockets.get(partnerId);
    
    if (socket) socket.emit('matched', { initiator: true, partnerId });
    if (partnerSocket) partnerSocket.emit('matched', { initiator: false, partnerId: socketId });
    
    console.log(`[MATCH] Room ${roomId} created for ${socketId} ↔ ${partnerId}`);
  } else {
    // Nobody available, join queue
    addToQueue(socketId);
    const socket = io.sockets.sockets.get(socketId);
    if (socket) socket.emit('waiting');
    console.log(`[QUEUE] ${socketId} is waiting (queue length: ${waitingQueue.length})`);
  }
}

// ─── Socket.IO Events ─────────────────────────────────────────────────────────

io.on('connection', (socket) => {
  console.log(`[CONNECT] ${socket.id}`);
  
  // Initialize user state
  users.set(socket.id, {
    socketId: socket.id,
    state: UserState.IDLE,
    roomId: null,
    recentPartners: []
  });

  // ── Join Queue ──────────────────────────────────────────────────────────────
  socket.on('join-queue', () => {
    console.log(`[JOIN-QUEUE] ${socket.id}`);
    const user = getUser(socket.id);
    if (!user) return;
    
    // Clean up if they were already in a room
    if (user.roomId) {
      handleSkipOrDisconnect(socket.id, true);
    }
    
    user.state = UserState.WAITING;
    tryMatch(socket.id);
  });

  // ── Skip (Next) ─────────────────────────────────────────────────────────────
  socket.on('next', () => {
    console.log(`[NEXT] ${socket.id}`);
    handleSkipOrDisconnect(socket.id, true);
  });

  // ── End Session ─────────────────────────────────────────────────────────────
  socket.on('end-session', () => {
    console.log(`[END-SESSION] ${socket.id}`);
    handleSkipOrDisconnect(socket.id, false);
    
    // Requester becomes idle
    const user = getUser(socket.id);
    if (user) {
      user.state = UserState.IDLE;
    }
  });

  // ── Disconnect ──────────────────────────────────────────────────────────────
  socket.on('disconnect', () => {
    console.log(`[DISCONNECT] ${socket.id}`);
    const user = getUser(socket.id);
    if (user) {
      user.state = UserState.DISCONNECTED;
      handleSkipOrDisconnect(socket.id, false);
      users.delete(socket.id);
    }
  });

  // ── Helper for Skip/Disconnect/End ──────────────────────────────────────────
  /**
   * Handles room destruction, partner notification, and re-queuing.
   * @param {string} socketId 
   * @param {boolean} requeueSelf If true, user re-enters matchmaking (skip)
   * @returns {string|null} partnerId if there was one
   */
  function handleSkipOrDisconnect(socketId, requeueSelf) {
    const user = getUser(socketId);
    if (!user) return null;
    
    if (requeueSelf) {
      user.state = UserState.SKIPPING;
    }
    
    removeFromQueue(socketId);
    
    let partnerIdToRequeue = null;
    
    if (user.roomId) {
      const room = getRoom(user.roomId);
      if (room) {
        const partnerId = room.user1 === socketId ? room.user2 : room.user1;
        const partner = getUser(partnerId);
        
        // Update recent partners to avoid immediate rematch
        addRecentPartner(user, partnerId);
        if (partner) {
          addRecentPartner(partner, socketId);
        }
        
        destroyRoom(user.roomId); // This sets both users' roomId to null
        
        if (partner && partner.state !== UserState.DISCONNECTED) {
          partner.state = UserState.WAITING;
          partnerIdToRequeue = partnerId;
          const partnerSocket = io.sockets.sockets.get(partnerId);
          if (partnerSocket) {
            partnerSocket.emit('peer-disconnected');
          }
        }
      }
    }
    
    // Re-queue partner
    if (partnerIdToRequeue) {
      tryMatch(partnerIdToRequeue);
    }
    
    // Re-queue self
    if (requeueSelf && user.state !== UserState.DISCONNECTED) {
      tryMatch(socketId);
    }
    
    return partnerIdToRequeue;
  }

  // ── WebRTC Signaling & Chat ─────────────────────────────────────────────────
  
  function relayToPartner(eventName, data) {
    const user = getUser(socket.id);
    if (!user || !user.roomId) return;
    
    const room = getRoom(user.roomId);
    if (!room) return;
    
    const partnerId = room.user1 === socket.id ? room.user2 : room.user1;
    const partnerSocket = io.sockets.sockets.get(partnerId);
    
    if (partnerSocket) {
      partnerSocket.emit(eventName, data);
    }
  }

  socket.on('offer', (data) => {
    relayToPartner('offer', { sdp: data.sdp, from: socket.id });
  });

  socket.on('answer', (data) => {
    // When an answer is sent, it implies connection is being established
    const user = getUser(socket.id);
    if (user && user.state === UserState.CONNECTING) {
      user.state = UserState.CONNECTED;
      // Note: we could also set partner to CONNECTED here, but their client
      // handles the UI state. We just keep our server state consistent.
      const room = getRoom(user.roomId);
      if (room) {
        const partner = getUser(room.user1 === socket.id ? room.user2 : room.user1);
        if (partner && partner.state === UserState.CONNECTING) {
          partner.state = UserState.CONNECTED;
        }
      }
    }
    relayToPartner('answer', { sdp: data.sdp, from: socket.id });
  });

  socket.on('ice-candidate', (data) => {
    relayToPartner('ice-candidate', { candidate: data.candidate, from: socket.id });
  });

  socket.on('chat-message', (data) => {
    relayToPartner('chat-message', { message: data.message });
  });
});

// ─── Static Files ─────────────────────────────────────────────────────────────

app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

// ─── Start Server ─────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n🚀 Random Video Chat running at http://localhost:${PORT}\n`);
});
