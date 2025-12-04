// public/script.js (corrigé)
// Assure-toi que le client charge socket.io et que les IDs HTML existent.

const socket = io();
let room = null;
let board = null;
let lastPlayers = [];
let currentTurnPlayerId = null;
let activePlayers = [];
let clientTimer = null;

// raccourci DOM
const $ = id => document.getElementById(id);

// éléments attendus (adapte si tu as des IDs différents)
const elMenu = $('menu');
const elGame = $('game');
const elPlayerName = $('playerName');
const elCreateBtn = $('createBtn');
const elJoinBtn = $('joinBtn');
const elRoomCode = $('roomCode');
const elStartBtn = $('startBtn');
const elRollBtn = $('rollBtn');
const elPlateau = $('plateau');
const elPions = $('pions');
const elPossible = $('possibleCases');
const elActionGrid = $('actionGrid');
const elScoreTable = $('scoreTable');
const elQuestionBox = $('questionBox');
const elThemeTitle = $('themeTitle');
const elQuestionText = $('questionText');
const elAnswerInput = $('answerInput');
const elSendAnswerBtn = $('sendAnswerBtn');
const elTimer = $('timer');
const elResultBox = $('resultBox');
const elResultText = $('resultText');
const elRoomDisplay = $('roomDisplay');
const elDiceResult = $('diceResult') || null;
const elChoice = $('choice') || (function(){ const d=document.createElement('div'); d.id='choice'; document.body.appendChild(d); return d; })();

// ---------- UI event wiring ----------
elCreateBtn && (elCreateBtn.onclick = () => {
  socket.emit('create', elPlayerName.value || 'Hôte');
});
elJoinBtn && (elJoinBtn.onclick = () => {
  const code = (elRoomCode.value || '').trim().toUpperCase();
  if (!code) return alert('Code requis !');
  socket.emit('join', { code, name: elPlayerName.value || 'Joueur' });
});
elStartBtn && (elStartBtn.onclick = () => {
  if (!room) return alert('Pas de salle');
  socket.emit('start', room);
});
elRollBtn && (elRollBtn.onclick = () => {
  if (!room) return;
  socket.emit('roll', room);
  // désactiver immédiatement côté client jusqu'au prochain tour
  elRollBtn.disabled = true;
});
elSendAnswerBtn && (elSendAnswerBtn.onclick = () => {
  const v = (elAnswerInput.value || '').trim();
  if (!v) return;
  socket.emit('answer', { code: room, answer: v });
  elAnswerInput.value = '';
  // on masque la question après envoi (le serveur renverra résultats)
  elQuestionBox.style.display = 'none';
  stopClientTimer();
});

// ---------- socket handlers ----------
socket.on('created', code => {
  room = code;
  showGame(code);
});
socket.on('joined', code => {
  room = code;
  showGame(code);
});
socket.on('error', msg => alert(msg));
socket.on('gameStart', () => {
  // visible si besoin ; le serveur enverra 'yourTurn'
  console.log('Partie démarrée');
});

// receive board data
socket.on('boardData', b => {
  board = b;
  // si l'image plateau est déjà chargée, on met à jour
  updatePawns(lastPlayers);
});

// players list update
socket.on('players', players => {
  lastPlayers = players || [];
  renderScoreTable(lastPlayers);
  updatePawns(lastPlayers);
});

// when it's your turn (server tells the single socket)
socket.on('yourTurn', data => {
  // data: { playerId }
  currentTurnPlayerId = data && data.playerId ? data.playerId : null;
  activePlayers = [currentTurnPlayerId];
  renderActiveState();
  // enable roll only for the player who must play (socket.id)
  if (socket.id === currentTurnPlayerId) {
    elRollBtn.disabled = false;
  } else {
    elRollBtn.disabled = true;
  }
});

// rolled: show dice result and possible cases (only visible for roller)
socket.on('rolled', data => {
  // data: { roll, currentPos }
  if (!data) return;
  if (elDiceResult) elDiceResult.textContent = data.roll;
  // Show possible cases only to the player who rolled (the server will emit rolled to everyone; we show only if we are the active roller)
  if (socket.id === currentTurnPlayerId) {
    showPossibleCases(data.currentPos, data.roll);
  }
});

// action drawn highlight
socket.on('actionDrawn', data => {
  highlightAction(data.action);
});

// requestSelection (server asks initiator to pick player or action)
socket.on('requestSelection', payload => {
  // payload: { type: 'player'|'action', message, initiatorId }
  showSelection(payload);
});

