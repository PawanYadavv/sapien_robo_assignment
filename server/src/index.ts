import cors from 'cors';
import express from 'express';
import http from 'node:http';
import { Server } from 'socket.io';
import { RoomManager, roomPublicState } from './game.js';

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const roomManager = new RoomManager();

app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ ok: true, status: 'healthy' });
});

app.get('/api/rooms/:code', (req, res) => {
  const room = roomManager.getRoom(req.params.code);
  if (!room) {
    return res.status(404).json({ error: 'Room not found.' });
  }
  return res.json(roomPublicState(room));
});

io.on('connection', (socket) => {
  socket.on('createRoom', ({ playerName }) => {
    const created = roomManager.createRoom(String(playerName ?? 'Host'));
    const room = roomManager.getRoom(created.roomCode);
    if (!room) {
      socket.emit('error', { message: 'Unable to create room.' });
      return;
    }

    socket.data.roomCode = created.roomCode;
    socket.data.playerId = created.playerId;
    socket.join(created.roomCode);
    socket.emit('session', {
      playerId: created.playerId,
      reconnectToken: created.reconnectToken,
      roomCode: created.roomCode
    });
    io.to(created.roomCode).emit('room:update', {
      playerId: created.playerId,
      room: roomPublicState(room)
    });
  });

  socket.on('joinRoom', ({ roomCode, playerName, reconnectToken }) => {
    const result = roomManager.joinRoom(String(roomCode ?? ''), String(playerName ?? 'Player'), reconnectToken ? String(reconnectToken) : undefined);
    if ('error' in result) {
      socket.emit('error', { message: result.error });
      return;
    }

    socket.data.roomCode = String(roomCode);
    socket.data.playerId = result.playerId;
    socket.join(String(roomCode));
    socket.emit('session', {
      playerId: result.playerId,
      reconnectToken: result.reconnectToken,
      roomCode: String(roomCode)
    });

    const room = roomManager.getRoom(String(roomCode));
    if (room) {
      io.to(String(roomCode)).emit('room:update', {
        playerId: result.playerId,
        room: roomPublicState(room)
      });
    }

    if (result.reconnecting) {
      socket.emit('notification', { message: 'Reconnected to room.' });
    }
  });

  socket.on('updateConfig', ({ roomCode, config }) => {
    const roomCodeValue = String(roomCode ?? '');
    const playerId = String(socket.data.playerId ?? '');
    const result = roomManager.updateConfig(roomCodeValue, playerId, config ?? {});
    if (!result.ok) {
      socket.emit('error', { message: result.error });
      return;
    }
    const room = roomManager.getRoom(roomCodeValue);
    if (room) {
      io.to(roomCodeValue).emit('room:update', { playerId, room: roomPublicState(room) });
    }
  });

  socket.on('startGame', ({ roomCode }) => {
    const roomCodeValue = String(roomCode ?? '');
    const playerId = String(socket.data.playerId ?? '');
    const result = roomManager.startGame(roomCodeValue, playerId);
    if (!result.ok) {
      socket.emit('error', { message: result.error });
      return;
    }

    const room = roomManager.getRoom(roomCodeValue);
    if (!room) return;

    const drawerId = room.currentDrawerId;
    if (drawerId) {
      const drawerSocket = Array.from(io.sockets.sockets.values()).find((socketEntry) => String((socketEntry as any).data.playerId) === String(drawerId));
      if (drawerSocket) {
        drawerSocket.emit('private:wordChoices', {
          roomCode: roomCodeValue,
          wordChoices: room.wordChoices
        });
      }
    }

    io.to(roomCodeValue).emit('room:update', { playerId, room: roomPublicState(room) });
  });

  socket.on('selectWord', ({ roomCode, word }) => {
    const roomCodeValue = String(roomCode ?? '');
    const playerId = String(socket.data.playerId ?? '');
    const result = roomManager.chooseWord(roomCodeValue, playerId, String(word ?? ''), (updatedRoom) => {
      io.to(roomCodeValue).emit('room:update', {
        playerId: updatedRoom.currentDrawerId ?? updatedRoom.hostPlayerId,
        room: roomPublicState(updatedRoom)
      });
    });
    if (!result.ok) {
      socket.emit('error', { message: result.error });
      return;
    }
    const room = roomManager.getRoom(roomCodeValue);
    if (room) {
      io.to(roomCodeValue).emit('room:update', { playerId, room: roomPublicState(room) });
    }
  });

  socket.on('chat:send', ({ roomCode, text }) => {
    const roomCodeValue = String(roomCode ?? '');
    const playerId = String(socket.data.playerId ?? '');
    const result = roomManager.handleChat(roomCodeValue, playerId, String(text ?? ''));
    if (!result.ok) {
      socket.emit('error', { message: result.error });
      return;
    }
    const room = roomManager.getRoom(roomCodeValue);
    if (room) {
      io.to(roomCodeValue).emit('room:update', { playerId, room: roomPublicState(room) });
    }
  });

  socket.on('guess', ({ roomCode, guess }) => {
    const roomCodeValue = String(roomCode ?? '');
    const playerId = String(socket.data.playerId ?? '');
    const result = roomManager.handleGuess(roomCodeValue, playerId, String(guess ?? ''));
    socket.emit('guess:result', result);
    if (result.close) {
      socket.emit('private:feedback', { message: 'close!' });
    }
    const room = roomManager.getRoom(roomCodeValue);
    if (room) {
      io.to(roomCodeValue).emit('room:update', { playerId, room: roomPublicState(room) });
    }
  });

  socket.on('draw:event', ({ roomCode, event }) => {
    const roomCodeValue = String(roomCode ?? '');
    const playerId = String(socket.data.playerId ?? '');
    const result = roomManager.handleDrawingEvent(roomCodeValue, playerId, event ?? {});
    if (!result.ok) {
      socket.emit('error', { message: result.error });
      return;
    }

    const room = roomManager.getRoom(roomCodeValue);
    if (room) {
      io.to(roomCodeValue).emit('draw:history', { roomCode: roomCodeValue, history: room.history });
      io.to(roomCodeValue).emit('room:update', { playerId, room: roomPublicState(room) });
    }
  });

  socket.on('reconnectPlayer', ({ roomCode, reconnectToken }) => {
    const roomCodeValue = String(roomCode ?? '');
    const token = String(reconnectToken ?? '');
    const result = roomManager.reconnectPlayer(roomCodeValue, token);
    if ('error' in result) {
      socket.emit('error', { message: result.error });
      return;
    }

    socket.data.roomCode = roomCodeValue;
    socket.data.playerId = result.playerId;
    socket.join(roomCodeValue);
    const room = roomManager.getRoom(roomCodeValue);
    if (room) {
      socket.emit('session', {
        playerId: result.playerId,
        reconnectToken: result.reconnectToken,
        roomCode: roomCodeValue
      });
      socket.emit('draw:history', { roomCode: roomCodeValue, history: room.history });
      io.to(roomCodeValue).emit('room:update', { playerId: result.playerId, room: roomPublicState(room) });
    }
  });

  socket.on('disconnect', () => {
    const roomCode = String(socket.data.roomCode ?? '');
    const playerId = String(socket.data.playerId ?? '');
    if (!roomCode || !playerId) return;
    const result = roomManager.disconnectPlayer(roomCode, playerId);
    if (result.ok) {
      const room = roomManager.getRoom(roomCode);
      if (room) {
        io.to(roomCode).emit('room:update', { playerId, room: roomPublicState(room) });
      }
    }
  });
});

const PORT = Number(process.env.PORT || 4001);
server.listen(PORT, () => {
  console.log(`Sketch server listening on http://localhost:${PORT}`);
});
