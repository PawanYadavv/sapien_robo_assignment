import { io } from 'socket.io-client';

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

(async () => {
  const socketA = io('http://localhost:4001', { transports: ['websocket'] });
  const socketB = io('http://localhost:4001', { transports: ['websocket'] });

  const roomCodePromise = new Promise<string>((resolve) => {
    socketA.on('session', ({ roomCode }) => resolve(roomCode));
  });

  const joinPromise = new Promise<string[]>((resolve) => {
    socketB.on('room:update', ({ room }) => {
      if (room && room.players.length >= 2) resolve(room.players.map((player: { name: string }) => player.name));
    });
  });

  await wait(500);
  socketA.emit('createRoom', { playerName: 'Alice' });
  const createdRoom = await roomCodePromise;
  console.log('created-room', createdRoom);
  await wait(250);
  socketB.emit('joinRoom', { roomCode: createdRoom, playerName: 'Bob' });
  const players = await joinPromise;
  console.log('players', players);

  socketA.close();
  socketB.close();
})();