// question event (server sends only to relevant clients)
socket.on('question', payload => {
  // payload: { theme, question, timer }
  if (!payload) return;
  // show question UI
  elThemeTitle.textContent = payload.theme || 'Maths';
  elQuestionText.textContent = payload.question || '';
  elQuestionBox.style.display = 'block';
  startClientTimer(payload.timer || 60);
});

// timeOut from server
socket.on('timeOut', d => {
  stopClientTimer();
  showResult({ correct: false, message: d && d.message ? d.message : 'Temps écoulé' });
});

// results event
socket.on('results', data => {
  stopClientTimer();
  // data: { players, correct, winnerId? }
  if (data && data.players) {
    lastPlayers = data.players;
    renderScoreTable(lastPlayers);
    updatePawns(lastPlayers);
  }
  const correct = data && typeof data.correct !== 'undefined' ? data.correct : null;
  showResult({ correct, message: null, winnerId: data && data.winnerId });
});

// actionClear: cleanup UI
socket.on('actionClear', () => {
  elQuestionBox.style.display = 'none';
  elPossible.innerHTML = '';
  elChoice.innerHTML = '';
  stopClientTimer();
});

// board request (server might not implement but keep)
socket.on('requestBoard', () => {
  socket.emit('requestBoard');
});

// ---------- UI helpers ----------

function showGame(code) {
  if (elMenu) elMenu.style.display = 'none';
  if (elGame) elGame.style.display = 'block';
  if (elRoomDisplay) elRoomDisplay.textContent = code;
  // ask for players list and board if not already received
  socket.emit('requestPlayers', code);
  socket.emit('requestBoard');
  // ensure roll disabled until server grants yourTurn
  elRollBtn.disabled = true;
}

function renderScoreTable(players) {
  if (!elScoreTable) return;
  elScoreTable.innerHTML = '<b>Scores</b><br/>';
  players.forEach((p, i) => {
    const line = document.createElement('div');
    line.className = 'scoreLine';
    line.textContent = `${i+1}. ${p.name} — ${p.score || 0} pts`;
    // make clickable when there is a pending selection and this client is the initiator
    line.onclick = () => {
      // If our client initiated selection and server asked for select, emit accordingly (server expects selectPlayer)
      // We don't keep waitingFor state client-side tied to server — server will emit requestSelection and that payload includes initiator
      // So allow clicking only if the server asked selection and this client is initiator (we check presence of elChoice content)
      const initiatorFlag = elChoice && elChoice.dataset && elChoice.dataset.initiator === socket.id;
      if (elChoice && elChoice.dataset && elChoice.dataset.type === 'player' && elChoice.dataset.initiator === socket.id) {
        socket.emit('selectPlayer', { code: room, targetId: (players[i] && players[i].id) ? players[i].id : null });
        elChoice.innerHTML = '';
      }
    };
    // mark current turn player
    if (p.id === currentTurnPlayerId) line.style.fontWeight = 'bold';
    elScoreTable.appendChild(line);
  });
}

// ---------- pawn rendering ----------

function updatePawns(players) {
  if (!board || !board.positions) return;
  // ensure plateau image loaded
  if (!elPlateau.complete || elPlateau.naturalWidth === 0) {
    // try again shortly
    setTimeout(() => updatePawns(players), 50);
    return;
  }

  elPions.innerHTML = '';
  const w = elPlateau.clientWidth;
  const h = elPlateau.clientHeight;
  (players || []).forEach((p, idx) => {
    const posIndex = Math.max(0, Math.min(board.positions.length - 1, p.pos || 0));
    const pos = board.positions[posIndex] || { x: 50, y: 50 };
    const x = (pos.x / 100) * w;
    const y = (pos.y / 100) * h;

    const pawn = document.createElement('div');
    pawn.className = 'pawn';
    // pixel-accurate centering
    pawn.style.left = `${x}px`;
    pawn.style.top = `${y}px`;
    pawn.style.transform = 'translate(-50%, -50%)';
    pawn.textContent = (idx + 1);
    // color
    pawn.style.background = ['#e53935','#43a047','#fb8c00','#1e88e5','#8e24aa','#fdd835'][idx % 6];
    elPions.appendChild(pawn);
  });
}

