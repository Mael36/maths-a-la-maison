const socket = io();
let room = null;
let roll = 0;
let board = null;

const $ = id => document.getElementById(id);

// Les 16 vraies cartes Action avec images et textes
const ACTIONS = [
  {name:"Flash", img:"actions/flash.jpg", text:"Tu dois répondre en moins de 30 secondes à la question !"},
  {name:"Battle on left", img:"actions/battle_left.jpg", text:"Tu dois répondre plus vite que ton voisin de gauche. Si l'un de vous deux répond juste avant toi, c'est lui qui remporte le point sinon c'est toi."},
  {name:"Battle on right", img:"actions/battle_right.jpg", text:"Tu dois répondre plus vite que ton voisin de droite. Si l'un de vous deux répond juste avant toi, c'est lui qui remporte le point sinon c'est toi."},
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

// Chargement du plateau réel
fetch('/data/board.json')
  .then(r => r.json())
  .then(data => {
    board = data;
    createActionGrid();
  });

// Grille 4×4 avec vraies images et textes
function createActionGrid() {
  const grid = $('actionGrid');
  ACTIONS.forEach(a => {
    const card = document.createElement('div');
    card.className = 'actionCard';
    card.innerHTML = `
      <img src="${a.img}" style="width:100%; height:160px; object-fit:cover; border-radius:12px;">
      <div style="padding:10px; background:#1565c0; color:white; border-radius:0 0 12px 12px;">
        <strong style="font-size:14px;">${a.name}</strong><br>
        <small style="font-size:10px; line-height:1.3;">${a.text}</small>
      </div>
    `;
    grid.appendChild(card);
  });
}

// Pions exactement sur les vraies cases
function updatePawns(players) {
  $('pions').innerHTML = '';
  const img = $('plateau');
  const rect = img.getBoundingClientRect();

  players.forEach((p, i) => {
    const pos = board.positions[p.pos];
    const x = rect.width * (pos.x / 100);
    const y = rect.height * (pos.y / 100);

    const pawn = document.createElement('div');
    pawn.className = 'pawn';
    pawn.style.left = (x - 30) + 'px';
    pawn.style.top = (y - 30) + 'px';
    pawn.style.background = ['#f44336','#4caf50','#ffeb3b','#2196f3','#ff9800','#9c27b0'][i];
    pawn.textContent = i + 1;
    pawn.title = `${p.name} – ${p.score} pts`;
    $('pions').appendChild(pawn);
  });
}

// Cases atteignables (gère cercle + branches + centre)
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
      const next = (pos + 1) % 48;
      queue.push({pos: next, remaining: remaining - 1});

      // Embranchement toutes les 4 cases
      if (pos % 4 === 0) {
        const branchIndex = pos / 4;
        const branchStart = 48 + branchIndex * 3;
        if (branchStart < 84) {
          queue.push({pos: branchStart, remaining: remaining - 1});
        }
      }
    }

    // Dans une branche (48-83)
    if (pos >= 48 && pos < 84) {
      const next = pos + 1;
      if (next <= 84) {
        queue.push({pos: next, remaining: remaining - 1});
      }
    }
  }

  // Affichage doré cliquable
  $('possibleCases').innerHTML = '';
  reachable.forEach(pos => {
    const p = board.positions[pos];
    const spot = document.createElement('div');
    spot.style.position = 'absolute';
    spot.style.width = '90px';
    spot.style.height = '90px';
    spot.style.background = 'radial-gradient(circle, gold, orange)';
    spot.style.border = '6px solid white';
    spot.style.borderRadius = '50%';
    spot.style.left = (p.x / 100 * $('plateau').width - 45) + 'px';
    spot.style.top = (p.y / 100 * $('plateau').height - 45) + 'px';
    spot.style.cursor = 'pointer';
    spot.style.boxShadow = '0 0 50px gold, inset 0 0 20px white';
    spot.style.zIndex = '1000';
    spot.onclick = () => socket.emit('moveTo', {code: room, pos});
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
  const card = [...document.querySelectorAll('.actionCard')].find(c => c.textContent.includes(data.action));
  if (card) card.classList.add('currentAction');
});
