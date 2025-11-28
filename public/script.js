const socket = io();
let room = null;
let lastRoll = 0;
let currentQuestion = null;
let countdownInterval = null;

const $ = id => document.getElementById(id);

const ACTIONS = [
  {name:"Flash",flash:30,desc:"30 secondes !"}, {name:"Battle on left",battleLeft:true},
  {name:"Battle on right",battleRight:true}, {name:"Call a friend",callFriend:true},
  {name:"For you",forYou:true}, {name:"Second life",secondLife:true},
  {name:"No way",noWay:true}, {name:"Double",multiplier:2},
  {name:"Téléportation",teleport:true}, {name:"+1 ou -1",plusOrMinus:true},
  {name:"Everybody",everybody:true}, {name:"Double or quits",doubleOrQuits:true},
  {name:"It's your choice",freeChoice:true}, {name:"Everybody",everybody:true},
  {name:"No way",noWay:true}, {name:"Quadruple",multiplier:4}
];

function createActionGrid() {
  if ($('actionGrid').children.length) return;
  ACTIONS.forEach(a => {
    const card = document.createElement('div');
    card.className = 'actionCard';
    card.innerHTML = `<strong>${a.name}</strong><br><small>${a.desc || ''}</small>`;
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
    pawn.title = `${p.name} – ${p.score} pts`;
    container.appendChild(pawn);
  });
}

window.createRoom = () => socket.emit('create', $('playerName').value || 'Hôte');
window.joinRoom = () => {
  const code = $('roomCode').value.trim().toUpperCase();
  if(!code) return alert('Entre un code !');
  socket.emit('join', {code, name: $('playerName').value || 'Joueur'});
};
window.rollDice = () => socket.emit('roll', room);
window.chooseDir = dir => socket.emit('move', {code:room, steps:lastRoll, direction:dir});
window.sendAnswer = () => {
  const ans = $('answerInput').value.trim();
  if (!ans || !currentQuestion) return;
  socket.emit('answer', {code: room, answer: ans});
  $('answerInput').value = '';
};

$('startBtn').onclick = () => socket.emit('start', room);

socket.on('created', code => { room=code; showGame(code); });
socket.on('joined', code => { room=code; showGame(code); });
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

socket.on('gameStart', () => { $('startBtn').style.display = 'none'; });

socket.on('yourTurn', () => {
  $('rollBtn').disabled = false;
  $('rollBtn').textContent = "Lancer le dé";
});

socket.on('rolled', ({roll}) => {
  lastRoll = roll;
  $('directions').style.display = 'block';
  alert(`Tu as fait ${roll} ! Choisis GAUCHE ou DROITE`);
});

socket.on('actionDrawn', data => {
  document.querySelectorAll('.actionCard').forEach(c=>c.classList.remove('currentAction'));
  const idx = ACTIONS.findIndex(a=>a.name===data.action);
  if(idx>=0) document.querySelectorAll('.actionCard')[idx].classList.add('currentAction');

  if(data.timer){
    $('flashTimer').style.display = 'block';
    let t = data.timer;
    $('flashTimer').textContent = t+'s';
    const int = setInterval(()=>{ t--; $('flashTimer').textContent = t+'s'; if(t<=0) clearInterval(int); },1000);
  }
});

socket.on('question', q => {
  currentQuestion = q;
  $('themeTitle').textContent = 'Thème : ' + q.theme;
  $('questionText').textContent = q.question;
  $('questionBox').style.display = 'block';
  $('answerInput').focus();

  // Timer 60s ou 30s pour Flash
  const timeLeft = q.action?.flash ? 30 : 60;
  $('countdown').textContent = timeLeft;
  $('timerDisplay').style.display = 'block';

  clearInterval(countdownInterval);
  countdownInterval = setInterval(() => {
    let sec = +$('countdown').textContent;
    sec--;
    $('countdown').textContent = sec;
    if (sec <= 0) {
      clearInterval(countdownInterval);
      $('questionBox').style.display = 'none';
      $('timerDisplay').style.display = 'none';
      $('timeUp').style.display = 'block';
      setTimeout(() => $('timeUp').style.display = 'none', 4000);
      socket.emit('timeUp', {code: room});
    }
  }, 1000);
});

socket.on('questionEnd', () => {
  clearInterval(countdownInterval);
  $('questionBox').style.display = 'none';
  $('timerDisplay').style.display = 'none';
  $('timeUp').style.display = 'block';
  setTimeout(() => $('timeUp').style.display = 'none', 4000);
});
