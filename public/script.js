const socket = io();
let room = null;

const $ = id => document.getElementById(id);

const ACTIONS = [
  {name:"Flash",flash:30,desc:"Réponds en moins de 30 secondes !"},
  {name:"Battle on left",battleLeft:true,desc:"Plus rapide que ton voisin de gauche"},
  {name:"Battle on right",battleRight:true,desc:"Plus rapide que ton voisin de droite"},
  {name:"Call a friend",callFriend:true,desc:"Choisis un partenaire → +1 point chacun"},
  {name:"For you",forYou:true,desc:"Désigne un joueur qui répond à ta place"},
  {name:"Second life",secondLife:true,desc:"Deuxième chance si tu échoues"},
  {name:"No way",noWay:true,desc:"Bonne réponse obligatoire, sinon +1 point à tous les autres"},
  {name:"Double",multiplier:2,desc:"×2 les points"},
  {name:"Téléportation",teleport:true,desc:"Réussite → +1 point + tu choisis la prochaine case"},
  {name:"+1 ou -1",plusOrMinus:true,desc:"Réussite → +2 / Échec → -1"},
  {name:"Everybody",everybody:true,desc:"Tout le monde joue !"},
  {name:"Double or quits",doubleOrQuits:true,desc:"Tout doubler ou tout perdre"},
  {name:"It's your choice",freeChoice:true,desc:"Choisis l'action que tu veux !"},
  {name:"Everybody",everybody:true,desc:"Tout le monde joue !"},
  {name:"No way",noWay:true,desc:"Bonne réponse obligatoire, sinon +1 point à tous les autres"},
  {name:"Quadruple",multiplier:4,desc:"×4 les points"}
];

// GRILLE 4×4
function createActionGrid() {
  if ($('actionGrid').children.length) return;
  ACTIONS.forEach(a => {
    const card = document.createElement('div');
    card.className = 'actionCard';
    card.innerHTML = `<strong>${a.name}</strong><br><small>${a.desc}</small>`;
    card.title = a.desc;
    $('actionGrid').appendChild(card);
  });
}

// PIONS PARFAITS
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
    pawn.title = `${p.name} – ${p.score} pts`;
    container.appendChild(pawn);
  });
}

// FONCTIONS
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

// Démarrer la partie
$('startBtn').onclick = () => socket.emit('start', room);

// SOCKET
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
  $('players').innerHTML = players.map(p=>`<div><strong>${p.name}</strong> – ${p.score} pts – case ${p.pos}</div>`).join('');
  updatePawns(players);
});

socket.on('gameStart', () => {
  $('startBtn').style.display = 'none';
  alert('La partie est lancée !');
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
  } else $('flashTimer').style.display = 'none';
});

socket.on('question', q => {
  $('themeTitle').textContent = 'Thème : ' + q.theme;
  $('questionText').textContent = q.question;
  $('questionBox').style.display = 'block';
  $('answerInput').focus();
});
