const socket = io();
let room = null;
let lastRoll = 0;
let possiblePositions = [];

const $ = id => document.getElementById(id);

const ACTIONS = [
  {name:"Flash",flash:30},{name:"Battle on left",battleLeft:true},{name:"Battle on right",battleRight:true},
  {name:"Call a friend",callFriend:true},{name:"For you",forYou:true},{name:"Second life",secondLife:true},
  {name:"No way",noWay:true},{name:"Double",multiplier:2},{name:"Téléportation",teleport:true},
  {name:"+1 ou -1",plusOrMinus:true},{name:"Everybody",everybody:true},{name:"Double or quits",doubleOrQuits:true},
  {name:"It's your choice",freeChoice:true},{name:"Everybody",everybody:true},{name:"No way",noWay:true},
  {name:"Quadruple",multiplier:4}
];

function createActionGrid() {
  if ($('actionGrid').children.length) return;
  ACTIONS.forEach((a,i) => {
    const card = document.createElement('div');
    card.className = 'actionCard';
    card.innerHTML = `<strong>${a.name}</strong>`;
    $('actionGrid').appendChild(card);
  });
}

function updatePawns(players) {
  const container = $('pions');
  const img = $('plateau');
  const w = img.clientWidth, h = img.clientHeight;
  container.style.width = w+'px'; container.style.height = h+'px';
  container.innerHTML = '';

  const cx = w/2, cy = h/2, radius = Math.min(w,h)*0.39;
  const colors = ['#f44336','#4caf50','#ffeb3b','#2196f3','#ff9800','#9c27b0'];

  players.forEach((p,i) => {
    const angle = (p.pos/32)*Math.PI*2 - Math.PI/2;
    const x = cx + Math.cos(angle)*radius;
    const y = cy + Math.sin(angle)*radius;
    const pawn = document.createElement('div');
    pawn.className = 'pawn';
    pawn.style.left = x+'px'; pawn.style.top = y+'px';
    pawn.style.background = colors[i%6];
    pawn.textContent = i+1;
    pawn.title = p.name + ' – ' + p.score + ' pts';
    container.appendChild(pawn);
  });
}

// === FONCTIONS ===
window.createRoom = () => socket.emit('create', $('playerName').value || 'Hôte');
window.joinRoom = () => {
  const code = $('roomCode').value.trim().toUpperCase();
  if(!code) return alert('Entre un code !');
  socket.emit('join', {code, name: $('playerName').value || 'Joueur'});
};

window.rollDice = () => {
  socket.emit('roll', room);
  $('rollBtn').disabled = true;
  $('rollBtn').textContent = 'Dé lancé...';
};

window.chooseDir = dir => {
  possiblePositions = [];
  const current = players.find(p => p.id === socket.id)?.pos || 0;
  const pos1 = (current + lastRoll) % 32;
  const pos2 = (current - lastRoll + 32) % 32;
  const positions = dir === 'right' ? [pos1] : [pos2];
  showPossibleCases(positions);
};

function showPossibleCases(positions) {
  $('possibleCases').innerHTML = '';
  const img = $('plateau');
  const w = img.clientWidth, h = img.clientHeight;
  const cx = w/2, cy = h/2, radius = Math.min(w,h)*0.39;

  positions.forEach(pos => {
    const angle = (pos/32)*Math.PI*2 - Math.PI/2;
    const x = cx + Math.cos(angle)*radius;
    const y = cy + Math.sin(angle)*radius;
    const spot = document.createElement('div');
    spot.style.position = 'absolute';
    spot.style.left = x+'px';
    spot.style.top = y+'px';
    spot.style.width = '70px';
    spot.style.height = '70px';
    spot.style.background = 'rgba(255,255,0,0.5)';
    spot.style.border = '5px solid gold';
    spot.style.borderRadius = '50%';
    spot.style.transform = 'translate(-50%,-50%)';
    spot.style.cursor = 'pointer';
    spot.style.boxShadow = '0 0 30px gold';
    spot.onclick = () => socket.emit('move', {code: room, position: pos});
    $('possibleCases').appendChild(spot);
  });
  $('directions').style.display = 'none';
}

window.sendAnswer = () => {
  const ans = $('answerInput').value.trim();
  if(ans) socket.emit('answer', {code: room, answer: ans});
  $('answerInput').value = '';
};

// Démarrer
$('startBtn').onclick = () => socket.emit('start', room);

// SOCKET
let players = [];

socket.on('created', code => { room = code; showGame(code); });
socket.on('joined', code => { room = code; showGame(code); });
socket.on('error', msg => alert(msg));

function showGame(code) {
  $('menu').style.display = 'none';
  $('game').style.display = 'block';
  $('roomDisplay').textContent = code;
  createActionGrid();
}

socket.on('players', p => { players = p; updatePawns(p); });

socket.on('gameStart', () => $('startBtn').style.display = 'none');

socket.on('yourTurn', () => {
  $('rollBtn').disabled = false;
  $('rollBtn').textContent = 'Lancer le dé';
});

socket.on('rolled', data => {
  lastRoll = data.roll;
  alert(`Tu as fait ${data.roll} ! Choisis la direction`);
  $('directions').style.display = 'block';
});

socket.on('actionDrawn', data => {
  document.querySelectorAll('.actionCard').forEach(c => c.classList.remove('currentAction'));
  const idx = ACTIONS.findIndex(a => a.name === data.action);
  if(idx >= 0) document.querySelectorAll('.actionCard')[idx].classList.add('currentAction');
  if(data.timer) {
    let t = data.timer;
    $('flashTimer').style.display = 'block';
    $('flashTimer').textContent = t+'s';
    const int = setInterval(() => { t--; $('flashTimer').textContent = t+'s'; if(t<=0) clearInterval(int); }, 1000);
  }
});

socket.on('question', q => {
  $('themeTitle').textContent = 'Thème : ' + q.theme;
  $('questionText').textContent = q.question;
  $('questionBox').style.display = 'block';
  $('answerInput').focus();
});

socket.on('results', data => {
  $('results').innerHTML = `<h3>${data.message}</h3>`;
  $('questionBox').style.display = 'none';
  $('possibleCases').innerHTML = '';
  $('flashTimer').style.display = 'none';
});
