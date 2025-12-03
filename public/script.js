// public/script.js
const socket = io();
let room = null;
let board = null;
let timer = null;
let currentPlayerId = null;
let activePlayers = [];

const $ = id => document.getElementById(id);

// create action cards with exact data-action attribute
function createActionCards() {
  const grid = $('actionGrid');
  if (!grid) return;
  grid.innerHTML = '';

  const actions = [
    "Flash","Battle on left","Battle on right","Call a friend","For you",
    "Second life","No way","Double","Téléportation","+1 ou -1",
    "Everybody","Double or quits","It's your choice","Quadruple"
  ];

  actions.forEach(name => {
    const card = document.createElement('div');
    card.className = 'actionCard';
    card.setAttribute('data-action', name);
    card.innerHTML = `<h4>${name}</h4>`;
    grid.appendChild(card);
  });
}

function updatePawns(players) {
  const container = $('pions');
  if (!container || !board) return;
  container.innerHTML = '';
  const img = $('plateau');
  const w = img.offsetWidth, h = img.offsetHeight;

  players.forEach((p, i) => {
    const posIndex = Math.min(Math.max(p.pos || 0, 0), board.positions.length - 1);
    const pos = board.positions[posIndex];
    const x = (pos.x / 100) * w;
    const y = (pos.y / 100) * h;

    const pawn = document.createElement('div');
    pawn.style.cssText = `
      position:absolute;width:35px;height:35px;border-radius:50%;
      background:${['#d32f2f','#388e3c','#fbc02d','#1976d2','#f57c00','#7b1fa2'][i%6]};
      border:3px solid white;display:flex;align-items:center;justify-content:center;
      left:${x}px;top:${y}px;transform:translate(-50%,-50%);
    `;
    pawn.textContent = i + 1;
    pawn.title = `${p.name} – ${p.score} pts`;
    container.appendChild(pawn);
  });
}

function showPossibleCases(currentPos, steps) {
  if (!board) return;
  const reachable = new Set();
  const q = [{ pos: currentPos, rem: steps }];
  while (q.length) {
    const { pos, rem } = q.shift();
    if (rem === 0) { reachable.add(pos); continue; }
    if (pos < board.positions.length - 1) q.push({ pos: pos + 1, rem: rem - 1 });
  }

  const el = $('possibleCases');
  el.innerHTML = '';
  const img = $('plateau');
  const w = img.offsetWidth, h = img.offsetHeight;

  reachable.forEach(pos => {
    const p = board.positions[pos];
    const x = (p.x / 100) * w, y = (p.y / 100) * h;
    const spot = document.createElement('div');
    spot.style.cssText = `
      position:absolute;width:50px;height:50px;border-radius:50%;
      background:radial-gradient(circle,gold,orange);border:4px solid white;
      left:${x}px;top:${y}px;transform:translate(-50%,-50%);
      cursor:pointer;z-index:999;
    `;
    spot.onclick = () => {
      // optionally include friend selection if client tracked it
      socket.emit('moveTo', { code: room, pos });
      el.innerHTML = '';
    };
    el.appendChild(spot);
  });
}

function startTimer(sec) {
  if (timer) clearInterval(timer);
  const el = $('timer');
  el.style.display = 'block';
  let t = sec;
  el.textContent = t + 's';
  timer = setInterval(() => {
    t--;
    el.textContent = t + 's';
    if (t <= 0) { clearInterval(timer); el.style.display = 'none'; clearInterval(timer); }
  }, 1000);
}

function updateScoreTable(players) {
  let table = $('scoreTable');
  if (!table) {
    table = document.createElement('div');
    table.id = 'scoreTable';
    table.style.cssText = 'position:absolute;top:10px;right:10px;background:#fff;padding:8px;border-radius:6px;min-width:140px;z-index:2000;';
    document.body.appendChild(table);
  }
  table.innerHTML = '<b>Scores :</b><br>';
  players.forEach((p, i) => {
    const line = document.createElement('div');
    line.textContent = `${p.name}: ${p.score} pts`;
    line.dataset.playerId = p.id;
    line.style.cursor = 'pointer';
    line.onclick = () => { socket.emit('selectPlayer', { target: p.id, code: room }); };
    if (currentPlayerId === p.id) line.style.fontWeight = 'bold';
    table.appendChild(line);
  });
}

