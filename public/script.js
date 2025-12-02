const socket = io();
let room = null;
let board = null;
let currentTimer = null;

const $ = id => document.getElementById(id);

fetch('/data/board.json')
  .then(r => r.json())
  .then(data => { board = data; createActionCards(); });

function createActionCards() {
  const grid = $('actionGrid');
  const actions = [
    "Flash","Battle on left","Battle on right","Call a friend",
    "For you","Second life","No way","Double",
    "Téléportation","+1 ou -1","Everybody","Double or quits",
    "It's your choice","Everybody","No way","Quadruple"
  ];

  actions.forEach(name => {
    const card = document.createElement('div');
    card.className = 'actionCard';
    card.innerHTML = `
      <div class="tree" style="background: url('assets/plateau.png') center/70% no-repeat;"></div>
      <h3>ACTION</h3>
      <p>${name}</p>
    `;
    grid.appendChild(card);
  });
}

function updatePawns(players) {
  $('pions').innerHTML = '';
  const img = $('plateau');
  if (!img || !board) return;
  const w = img.offsetWidth, h = img.offsetHeight;

  players.forEach((p, i) => {
    const pos = board.positions[p.pos];
    const x = (pos.x / 100) * w;
    const y = (pos.y / 100) * h;

    const pawn = document.createElement('div');
    pawn.style.position = 'absolute';
    pawn.style.width = '60px'; pawn.style.height = '60px';
    pawn.style.borderRadius = '50%';
    pawn.style.background = ['#d32f2f','#388e3c','#fbc02d','#1976d2','#f57c00','#7b1fa2'][i % 6];
    pawn.style.border = '8px solid white';
    pawn.style.boxShadow = '0 15px 40px rgba(0,0,0,0.8)';
    pawn.style.color = 'white'; pawn.style.fontSize = '32px'; pawn.style.fontWeight = 'bold';
    pawn.style.display = 'flex'; pawn.style.alignItems = 'center'; pawn.style.justifyContent = 'center';
    pawn.style.left = x + 'px'; pawn.style.top = y + 'px';
    pawn.style.transform = 'translate(-50%, -50%)';
    pawn.textContent = i + 1;
    pawn.title = `${p.name} – ${p.score} pts`;
    $('pions').appendChild(pawn);
  });
}

function showPossibleCases(currentPos, steps) {
  const reachable = new Set();
  const queue = [{pos: currentPos, rem: steps}];
  while (queue.length) {
    const {pos, rem} = queue.shift();
    if (rem === 0) { reachable.add(pos); continue; }
    if (pos < 48) {
      queue.push({pos: (pos + 1) % 48, rem: rem - 1});
      if (pos % 4 === 0) {
        const b = 48 + Math.floor(pos / 4) * 3;
        if (b < 84) queue.push({pos: b, rem: rem - 1});
      }
    }
    if (pos >= 48 && pos < 84 && pos + 1 <= 84) {
      queue.push({pos: pos + 1, rem: rem - 1});
    }
  }

  $('possibleCases').innerHTML = '';
  const img = $('plateau');
  const w = img.offsetWidth, h = img.offsetHeight;

  reachable.forEach(pos => {
    const p = board.positions[pos];
    const x = (p.x / 100) * w;
    const y = (p.y / 100) * h;

    const spot = document.createElement('div');
    spot.style.position = 'absolute';
    spot.style.width = '90px'; spot.style.height = '90px';
    spot.style.background = 'radial-gradient(circle, gold, orange)';
    spot.style.border = '10px solid white';
    spot.style.borderRadius = '50%';
    spot.style.left = x + 'px'; spot.style.top = y + 'px';
    spot.style.transform = 'translate(-50%, -50%)';
    spot.style.cursor = 'pointer';
    spot.style.boxShadow = '0 0 120px gold';
    spot.onclick = () => {
      socket.emit('moveTo', {code: room, targetPos: pos});
      $('possibleCases').innerHTML = '';
    };
    $('possibleCases').appendChild(spot);
  });
}

function startTimer(seconds) {
  if (currentTimer) clearInterval(currentTimer);
  $('timer').style.display = 'block';
  let t = seconds;
  $('timer').textContent = t + 's';
  $('timer').style.background = seconds === 30 ? '#d32f2f' : '#1976d2';

  currentTimer = setInterval(() => {
    t--;
    $('timer').textContent = t + 's';
    if (t <= 0) { clearInterval(currentTimer); $('timer').style.display = 'none'; }
  }, 1000);
}

// === INTERACTIONS ===
window.createRoom = () => socket.emit('create', $('playerName').value || 'Hôte');
window.joinRoom = () => {
  const code = $('roomCode').value.trim().toUpperCase();
  if (!code) return alert('Entre un code !');
  socket.emit('join', {code, name: $('playerName').value || 'Joueur'});
};
window.rollDice = () => { socket.emit('roll', room); $('rollBtn').disabled = true; };
window.sendAnswer = () => {
  const ans = $('answerInput').value.trim();
  if (ans) socket.emit('answer', {code: room, answer: ans});
  $('answerInput').value = '';
};
$('startBtn').onclick = () => socket.emit('start', room);

// === SOCKET ===
socket.on('created', code => { room = code; showGame(code); });
socket.on('joined', code => { room = code; showGame(code); });
socket.on('error', msg => alert(msg));
function showGame(code) {
  $('menu').style.display = 'none';
  $('game').style.display = 'block';
  $('roomDisplay').textContent = code;
}

socket.on('players', players => updatePawns(players));
socket.on('yourTurn', () => { $('rollBtn').disabled = false; $('rollBtn').textContent = 'Lancer le dé'; });
socket.on('rolled', data => {
  alert(`Tu as fait ${data.roll} ! Clique sur une case dorée`);
  showPossibleCases(data.currentPos, data.roll);
});
socket.on('actionDrawn', data => {
  document.querySelectorAll('.actionCard').forEach(c => c.style.transform = 'scale(1)');
  document.querySelectorAll('.actionCard').forEach(c => {
    if (c.textContent.includes(data.action)) c.style.transform = 'scale(1.4)';
  });
});
socket.on('question', q => {
  $('themeTitle').textContent = q.theme || 'Maths';
  $('questionText').textContent = q.question;
  $('questionBox').style.display = 'block';
  $('answerInput').focus();
  startTimer(q.action === 'Flash' ? 30 : 60);
});
socket.on('result', data => {
  clearInterval(currentTimer);
  $('timer').style.display = 'none';
  $('resultText').textContent = data.correct ? `BRAVO ${data.player} ! +1 point` : `Dommage ${data.player}...`;
  $('resultText').style.color = data.correct ? '#4caf50' : '#f44336';
  $('resultBox').style.display = 'block';
  setTimeout(() => {
    $('questionBox').style.display = 'none';
    $('resultBox').style.display = 'none';
  }, 5000);
});
