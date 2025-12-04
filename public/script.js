// public/script.js
const socket = io();
let room = null;
let board = null;
let lastPlayers = [];
let currentTurnPlayerId = null;
let activePlayers = [];
let waitingForSelection = null; // { type:'player'|'action', message, initiator }

const $ = id => document.getElementById(id);

// UI elements assumed present in your HTML (adapt if different)
const elMenu = $('menu');
const elGame = $('game');
const elRoomDisplay = $('roomDisplay');
const elPions = $('pions');
const elPlateau = $('plateau');
const elPossible = $('possibleCases');
const elActionGrid = $('actionGrid');
const elScoreTable = $('scoreTable');
const elRollBtn = $('rollBtn');
const elStartBtn = $('startBtn');
const elCreateBtn = $('createBtn');
const elJoinBtn = $('joinBtn');
const elPlayerName = $('playerName');
const elRoomCode = $('roomCode');
const elQuestionBox = $('questionBox');
const elThemeTitle = $('themeTitle');
const elQuestionText = $('questionText');
const elAnswerInput = $('answerInput');
const elSendAnswerBtn = $('sendAnswerBtn');
const elTimer = $('timer');
const elResultBox = $('resultBox');
const elResultText = $('resultText');
const elDiceResult = $('diceResult') || document.createElement('span');
const elChoice = $('choice'); // container for selection choices

// start handlers
elCreateBtn.onclick = () => socket.emit('create', elPlayerName.value || 'Hôte');
elJoinBtn.onclick = () => {
  const code = (elRoomCode.value || '').trim().toUpperCase();
  if (!code) return alert('Code requis');
  socket.emit('join', { code, name: elPlayerName.value || 'Joueur' });
};
elStartBtn.onclick = () => { if (room) socket.emit('start', room); };
elRollBtn.onclick = () => { if (room) { socket.emit('roll', room); elRollBtn.disabled = true; } };
elSendAnswerBtn.onclick = () => {
  const v = elAnswerInput.value.trim();
  if (!v) return;
  socket.emit('answer', { code: room, answer: v });
  elAnswerInput.value = '';
  elQuestionBox.style.display = 'none';
};

// request board when game shown
function requestBoard() { socket.emit('requestBoard'); }

// Show game UI
function showGame(rc) {
  room = rc;
  elMenu.style.display = 'none';
  elGame.style.display = 'block';
  if (elRoomDisplay) elRoomDisplay.textContent = room;
  // request board explicitly
  requestBoard();
}

// Board data
socket.on('boardData', (b) => {
  board = b;
  // ensure image src matches board, but typically you have assets/plateau.png in HTML
  // If you used a different path, adjust accordingly.
  // place pions after image loaded
  if (elPlateau.complete) updatePawns(lastPlayers);
});

// Created / joined
socket.on('created', (code) => { room = code; showGame(code); });
socket.on('joined', (code) => { room = code; showGame(code); });
socket.on('error', (msg) => alert(msg));

// Players update
socket.on('players', (players) => {
  lastPlayers = players || [];
  renderScoreTable(players);
  updatePawns(players);
});

// your turn
socket.on('yourTurn', (data) => {
  currentTurnPlayerId = data.playerId;
  // set active players to only current by default
  activePlayers = [currentTurnPlayerId];
  renderActiveState();
  // enable roll button only for current player
  if (socket.id === currentTurnPlayerId) elRollBtn.disabled = false;
});

// rolled (both to player and broadcast) -> show dice result and possible cases for current player only
socket.on('rolled', (data) => {
  if (!data) return;
  if (elDiceResult) elDiceResult.textContent = data.roll;
  // show possible cases to the player who rolled (client receives this event for everyone but only show for the roller)
  // The server sends 'rolled' as both to roller socket and broadcast; the 'currentPos' identifies the roller
  // show possible only for the roller (we assume server emits rolled to roller and to everyone)
  // We need to know whether this client is the roller: server previously emitted rolled to roller by socket.emit and to room
  // The simplest: the client that is allowed to roll will be the current player; we show possible cases only if socket.id === currentTurnPlayerId
  if (socket.id === currentTurnPlayerId) {
    showPossibleCases(data.currentPos, data.roll);
  }
});

