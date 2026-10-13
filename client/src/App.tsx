import { useEffect, useMemo, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';

type Player = {
  id: string;
  name: string;
  score: number;
  connected: boolean;
  isHost: boolean;
  guessed: boolean;
};

type RoomState = {
  code: string;
  hostPlayerId: string;
  players: Player[];
  status: 'lobby' | 'playing' | 'finished';
  currentDrawerId: string | null;
  roundNumber: number;
  totalRounds: number;
  timeLeft: number;
  winnerId: string | null;
  messages: Array<{
    id: string;
    playerId: string;
    playerName: string;
    text: string;
    type: 'system' | 'chat';
    createdAt: number;
  }>;
  history: Array<{
    id: string;
    seq: number;
    type: 'stroke' | 'fill' | 'clear' | 'undo';
    tool?: 'pen' | 'eraser';
    color?: string;
    size?: number;
    fillColor?: string;
    points?: Array<{ x: number; y: number }>;
    createdAt: number;
  }>;
  config: {
    roundCount: number;
    drawingTime: number;
    words: string[];
  };
};

const BACKEND_URL = 'http://localhost:4001';
const RECONNECT_TOKEN_KEY = 'scribbleReconnectToken';

const defaultRoomConfig = { roundCount: 3, drawingTime: 60, words: ['planet', 'castle', 'guitar'] };

const getPlayerPoint = (event: React.PointerEvent<HTMLCanvasElement>) => {
  const rect = event.currentTarget.getBoundingClientRect();
  const scaleX = event.currentTarget.width / rect.width;
  const scaleY = event.currentTarget.height / rect.height;
  return {
    x: (event.clientX - rect.left) * scaleX,
    y: (event.clientY - rect.top) * scaleY
  };
};

function App() {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [playerId, setPlayerId] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [playerName, setPlayerName] = useState('Player One');
  const [room, setRoom] = useState<RoomState | null>(null);
  const [chatInput, setChatInput] = useState('');
  const [guessInput, setGuessInput] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [wordChoices, setWordChoices] = useState<string[]>([]);
  const [selectedTool, setSelectedTool] = useState<'pen' | 'eraser' | 'fill' | 'clear' | 'undo'>('pen');
  const [brushColor, setBrushColor] = useState('#1f2937');
  const [brushSize, setBrushSize] = useState(4);
  const [roomConfig, setRoomConfig] = useState(defaultRoomConfig);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef<{
    isDrawing: boolean;
    id: string;
    points: Array<{ x: number; y: number }>;
    tool: 'pen' | 'eraser';
    color: string;
    size: number;
  } | null>(null);

  useEffect(() => {
    const newSocket = io(BACKEND_URL, {
      transports: ['websocket'],
      autoConnect: true
    });

    newSocket.on('connect', () => {
      setConnected(true);
      setError('');
    });

    newSocket.on('disconnect', () => {
      setConnected(false);
    });

    newSocket.on('session', ({ playerId: incomingId, roomCode: incomingCode, reconnectToken }: { playerId: string; roomCode: string; reconnectToken: string }) => {
      setPlayerId(incomingId);
      if (incomingCode) {
        setRoomCode(incomingCode);
      }
      if (reconnectToken) {
        sessionStorage.setItem(RECONNECT_TOKEN_KEY, reconnectToken);
      }
    });

    newSocket.on('room:update', ({ room: incomingRoom }) => {
      setRoom(incomingRoom as RoomState);
    });

    newSocket.on('private:wordChoices', ({ wordChoices: incomingChoices }) => {
      setWordChoices(incomingChoices ?? []);
    });

    newSocket.on('private:feedback', ({ message }) => {
      setNotice(message ?? '');
    });

    newSocket.on('guess:result', ({ correct, message, close }) => {
      if (correct) {
        setNotice('Correct!');
      } else if (close) {
        setNotice('close!');
      } else if (message) {
        setNotice(message);
      }
    });

    newSocket.on('error', ({ message }) => {
      setError(message ?? 'An error occurred.');
    });

    setSocket(newSocket);

    return () => {
      newSocket.disconnect();
    };
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const roomFromUrl = params.get('room');
    if (roomFromUrl) {
      setRoomCode(roomFromUrl);
    }
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const stacked: Array<{ type: 'stroke' | 'fill' | 'clear' | 'undo'; tool?: 'pen' | 'eraser'; color?: string; size?: number; fillColor?: string; points?: Array<{ x: number; y: number }> }> = [];
    let background = '#ffffff';
    if (room?.history) {
      for (const event of room.history) {
        if (event.type === 'stroke') {
          stacked.push(event);
        } else if (event.type === 'fill') {
          background = event.fillColor ?? background;
        } else if (event.type === 'clear') {
          stacked.length = 0;
          background = '#ffffff';
        } else if (event.type === 'undo') {
          stacked.pop();
        }
      }
    }

    ctx.fillStyle = background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    for (const event of stacked) {
      if (event.type !== 'stroke' || !event.points?.length) continue;
      const strokeColor = event.color ?? '#111827';
      const lineWidth = event.size ?? 4;
      ctx.beginPath();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.lineWidth = lineWidth;
      ctx.strokeStyle = strokeColor;

      if (event.tool === 'eraser') {
        ctx.globalCompositeOperation = 'destination-out';
      } else {
        ctx.globalCompositeOperation = 'source-over';
      }

      ctx.moveTo(event.points[0].x, event.points[0].y);
      for (let i = 1; i < event.points.length; i += 1) {
        ctx.lineTo(event.points[i].x, event.points[i].y);
      }
      ctx.stroke();
      ctx.globalCompositeOperation = 'source-over';
    }
  }, [room]);

  const isDrawer = room ? room.currentDrawerId === playerId : false;
  const currentDrawer = room?.players.find((player) => player.id === room.currentDrawerId);
  const myPlayer = room?.players.find((player) => player.id === playerId);
  const roomStatusText = room ? (room.status === 'playing' ? 'In progress' : room.status === 'finished' ? 'Finished' : 'Lobby') : 'Idle';
  const userRole = isDrawer ? 'Drawer' : room ? 'Guesser' : 'Guest';

  const createRoom = () => {
    if (!socket) return;
    socket.emit('createRoom', { playerName });
  };

  const joinRoom = () => {
    if (!socket || !roomCode.trim()) {
      setError('Enter a room code.');
      return;
    }
    const desiredRoomCode = roomCode.trim().toUpperCase();
    socket.emit('joinRoom', {
      roomCode: desiredRoomCode,
      playerName,
      reconnectToken: sessionStorage.getItem(RECONNECT_TOKEN_KEY) ?? undefined
    });
  };

  const updateConfig = () => {
    if (!socket || !roomCode || !room) return;
    socket.emit('updateConfig', {
      roomCode,
      config: roomConfig
    });
  };

  const startGame = () => {
    if (!socket || !roomCode) return;
    socket.emit('startGame', { roomCode });
  };

  const sendChat = () => {
    if (!socket || !roomCode || !chatInput.trim()) return;
    socket.emit('chat:send', { roomCode, text: chatInput.trim() });
    setChatInput('');
  };

  const sendGuess = () => {
    if (!socket || !roomCode || !guessInput.trim()) return;
    socket.emit('guess', { roomCode, guess: guessInput.trim() });
    setGuessInput('');
  };

  const selectWord = (word: string) => {
    if (!socket || !roomCode) return;
    socket.emit('selectWord', { roomCode, word });
  };

  const emitAction = (action: 'fill' | 'clear' | 'undo') => {
    if (!socket || !roomCode || !isDrawer) return;
    const payload = {
      roomCode,
      event: {
        id: crypto.randomUUID(),
        type: action,
        fillColor: action === 'fill' ? brushColor : undefined
      }
    };
    socket.emit('draw:event', payload);
  };

  const getCanvasPoint = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * event.currentTarget.width;
    const y = ((event.clientY - rect.top) / rect.height) * event.currentTarget.height;
    return { x, y };
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawer || !socket || !roomCode) return;
    event.preventDefault();
    const point = getCanvasPoint(event);
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return;

    event.currentTarget.setPointerCapture(event.pointerId);
    drawingRef.current = {
      isDrawing: true,
      id: crypto.randomUUID(),
      points: [point],
      tool: selectedTool === 'eraser' ? 'eraser' : 'pen',
      color: selectedTool === 'eraser' ? '#ffffff' : brushColor,
      size: brushSize
    };
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current || !drawingRef.current.isDrawing) return;
    const point = getCanvasPoint(event);
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return;

    drawingRef.current.points.push(point);

    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    const { points, color, size, tool } = drawingRef.current;
    if (points.length < 2) return;

    ctx.strokeStyle = color;
    ctx.lineWidth = size;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.globalCompositeOperation = tool === 'eraser' ? 'destination-out' : 'source-over';
    ctx.beginPath();
    ctx.moveTo(points[points.length - 2].x, points[points.length - 2].y);
    ctx.lineTo(point.x, point.y);
    ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';
  };

  const handlePointerUp = () => {
    if (!drawingRef.current || !socket || !roomCode) return;
    const stroke = drawingRef.current;
    const validPoints = stroke.points.filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
    if (validPoints.length === 0) {
      drawingRef.current = null;
      return;
    }

    socket.emit('draw:event', {
      roomCode,
      event: {
        id: stroke.id,
        type: 'stroke',
        points: validPoints,
        color: stroke.color,
        size: stroke.size,
        tool: stroke.tool
      }
    });
    drawingRef.current = null;
  };

  const joinedRoom = Boolean(room);

  const publicPlayers = useMemo(() => room?.players ?? [], [room]);

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="branding">
          <div className="logo-mark">✏️</div>
          <div>
            <p className="eyebrow">multiplayer drawing</p>
            <h1>Sketch Party</h1>
          </div>
        </div>

        <div className="header-meta">
          <span className={`status-pill ${connected ? 'online' : 'offline'}`}>
            {connected ? 'Live' : 'Offline'}
          </span>
          <div className="room-badge">Room {roomCode || '—'}</div>
        </div>
      </header>

      <div className="content-grid">
        <aside className="panel control-panel">
          <div className="panel-header-row">
            <h3>Lobby</h3>
            <span className="mini-badge">{userRole}</span>
          </div>

          <label>
            Name
            <input value={playerName} onChange={(event) => setPlayerName(event.target.value)} />
          </label>

          <div className="inline-actions">
            <button onClick={createRoom}>Create room</button>
            <button onClick={joinRoom}>Join room</button>
          </div>

          <label>
            Room code
            <input value={roomCode} onChange={(event) => setRoomCode(event.target.value.toUpperCase())} placeholder="ABC12" />
          </label>

          {room && (
            <div className="section-box">
              <div className="section-heading">
                <h4>Host controls</h4>
                <span className="mini-badge accent">{roomStatusText}</span>
              </div>

              <label>
                Rounds
                <input type="number" min={1} max={10} value={room.config.roundCount} onChange={(event) => setRoomConfig((current) => ({ ...current, roundCount: Number(event.target.value) || 1 }))} />
              </label>

              <label>
                Drawing time (sec)
                <input type="number" min={20} max={180} value={room.config.drawingTime} onChange={(event) => setRoomConfig((current) => ({ ...current, drawingTime: Number(event.target.value) || 30 }))} />
              </label>

              <div className="inline-actions">
                <button onClick={updateConfig}>Save config</button>
                <button onClick={startGame}>Start game</button>
              </div>
            </div>
          )}

          {error && <div className="message error">{error}</div>}
          {notice && <div className="message warning">{notice}</div>}
        </aside>

        <main className="game-panel panel">
          <div className="game-header">
            <div className="metric-card">
              <span className="metric-label">Drawer</span>
              <strong>{currentDrawer?.name ?? 'Waiting...'}</strong>
            </div>
            <div className="metric-card">
              <span className="metric-label">Round</span>
              <strong>{room?.roundNumber ?? 0}/{room?.totalRounds ?? 0}</strong>
            </div>
            <div className="metric-card accent">
              <span className="metric-label">Timer</span>
              <strong>{room?.timeLeft ?? 0}s</strong>
            </div>
          </div>

          {wordChoices.length > 0 && isDrawer && (
            <div className="word-picker">
              <div className="word-picker-title">Choose a word</div>
              {wordChoices.map((word) => (
                <button key={word} className="word-button" onClick={() => selectWord(word)}>{word}</button>
              ))}
            </div>
          )}

          {room && room.status !== 'playing' && !isDrawer && (
            <div className="canvas-hint">Waiting for the next drawing round.</div>
          )}

          <div className="canvas-tools">
            <div className="tool-group">
              {(['pen', 'eraser', 'fill', 'clear', 'undo'] as const).map((tool) => (
                <button
                  key={tool}
                  className={selectedTool === tool ? 'active tool-button' : 'tool-button'}
                  onClick={() => {
                    setSelectedTool(tool);
                    if (tool === 'fill' || tool === 'clear' || tool === 'undo') {
                      emitAction(tool);
                    }
                  }}
                >
                  {tool}
                </button>
              ))}
            </div>

            <div className="tool-group compact">
              <label>
                Color
                <input type="color" value={brushColor} onChange={(event) => setBrushColor(event.target.value)} />
              </label>
              <label>
                Brush size
                <input type="range" min={2} max={24} value={brushSize} onChange={(event) => setBrushSize(Number(event.target.value))} />
              </label>
            </div>
          </div>

          <canvas
            ref={canvasRef}
            width={900}
            height={520}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerLeave={handlePointerUp}
            onPointerCancel={handlePointerUp}
            className="drawing-surface"
          />

          <div className="guess-chat-row">
            <div className="guess-box">
              <input value={guessInput} onChange={(event) => setGuessInput(event.target.value)} placeholder="Guess the word" />
              <button onClick={sendGuess}>Guess</button>
            </div>
            <div className="chat-box">
              <input value={chatInput} onChange={(event) => setChatInput(event.target.value)} placeholder="Say something" />
              <button onClick={sendChat}>Send</button>
            </div>
          </div>
        </main>

        <aside className="panel sidebar-panel">
          <div className="panel-header-row">
            <h3>Players</h3>
            <span className="mini-badge">{publicPlayers.length}</span>
          </div>

          <ul className="player-list">
            {publicPlayers.map((player) => (
              <li key={player.id} className={player.id === playerId ? 'self' : ''}>
                <div className="player-meta">
                  <span className={`player-status ${player.connected ? 'connected' : 'offline'}`} />
                  <span>{player.name}</span>
                  {room?.currentDrawerId === player.id && <span className="mini-badge accent">Draw</span>}
                  {room?.hostPlayerId === player.id && <span className="mini-badge">Host</span>}
                </div>
                <strong>{player.score}</strong>
              </li>
            ))}
          </ul>

          <div className="chat-list">
            {room?.messages.length ? (
              room.messages.map((message) => (
                <div key={message.id} className={`chat-message ${message.type}`}>
                  <strong>{message.playerName}</strong>
                  <span>{message.text}</span>
                </div>
              ))
            ) : (
              <div className="chat-empty">No messages yet.</div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

export default App;
