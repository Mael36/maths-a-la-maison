const socket = io();
let room = null;
let currentRoll = 0;
let board = null;

const $ = id => document.getElementById(id);

// Chargement du plateau
fetch('/data/board.json')
  .then(r => r.json())
  .then(data => {
    board = data;
    createActionGrid();
  });

// CARTES ACTION EXACTEMENT COMME LES TIENNES
function createActionGrid() {
  const grid = $('actionGrid');
  grid.style.display = 'grid';
  grid.style.gridTemplateColumns = 'repeat(4, 1fr)';
  grid.style.gap = '40px';
  grid.style.maxWidth = '1600px';
  grid.style.margin = '60px auto';
  grid.style.padding = '40px';
  grid.style.background = '#bbdefb';
  grid.style.borderRadius = '30px';

  const actions = [
    {name:"Flash", img:"actions/flash.jpg", text:"Tu dois répondre en moins de 30 secondes à la question !"},
    {name:"Battle on left", img:"actions/battle_left.jpg", text:"Tu dois répondre plus vite que ton voisin de gauche"},
    {name:"Battle on right", img:"actions/battle_right.jpg", text:"Tu dois répondre plus vite que ton voisin de droite"},
    {name:"Call a friend", img:"actions/call_friend.jpg", text:"Choisis le partenaire de ton choix. Cherchez la réponse à 2. Si vous réussissez, vous remportez 1 point tous les 2."},
    {name:"For you", img:"actions/for_you.jpg", text:"Choisis le joueur qui répondra à ta place. S'il réussit, vous remportez chacun 1 point."},
    {name:"Second life", img:"actions/second_life.jpg", text:"Si tu ne réussis pas la prochaine question, tu peux piocher une autre question dans la même catégorie et retenter ta chance."},
    {name:"No way", img:"actions/no_way.jpg", text:"Réponds correctement à la question sinon tu offres 1 point à chacun des autres joueurs."},
    {name:"Double", img:"actions/double.jpg", text:"Si tu réussis la question, tu gagnes 2 points."},
    {name:"Téléportation", img:"actions/teleport.jpg", text:"Réussite → +1 point + tu choisis la prochaine case"},
    {name:"+1 ou -1", img:"actions/plus_minus.jpg", text:"Réussite → +2 points / Échec → -1 point"},
    {name:"Everybody", img:"actions/everybody.jpg", text:"Tout le monde joue !"},
    {name:"Double or quits", img:"actions/double_quits.jpg", text:"Tout doubler ou tout perdre"},
    {name:"It's your choice", img:"actions/choice.jpg", text:"Tu choisis l'action que tu veux !"},
    {name:"Everybody", img:"actions/everybody.jpg", text:"Tout le monde joue !"},
    {name:"No way", img:"actions/no_way.jpg", text:"Réponds correctement à la question sinon tu offres 1 point à chacun des autres joueurs."},
    {name:"Quadruple", img:"actions/quadruple.jpg", text:"Si tu réussis la question, tu gagnes 4 points."}
  ];

  actions.forEach(a => {
    const card = document.createElement('div');
    card.className = 'actionCard';
    card.style.background = 'white';
    card.style.borderRadius = '20px';
    card.style.overflow = 'hidden';
    card.style.boxShadow = '0 15px 40px rgba(0,0,0,0.3)';
    card.style.textAlign = 'center';
    card.innerHTML = `
      <div style="width:100%; height:280px; background:white; border-radius:50%; overflow:hidden; border:10px solid #1565c0; margin:20px auto;">
        <img src="${a.img}" style="width:100%; height:100%; object-fit:cover;">
      </div>
      <div style="padding:20px; background:#1565c0; color:white;">
        <h3 style="margin:0 0 10px; font-size:24px;">${a.name}</h3>
        <p style="margin:0; font-size:16px; line-height:1.5;">${a.text}</p>
      </div>
    `;
    grid.appendChild(card);
  });
}

// PIONS ET CASES DORÉES – PARFAITEMENT CENTRÉS
function updatePawns(players) {
  $('pions').innerHTML = '';
  const img = $('plateau');
  if (!img || !board) return;

  const w = img.offsetWidth;
  const h = img.offsetHeight;

  players.forEach((p, i) => {
    const pos = board.positions[p.pos];
    const x = (pos.x / 100) * w;
    const y = (pos.y / 100) * h;

    const pawn = document.createElement('div');
    pawn.style.position = 'absolute';
    pawn.style.width = '46px';
    pawn.style.height = '46px';
    pawn.style.borderRadius = '50%';
    pawn.style.background = ['#d32f2f','#388e3c','#fbc02d','#1976d2','#f57c00','#7b1fa2'][i % 6];
    pawn.style.border = '6px solid white';
    pawn.style.boxShadow = '0 10px 30px rgba(0,0,0,0.7)';
    pawn.style.color = 'white';
    pawn.style.fontSize = '24px';
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

function showPossibleCases(currentPos, steps) {
  const reachable = new Set();
  const queue = [{pos: currentPos, rem: steps}];

  while (queue.length) {
    const {pos, rem} = queue.shift();
    if (rem === 0) { reachable.add(pos); continue; }

    if (pos < 48) {
      queue.push({pos: (pos + 1) % 48, rem: rem - 1});
      if (pos % 4 === 0) {
        const branch = 48 + (pos / 4) * 3;
        if (branch < 84) queue.push({pos: branch, rem: rem - 1});
      }
    }
    if (pos >= 48 && pos < 84) {
      const next = pos + 1;
      if (next <= 84) queue.push({pos: next, rem: rem - 1});
    }
  }

  $('possibleCases').innerHTML = '';
  const img = $('plateau');
  const w = img.offsetWidth;
  const h = img.offsetHeight;

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
    spot.style.boxShadow = '0 0 80px gold, inset 0 0 40px white';
    spot.style.zIndex = '999';
    spot.onclick = () => {
      socket.emit('moveTo', {code: room, targetPos: pos});
      $('possibleCases').innerHTML = '';
    };
    $('possibleCases').appendChild(spot);
  });
}

// === INTERACTIONS & SOCKET ===
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
  currentRoll = data.roll;
  alert(`Tu as fait ${currentRoll} ! Clique sur une case dorée`);
  showPossibleCases(data.currentPos, currentRoll);
});
socket.on('actionDrawn', data => {
  document.querySelectorAll('.actionCard').forEach(c => c.classList.remove('currentAction'));
  document.querySelectorAll('.actionCard').forEach(card => {
    if (card.textContent.includes(data.action)) {
      card.classList.add('currentAction');
      card.style.transform = 'scale(1.15)';
      card.style.boxShadow = '0 0 100px gold';
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
socket.on('results', () => { $('questionBox').style.display = 'none'; });
