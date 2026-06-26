# Monkey Video Chat 🐒

A modern, peer-to-peer anonymous video chat platform. Built as a sleek, lightning-fast alternative to Omegle.

## Features
- **True Peer-to-Peer:** Video and audio are sent directly between browsers using WebRTC. No video data touches the server.
- **Lightning Fast Matchmaking:** Instant connections with a strict state-machine backend.
- **Sleek Dark Mode UI:** Premium, app-like interface designed for an authentic social experience.
- **100% Anonymous:** No signups, no tracking, just click start and chat.

## Tech Stack
- **Frontend:** Vanilla JS, HTML, CSS (Zero dependencies, pure performance)
- **Backend:** Node.js, Express, Socket.IO
- **Signaling:** Custom WebRTC relay mechanism

## Running Locally

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Start the server:
   ```bash
   npm start
   ```
4. Open `http://localhost:3000` in your browser.

## Deployment
This app is ready to be deployed on platforms like **Render**, **Railway**, or **Heroku**. 
It dynamically binds to `process.env.PORT` and Socket.IO dynamically connects to the window origin.
