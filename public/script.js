const socket = io();
let room = null;
let board = null;
let currentTimer = null;

const $ = id => document.getElementById(id);

// Chargement du plateau
fetch('/data/board.json')
  .then(r => r.json())
  .then(data => { board = data; createActionCards(); });

// CARTES ACTION RONDES EXACTEMENT COMME LES TIENNES (arbre + ACTION + nom)
function createActionCards() {
  const grid = $('actionGrid');
  grid.innerHTML = '';
  grid.style.display = 'grid';
  grid.style.gridTemplateColumns = 'repeat(4, 1fr)';
  grid.style.gap = '50px';
  grid.style.maxWidth = '1800px';
  grid.style.margin = '80px auto';
  grid.style.padding = '40px';
  grid.style.background = '#bbdefb';
  grid.style.borderRadius = '40px';

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
      <div style="width:300px;height:300px;background:white;border-radius:50%;
                  box-shadow:0 30px 80px rgba(0,0,0,0.4);display:flex;flex-direction:column;
                  align-items:center;justify-content:center;border:16px solid #1565c0;margin:0 auto;">
        <img src="assets/action-circle.png" style="width:260px;height:260px;object-fit:contain;">
      </div>
      <div style="text-align:center;margin-top:40px;font-size:40px;font-weight:bold;color:#1565c0;">
        ACTION
      </div>
      <div style="text-align:center;margin-top:20px;font-size:32px;color:#000;">
        ${name}
      </div>
    `;
    grid.appendChild(card);
  });
}

// PIONS PARFAITEMENT CENTRÉS
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
    pawn.style.width = '56px';
    pawn.style.height = '56px';
    pawn.style.borderRadius = '50%';
    pawn.style.background = ['#d32f2f','#388e3c','#fbc02d','#1976d2','#f57c00','#7b1fa2'][i % 6];
    pawn.style.border = '7px solid white';
    pawn.style.boxShadow = '0 12px 40px rgba(0,0,0,0.8)';
    pawn.style.color = 'white';
    pawn.style.fontSize = '30px';
    pawn.style.fontWeight = 'bold';
    pawn.style.display = 'flex';
    pawn.style.alignItems = 'center';
    pawn.style.justifyContent = 'center';
    pawn.style.left = x + 'px';
    pawn.style.top = y + 'px';
    pawn.style.transform = 'translate(-50%, -50%)';
    pawn.style.zIndex = '10';
    pawn.textContent = i + 1;
    pawn.title = `${p.name} – ${p.score} pts`;
    $('pions').appendChild(pawn);
  });
}

// CASES DORÉES PARFAITEMENT CENTRÉES
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
    if (pos >= 48 && pos < 84) {
      if (pos + 1 <= 84) queue.push({pos: pos + 1, rem: rem - 1});
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
    spot.style.width = '80px';
    spot.style.height = '80px';
    spot.style.background = 'radial-gradient(circle, gold, orange)';
    spot.style.border = '10px solid white';
    spot.style.borderRadius = '50%';
    spot.style.left = x + 'px';
    spot.style.top = y + 'px';
    spot.style.transform = 'translate(-50%, -50%)';
    spot.style.cursor = 'pointer';
    spot.style.boxShadow = '0 0 100px gold, inset 0 0 40px white';
    spot.style.zIndex = '999';
    spot.onclick = () => {
      socket.emit('moveTo', {code: room, targetPos: pos});
      $('possibleCases').innerHTML = '';
    };
    $('possibleCases').appendChild(spot);
  });
}

// TIMER 60s / 30s si Flash
function startTimer(seconds) {
  if (currentTimer) clearInterval(currentTimer);
  $('flashTimer').style.display = 'block';
  let time = seconds;
  $('flashTimer').textContent = `${time}s`;
  $('flashTimer').style.background = seconds === 30 ? '#d32f2f' : '#1976d2';

  currentTimer = setInterval(() => {
    time--;
    $('flashTimer').textContent = `${time}s`;
    if (time <= 0) {
      clearInterval(currentTimer);
      $('flashTimer').style.display = 'none';
    }
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
  document.querySelectorAll('.actionCard').forEach(card => {
    if (card.textContent.includes(data.action)) {
      card.style.transform = 'scale(1.3)';
      card.style.boxShadow = '0 0 120px gold, 0 40px 100px rgba(0,0,0,0.6)';
    }
  });
});

// QUESTION + TIMER
socket.on('question', q => {
  $('themeTitle').textContent = q.theme || 'Maths à la maison';
  $('questionText').textContent = q.question;
  $('questionBox').style.display = 'block';
  $('answerInput').focus();

  const isFlash = q.action === 'Flash';
  startTimer(isFlash ? 30 : 60);
});

// RÉSULTAT BONNE/MAUVAISE RÉPONSE
socket.on('result', data => {
  clearInterval(currentTimer);
  $('flashTimer').style.display = 'none';

  const msg = data.correct
   
