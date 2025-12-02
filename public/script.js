const socket = io();
let room = null;
let currentRoll = 0;
let board = null;

const $ = id => document.getElementById(id);

// Chargement du plateau (85 cases)
fetch('/data/board.json')
  .then(r => r.json())
  .then(data => {
    board = data;
    createActionGrid();
  });

// 16 CARTES ACTION RONDES OFFICIELLES – TON DESIGN EXACT (arbre + "ACTION")
function createActionGrid() {
  const grid = $('actionGrid');
  grid.style.display = 'grid';
  grid.style.gridTemplateColumns = 'repeat(4, 1fr)';
  grid.style.gap = '50px';
  grid.style.maxWidth = '1600px';
  grid.style.margin = '80px auto';
  grid.style.padding = '40px';
  grid.style.background = '#e1f5fe';
  grid.style.borderRadius = '40px';
  grid.style.boxShadow = '0 20px 60px rgba(0,0,0,0.2)';

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
      <div style="width:280px; height:280px; background:white; border-radius:50%; 
                  box-shadow:0 25px 70px rgba(0,0,0,0.4); display:flex; flex-direction:column; 
                  align-items:center; justify-content:center; border:14px solid #1565c0; margin:0 auto;">
        <div style="width:240px; height:240px; background:url('assets/plateau.png') center/70% no-repeat;"></div>
      </div>
      <div style="text-align:center; margin-top:40px; font-size:36px; font-weight:bold; color:#1565c0;">
        ACTION
      </div>
      <div style="text-align:center; margin-top:15px; font-size:26px; color:#000;">
        ${name}
      </div>
    `;
    grid.appendChild(card);
  });
}

// PIONS PARFAITEMENT CENTRÉS – 100 % CORRIGÉ
function updatePawns(players) {
  const container = $('pions');
  container.innerHTML = '';
  const img = $('plateau');
  if (!img || !board) return;

  const imgWidth = img.offsetWidth;
  const imgHeight = img.offsetHeight;

  players.forEach((p, i) => {
    const pos = board.positions[p.pos];
    if (!pos) return;

    const x = (pos.x / 100) * imgWidth;
    const y = (pos.y / 100) * imgHeight;

    const pawn = document.createElement('div');
    pawn.style.position = 'absolute';
    pawn.style.width = '48px';
    pawn.style.height = '48px';
    pawn.style.borderRadius = '50%';
    pawn.style.background = ['#d32f2f','#388e3c','#fbc02d','#1976d2','#f57c00','#7b1fa2'][i % 6];
    pawn.style.border = '6px solid white';
    pawn.style.boxShadow = '0 12px 35px rgba(0,0,0,0.7)';
    pawn.style.color = 'white';
    pawn.style.fontWeight = 'bold';
    pawn.style.fontSize = '26px';
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

// Cases dorées : distance parfaite
function showPossibleCases(currentPos, steps) {
  const reachable = new Set();
  const queue = [{pos: currentPos, remaining: steps}];

  while (queue.length) {
    const {pos, remaining} = queue.shift();
    if (remaining === 0) { reachable.add(pos); continue; }

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
    spot.style.width = '64px';
    spot.style.height = '64px';
    spot.style.background = 'radial-gradient(circle, gold, orange)';
    spot.style.border = '7px solid white';
    spot.style.borderRadius = '50%';
    spot.style.left = x + 'px';
    spot.style.top = y + 'px';
    spot.style.transform = 'translate(-50%, -50%)';
    spot.style.cursor = 'pointer';
    spot.style.boxShadow = '0 0 70px gold, inset 0 0 30px white';
    spot.style.zIndex = '999';
    spot.onclick = () => {
      socket.emit('moveTo', {code: room, targetPos: pos});
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
  currentRoll = data.roll;
  alert(`Tu as fait ${currentRoll} ! Clique sur une case dorée`);
  showPossibleCases(data.currentPos, currentRoll);
});

socket.on('actionDrawn', data => {
  document.querySelectorAll('.actionCard').forEach(c => c.classList.remove('currentAction'));
  document.querySelectorAll('.actionCard').forEach(card => {
    if (card.textContent.includes(data.action)) {
      card.classList.add('currentAction');
      card.style.transform = 'scale(1.3)';
      card.style.boxShadow = '0 0 120px gold';
    }
  });
});

// QUESTIONS POSÉES DEPUIS public/data.json
socket.on('question', q => {
  $('themeTitle').textContent = `Thème : ${q.theme || 'Maths'}`;
  $('questionText').textContent = q.question;
  $('questionBox').style.display = 'block';
  $('answerInput').focus();
});

socket.on('results', () => {
  $('questionBox').style.display = 'none';
});
