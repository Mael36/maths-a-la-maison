// public/script.js
const socket = io();
let room = null;
let board = null;
let players = [];
let currentPlayerId = null;
let activePlayers = [];
let clientTimer = null;

// helpers
const $ = id => document.getElementById(id);

// UI elements
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
const elDiceResult = $('diceResult');
const elQuestionBox = $('questionBox');
const elThemeTitle = $('themeTitle');
const elQuestionText = $('questionText');
const elQuestionImg= $('questionImage');
const elAnswerInput = $('answerInput');
const elSendAnswer = $('sendAnswerBtn');
const elTimer = $('timer');
const elResultBox = $('resultBox');
const elResultText = $('resultText');
const elChoice = $('choice');

// UI wiring
elCreate && (elCreate.onclick = () => socket.emit('create', $('playerName').value || 'Hôte'));
elJoin && (elJoin.onclick = () => {
  const code = ($('roomCode').value || '').trim().toUpperCase();
  if (!code) return alert('Code requis !');
  socket.emit('join', { code, name: $('playerName').value || 'Joueur' });
});
elStart && (elStart.onclick = () => { if (room) socket.emit('start', room); });
elRoll && (elRoll.onclick = () => { if (!room) return; socket.emit('roll', room); elRoll.disabled = true; });
elSendAnswer && (elSendAnswer.onclick = () => {
  const ans = (elAnswerInput.value || '').trim();
  if (!ans) return;
  socket.emit('answer', { code: room, answer: ans });
  hideQuestion();
});

// create action cards (visual)
function createActionCards() {
  if (!elActionGrid) return;
  elActionGrid.innerHTML = '';
  const actions = [
    "Flash","Battle on left","Battle on right","Call a friend","For you",
    "Second life","No way","Double","Téléportation","+1 ou -1",
    "Everybody","Double or quits","It's your choice","Quadruple"
  ];
  actions.forEach(a => {
    const c = document.createElement('div');
    c.className = 'actionCard';
    c.textContent = a;
    c.dataset.action = a;
    elActionGrid.appendChild(c);
  });
}
createActionCards();

// update pawns
function updatePawns(list) {
  if (Array.isArray(list)) players = list;
  if (!board || !board.positions) return;
  // wait for image load to have dimensions
  if (!elPlateau.complete && elPlateau.naturalWidth === 0) {
    setTimeout(() => updatePawns(players), 60);
    return;
  }
  elPions.innerHTML = '';
  const w = elPlateau.clientWidth;
  const h = elPlateau.clientHeight;
  (players || []).forEach((p, i) => {
    const idx = Math.max(0, Math.min((p.pos || 0), board.positions.length - 1));
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

// show possible landing spots (uses branches)
function showPossibleCases(currentPos, steps) {
  if (!board || !board.positions) return;
  elPossible.innerHTML = '';
  const reachable = new Set();
  const queue = [{ pos: currentPos, rem: steps }];
  const seen = new Set();

  while (queue.length) {
    const { pos, rem } = queue.shift();
    const key = pos + ':' + rem;
    if (seen.has(key)) continue;
    seen.add(key);

    if (rem === 0) { reachable.add(pos); continue; }

    // If on circle (0..47) advance and consider branch entry
    if (pos >= 0 && pos < 48) {
      queue.push({ pos: (pos + 1) % 48, rem: rem - 1 });
      (board.branches || []).forEach(branch => {
        if (branch[0] === pos) {
          if (branch.length > 1) queue.push({ pos: branch[1], rem: rem - 1 });
        }
      });
    } else {
      // On branch or center: follow branch sequences
      (board.branches || []).forEach(branch => {
        const idx = branch.indexOf(pos);
        if (idx !== -1 && idx + 1 < branch.length) queue.push({ pos: branch[idx + 1], rem: rem - 1 });
      });
    }
  }

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
    spot.addEventListener('click', () => {
      socket.emit('moveTo', { code: room, pos: posIdx });
      elPossible.innerHTML = '';
    });
    elPossible.appendChild(spot);
  });
}

// selection UI (choose player or action)
function showSelection(payload) {
  // payload: { type: 'player'|'action', message, actions? }
  elChoice.style.display = 'block';
  elChoice.innerHTML = '';
  const title = document.createElement('div');
  title.style.fontWeight = 'bold';
  title.textContent = payload.message || 'Choisir';
  elChoice.appendChild(title);

  if (payload.type === 'player') {
    (players || []).forEach(p => {
      const b = document.createElement('button');
      b.textContent = p.name;
      b.style.margin = '6px';
      b.onclick = () => {
        socket.emit('selectPlayer', { code: room, targetId: p.id });
        elChoice.style.display = 'none';
      };
      elChoice.appendChild(b);
    });
  } else if (payload.type === 'action') {
    (payload.actions || []).forEach(act => {
      const b = document.createElement('button');
      b.textContent = act;
      b.style.margin = '6px';
      b.onclick = () => {
        socket.emit('chooseAction', { code: room, chosenAction: act });
        elChoice.style.display = 'none';
      };
      elChoice.appendChild(b);
    });
  }
}

function showQuestion(payload) {
  if (!payload) return;
  if (payload.recipients && Array.isArray(payload.recipients) && !payload.recipients.includes(socket.id)) return;

  const elQuestionImg = $('questionImg'); // récupéré ici

  $('themeTitle').textContent = payload.theme || 'Maths';
  $('questionText').textContent = payload.question || '';

  if (payload.img) {
    elQuestionImg.src = payload.img;
    elQuestionImg.style.display = 'block';
  } else {
    elQuestionImg.src = '';
    elQuestionImg.style.display = 'none';
  }

  $('questionBox').style.display = 'block';
  startTimer(payload.timer || 60);
}



// hide question
function hideQuestion() {
  elQuestionBox.style.display = 'none';
  elQuestionImage.style.display = 'none';
  elQuestionImage.src = '';
  stopTimer();
}


// timer
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
      socket.emit('timeout', { code: room });
    }
  }, 1000);
}
function stopTimer() {
  if (clientTimer) clearInterval(clientTimer);
  clientTimer = null;
  if (elTimer) elTimer.style.display = 'none';
}

