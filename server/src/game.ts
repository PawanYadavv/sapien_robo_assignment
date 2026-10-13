export type Player = {
  id: string;
  name: string;
  score: number;
  connected: boolean;
  reconnectToken: string;
  isHost: boolean;
  guessed: boolean;
  lastChatAt: number;
  lastDrawAt: number;
  disconnectAt: number | null;
};

export type RoomConfig = {
  roundCount: number;
  drawingTime: number;
  words: string[];
};

export type ChatMessage = {
  id: string;
  playerId: string;
  playerName: string;
  text: string;
  type: 'system' | 'chat';
  createdAt: number;
};

export type Point = {
  x: number;
  y: number;
};

export type DrawingEvent = {
  id: string;
  seq: number;
  type: 'stroke' | 'fill' | 'clear' | 'undo';
  tool?: 'pen' | 'eraser';
  color?: string;
  size?: number;
  fillColor?: string;
  points?: Point[];
  createdAt: number;
};

export type RoomState = {
  code: string;
  hostPlayerId: string;
  players: Player[];
  config: RoomConfig;
  status: 'lobby' | 'playing' | 'finished';
  currentDrawerId: string | null;
  roundNumber: number;
  totalRounds: number;
  timeLeft: number;
  secretWord: string | null;
  wordChoices: string[];
  messages: ChatMessage[];
  history: DrawingEvent[];
  nextSequence: number;
  roundStartedAt: number | null;
  endsAt: number | null;
  winnerId: string | null;
};

export type JoinResult = {
  room: RoomState;
  playerId: string;
  reconnectToken: string;
  reconnecting: boolean;
};

export type GuessResult = {
  correct: boolean;
  duplicate: boolean;
  close: boolean;
  awardedPoints: number;
  drawerPoints: number;
  reason: 'correct' | 'wrong' | 'duplicate' | 'drawer' | 'inactive';
  message: string;
  winner: boolean;
};

const DEFAULT_WORDS = [
  'planet',
  'guitar',
  'castle',
  'rocket',
  'telescope',
  'rainbow',
  'diamond',
  'beach',
  'forest',
  'train'
];

const createId = () => Math.random().toString(36).slice(2, 10);
const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const normalize = (value: string) => value.trim().toLowerCase().replace(/\s+/g, ' ');

const levenshtein = (a: string, b: string) => {
  const dp = Array.from({ length: b.length + 1 }, () => Array(a.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) dp[0][i] = i;
  for (let j = 0; j <= b.length; j++) dp[j][0] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      const cost = a[j - 1] === b[i - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }
  return dp[b.length][a.length];
};

const getRandomWords = (pool: string[], amount = 3) => {
  const shuffled = [...pool].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, Math.min(amount, shuffled.length));
};

const nextPlayerIndex = (players: Player[], currentId: string | null) => {
  if (!players.length) return 0;
  if (!currentId) return 0;
  const index = players.findIndex((player) => player.id === currentId);
  return index >= 0 ? (index + 1) % players.length : 0;
};

export class RoomManager {
  private rooms = new Map<string, RoomState>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();

  createRoom(hostName: string): { roomCode: string; room: RoomState; playerId: string; reconnectToken: string } {
    const roomCode = createId().slice(0, 5).toUpperCase();
    const playerId = createId();
    const reconnectToken = createId();
    const room: RoomState = {
      code: roomCode,
      hostPlayerId: playerId,
      players: [
        {
          id: playerId,
          name: hostName || 'Host',
          score: 0,
          connected: true,
          reconnectToken,
          isHost: true,
          guessed: false,
          lastChatAt: 0,
          lastDrawAt: 0,
          disconnectAt: null
        }
      ],
      config: {
        roundCount: 3,
        drawingTime: 60,
        words: DEFAULT_WORDS
      },
      status: 'lobby',
      currentDrawerId: null,
      roundNumber: 0,
      totalRounds: 3,
      timeLeft: 0,
      secretWord: null,
      wordChoices: [],
      messages: [
        {
          id: createId(),
          playerId: '__system__',
          playerName: 'System',
          text: 'Room created. Share the room code or URL with friends.',
          type: 'system',
          createdAt: Date.now()
        }
      ],
      history: [],
      nextSequence: 1,
      roundStartedAt: null,
      endsAt: null,
      winnerId: null
    };

    this.rooms.set(roomCode, room);
    return { roomCode, room, playerId, reconnectToken };
  }

