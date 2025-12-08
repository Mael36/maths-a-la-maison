// public/script.js
// Client-side game logic — compatible with your CSS/HTML IDs
const socket = io();
let room = null;
let board = null;
let players = [];
let currentPlayerId = null; // id of player whose turn it is
let activePlayers = []; // players allowed to answer
let clientTimer = null;

// helpers
const $ = id => document.getElementById(id);

// UI elements (assumes these IDs exist)
const elMenu = $('menu');
const elGame = $('game');
const elCreate = $('createBtn');
const elJoin = $('joinBtn');
const elStart = $('startBtn');
const elRoll = $('rollBtn');
const elPlateau = $('plateau');
const elPions = $('pions');
const elPossible = $('possibleCases');
const elActionGrid = $('actionGrid');
const elScoreTable = $('scoreTable');
const elRoomDisplay = $('roomDisplay');
const elDiceResult = $('diceResult') || null;
const elQuestionBox = $('questionBox');
const elThemeTitle = $('themeTitle');
const elQuestionText = $('questionText');
const elAnswerInput = $('answerInput');
const elSendAnswer = $('sendAnswerBtn');
const elTimer = $('timer');
const elResultBox = $('resultBox');
const elResultText = $('resultText');
const elChoice = (() => {
  let c = document.getElementById('choice');
  if (!c) { c = document.createElement('div'); c.id = 'choice'; document.body.appendChild(c); }
  return c;
})();

// --- UI wiring
elCreate && (elCreate.onclick = () => socket.emit('create', $('playerName').value || 'Hôte'));
elJoin && (elJoin.onclick = () => {
  const code = ($('roomCode').value || '').trim().toUpperCase();
  if (!code) return alert('Code requis !');
  socket.emit('join', { code, name: $('playerName').value || 'Joueur' });
});
elStart && (elStart.onclick = () => { if (room) socket.emit('start', room); });
elRoll && (elRoll.onclick = () => {
  if (!room) return;
  socket.emit('roll', room);
  elRoll.disabled = true;
});
elSendAnswer && (elSendAnswer.onclick = () => {
  const ans = (elAnswerInput.value || '').trim();
  if (!ans) return;
  socket.emit('answer', { code: room, answer: ans });
  elAnswerInput.value = '';
  hideQuestion();
});

// --- build small action grid (visual only)
function createActionCards() {
  if (!elActionGrid) return;
  elActionGrid.innerHTML = '';
  const actions = [
    "Flash","Battle on left","Battle on right","Call a friend","For you",
    "Second life","No way","Double","Téléportation","+1 ou -1",
    "Everybody","Double or quits","It's your choice","Quadruple"
  ];
  actions.forEach(a => {
    const div = document.createElement('div');
    div.className = 'actionCard';
    div.textContent = a;
    div.dataset.action = a;
    elActionGrid.appendChild(div);
  });
}
createActionCards();

// --- rendering pions ---
function updatePawns(list) {
  players = Array.isArray(list) ? list : players;
  if (!board || !board.positions) return;
  // ensure plateau loaded
  if (!elPlateau.complete || elPlateau.naturalWidth === 0) {
    setTimeout(() => updatePawns(players), 50);
    return;
  }
  elPions.innerHTML = '';
  const w = elPlateau.clientWidth, h = elPlateau.clientHeight;
  (players || []).forEach((p, i) => {
    const idx = Math.max(0, Math.min(board.positions.length - 1, p.pos || 0));
    const pos = board.positions[idx] || { x: 50, y: 50 };
    const x = (pos.x / 100) * w;
    const y = (pos.y / 100) * h;
    const pawn = document.createElement('div');
    pawn.className = 'pawn';
    pawn.style.left = `${x}px`;
    pawn.style.top = `${y}px`;
    pawn.style.background = ['#e53935','#43a047','#fb8c00','#1e88e5','#8e24aa','#fdd835'][i % 6];
    pawn.textContent = i + 1;
    elPions.appendChild(pawn);
  });
}

