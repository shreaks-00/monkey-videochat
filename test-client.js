const { io } = require('socket.io-client');

async function run() {
  console.log('Connecting client A...');
  const a = io('http://localhost:3000');
  
  console.log('Connecting client B...');
  const b = io('http://localhost:3000');

  a.on('connect', () => {
    console.log('A connected', a.id);
    a.emit('join-queue');
  });

  b.on('connect', () => {
    console.log('B connected', b.id);
    b.emit('join-queue');
  });

  a.on('waiting', () => console.log('A waiting'));
  b.on('waiting', () => console.log('B waiting'));

  a.on('matched', (data) => console.log('A matched', data));
  b.on('matched', (data) => console.log('B matched', data));

  a.on('offer', (data) => console.log('A received offer'));
  b.on('offer', (data) => console.log('B received offer'));

  a.on('answer', (data) => console.log('A received answer'));
  b.on('answer', (data) => console.log('B received answer'));

  // Simulate WebRTC
  a.on('matched', (data) => {
    if (data.initiator) {
      console.log('A sending offer');
      a.emit('offer', { sdp: 'fake-offer-sdp' });
    }
  });

  b.on('matched', (data) => {
    if (data.initiator) {
      console.log('B sending offer');
      b.emit('offer', { sdp: 'fake-offer-sdp' });
    }
  });

  a.on('offer', () => {
    console.log('A sending answer');
    a.emit('answer', { sdp: 'fake-answer-sdp' });
  });

  b.on('offer', () => {
    console.log('B sending answer');
    b.emit('answer', { sdp: 'fake-answer-sdp' });
  });

  setTimeout(() => {
    console.log('Test complete');
    process.exit(0);
  }, 2000);
}

run();
