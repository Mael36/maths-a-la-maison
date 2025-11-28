const socket = io();
let room = null;
let myId = null;

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

// Créer la grille 4×4 des actions
function createActionGrid() {
  if ($('actionGrid').innerHTML) return;
  const grid = $('actionGrid');
  ACTIONS.forEach(a => {
    const card = document.createElement('div');
    card.className = 'actionCard';
    card.innerHTML = `<strong>${a.name}</strong><br><small>${a.desc}</small>`;
    card.title = a.desc;
    grid.appendChild(card);
  });
}

// Position des pions (parfaitement centrés)
function updatePawns(players) {
  const container = $('pions');
  const img = $('plateau');
  const w = img.clientWidth;
  const h = img.clientHeight;
  container.style.width = w + 'px';
  container.style.height = h + 'px';
  container.innerHTML = '';

  const cx = w / 2;
  const cy = h / 2;
  const radius = Math.min(w,h) * 0.39;
  const colors = ['#f44336','#4caf50','#ffeb3b','#2196f3','#ff9800','#9c27b0'];

  players.forEach((p,i) => {
    const angle = (p.pos / 32) * Math.PI * 2 - Math.PI/2;
    const x = cx + Math.cos(angle) * radius;
    const y = cy + Math.sin(angle) * radius;
    const pawn = document.createElement('div');
    pawn.className = 'pawn';
    pawn.style.left = x+'px';
    pawn.style.top = y+'px';
    pawn.style.background = colors[i%6];
    pawn.textContent = i+1;
    pawn.title = `${p.name} – ${p.score} pts`;
    container.appendChild(pawn);
  });
}

// === FONCTIONS UTILISATEUR ===
window.createRoom = () => {
  const name = $('playerName').value.trim() || 'Hôte';
  socket.emit('create', name);
};
window.joinRoom = () => {
  const name = $('playerName').value.trim() || 'Joueur';
  const code = $('roomCode').value.trim().toUpperCase();
  if (!code) return alert('Entre un code !');
  socket.emit('join', {code, name});
};
window.rollDice = () => socket.emit('roll', room);
window.chooseDir = dir => socket.emit('move', {code:room, direction:dir});
window.sendAnswer = () => {
  const ans = $('answerInput').value.trim();
  if (ans) socket.emit('answer', {code:room, answer:ans});
  $('answerInput').value = '';
};

// === SOCKET ===
socket.on('created', code => { room=code; startGame(code); });
socket.on('joined', code => { room=code; startGame(code); });
socket.on('error', msg => alert(msg));

function startGame(code) {
  $('menu').style.display = 'none';
  $('game').style.display = 'block';
  $('roomDisplay').textContent = code;
  createActionGrid();
}

socket.on('players', players => {
  $('players').innerHTML = players.map(p=>`<div>${p.name} – ${p.score} pts – case ${p.pos}</div>`).join('');
  updatePawns(players);
});

socket.on('yourTurn', () => $('rollBtn').disabled = false);
socket.on('rolled', ({roll}) => {
  alert(`Tu as fait ${roll} ! Choisis la direction`);
  $('directions').style.display = 'block';
});
socket.on('actionDrawn', data => {
  // Timer Flash
  if (data.timer) {
    let t = data.timer;
    $('flashTimer').style.display = 'block';
    $('flashTimer').textContent = t+'s';
    const int = setInterval(()=>{ t--; $('flashTimer').textContent = t+'s'; if(t<=0) clearInterval(int); },1000);
  }
  // Surligner action
  document.querySelectorAll('.actionCard').forEach(c=>c.classList.remove('currentAction'));
  const cards = document.querySelectorAll('.actionCard');
  const idx = ACTIONS.findIndex(a=>a.name===data.action);
  if(cards[idx]) cards[idx].classList.add('currentAction');
});

socket.on('question', q => {
  $('themeTitle').textContent = q.theme;
  $('questionText').textContent = q.question;
  $('questionBox').style.display = 'block';
  $('answerInput').focus();
});

socket.on('results', data => {
  $('results').innerHTML = `<h3>${data.action}</h3>` + data.results.map(r=>`${r.correct?'Correct':'Faux'} ${r.player} → ${r.score} pts`).join('<br>');
  setTimeout(()=>{ $('results').innerHTML=''; },5000);
});

socket.on('gameStart', () => alert('La partie commence !'));