// results
function showResults(correct, message) {
  elResultBox.style.display = 'block';
  elResultText.textContent = (typeof correct === 'boolean') ? (correct ? 'Bonne réponse' : 'Mauvaise réponse') : (message || '');
  elResultText.style.color = correct ? '#2e7d32' : '#c62828';
  setTimeout(() => { elResultBox.style.display = 'none'; }, 2500);
}

// score table rendering
function renderScoreTable(list) {
  players = Array.isArray(list) ? list : players;
  elScoreTable.innerHTML = '<b>Scores</b><br>';
  (players || []).forEach((p, i) => {
    const row = document.createElement('div');
    row.textContent = `${i+1}. ${p.name} — ${p.score || 0} pts`;
    row.style.cursor = 'pointer';
    row.onclick = () => { socket.emit('selectPlayer', { code: room, targetId: p.id }); };
    if (p.id === currentPlayerId) row.style.fontWeight = 'bold';
    elScoreTable.appendChild(row);
  });
}

// highlight action drawn
function highlightAction(name) {
  document.querySelectorAll('.actionCard').forEach(c => {
    c.classList.toggle(
      'activeAction',
      c.dataset.action === name
    );
  });
}


// socket events
socket.on('created', code => { room = code; showGame(); });
socket.on('joined', code => { room = code; showGame(); });
socket.on('players', list => { players = list; renderScoreTable(players); updatePawns(players); });
socket.on('boardData', b => { board = b; updatePawns(players); createActionCards(); });
socket.on('yourTurn', data => {
  currentPlayerId = data && data.playerId;
  activePlayers = [currentPlayerId];
  if (elRoll) elRoll.disabled = (socket.id !== currentPlayerId);
  // visually indicate current player in score table
  renderScoreTable(players);
});
socket.on('rolled', data => {
  if (!data) return;
  if (elDiceResult) elDiceResult.textContent = data.roll;
  if (socket.id === currentPlayerId) showPossibleCases(data.currentPos, data.roll);
});
socket.on("actionDrawn", data => {
  if (!data || !data.action) return;

  // Réinitialise toutes les cartes
  document.querySelectorAll('.actionCard').forEach(c => {
    c.classList.remove("activeAction");
  });

  // Met en valeur celle tirée
  const selected = [...document.querySelectorAll('.actionCard')]
    .find(c => c.dataset.action === data.action);

  if (selected) {
    selected.classList.add("activeAction");
  }
});


socket.on('requestSelection', payload => {
  // show selection to current player only
  if (!payload) return;
  if (payload.initiatorId && payload.initiatorId !== socket.id) return;
  showSelection(payload);
});
socket.on('question', payload => {
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
  // reset action highlight & possible cases after result
  elPossible.innerHTML = '';
  highlightAction('');
  elChoice.style.display = 'none';
  hideQuestion();
});
socket.on('teleport', payload => {
  // server updated positions; players event will reposition pawns
  // optional visual tick
  console.log('teleported to', payload.pos);
});
socket.on('actionClear', () => {
  elPossible.innerHTML = '';
  elChoice.style.display = 'none';
  hideQuestion();
  highlightAction('');
});

// request board/players when joining
socket.on('joined', () => {
  socket.emit('requestBoard');
  socket.emit('requestPlayers');
});

// utility: ensure pad after image load
window.addEventListener('resize', () => updatePawns(players));
elPlateau && elPlateau.addEventListener('load', () => updatePawns(players));

// show game UI
function showGame() {
  if (elMenu) elMenu.style.display = 'none';
  if (elGame) elGame.style.display = 'block';
  if (elRoomDisplay) elRoomDisplay.textContent = room;
  socket.emit('requestBoard');
  socket.emit('requestPlayers');
  if (elRoll) elRoll.disabled = true;
}