// --- show reachable cases (uses branches) ---
function showPossibleCases(currentPos, steps) {
  if (!board || !board.positions) return;
  elPossible.innerHTML = '';
  const reachable = new Set();
  const q = [{ pos: currentPos, rem: steps }];
  const seen = new Set();
  const maxIdx = board.positions.length - 1;

  while (q.length) {
    const { pos, rem } = q.shift();
    const key = pos + ':' + rem;
    if (seen.has(key)) continue;
    seen.add(key);

    if (rem === 0) { reachable.add(pos); continue; }

    // if on circle (0..47), advance along circle
    if (pos >= 0 && pos < 48) {
      q.push({ pos: (pos + 1) % 48, rem: rem - 1 });
      // also if entry to a branch exists at this position, follow branch's next element
      (board.branches || []).forEach(branch => {
        if (branch[0] === pos) {
          if (branch.length > 1) q.push({ pos: branch[1], rem: rem - 1 });
        }
      });
    } else {
      // if on a branch or center, try to follow branch sequence
      (board.branches || []).forEach(branch => {
        const idx = branch.indexOf(pos);
        if (idx !== -1) {
          if (idx + 1 < branch.length) q.push({ pos: branch[idx + 1], rem: rem - 1 });
        }
      });
      // if at center (board.center) nothing more to advance
    }
  }

  // draw spots
  const w = elPlateau.clientWidth, h = elPlateau.clientHeight;
  Array.from(reachable).sort((a,b)=>a-b).forEach(posIdx => {
    const pos = board.positions[posIdx];
    if (!pos) return;
    const x = (pos.x / 100) * w;
    const y = (pos.y / 100) * h;
    const spot = document.createElement('div');
    spot.className = 'spot';
    spot.style.left = `${x}px`;
    spot.style.top = `${y}px`;
    spot.onclick = () => {
      socket.emit('moveTo', { code: room, pos: posIdx });
      elPossible.innerHTML = '';
    };
    elPossible.appendChild(spot);
  });
}

// --- selection UI for choosing a player or action ---
function showSelection(payload) {
  // payload: { type: 'player'|'action', message, initiatorId, actions? }
  elChoice.innerHTML = '';
  const title = document.createElement('div');
  title.textContent = payload.message || 'Choisissez';
  title.style.fontWeight = 'bold';
  elChoice.appendChild(title);

  if (payload.type === 'player') {
    (players || []).forEach(p => {
      const b = document.createElement('button');
      b.textContent = p.name;
      b.onclick = () => {
        socket.emit('selectPlayer', { code: room, targetId: p.id });
        elChoice.innerHTML = '';
      };
      elChoice.appendChild(b);
    });
  } else if (payload.type === 'action') {
    (payload.actions || []).forEach(act => {
      const b = document.createElement('button');
      b.textContent = act;
      b.onclick = () => {
        socket.emit('chooseAction', { code: room, chosenAction: act });
        elChoice.innerHTML = '';
      };
      elChoice.appendChild(b);
    });
  }
}

// --- question UI ---
function showQuestion(payload) {
  // payload: { theme, question, timer }
  elThemeTitle.textContent = payload.theme || 'Maths';
  elQuestionText.textContent = payload.question || '';
  elQuestionBox.style.display = 'block';
  startTimer(payload.timer || 60);
}

// hide question
function hideQuestion() {
  elQuestionBox.style.display = 'none';
  stopTimer();
}

// timer UI
function startTimer(seconds) {
  stopTimer();
  let t = seconds;
  elTimer.style.display = 'block';
  elTimer.textContent = t + 's';
  clientTimer = setInterval(() => {
    t--;
    elTimer.textContent = t + 's';
    if (t <= 0) {
      stopTimer();
      // inform server that time is out for this room
      socket.emit('timeout', { code: room });
    }
  }, 1000);
}
function stopTimer() {
  if (clientTimer) clearInterval(clientTimer);
  clientTimer = null;
  if (elTimer) elTimer.style.display = 'none';
}