// action drawn
socket.on('actionDrawn', (data) => {
  // highlight action in grid
  highlightAction(data.action);
});

// requestSelection (server asks initiator to choose a player or an action)
socket.on('requestSelection', (payload) => {
  waitingForSelection = payload;
  showSelection(payload);
});

// question: shown only for targeted clients (server sends to those)
socket.on('question', (payload) => {
  // payload: { theme, question, timer }
  // display only if we are an active player for that question (server sends only to actives)
  elThemeTitle.textContent = payload.theme || 'Maths';
  elQuestionText.textContent = payload.question || '';
  elQuestionBox.style.display = 'block';
  startTimer(payload.timer || 60);
});

// timeOut
socket.on('timeOut', (d) => {
  stopTimer();
  showResult({ correct: false, message: d && d.message ? d.message : 'Temps écoulé' });
});

// results
socket.on('results', (data) => {
  stopTimer();
  // data: { players, correct: boolean, winnerId? }
  // update score table
  if (data && data.players) {
    renderScoreTable(data.players);
  }
  // show result text: for actions like everybody we can show who won
  if (data && typeof data.correct !== 'undefined') {
    showResult({ correct: data.correct, winnerId: data.winnerId });
  } else {
    showResult({ correct: false });
  }
});

// actionClear
socket.on('actionClear', () => {
  // cleanup UI of question/choice
  elQuestionBox.style.display = 'none';
  elPossible.innerHTML = '';
  elResultBox.style.display = 'none';
  elChoice.innerHTML = '';
  waitingForSelection = null;
  activePlayers = [];
  renderActiveState();
});

// requestBoard isn't used by server in this code, but keep handler
socket.on('boardData', (b) => {
  board = b;
  updatePawns(lastPlayers);
});

// Helper: show selection choices
function showSelection(payload) {
  // payload: { type:'player'|'action', message }
  elChoice.innerHTML = `<div class="choiceTitle">${payload.message}</div>`;
  if (payload.type === 'player') {
    // list players
    lastPlayers.forEach(p => {
      const btn = document.createElement('button');
      btn.textContent = p.name;
      btn.onclick = () => {
        socket.emit('selectPlayer', { code: room, targetId: p.id });
        elChoice.innerHTML = '';
        waitingForSelection = null;
      };
      elChoice.appendChild(btn);
    });
  } else if (payload.type === 'action') {
    // show a small subset of actions client-side for choice
    const actions = ['second_life', 'double', 'quadruple', 'no_way', 'flash'];
    actions.forEach(a => {
      const btn = document.createElement('button');
      btn.textContent = a;
      btn.onclick = () => {
        socket.emit('chooseAction', { code: room, chosenAction: a });
        elChoice.innerHTML = '';
        waitingForSelection = null;
      };
      elChoice.appendChild(btn);
    });
  }
}

// Render and UI helpers
function renderScoreTable(players) {
  elScoreTable.innerHTML = '<b>Scores</b><br/>';
  players.forEach((p, i) => {
    const line = document.createElement('div');
    line.className = 'scoreLine';
    if (p.id === currentTurnPlayerId) line.style.fontWeight = 'bold';
    line.innerHTML = `${i + 1}. ${p.name} — ${p.score || 0} pts`;
    // allow clicking to select player when waitingForSelection is type player and this client is the initiator
    line.onclick = () => {
      if (waitingForSelection && waitingForSelection.type === 'player' && socket.id === waitingForSelection.initiator) {
        socket.emit('selectPlayer', { code: room, targetId: p.id });
        elChoice.innerHTML = '';
        waitingForSelection = null;
      }
    };
    elScoreTable.appendChild(line);
  });
  lastPlayers = players;
}

// Highlight action card
function highlightAction(name) {
  document.querySelectorAll('#actionGrid .actionCard').forEach(c => {
    c.style.transform = 'scale(1)';
    if (c.textContent.trim() === name) c.style.transform = 'scale(1.1)';
  });
}

