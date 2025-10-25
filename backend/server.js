// backend/server.js
const http = require('http');
const { Server } = require('socket.io');

const server = http.createServer();

const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// Simple message relay for Y.js
io.on('connection', (socket) => {
  console.log('✅ Client connected:', socket.id);
  
  socket.on('join-room', (roomName) => {
    socket.join(roomName);
    console.log(`User ${socket.id} joined room: ${roomName}`);
  });
  
  // Relay Y.js sync messages between clients
  socket.on('yjs-message', ({ room, message }) => {
    socket.to(room).emit('yjs-message', message);
  });

  socket.on('disconnect', () => {
    console.log('❌ Client disconnected:', socket.id);
  });
});

const PORT = process.env.PORT || 1234;
server.listen(PORT, () => {
  console.log(`🚀 WebSocket server running on port ${PORT}`);
  console.log(`📡 Ready for real-time collaboration!`);
});