// ---------- show possible target cases (after roll) ----------
function showPossibleCases(currentPos, steps) {
  if (!board || !board.positions) return;
  elPossible.innerHTML = '';
  steps = parseInt(steps || 0, 10);
  if (steps <= 0) return;

  const reachable = new Set();
  const q = [{ pos: currentPos, rem: steps }];
  const maxIndex = board.positions.length - 1;
  while (q.length) {
    const { pos, rem } = q.shift();
    if (rem === 0) { reachable.add(pos); continue; }
    if (pos < maxIndex) q.push({ pos: pos + 1, rem: rem - 1 });
  }

  if (!elPlateau.complete || elPlateau.naturalWidth === 0) {
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
    spot.style.left = `${x}px`;
    spot.style.top = `${y}px`;
    spot.onclick = () => {
      socket.emit('moveTo', { code: room, pos });
      elPossible.innerHTML = '';
    };
    elPossible.appendChild(spot);
  });
}

// ---------- highlight action ----------
function highlightAction(name) {
  document.querySelectorAll('#actionGrid .actionCard').forEach(c => {
    c.style.transform = (c.textContent.trim() === name) ? 'scale(1.08)' : 'scale(1)';
  });
}

// ---------- selection UI (when server asks) ----------
function showSelection(payload) {
  // payload: { type, message, initiatorId }
  elChoice.innerHTML = `<div class="choiceTitle">${payload.message || 'Choisissez'}</div>`;
  if (payload.type === 'player') {
    // list players for selection
    lastPlayers.forEach(p => {
      const btn = document.createElement('button');
      btn.textContent = p.name;
      btn.onclick = () => {
        socket.emit('selectPlayer', { code: room, targetId: p.id });
        elChoice.innerHTML = '';
      };
      elChoice.appendChild(btn);
    });
    // mark initiator so score table clicks can also work if needed
    elChoice.dataset.type = 'player';
    elChoice.dataset.initiator = payload.initiatorId || '';
  } else if (payload.type === 'action') {
    const actions = ['second_life','double','quadruple','no_way','flash'];
    actions.forEach(a => {
      const btn = document.createElement('button');
      btn.textContent = a;
      btn.onclick = () => {
        socket.emit('chooseAction', { code: room, chosenAction: a });
        elChoice.innerHTML = '';
      };
      elChoice.appendChild(btn);
    });
    elChoice.dataset.type = 'action';
    elChoice.dataset.initiator = payload.initiatorId || '';
  }
}

// ---------- client timer UI ----------
function startClientTimer(seconds) {
  if (clientTimer) clearInterval(clientTimer);
  let t = seconds;
  elTimer.style.display = 'inline-block';
  elTimer.textContent = t + 's';
  clientTimer = setInterval(() => {
    t--;
    elTimer.textContent = t + 's';
    if (t <= 0) {
      clearInterval(clientTimer);
      elTimer.style.display = 'none';
    }
  }, 1000);
}
function stopClientTimer() {
  if (clientTimer) clearInterval(clientTimer);
  elTimer.style.display = 'none';
}

// ---------- show result box ----------
function showResult({ correct = null, message = null, winnerId = null }) {
  elResultBox.style.display = 'block';
  if (correct === true) {
    elResultText.textContent = message || 'Bonne réponse';
    elResultText.style.color = '#2e7d32';
  } else if (correct === false) {
    elResultText.textContent = message || 'Mauvaise réponse';
    elResultText.style.color = '#c62828';
  } else {
    elResultText.textContent = message || '';
    elResultText.style.color = '#1976d2';
  }
  // show 2.5s
  setTimeout(() => {
    elResultBox.style.display = 'none';
  }, 2500);
}

// ---------- render active state (UI feedback for who can act) ----------
function renderActiveState() {
  // mark score table entries or action grid
  document.querySelectorAll('#scoreTable .scoreLine').forEach(el => {
    if (!el) return;
  });
  // ensure roll button state consistent
  elRollBtn.disabled = socket.id !== currentTurnPlayerId;
}

// ---------- build a minimal action grid if not present ----------
function buildActionGrid() {
  if (!elActionGrid) return;
  const actions = [
    "Flash","Battle on left","Battle on right","Call a friend","For you",
    "Second life","No way","Double","Téléportation","+1 ou -1",
    "Everybody","Double or quits","It's your choice","Quadruple"
  ];
  elActionGrid.innerHTML = '';
  actions.forEach(a => {
    const c = document.createElement('div');
    c.className = 'actionCard';
    c.textContent = a;
    elActionGrid.appendChild(c);
  });
}
buildActionGrid();

// ensure plateau pions reposition when image loads or on resize
elPlateau.addEventListener('load', () => updatePawns(lastPlayers));
window.addEventListener('resize', () => updatePawns(lastPlayers));