// Show dice-accessible positions
function showPossibleCases(currentPos, steps) {
  if (!board || !board.positions) return;
  elPossible.innerHTML = '';
  // If steps is zero or invalid, nothing to show
  steps = parseInt(steps || 0, 10);
  if (steps <= 0) return;

  // BFS-like reachable along board linear forward (wrap disabled here). Adjust per your board rules.
  const reachable = new Set();
  const q = [{ pos: currentPos, rem: steps }];
  const maxIndex = board.positions.length - 1;

  while (q.length) {
    const { pos, rem } = q.shift();
    if (rem === 0) { reachable.add(pos); continue; }
    if (pos < maxIndex) q.push({ pos: pos + 1, rem: rem - 1 });
  }

  // map positions to pixel coords
  if (!elPlateau.complete || elPlateau.naturalWidth === 0) {
    // try again shortly
    setTimeout(() => showPossibleCases(currentPos, steps), 50);
    return;
  }
  const w = elPlateau.clientWidth, h = elPlateau.clientHeight;

  reachable.forEach(pos => {
    const p = board.positions[pos];
    if (!p) return;
    const x = (p.x / 100) * w;
    const y = (p.y / 100) * h;
    const spot = document.createElement('div');
    spot.className = 'spot';
    spot.style.left = x + 'px';
    spot.style.top = y + 'px';
    spot.onclick = () => {
      socket.emit('moveTo', { code: room, pos });
      elPossible.innerHTML = '';
    };
    elPossible.appendChild(spot);
  });
}

// Pawn rendering — robust to image load & resize
function updatePawns(players) {
  if (!board || !board.positions) return;
  elPions.innerHTML = '';
  const img = elPlateau;
  if (!img.complete || img.naturalWidth === 0) {
    setTimeout(() => updatePawns(players), 50);
    return;
  }
  const w = img.clientWidth, h = img.clientHeight;
  (players || []).forEach((p, idx) => {
    const posIndex = Math.max(0, Math.min(board.positions.length - 1, p.pos || 0));
    const pos = board.positions[posIndex] || { x: 50, y: 50 };
    const x = (pos.x / 100) * w;
    const y = (pos.y / 100) * h;

    const pawn = document.createElement('div');
    pawn.className = 'pawn';
    pawn.style.left = x + 'px';
    pawn.style.top = y + 'px';
    pawn.textContent = (idx + 1);
    pawn.style.background = ['#d32f2f', '#388e3c', '#fbc02d', '#1976d2', '#f57c00', '#7b1fa2'][idx % 6];
    elPions.appendChild(pawn);
  });
}

// Timer UI
let clientTimer = null;
function startTimer(sec) {
  if (clientTimer) clearInterval(clientTimer);
  elTimer.style.display = 'inline-block';
  let t = sec;
  elTimer.textContent = t + 's';
  clientTimer = setInterval(() => {
    t--;
    elTimer.textContent = t + 's';
    if (t <= 0) { clearInterval(clientTimer); elTimer.style.display = 'none'; }
  }, 1000);
}
function stopTimer() {
  if (clientTimer) clearInterval(clientTimer);
  elTimer.style.display = 'none';
}

// Result display
function showResult({ correct, message, winnerId }) {
  elResultBox.style.display = 'block';
  if (typeof correct !== 'undefined') {
    elResultText.textContent = correct ? (message || 'Bonne réponse') : (message || 'Mauvaise réponse');
    elResultText.style.color = correct ? '#2e7d32' : '#c62828';
  } else {
    elResultText.textContent = message || '';
  }
  setTimeout(() => {
    elResultBox.style.display = 'none';
  }, 2500);
}

// Build action grid (smaller cards)
function buildActionGrid() {
  const actions = [
    "Flash","Battle on left","Battle on right","Call a friend","For you",
    "Second life","No way","Double","Téléportation","+1 ou -1",
    "Everybody","Double or quits","It's your choice","Quadruple"
  ];
  elActionGrid.innerHTML = '';
  actions.forEach(a => {
    const card = document.createElement('div');
    card.className = 'actionCard';
    card.textContent = a;
    elActionGrid.appendChild(card);
  });
}
buildActionGrid();

// make sure plateau image is responsive: on load update pawns
elPlateau.addEventListener('load', () => updatePawns(lastPlayers));
window.addEventListener('resize', () => updatePawns(lastPlayers));

// initial UI setup: hide game
if (elGame) elGame.style.display = 'none';
