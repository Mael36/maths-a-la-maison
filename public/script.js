const socket = io();
let room = null;
let board = null;
let currentTimer = null;

const $ = id => document.getElementById(id);

// Chargement plateau
fetch('/data/board.json')
  .then(r => r.json())
  .then(data => { board = data; createActionIcons(); });

// 1. CARTES ACTION → PETITES EN HAUT À GAUCHE (comme tu l’as demandé)
function createActionIcons() {
  const container = document.createElement('div');
  container.id = 'actionIcons';
  container.style.position = 'fixed';
  container.style.top = '20px';
  container.style.left = '20px';
  container.style.zIndex = '1000';
  container.style.display = 'grid';
  container.style.gridTemplateColumns = 'repeat(4, 1fr)';
  container.style.gap = '15px';
  container.style.background = 'rgba(255,255,255,0.95)';
  container.style.padding = '20px';
  container.style.borderRadius = '20px';
  container.style.boxShadow = '0 10px 30px rgba(0,0,0,0.4)';
  container.style.maxWidth = '480px';

  const actions = ["Flash","Battle on left","Battle on right","Call a friend","For you","Second life","No way","Double",
                   "Téléportation","+1 ou -1","Everybody","Double or quits","It's your choice","Everybody","No way","Quadruple"];

  actions.forEach(name => {
    const div = document.createElement('div');
    div.className = 'actionIcon';
    div.innerHTML = `
      <div style="width:80px;height:80px;background:white;border-radius:50%;overflow:hidden;
                  border:6px solid #1565c0;box-shadow:0 8px 20px rgba(0,0,0,0.3);">
        <img src="assets/action-circle.png" style="width:100%;height:100%;object-fit:contain;">
      </div>
      <div style="text-align:center;margin-top:8px;font-weight:bold;color:#1565c0;font-size:13px;">${name}</div>
    `;
    container.appendChild(div);
  });

  document.body.appendChild(container);
}

// 2. PIONS TOUJOURS VISIBLES + CENTRÉS PARFAITEMENT
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
    pawn.style.width = '50px';
    pawn.style.height = '50px';
    pawn.style.borderRadius = '50%';
    pawn.style.background = ['#d32f2f','#388e3c','#fbc02d','#1976d2','#f57c00','#7b1fa2'][i % 6];
    pawn.style.border = '6px solid white';
    pawn.style.boxShadow = '0 10px 30px rgba(0,0,0,0.7)';
    pawn.style.color = 'white';
    pawn.style.fontSize = '26px';
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

// 3. CASES DORÉES PARFAITEMENT CENTRÉES
function showPossibleCases(currentPos, steps) {
  const reachable = new Set();
  const queue = [{pos: currentPos, rem: steps}];

  while (queue.length) {
    const {pos, rem} = queue.shift();
    if (rem === 0) { reachable.add(pos); continue; }
    if (pos < 48) {
      queue.push({pos: (pos + 1) % 48, rem: rem - 1});
      if (pos % 4 === 0) {
        const b = 48 + (pos / 4) * 3;
        if (b < 84) queue.push({pos: b, rem: rem - 1});
      }
    }
    if (pos >= 48 && pos < 84) {
      const next = pos + 1;
      if (next <= 84) queue.push({pos: next, rem: rem - 1});
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
    spot.style.width = '70px';
    spot.style.height = '70px';
    spot.style.background = 'radial-gradient(circle, gold, orange)';
    spot.style.border = '8px solid white';
    spot.style.borderRadius = '50%';
    spot.style.left = x + 'px';
    spot.style.top = y + 'px';
    spot.style.transform = 'translate(-50%, -50%)';
    spot.style.cursor = 'pointer';
    spot.style.boxShadow = '0 0 80px gold';
    spot.style.zIndex = '999';
    spot.onclick = () => {
      socket.emit('moveTo', {code: room, targetPos: pos});
      $('possibleCases').innerHTML = '';
    };
    $('possibleCases').appendChild(spot);
  });
}

// 4. TIMER 60s / 30s (Flash) EN HAUT À DROITE
function startTimer(seconds) {
  if (currentTimer) clearInterval(currentTimer);
  $('timer').style.display = 'block';
  let time = seconds;
  $('timer').textContent = `${time}s`;

  currentTimer = setInterval(() => {
    time--;
    $('timer').textContent = `${time}s`;
    if (time <= 0) {
      clearInterval(currentTimer);
      $('timer').style.display = 'none';
    }
  }, 1000);
}

// === SOCKET & INTERACTIONS ===
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
  alert(`Tu as fait ${data.roll} ! Choisis une case dorée`);
  showPossibleCases(data.currentPos, data.roll);
});

// Action tirée → icône en surbrillance
socket.on('actionDrawn', data => {
  document.querySelectorAll('.actionIcon').forEach(ic => ic.style.opacity = '0.4');
  const icons = document.querySelectorAll('.actionIcon');
  icons.forEach(ic => {
    if (ic.textContent.includes(data.action)) {
      ic.style.opacity = '1';
      ic.style.transform = 'scale(1.3)';
      setTimeout(() => ic.style.transform = 'scale(1)', 500);
    }
  });
});

// Question + timer 60s ou 30s si Flash
socket.on('question', q => {
  $('themeTitle').textContent = q.theme || 'Maths';
  $('questionText').textContent = q.question;
  $('questionBox').style.display = 'block';
  $('answerInput').focus();

  const isFlash = q.action === 'Flash';
  startTimer(isFlash ? 30 : 60);
});

// Résultat avec Bonne/Mauvaise réponse + score
socket.on('result', data => {
  clearInterval(currentTimer);
  $('timer').style.display = 'none';

  const msg = data.correct
    ? `BRAVO ${data.player} ! +${data.points} point(s)`
    : `Dommage ${data.player}... ${data.points < 0 ? data.points : '0'} point`;

  $('resultText').textContent = msg;
  $('resultText').style.color = data.correct ? '#4caf50' : '#f44336';
  $('resultBox').style.display = 'block';

  setTimeout(() => {
    $('questionBox').style.display = 'none';
    $('resultBox').style.display = 'none';
  }, 4000);
});

// Recalcul au redimensionnement
window.addEventListener('resize', () => updatePawns([]));
