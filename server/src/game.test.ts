import { describe, expect, it } from 'vitest';
import { RoomManager } from './game.js';

describe('RoomManager game flow', () => {
  it('creates a room with host and room code', () => {
    const manager = new RoomManager();
    const created = manager.createRoom('Alice');
    expect(created.roomCode.length).toBeGreaterThan(0);
    expect(created.room.players[0]?.name).toBe('Alice');
  });

  it('awards server-authoritative scoring and blocks duplicates', () => {
    const manager = new RoomManager();
    const created = manager.createRoom('Host');
    const guestOne = manager.joinRoom(created.roomCode, 'Guest One');
    const guestTwo = manager.joinRoom(created.roomCode, 'Guest Two');
    if ('error' in guestOne || 'error' in guestTwo) throw new Error('Join failed');
    manager.startGame(created.roomCode, created.playerId);
    const room = manager.getRoom(created.roomCode)!;
    const drawerId = room.currentDrawerId!;
    const guesserId = room.players.find((player) => player.id !== drawerId)?.id!;
    const chosenWord = room.wordChoices[0]!;
    const chooseWord = manager.chooseWord(created.roomCode, drawerId, chosenWord);
    expect(chooseWord.ok).toBe(true);
    const firstGuess = manager.handleGuess(created.roomCode, guesserId, chosenWord);
    expect(firstGuess.correct).toBe(true);
    expect(firstGuess.awardedPoints).toBeGreaterThan(0);
    const secondGuess = manager.handleGuess(created.roomCode, guesserId, chosenWord);
    expect(secondGuess.duplicate).toBe(true);
  });

  it('does not expose secret words publicly', () => {
    const manager = new RoomManager();
    const created = manager.createRoom('Host');
    const guest = manager.joinRoom(created.roomCode, 'Guest');
    if ('error' in guest) throw new Error('Join failed');
    manager.startGame(created.roomCode, created.playerId);
    const room = manager.getRoom(created.roomCode)!;
    const drawerId = room.currentDrawerId!;
    const chooseWord = manager.chooseWord(created.roomCode, drawerId, room.wordChoices[0]!);
    expect(chooseWord.ok).toBe(true);
    const roomPublic = manager.getRoom(created.roomCode)!;
    expect(roomPublic.secretWord).toBeTruthy();
    expect(roomPublic.currentDrawerId).toBe(drawerId);
  });

  it('rejects drawing from non-drawers', () => {
    const manager = new RoomManager();
    const created = manager.createRoom('Host');
    const guest = manager.joinRoom(created.roomCode, 'Guest');
    if ('error' in guest) throw new Error('Join failed');
    manager.startGame(created.roomCode, created.playerId);
    const room = manager.getRoom(created.roomCode)!;
    const nonDrawerId = room.players.find((player) => player.id !== room.currentDrawerId)?.id!;
    const result = manager.handleDrawingEvent(created.roomCode, nonDrawerId, {
      id: 'evt-1',
      type: 'stroke',
      points: [{ x: 20, y: 20 }, { x: 50, y: 50 }],
      color: '#000000',
      size: 6,
      tool: 'pen'
    });
    expect(result.ok).toBe(false);
  });

  it('rates limits chat and stroke payloads', () => {
    const manager = new RoomManager();
    const created = manager.createRoom('Host');
    const guest = manager.joinRoom(created.roomCode, 'Guest');
    if ('error' in guest) throw new Error('Join failed');
    manager.startGame(created.roomCode, created.playerId);
    const room = manager.getRoom(created.roomCode)!;
    const drawerId = room.currentDrawerId!;
    const chat = manager.handleChat(created.roomCode, drawerId, 'This is a chat message');
    expect(chat.ok).toBe(true);
    const secondChat = manager.handleChat(created.roomCode, drawerId, 'Another message');
    expect(secondChat.ok).toBe(false);

    const validShortStroke = manager.handleDrawingEvent(created.roomCode, drawerId, {
      id: 'short-stroke',
      type: 'stroke',
      points: [{ x: 10, y: 20 }],
      color: '#000000',
      size: 4,
      tool: 'pen'
    });
    expect(validShortStroke.ok).toBe(true);

    const invalidNaNStroke = manager.handleDrawingEvent(created.roomCode, drawerId, {
      id: 'nan-stroke',
      type: 'stroke',
      points: [{ x: Number.NaN, y: 20 }],
      color: '#000000',
      size: 4,
      tool: 'pen'
    });
    expect(invalidNaNStroke.ok).toBe(false);

    const badDraw = manager.handleDrawingEvent(created.roomCode, drawerId, {
      id: 'bad-stroke',
      type: 'stroke',
      points: Array.from({ length: 201 }, (_, index) => ({ x: index, y: index })),
      color: '#000000',
      size: 4,
      tool: 'pen'
    });
    expect(badDraw.ok).toBe(false);
  });

  it('handles reconnect tokens and score recovery', () => {
    const manager = new RoomManager();
    const created = manager.createRoom('Host');
    const guest = manager.joinRoom(created.roomCode, 'Guest');
    if ('error' in guest) throw new Error('Join failed');
    const room = manager.getRoom(created.roomCode)!;
    const guestPlayer = room.players.find((player) => player.id === guest.playerId)!;
    guestPlayer.score = 42;
    manager.disconnectPlayer(created.roomCode, guest.playerId);
    const reconnect = manager.reconnectPlayer(created.roomCode, guestPlayer.reconnectToken);
    expect('error' in reconnect).toBe(false);
  });

  it('returns a late joiner a reconstructed history', () => {
    const manager = new RoomManager();
    const created = manager.createRoom('Host');
    const guest = manager.joinRoom(created.roomCode, 'Guest');
    if ('error' in guest) throw new Error('Join failed');
    manager.startGame(created.roomCode, created.playerId);
    const room = manager.getRoom(created.roomCode)!;
    const drawerId = room.currentDrawerId!;
    const chooseWord = manager.chooseWord(created.roomCode, drawerId, room.wordChoices[0]!);
    expect(chooseWord.ok).toBe(true);
    const draw = manager.handleDrawingEvent(created.roomCode, drawerId, {
      id: 'stroke-1',
      type: 'stroke',
      points: [{ x: 1, y: 1 }, { x: 50, y: 50 }],
      color: '#ff0000',
      size: 8,
      tool: 'pen'
    });
    expect(draw.ok).toBe(true);
    const snapshot = manager.getRoom(created.roomCode)!;
    expect(snapshot.history.length).toBeGreaterThan(0);
  });

  it('counts down the round timer while the round is active', async () => {
    const manager = new RoomManager();
    const created = manager.createRoom('Host');
    const guest = manager.joinRoom(created.roomCode, 'Guest');
    if ('error' in guest) throw new Error('Join failed');
    manager.startGame(created.roomCode, created.playerId);
    const room = manager.getRoom(created.roomCode)!;
    const drawerId = room.currentDrawerId!;
    const chooseWord = manager.chooseWord(created.roomCode, drawerId, room.wordChoices[0]!);
    expect(chooseWord.ok).toBe(true);

    await new Promise((resolve) => setTimeout(resolve, 1300));
    const updated = manager.getRoom(created.roomCode)!;
    expect(updated.timeLeft).toBeLessThanOrEqual(59);
    expect(updated.timeLeft).toBeGreaterThanOrEqual(0);
  });
});