  joinRoom(roomCode: string, playerName: string, reconnectToken?: string): JoinResult | { error: string } {
    const room = this.rooms.get(roomCode);
    if (!room) {
      return { error: 'Room not found.' };
    }

    const existingPlayer = reconnectToken
      ? room.players.find((player) => player.reconnectToken === reconnectToken)
      : undefined;

    if (existingPlayer) {
      existingPlayer.connected = true;
      existingPlayer.disconnectAt = null;
      existingPlayer.name = playerName || existingPlayer.name;
      this.cancelTimer(room.code);
      return {
        room: this.getRoomSnapshot(room),
        playerId: existingPlayer.id,
        reconnectToken: existingPlayer.reconnectToken,
        reconnecting: true
      };
    }

    if (room.players.length >= 8) {
      return { error: 'Room is full.' };
    }

    const playerId = createId();
    const token = createId();
    const player: Player = {
      id: playerId,
      name: playerName || `Player ${room.players.length + 1}`,
      score: 0,
      connected: true,
      reconnectToken: token,
      isHost: false,
      guessed: false,
      lastChatAt: 0,
      lastDrawAt: 0,
      disconnectAt: null
    };

    room.players.push(player);
    room.messages.push({
      id: createId(),
      playerId: '__system__',
      playerName: 'System',
      text: `${player.name} joined the room.`,
      type: 'system',
      createdAt: Date.now()
    });

    return {
      room: this.getRoomSnapshot(room),
      playerId,
      reconnectToken: token,
      reconnecting: false
    };
  }

  reconnectPlayer(roomCode: string, reconnectToken: string): JoinResult | { error: string } {
    const room = this.rooms.get(roomCode);
    if (!room) return { error: 'Room not found.' };
    const player = room.players.find((entry) => entry.reconnectToken === reconnectToken);
    if (!player) return { error: 'Reconnect token not valid.' };
    if (player.disconnectAt && Date.now() - player.disconnectAt > 30_000) {
      return { error: 'Reconnect window expired.' };
    }
    player.connected = true;
    player.disconnectAt = null;
    return { room: this.getRoomSnapshot(room), playerId: player.id, reconnectToken, reconnecting: true };
  }

  updateConfig(roomCode: string, hostId: string, config: Partial<RoomConfig>): { ok: boolean; room?: RoomState; error?: string } {
    const room = this.rooms.get(roomCode);
    if (!room) return { ok: false, error: 'Room not found.' };
    if (room.hostPlayerId !== hostId) return { ok: false, error: 'Only the host can change room settings.' };
    if (room.status === 'playing') return { ok: false, error: 'Game is already in progress.' };

    const validated = {
      roundCount: clamp(Number(config.roundCount) || 3, 1, 10),
      drawingTime: clamp(Number(config.drawingTime) || 60, 20, 180),
      words: Array.isArray(config.words) && config.words.length ? config.words.map((word) => String(word).trim()).filter(Boolean).slice(0, 12) : DEFAULT_WORDS
    };

    room.config = validated;
    room.totalRounds = validated.roundCount;
    return { ok: true, room: this.getRoomSnapshot(room) };
  }

  startGame(roomCode: string, hostId: string): { ok: boolean; room?: RoomState; error?: string } {
    const room = this.rooms.get(roomCode);
    if (!room) return { ok: false, error: 'Room not found.' };
    if (room.hostPlayerId !== hostId) return { ok: false, error: 'Only the host can start the game.' };
    if (room.players.filter((player) => player.connected).length < 2) {
      return { ok: false, error: 'Two or more active players are required.' };
    }

    room.status = 'playing';
    room.roundNumber = 1;
    room.secretWord = null;
    room.currentDrawerId = room.players[0]?.id ?? null;
    room.timeLeft = room.config.drawingTime;
    room.roundStartedAt = Date.now();
    room.endsAt = null;
    room.winnerId = null;
    room.wordChoices = this.getWordChoices(room);
    room.messages.push({
      id: createId(),
      playerId: '__system__',
      playerName: 'System',
      text: `${this.getPlayerName(room, room.currentDrawerId)} is drawing.`,
      type: 'system',
      createdAt: Date.now()
    });

    for (const player of room.players) {
      player.guessed = false;
    }

    return { ok: true, room: this.getRoomSnapshot(room) };
  }

