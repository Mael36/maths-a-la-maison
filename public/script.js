const socket = io();
let room = null;

const $ = id => document.getElementById(id);

const ACTIONS = [ /* les 16 actions exactement comme ton tableau */ 
  {name:"Flash",flash:30}, {name:"Battle on left",battleLeft:true}, {name:"Battle on right",battleRight:true},
  {name:"Call a friend",callFriend:true}, {name:"For you",forYou:true}, {name:"Second life",secondLife:true},
  {name:"No way",noWay:true}, {name:"Double",multiplier:2}, {name:"Téléportation",teleport:true},
  {name:"+1 ou -1",plusOrMinus:true}, {name:"Everybody",everybody:true}, {name:"Double or quits",doubleOrQuits:true},
  {name:"It's your choice",freeChoice:true}, {name:"Everybody",everybody:true}, {name:"No way",noWay:true},
  {name:"Quadruple",multiplier:4}
];

const actionImages = [
  "flash.jpg","battle-left.jpg","battle-right.jpg","call-a-friend.jpg","for-you.jpg","second-life.jpg",
  "no-way.jpg","double.jpg","teleportation.jpg","plus-ou-moins.jpg","everybody.jpg","double-or-quits.jpg",
  "its-your-choice.jpg","everybody.jpg","no-way.jpg","quadruple.jpg"
];

// === GRILLE 4×4 ===
function createActionGrid() {
  if ($('actionGrid').children.length > 0) return;
  const grid = $('actionGrid');
  ACTIONS.forEach((a,i) => {
    const card = document.createElement('div');
    card.className = 'actionCard';
    card.innerHTML = `<img src="actions/${actionImages[i]}" alt="${a.name}"><div class="title">${a.name}</div>`;
    grid.appendChild(card);
  });
}

// === PIONS PARFAITS ===
function updatePawns(players) {
  const container = $('pions');
  const img = $('plateau');
  const rect = img.getBoundingClientRect();
  const w = rect.width, h = rect.height;
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
window.rollDice = () => socket.emit('roll', room);
window.chooseDir = dir => socket.emit('move', {code:room, direction:dir});
window.sendAnswer = () => {
  const ans = $('answerInput').value.trim();
  if(ans) socket.emit('answer', {code:room, answer:ans});
  $('answerInput').value = '';
};

// Bouton Démarrer
$('startGameBtn').onclick = () => socket.emit('start', room);

// === SOCKET ===
socket.on('created', code => { room=code; showGame(code); });
socket.on('joined', code => { room=code; showGame(code); });
socket.on('error', msg => alert(msg));

function showGame(code) {
  $('menu').style.display = 'none';
  $('game').style.display = 'block';
  $('roomDisplay').textContent = code;
  createActionGrid();
}

socket.on('players', players => {
  $('players').innerHTML = players.map(p=>`<div style="padding:12px; background:#bbdefb; margin:8px; border-radius:10px;"><strong>${p.name}</strong> – ${p.score} pts – case ${p.pos}</div>`).join('');
  updatePawns(players);
});

socket.on('gameStart', () => {
  $('startGameBtn').style.display = 'none';
  alert('La partie commence !');
});

socket.on('yourTurn', () => $('rollBtn').disabled = false);

socket.on('actionDrawn', data => {
  document.querySelectorAll('.actionCard').forEach(c=>c.classList.remove('currentAction'));
  const idx = ACTIONS.findIndex(a=>a.name===data.action);
  if(idx>=0) document.querySelectorAll('.actionCard')[idx].classList.add('currentAction');

  if(data.timer){
    let t = data.timer;
    $('flashTimer').style.display = 'block';
    $('flashTimer').textContent = t+'s';
    const int = setInterval(()=>{ t--; $('flashTimer').textContent = t+'s'; if(t<=0) clearInterval(int); },1000);
  }
});

socket.on('question', q => {
  $('themeTitle').textContent = 'Thème : ' + q.theme;
  $('questionText').textContent = q.question;
  $('questionBox').style.display = 'block';
  $('answerInput').focus();
});
