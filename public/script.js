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

// 16 CARTES OFFICIELLES – TES IMAGES + TES RONDS "MATHS À LA MAISON"
function createActionGrid() {
  const grid = $('actionGrid');
  grid.style.display = 'grid';
  grid.style.gridTemplateColumns = 'repeat(4, 1fr)';
  grid.style.gap = '30px';
  grid.style.maxWidth = '1400px';
  grid.style.margin = '60px auto';
  grid.style.padding = '40px';
  grid.style.background = '#e1f5fe';
  grid.style.borderRadius = '30px';

  const actions = [
    {name: "Flash", img: "actions/flash.jpg"},
    {name: "Battle on left", img: "actions/battle_left.jpg"},
    {name: "Battle on right", img: "actions/battle_right.jpg"},
    {name: "Call a friend", img: "actions/call_friend.jpg"},
    {name: "For you", img: "actions/for_you.jpg"},
    {name: "Second life", img: "actions/second_life.jpg"},
    {name: "No way", img: "actions/no_way.jpg"},
    {name: "Double", img: "actions/double.jpg"},
    {name: "Téléportation", img: "actions/teleport.jpg"},
    {name: "+1 ou -1", img: "actions/plus_minus.jpg"},
    {name: "Everybody", img: "actions/everybody.jpg"},
    {name: "Double or quits", img: "actions/double_quits.jpg"},
    {name: "It's your choice", img: "actions/choice.jpg"},
    {name: "Everybody", img: "actions/everybody.jpg"},
    {name: "No way", img: "actions/no_way.jpg"},
    {name: "Quadruple", img: "actions/quadruple.jpg"}
  ];

  actions.forEach((a, i) => {
    const card = document.createElement('div');
    card.className = 'actionCard';
    card.innerHTML = `
      <div style="width:260px; height:260px; background:white; border-radius:50%; 
                  box-shadow:0 20px 50px rgba(0,0,0,0.3); display:flex; align-items:center; justify-content:center;
                  border:12px solid #1565c0; margin:0 auto; overflow:hidden;">
        <img src="assets/action-circle.png" style="width:100%; height:100%; object-fit:contain;">
        <div style="position:absolute; width:100%; height:100%; background:rgba(0,0,0,0.4); display:flex; align-items:center; justify-content:center;">
          <img src="${a.img}" style="width:85%; height:85%; object-fit:contain; border-radius:15px;">
        </div>
      </div>
      <div style="text-align:center; margin-top:30px; font-size:28px; font-weight:bold; color:#1565c0;">
        ${a.name}
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
    pawn.style.width = '44px';
    pawn.style.height = '44px';
    pawn.style.borderRadius = '50%';
    pawn.style.background = ['#d32f2f','#388e3c','#fbc02d','#1976d2','#f57c00','#7b1fa2'][i % 6];
    pawn.style.border = '6px solid white';
    pawn.style.boxShadow = '0 10px 30px rgba(0,0,0,0.7)';
    pawn.style.color = 'white';
    pawn.style.fontWeight = 'bold';
    pawn.style.fontSize = '24px';
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
    spot.style.width = '60px';
    spot.style.height = '60px';
    spot.style.background = 'radial-gradient(circle, gold, orange)';
    spot.style.border = '6px solid white';
    spot.style.borderRadius = '50%';
    spot.style.left = x + 'px';
    spot.style.top = y + 'px';
    spot.style.transform = 'translate(-50%, -50%)';
    spot.style.cursor = 'pointer';
    spot.style.boxShadow = '0 0 60px gold, inset 0 0 30px white';
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
  if (ans) socket.emit('answer',', {code: room, answer: ans});
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
  const cards = document.querySelectorAll('.actionCard');
  cards.forEach(card => {
    if (card.textContent.includes(data.action)) {
      card.classList.add('currentAction');
      card.style.transform = 'scale(1.25)';
      card.style.boxShadow = '0 0 100px gold';
    }
  });
});

// QUESTIONS POSÉES DEPUIS public/data.json
socket.on('question', q => {
  $('themeTitle').textContent = `Thème : ${q.theme || 'Général'}`;
  $('questionText').textContent = q.question;
  $('questionBox').style.display = 'block';
  $('answerInput').focus();

  if (q.timer) {
    let t = q.timer;
    $('flashTimer').style.display = 'block';
    $('flashTimer').textContent = t + 's';
    const int = setInterval(() => {
      t--;
      $('flashTimer').textContent = t + 's';
      if (t <= 0) {
        clearInterval(int);
        $('flashTimer').style.display = 'none';
      }
    }, 1000);
  }
});

socket.on('results', data => {
  $('results').innerHTML = `<h3>Résultat – ${data.action || 'Question'}</h3>` +
    data.results.map(r => `<strong>${r.correct ? 'Correct' : 'Faux'}</strong> ${r.player} → ${r.score} pts`).join('<br>');
  $('questionBox').style.display = 'none';
  $('flashTimer').style.display = 'none';
});