  chooseWord(roomCode: string, playerId: string, word: string, onTick?: (room: RoomState) => void): { ok: boolean; room?: RoomState; error?: string } {
    const room = this.rooms.get(roomCode);
    if (!room) return { ok: false, error: 'Room not found.' };
    if (room.currentDrawerId !== playerId) return { ok: false, error: 'Only the drawer can choose a word.' };
    const normalizedChoice = normalize(word);
    if (!room.wordChoices.some((choice) => normalize(choice) === normalizedChoice)) {
      return { ok: false, error: 'That word is not available for this round.' };
    }

    room.secretWord = normalizedChoice;
    room.roundStartedAt = Date.now();
    room.endsAt = room.roundStartedAt + room.config.drawingTime * 1000;
    room.timeLeft = room.config.drawingTime;
    room.messages.push({
      id: createId(),
      playerId: '__system__',
      playerName: 'System',
      text: `${this.getPlayerName(room, playerId)} picked a word.`,
      type: 'system',
      createdAt: Date.now()
    });

    this.startTimer(room.code, onTick);
    return { ok: true, room: this.getRoomSnapshot(room) };
  }

  handleChat(roomCode: string, playerId: string, message: string): { ok: boolean; room?: RoomState; error?: string } {
    const room = this.rooms.get(roomCode);
    if (!room) return { ok: false, error: 'Room not found.' };
    const player = room.players.find((entry) => entry.id === playerId);
    if (!player) return { ok: false, error: 'Unknown player.' };
    const cleanMessage = String(message ?? '').slice(0, 180);
    if (!cleanMessage.trim()) return { ok: false, error: 'Empty messages are not allowed.' };
    if (Date.now() - player.lastChatAt < 650) return { ok: false, error: 'Rate limit reached. Please wait a moment.' };
    if (room.secretWord && normalize(cleanMessage).includes(normalize(room.secretWord))) {
      return { ok: false, error: 'Secret words are not allowed in chat.' };
    }
    if (player.guessed && room.secretWord && normalize(cleanMessage).includes(normalize(room.secretWord))) {
      return { ok: false, error: 'You already guessed correctly; do not reveal the word.' };
    }

    player.lastChatAt = Date.now();
    room.messages.push({
      id: createId(),
      playerId,
      playerName: player.name,
      text: cleanMessage,
      type: 'chat',
      createdAt: Date.now()
    });

    return { ok: true, room: this.getRoomSnapshot(room) };
  }

  handleGuess(roomCode: string, playerId: string, guess: string): GuessResult {
    const room = this.rooms.get(roomCode);
    if (!room) {
      return { correct: false, duplicate: false, close: false, awardedPoints: 0, drawerPoints: 0, reason: 'inactive', message: 'Room not found.', winner: false };
    }

    const player = room.players.find((entry) => entry.id === playerId);
    if (!player) {
      return { correct: false, duplicate: false, close: false, awardedPoints: 0, drawerPoints: 0, reason: 'inactive', message: 'Unknown player.', winner: false };
    }
    if (room.currentDrawerId === playerId) {
      return { correct: false, duplicate: false, close: false, awardedPoints: 0, drawerPoints: 0, reason: 'drawer', message: 'The drawer cannot guess.', winner: false };
    }
    if (!room.secretWord || room.status !== 'playing') {
      return { correct: false, duplicate: false, close: false, awardedPoints: 0, drawerPoints: 0, reason: 'inactive', message: 'No active round.', winner: false };
    }

    const answer = normalize(String(guess));
    if (!answer) {
      return { correct: false, duplicate: false, close: false, awardedPoints: 0, drawerPoints: 0, reason: 'wrong', message: '', winner: false };
    }

    if (player.guessed) {
      return { correct: false, duplicate: true, close: false, awardedPoints: 0, drawerPoints: 0, reason: 'duplicate', message: 'You already guessed correctly.', winner: false };
    }

    if (answer === normalize(room.secretWord)) {
      player.guessed = true;
      const timeUsed = room.roundStartedAt ? (Date.now() - room.roundStartedAt) / 1000 : 0;
      const base = 120 - Math.min(100, Math.floor(timeUsed * 2));
      const score = Math.max(40, base + room.players.length * 10);
      const drawer = room.players.find((entry) => entry.id === room.currentDrawerId);
      const drawerBonus = Math.max(20, 25 + room.players.length * 8);
      player.score += score;
      if (drawer) drawer.score += drawerBonus;
      room.messages.push({
        id: createId(),
        playerId: '__system__',
        playerName: 'System',
        text: `${player.name} guessed the word!`,
        type: 'system',
        createdAt: Date.now()
      });

      const allGuessed = room.players.filter((entry) => entry.connected && entry.id !== room.currentDrawerId).every((entry) => entry.guessed || entry.id === player.id);
      if (allGuessed) {
        this.finishRound(room.code, 'all-guessed');
      }

      return {
        correct: true,
        duplicate: false,
        close: false,
        awardedPoints: score,
        drawerPoints: drawerBonus,
        reason: 'correct',
        message: 'Correct!',
        winner: allGuessed
      };
    }

    const closeEnough = levenshtein(answer, normalize(room.secretWord)) <= 1;
    if (closeEnough) {
      return { correct: false, duplicate: false, close: true, awardedPoints: 0, drawerPoints: 0, reason: 'wrong', message: 'close!', winner: false };
    }

    return { correct: false, duplicate: false, close: false, awardedPoints: 0, drawerPoints: 0, reason: 'wrong', message: 'Nope.', winner: false };
  }

