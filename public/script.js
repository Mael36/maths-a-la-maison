const socket = io();
let room = null;
let roll = 0;
let board = null;

const $ = id => document.getElementById(id);

// Chargement du plateau réel
fetch('/data/board.json')
  .then(r => r.json())
  .then(data => {
    board = data;
    createActionGrid();
  });

// 16 CARTES RONDES OFFICIELLES "MATHS À LA MAISON"
function createActionGrid() {
  const grid = $('actionGrid');
  grid.style.display = 'grid';
  grid.style.gridTemplateColumns = 'repeat(4, 1fr)';
  grid.style.gap = '40px';
  grid.style.maxWidth = '1400px';
  grid.style.margin = '50px auto';
  grid.style.padding = '20px';

  const actionNames = [
    "Flash","Battle on left","Battle on right","Call a friend",
    "For you","Second life","No way","Double",
    "Téléportation","+1 ou -1","Everybody","Double or quits",
    "It's your choice","Everybody","No way","Quadruple"
  ];

  actionNames.forEach(name => {
    const card = document.createElement('div');
    card.className = 'actionCard';
    card.innerHTML = `
      <div style="width:220px; height:220px; background:white; border-radius:50%; 
                  box-shadow:0 15px 40px rgba(0,0,0,0.3); display:flex; align-items:center; justify-content:center;
                  border:8px solid #1565c0; margin:0 auto;">
        <div style="width:190px; height:190px; background:url('assets/action-circle.png') center/contain no-repeat;"></div>
      </div>
      <div style="text-align:center; margin-top:25px; font-size:24px; font-weight:bold; color:#1565c0;">
        ACTION
      </div>
      <div style="text-align:center; margin-top:10px; font-size:18px; color:#000;">
        ${name}
      </div>
    `;
    grid.appendChild(card);
  });
}

// PIONS PARFAITEMENT CENTRÉS – CORRIGÉ À 1000 %
function updatePawns(players) {
  const container = $('pions');
  container.innerHTML = '';
  const img = $('plateau');
  if (!img || !board) return;

  // Forcer le recalcul précis
  const rect = img.getBoundingClientRect();
  const imgWidth = img.offsetWidth;
  const imgHeight = img.offsetHeight;

  players.forEach((p, i) => {
    const pos = board.positions[p.pos];
    if (!pos) return;

    // Calcul ultra-précis avec offsetWidth/Height
    const x = (pos.x / 100) * imgWidth;
    const y = (pos.y / 100) * imgHeight;

    const pawn = document.createElement('div');
    pawn.style.position = 'absolute';
    pawn.style.width = '38px';
    pawn.style.height = '38px';
    pawn.style.borderRadius = '50%';
    pawn.style.background = ['#d32f2f','#388e3c','#fbc02d','#1976d2','#f57c00','#7b1fa2'][i % 6];
    pawn.style.border = '5px solid white';
    pawn.style.boxShadow = '0 8px 25px rgba(0,0,0,0.6)';
    pawn.style.color = 'white';
    pawn.style.fontWeight = 'bold';
    pawn.style.fontSize = '20px';
    pawn.style.display = 'flex';
    pawn.style.alignItems = 'center';
    pawn.style.justifyContent = 'center';
    pawn.style.left = x + 'px';
    pawn.style.top = y + 'px';
    pawn.style.transform = 'translate(-50%, -50%)';
    pawn.style.zIndex = '10';
    pawn.textContent = i + 1;
    pawn.title = `${p.name} – ${p.score} pts`;

    container.appendChild(pawn);
  });
}

// Cases dorées : distance exacte + taille parfaite
function showPossibleCases(currentPos, steps) {
  const reachable = new Set();
  const queue = [{pos: currentPos, remaining: steps}];

  while (queue.length) {
    const {pos, remaining} = queue.shift();
    if (remaining === 0) {
      reachable.add(pos);
      continue;
    }

    if (pos < 48) {
      queue.push({pos: (pos + 1) % 48, remaining: remaining - 1});
      if (pos % 4 === 0) {
        const branchStart = 48 + (pos / 4) * 3;
        if (branchStart < 84) queue.push({pos: branchStart, remaining: remaining - 1});
      }
    }
    if (pos >= 48 && pos < 84) {
      const next = pos + 1;
      if (next <= 84) queue.push({pos: next, remaining: remaining - 1});
    }
  }

  $('possibleCases').innerHTML = '';
  const img = $('plateau');
  reachable.forEach(pos => {
    const p = board.positions[pos];
    const x = (p.x / 100) * img.offsetWidth;
    const y = (p.y / 100) * img.offsetHeight;

    const spot = document.createElement('div');
    spot.style.position = 'absolute';
    spot.style.width = '50px';
    spot.style.height = '50px';
    spot.style.background = 'radial-gradient(circle, gold, orange)';
    spot.style.border = '4px solid white';
    spot.style.borderRadius = '50%';
    spot.style.left = x + 'px';
    spot.style.top = y + 'px';
    spot.style.transform = 'translate(-50%, -50%)';
    spot.style.cursor = 'pointer';
    spot.style.boxShadow = '0 0 40px gold';
    spot.style.zIndex = '999';
    spot.onclick = () => {
      socket.emit('moveTo', {code: room, pos});
      $('possibleCases').innerHTML = '';
    };
    $('possibleCases').appendChild(spot);
  });
}

// === INTERACTIONS ===
window.createRoom = () => socket.emit('create', $('playerName').value || 'Hôte');
window.joinRoom = () => {
  const code = $('roomCode').value.trim().toUpperCase();
  if (!code) return alert('Entre un code !');
  socket.emit('join', {code, name: $('playerName').value || 'Joueur'});
};

window.rollDice = () => {
  socket.emit('roll', room);
  $('rollBtn').disabled = true;
  $('rollBtn').textContent = 'Dé lancé...';
};

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
socket.on('gameStart', () => $('startBtn').style.display = 'none');

socket.on('yourTurn', () => {
  $('rollBtn').disabled = false;
  $('rollBtn').textContent = 'Lancer le dé';
});

socket.on('rolled', data => {
  roll = data.roll;
  alert(`Tu as fait ${roll} ! Clique sur une case dorée`);
  showPossibleCases(data.currentPos, roll);
});

socket.on('actionDrawn', data => {
  document.querySelectorAll('.actionCard').forEach(c => c.classList.remove('currentAction'));
  const cards = document.querySelectorAll('.actionCard');
  cards.forEach((card, i) => {
    if (card.textContent.includes(data.action)) {
      card.classList.add('currentAction');
      card.style.transform = 'scale(1.15)';
      card.style.boxShadow = '0 0 60px gold, 0 20px 50px rgba(0,0,0,0.5)';
    }
  });
});

// Forcer le recalcul au redimensionnement
window.addEventListener('resize', () => {
  if (board && room) updatePawns(/* players from server */);
});
