const socket = io();
let room = null;
let roll = 0;
let board = null;

const $ = id => document.getElementById(id);

// Chargement du plateau réel (85 cases)
fetch('/data/board.json')
  .then(r => r.json())
  .then(data => {
    board = data;
    createActionGrid();
  });

// 16 cartes Action sans image → ton design rond officiel
function createActionGrid() {
  const grid = $('actionGrid');
  grid.style.display = 'grid';
  grid.style.gridTemplateColumns = 'repeat(4, 1fr)';
  grid.style.gap = '20px';
  grid.style.maxWidth = '1000px';
  grid.style.margin = '40px auto';

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
      <div style="width:180px; height:180px; background:white; border-radius:50%; 
                  display:flex; flex-direction:column; align-items:center; justify-content:center;
                  box-shadow:0 10px 30px rgba(0,0,0,0.3); margin:0 auto;">
        <img src="assets/action-circle.png" style="width:140px; height:140px;">
        <strong style="margin-top:10px; color:#1565c0; font-size:16px;">ACTION</strong>
      </div>
      <div style="text-align:center; margin-top:15px; padding:10px; background:#1565c0; color:white; border-radius:12px;">
        <strong>${name}</strong>
      </div>
    `;
    grid.appendChild(card);
  });
}

// PIONS PETITS ET PARFAITEMENT CENTRÉS
function updatePawns(players) {
  $('pions').innerHTML = '';
  const img = $('plateau');
  if (!img || !board) return;
  const rect = img.getBoundingClientRect();

  players.forEach((p, i) => {
    const pos = board.positions[p.pos];
    const x = rect.width * (pos.x / 100);
    const y = rect.height * (pos.y / 100);

    const pawn = document.createElement('div');
    pawn.className = 'pawn';
    pawn.style.position = 'absolute';
    pawn.style.width = '36px';
    pawn.style.height = '36px';
    pawn.style.borderRadius = '50%';
    pawn.style.background = ['#f44336','#4caf50','#ffeb3b','#2196f3','#ff9800','#9c27b0'][i];
    pawn.style.border = '4px solid white';
    pawn.style.boxShadow = '0 4px 15px rgba(0,0,0,0.5)';
    pawn.style.color = 'white';
    pawn.style.fontWeight = 'bold';
    pawn.style.fontSize = '18px';
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

// CASES DORÉES : DISTANCE EXACTE + TAILLE RÉDUITE
function showPossibleCases(currentPos, steps) {
  const reachable = new Set();
  const queue = [{pos: currentPos, remaining: steps}];

  while (queue.length) {
    const {pos, remaining} = queue.shift();
    if (remaining === 0) {
      reachable.add(pos);
      continue;
    }

    // Cercle extérieur (0-47)
    if (pos < 48) {
      const nextCircle = (pos + 1) % 48;
      queue.push({pos: nextCircle, remaining: remaining - 1});

      // Embranchement toutes les 4 cases
      if (pos % 4 === 0) {
        const branchIndex = pos / 4;
        const branchStart = 48 + branchIndex * 3;
        if (branchStart < 84) {
          queue.push({pos: branchStart, remaining: remaining - 1});
        }
      }
    }

    // Dans une branche
    if (pos >= 48 && pos < 84) {
      const next = pos + 1;
      if (next <= 84) {
        queue.push({pos: next, remaining: remaining - 1});
      }
    }
  }

  // Affichage des cases dorées (petites et précises)
  $('possibleCases').innerHTML = '';
  reachable.forEach(pos => {
    const p = board.positions[pos];
    const spot = document.createElement('div');
    spot.style.position = 'absolute';
    spot.style.width = '50px';
    spot.style.height = '50px';
    spot.style.background = 'radial-gradient(circle, gold, orange)';
    spot.style.border = '4px solid white';
    spot.style.borderRadius = '50%';
    spot.style.left = (p.x / 100 * $('plateau').width - 25) + 'px';
    spot.style.top = (p.y / 100 * $('plateau').height - 25) + 'px';
    spot.style.cursor = 'pointer';
    spot.style.boxShadow = '0 0 30px gold';
    spot.style.zIndex = '999';
    spot.style.transform = 'translate(-50%, -50%)';
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
  const card = [...document.querySelectorAll('.actionCard')].find(c => c.querySelector('strong')?.textContent === data.action);
  if (card) card.classList.add('currentAction');
});