  handleDrawingEvent(roomCode: string, playerId: string, event: Partial<DrawingEvent>): { ok: boolean; room?: RoomState; error?: string } {
    const room = this.rooms.get(roomCode);
    if (!room) return { ok: false, error: 'Room not found.' };
    if (room.currentDrawerId !== playerId) return { ok: false, error: 'Only the drawer can draw.' };
    if (room.status !== 'playing') return { ok: false, error: 'No active draw phase.' };

    const player = room.players.find((entry) => entry.id === playerId);
    if (!player) return { ok: false, error: 'Unknown player.' };
    if (Date.now() - player.lastDrawAt < 35) return { ok: false, error: 'Drawing rate limit reached.' };

    const rawPoints = Array.isArray(event.points)
      ? event.points.map((point) => ({ x: Number(point?.x ?? 0), y: Number(point?.y ?? 0) }))
      : [];

    const normalizedEvent: DrawingEvent = {
      id: String(event.id ?? createId()),
      seq: room.nextSequence++,
      type: event.type === 'fill' || event.type === 'clear' || event.type === 'undo' ? event.type : 'stroke',
      tool: event.tool === 'eraser' ? 'eraser' : 'pen',
      color: String(event.color ?? '#111827'),
      size: Number(event.size ?? 4),
      fillColor: event.fillColor ? String(event.fillColor) : undefined,
      points: rawPoints,
      createdAt: Date.now()
    };

    if (normalizedEvent.type === 'stroke') {
      const normalizedPoints = rawPoints
        .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
        .map((point) => ({
          x: clamp(point.x, 0, 900),
          y: clamp(point.y, 0, 520)
        }));

      if (normalizedPoints.length === 0 || normalizedPoints.length > 200) {
        return { ok: false, error: 'Stroke payload is invalid.' };
      }
      normalizedEvent.points = normalizedPoints;
    }

    room.history.push(normalizedEvent);
    player.lastDrawAt = Date.now();
    return { ok: true, room: this.getRoomSnapshot(room) };
  }

  leaveRoom(roomCode: string, playerId: string): { ok: boolean; room?: RoomState; error?: string } {
    const room = this.rooms.get(roomCode);
    if (!room) return { ok: false, error: 'Room not found.' };
    const player = room.players.find((entry) => entry.id === playerId);
    if (!player) return { ok: false, error: 'Player not found.' };

    if (player.isHost) {
      this.cleanupRoom(roomCode);
      return { ok: true, room: this.getRoomSnapshot(room) };
    }

    room.players = room.players.filter((entry) => entry.id !== playerId);
    room.messages.push({
      id: createId(),
      playerId: '__system__',
      playerName: 'System',
      text: `${player.name} left the room.`,
      type: 'system',
      createdAt: Date.now()
    });

    if (room.currentDrawerId === playerId && room.status === 'playing') {
      this.finishRound(room.code, 'drawer-disconnected');
    }
    if (room.players.length === 0) {
      this.cleanupRoom(roomCode);
    }
    return { ok: true, room: this.getRoomSnapshot(room) };
  }

  disconnectPlayer(roomCode: string, playerId: string): { ok: boolean; room?: RoomState; error?: string } {
    const room = this.rooms.get(roomCode);
    if (!room) return { ok: false, error: 'Room not found.' };
    const player = room.players.find((entry) => entry.id === playerId);
    if (!player) return { ok: false, error: 'Player not found.' };
    player.connected = false;
    player.disconnectAt = Date.now();
    if (room.currentDrawerId === playerId && room.status === 'playing') {
      this.finishRound(room.code, 'drawer-disconnected');
    }
    return { ok: true, room: this.getRoomSnapshot(room) };
  }

  cleanupRoom(roomCode: string) {
    this.cancelTimer(roomCode);
    this.rooms.delete(roomCode);
  }