// results UI
function showResults(correct, message) {
  elResultBox.style.display = 'block';
  elResultText.textContent = (typeof correct === 'boolean') ? (correct ? 'Bonne réponse' : 'Mauvaise réponse') : (message || '');
  elResultText.style.color = correct ? '#2e7d32' : '#c62828';
  setTimeout(() => { elResultBox.style.display = 'none'; }, 2500);
}

// score table
function renderScoreTable(list) {
  players = list || players;
  if (!elScoreTable) return;
  elScoreTable.innerHTML = '<b>Scores</b><br/>';
  (players || []).forEach((p, i) => {
    const row = document.createElement('div');
    row.textContent = `${i+1}. ${p.name} — ${p.score || 0} pts`;
    row.dataset.id = p.id;
    row.style.cursor = 'pointer';
    // if click while selection pending, emit select
    row.onclick = () => { socket.emit('selectPlayer', { code: room, targetId: p.id }); };
    if (p.id === currentPlayerId) row.style.fontWeight = 'bold';
    elScoreTable.appendChild(row);
  });
}

// highlight drawn action on grid
function highlightAction(name) {
  Array.from(document.querySelectorAll('.actionCard')).forEach(c => {
    c.style.transform = (c.textContent.trim() === name) ? 'scale(1.05)' : 'scale(1)';
  });
}

// --- socket handlers ---
socket.on('created', code => { room = code; showGame(); });
socket.on('joined', code => { room = code; showGame(); });
socket.on('error', msg => alert(msg));

socket.on('boardData', b => {
  board = b;
  createActionCards();
  updatePawns(players);
});

socket.on('players', list => {
  players = list || [];
  renderScoreTable(players);
  updatePawns(players);
});

socket.on('yourTurn', data => {
  currentPlayerId = data && data.playerId;
  activePlayers = [currentPlayerId];
  // enable roll for the current player only
  if (elRoll) elRoll.disabled = (socket.id !== currentPlayerId);
});

socket.on('rolled', data => {
  if (!data) return;
  if (elDiceResult) elDiceResult.textContent = data.roll;
  // only show spots to roller
  if (socket.id === currentPlayerId) showPossibleCases(data.currentPos, data.roll);
});

socket.on('actionDrawn', data => {
  highlightAction(data.action);
});

socket.on('requestSelection', payload => {
  // server asks current player to choose player/action
  showSelection(payload);
});

socket.on('question', payload => {
  // server sends question only to active players — show only if this socket is active
  if (!payload) return;
  if (payload.recipients && Array.isArray(payload.recipients) && !payload.recipients.includes(socket.id)) return;
  showQuestion(payload);
});

socket.on('timeOut', d => {
  stopTimer();
  showResults(false, d && d.message ? d.message : 'Temps écoulé');
});

socket.on('results', data => {
  stopTimer();
  if (data && data.players) renderScoreTable(data.players);
  const correct = data && typeof data.correct !== 'undefined' ? data.correct : null;
  showResults(correct, data && data.message ? data.message : null);
});

socket.on('teleport', payload => {
  // payload: { pos } -> update locally (server will also send players list)
  if (payload && typeof payload.pos === 'number') {
    // visual feedback could be added; players update will reposition pawns
    console.log('Téléportation vers', payload.pos);
  }
});

socket.on('actionClear', () => {
  elPossible.innerHTML = '';
  elChoice.innerHTML = '';
  hideQuestion();
  highlightAction('');
});

// --- show/hide game UI ---
function showGame() {
  if (elMenu) elMenu.style.display = 'none';
  if (elGame) elGame.style.display = 'block';
  if (elRoomDisplay) elRoomDisplay.textContent = room;
  socket.emit('requestBoard');
  socket.emit('requestPlayers');
  if (elRoll) elRoll.disabled = true;
}

window.addEventListener('resize', () => updatePawns(players));
elPlateau && elPlateau.addEventListener('load', () => updatePawns(players));
