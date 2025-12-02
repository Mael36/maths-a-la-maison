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

// 16 CARTES ACTION – DESIGN OFFICIEL "MATHS À LA MAISON" (fond noir, texte blanc)
function createActionGrid() {
  const grid = $('actionGrid');
  grid.style.display = 'grid';
  grid.style.gridTemplateColumns = 'repeat(4, 1fr)';
  grid.style.gap = '25px';
  grid.style.maxWidth = '1300px';
  grid.style.margin = '50px auto';
  grid.style.padding = '20px';

  const actions = [
    {name:"Flash", text:"Tu dois répondre en moins de 30 secondes à la question !"},
    {name:"Battle on left", text:"Tu dois répondre plus vite que ton voisin de gauche. Si l’un de vous deux répond juste avant toi, c’est lui qui remporte le point sinon c’est toi."},
    {name:"Battle on right", text:"Tu dois répondre plus vite que ton voisin de droite. Si l’un de vous deux répond juste avant toi, c’est lui qui remporte le point sinon c’est toi."},
    {name:"Call a friend", text:"Choisis le partenaire de ton choix. Cherchez la réponse à 2. Si vous réussissez, vous remportez 1 point tous les 2."},
    {name:"For you", text:"Choisis le joueur qui répondra à ta place. S’il réussit, vous remportez chacun 1 point."},
    {name:"Second life", text:"Si tu ne réussis pas la prochaine question, tu peux piocher une autre question dans la même catégorie et retenter ta chance."},
    {name:"No way", text:"Réponds correctement à la question sinon tu offres 1 point à chacun des autres joueurs."},
    {name:"Double", text:"Si tu réussis la question, tu gagnes 2 points."},
    {name:"Téléportation", text:"Réussite → +1 point + tu choisis la prochaine case"},
    {name:"+1 ou -1", text:"Réussite → +2 points / Échec → -1 point"},
    {name:"Everybody", text:"Tout le monde joue !"},
    {name:"Double or quits", text:"Tout doubler ou tout perdre"},
    {name:"It's your choice", text:"Tu choisis l’action que tu veux !"},
    {name:"Everybody", text:"Tout le monde joue !"},
    {name:"No way", text:"Réponds correctement à la question sinon tu offres 1 point à chacun des autres joueurs."},
    {name:"Quadruple", text:"Si tu réussis la question, tu gagnes 4 points."}
  ];

  actions.forEach(a => {
    const card = document.createElement('div');
    card.className = 'actionCard';
    card.style.background = '#000';
    card.style.color = 'white';
    card.style.borderRadius = '16px';
    card.style.padding = '20px';
    card.style.boxShadow = '0 8px 25px rgba(0,0,0,0.4)';
    card.style.textAlign = 'center';
    card.style.fontFamily = 'Arial, sans-serif';
    card.style.transition = 'all 0.3s';
    card.innerHTML = `
      <h3 style="margin:0 0 15px 0; font-size:22px; color:#ffeb3b;">${a.name}</h3>
      <p style="margin:0; font-size:15px; line-height:1.5;">${a.text}</p>
    `;
    grid.appendChild(card);
  });
}

// PIONS PARFAITEMENT CENTRÉS
function updatePawns(players) {
  const container = $('pions');
  container.innerHTML = '';
  const img = $('plateau');
  if (!img || !board) return;
  const rect = img.getBoundingClientRect();

  players.forEach((p, i) => {
    const pos = board.positions[p.pos];
    const x = rect.width * (pos.x / 100);
    const y = rect.height * (pos.y / 100);

    const pawn = document.createElement('div');
    pawn.style.position = 'absolute';
    pawn.style.width = '36px';
    pawn.style.height = '36px';
    pawn.style.borderRadius = '50%';
    pawn.style.background = ['#d32f2f','#388e3c','#fbc02d','#1976d2','#f57c00','#7b1fa2'][i % 6];
    pawn.style.border = '4px solid white';
    pawn.style.boxShadow = '0 6px 20px rgba(0,0,0,0.6)';
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
    container.appendChild(pawn);
  });
}

// Cases dorées : distance exacte, petites et discrètes
function showPossibleCases(currentPos, steps) {
  const reachable = new Set();
  const queue = [{pos: currentPos, remaining: steps}];

  while (queue.length) {
    const {pos, remaining} = queue.shift();
    if (remaining === 0) { reachable.add(pos); continue; }

    if (pos < 48) {
      queue.push({pos: (pos + 1) % 48, remaining: remaining - 1});
      if (pos % 4 === 0) {
        const branchStart = 48 + Math.floor(pos / 4) * 3;
        if (branchStart < 84) queue.push({pos: branchStart, remaining: remaining - 1});
      }
    }
    if (pos >= 48 && pos < 84) {
      const next = pos + 1;
      if (next <= 84) queue.push({pos: next, remaining: remaining - 1});
    }
  }

  $('possibleCases').innerHTML = '';
  reachable.forEach(pos => {
    const p = board.positions[pos];
    const spot = document.createElement('div');
    spot.style.position = 'absolute';
    spot.style.width = '46px';
    spot.style.height = '46px';
    spot.style.background = 'radial-gradient(circle, gold, orange)';
    spot.style.border = '3px solid white';
    spot.style.borderRadius = '50%';
    spot.style.left = (p.x / 100 * $('plateau').width - 23) + 'px';
    spot.style.top = (p.y / 100 * $('plateau').height - 23) + 'px';
    spot.style.cursor = 'pointer';
    spot.style.boxShadow = '0 0 25px gold';
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
  document.querySelectorAll('.actionCard').forEach(card => {
    if (card.querySelector('h3')?.textContent === data.action) {
      card.classList.add('currentAction');
      card.style.transform = 'scale(1.08)';
      card.style.boxShadow = '0 0 40px gold, 0 15px 40px rgba(0,0,0,0.6)';
    }
  });
});