  getRoomSnapshot(room: RoomState): RoomState {
    return {
      ...room,
      players: room.players.map((player) => ({ ...player })),
      messages: [...room.messages],
      history: [...room.history],
      wordChoices: [...room.wordChoices],
      config: { ...room.config, words: [...room.config.words] }
    };
  }

  getRoom(roomCode: string): RoomState | undefined {
    const room = this.rooms.get(roomCode);
    return room ? this.getRoomSnapshot(room) : undefined;
  }

  private startTimer(roomCode: string, onTick?: (room: RoomState) => void) {
    this.cancelTimer(roomCode);
    const room = this.rooms.get(roomCode);
    if (!room) return;

    const interval = setInterval(() => {
      const activeRoom = this.rooms.get(roomCode);
      if (!activeRoom || activeRoom.status !== 'playing' || !activeRoom.endsAt) {
        this.cancelTimer(roomCode);
        return;
      }

      const remainingSeconds = Math.max(0, Math.ceil((activeRoom.endsAt - Date.now()) / 1000));
      activeRoom.timeLeft = remainingSeconds;
      onTick?.(this.getRoomSnapshot(activeRoom));

      if (remainingSeconds <= 0) {
        this.finishRound(roomCode, 'timeout');
        const nextRoom = this.rooms.get(roomCode);
        if (nextRoom) {
          onTick?.(this.getRoomSnapshot(nextRoom));
        }
      }
    }, 250);

    this.timers.set(roomCode, interval);
  }

  private cancelTimer(roomCode: string) {
    const timer = this.timers.get(roomCode);
    if (timer) {
      clearInterval(timer);
      this.timers.delete(roomCode);
    }
  }

  private finishRound(roomCode: string, reason: 'timeout' | 'all-guessed' | 'drawer-disconnected') {
    const room = this.rooms.get(roomCode);
    if (!room || room.status !== 'playing') return;
    this.cancelTimer(roomCode);
    room.status = 'lobby';
    room.secretWord = null;
    room.wordChoices = [];
    room.endsAt = null;
    room.timeLeft = 0;

    const nextRoundNumber = room.roundNumber + 1;
    if (nextRoundNumber > room.totalRounds) {
      room.status = 'finished';
      room.roundNumber = room.totalRounds;
      room.winnerId = this.getWinner(room)?.id ?? null;
      room.messages.push({
        id: createId(),
        playerId: '__system__',
        playerName: 'System',
        text: 'Game finished. Final scores are locked in.',
        type: 'system',
        createdAt: Date.now()
      });
      return;
    }

    room.roundNumber = nextRoundNumber;
    const activePlayers = room.players.filter((player) => player.connected);
    const currentIndex = activePlayers.findIndex((player) => player.id === room.currentDrawerId);
    const nextDrawer = activePlayers[(currentIndex + 1) % activePlayers.length] ?? activePlayers[0];
    room.currentDrawerId = nextDrawer?.id ?? room.players[0]?.id ?? null;
    room.messages.push({
      id: createId(),
      playerId: '__system__',
      playerName: 'System',
      text: `${this.getPlayerName(room, room.currentDrawerId)} is now drawing.`,
      type: 'system',
      createdAt: Date.now()
    });

    for (const player of room.players) {
      player.guessed = false;
    }
    room.wordChoices = this.getWordChoices(room);
    room.roundStartedAt = Date.now();
    room.timeLeft = room.config.drawingTime;
    room.history = [];
    room.nextSequence = 1;
  }

  private getWordChoices(room: RoomState) {
    const words = [...room.config.words];
    if (!words.length) return ['planet', 'rocket', 'castle'];
    return getRandomWords(words, 3);
  }

  private getPlayerName(room: RoomState, playerId: string | null) {
    return room.players.find((player) => player.id === playerId)?.name ?? 'Next player';
  }

  private getWinner(room: RoomState) {
    return [...room.players].sort((a, b) => b.score - a.score)[0] ?? null;
  }
}

export const publicWordChoices = (room: RoomState) => room.wordChoices;
export const roomPublicState = (room: RoomState) => ({
  code: room.code,
  hostPlayerId: room.hostPlayerId,
  players: room.players.map((player) => ({
    id: player.id,
    name: player.name,
    score: player.score,
    connected: player.connected,
    isHost: player.isHost,
    guessed: player.guessed
  })),
  status: room.status,
  currentDrawerId: room.currentDrawerId,
  roundNumber: room.roundNumber,
  totalRounds: room.totalRounds,
  timeLeft: room.timeLeft,
  winnerId: room.winnerId,
  messages: room.messages,
  history: room.history,
  config: room.config
});