// UI wiring
$('createBtn').onclick = () => socket.emit('create', $('playerName').value || 'Hôte');
$('joinBtn').onclick = () => socket.emit('join', { code: $('roomCode').value.trim().toUpperCase(), name: $('playerName').value || 'Joueur' });
$('startBtn').onclick = () => socket.emit('start', room);
$('rollBtn').onclick = () => {
  socket.emit('roll', room);
  $('rollBtn').disabled = true;
  // reset dice result until server replies
  const dr = $('diceResult');
  if (dr) dr.textContent = 'Résultat du dé : -';
};
$('sendAnswerBtn').onclick = () => {
  const ans = $('answerInput').value.trim();
  if (ans) socket.emit('answer', { code: room, answer: ans });
  $('answerInput').value = '';
};

// SOCKET handlers
socket.on('created', code => { room = code; showGame(); });
socket.on('joined', code => { room = code; showGame(); });
socket.on('boardData', b => { board = b; createActionCards(); updatePawns([]); });
socket.on('players', players => { updatePawns(players); updateScoreTable(players); });

socket.on('yourTurn', data => {
  currentPlayerId = data?.playerId || null;
  activePlayers = [currentPlayerId];
  $('rollBtn').disabled = currentPlayerId !== socket.id;
  $('rollBtn').textContent = 'Lancer le dé';
});

socket.on('rolled', data => {
  if (!data) return;
  // show dice result on interface
  let dr = $('diceResult');
  if (!dr) {
    dr = document.createElement('div');
    dr.id = 'diceResult';
    dr.style.cssText = 'position:absolute;top:50px;right:10px;font-weight:bold;z-index:2000;';
    document.body.appendChild(dr);
  }
  dr.textContent = `Résultat du dé : ${data.roll}`;
  const isActive = activePlayers.includes(socket.id);
  if (isActive) showPossibleCases(data.currentPos, data.roll);
});

socket.on('actionDrawn', data => {
  if (!data || !data.action) return;
  document.querySelectorAll('.actionCard').forEach(c => {
    c.style.transform = 'scale(1)';
    c.classList.remove('highlighted');
  });
  // highlight exact action using data-action
  const sel = Array.from(document.querySelectorAll('.actionCard')).find(c => c.dataset.action === data.action);
  if (sel) { sel.style.transform = 'scale(1.2)'; sel.classList.add('highlighted'); }
});

socket.on('question', data => {
  if (!data) return;
  // data.players may list who should see the question
  const playersAllowed = data.players || [];
  const showForMe = playersAllowed.length === 0 ? true : playersAllowed.includes(socket.id);
  if (!showForMe) return;
  $('themeTitle').textContent = data.theme || 'Général';
  $('questionText').textContent = data.question;
  $('questionBox').style.display = 'block';
  startTimer(data.timer || 60);
});

socket.on('timeOut', data => {
  clearInterval(timer); $('timer').style.display = 'none';
  $('resultText').textContent = data?.message || 'Temps écoulé';
  $('resultText').style.color = '#f44336';
  $('resultBox').style.display = 'block';
  setTimeout(() => { $('resultBox').style.display = 'none'; $('questionBox').style.display = 'none'; }, 2500);
});

socket.on('results', data => {
  clearInterval(timer); $('timer').style.display = 'none';
  if (!data) return;
  // data.correctness is a map { playerId: boolean }
  const correctness = data.correctness || {};
  const myCorrect = correctness[socket.id];
  if (typeof myCorrect === 'boolean') {
    $('resultText').textContent = myCorrect ? 'Bonne réponse' : 'Mauvaise réponse';
    $('resultText').style.color = myCorrect ? '#388e3c' : '#f44336';
    $('resultBox').style.display = 'block';
    setTimeout(() => { $('resultBox').style.display = 'none'; $('questionBox').style.display = 'none'; }, 2500);
  } else {
    // fallback: if no per-player info, show generic message
    $('resultText').textContent = 'Résultats';
    $('resultText').style.color = '#1976d2';
    $('resultBox').style.display = 'block';
    setTimeout(() => { $('resultBox').style.display = 'none'; }, 1500);
  }

  // update scoreboard
  if (Array.isArray(data.players)) updateScoreTable(data.players);
});

socket.on('actionClear', () => { document.querySelectorAll('.actionCard').forEach(c => c.style.transform = 'scale(1)'); });

// showGame
function showGame() {
  $('menu').style.display = 'none';
  $('game').style.display = 'block';
  $('roomDisplay').textContent = room;
  socket.emit('requestBoard');

  // ensure dice result element exists
  if (!$('diceResult')) {
    const div = document.createElement('div');
    div.id = 'diceResult';
    div.style.cssText = 'position:absolute;top:50px;right:10px;font-weight:bold;z-index:2000;';
    div.textContent = 'Résultat du dé : -';
    document.body.appendChild(div);
  }
}
