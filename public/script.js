const socket = io();
let room = null;
let board = null;
let timer = null;

const $ = id => document.getElementById(id);

fetch('/data/board.json')
  .then(r => r.json())
  .then(data => { board = data; createActionCards(); });

function createActionCards() {
  const grid = $('actionGrid');
  const actions = [
    {name:"Flash", text:"Tu dois répondre en moins de 30 secondes à la question !"},
    {name:"Battle on left", text:"Tu dois répondre plus vite que ton voisin de gauche..."},
    {name:"Battle on right", text:"Tu dois répondre plus vite que ton voisin de droite..."},
    {name:"Call a friend", text:"Choisis le partenaire de ton choix. Cherchez la réponse à 2..."},
    {name:"For you", text:"Choisis le joueur qui répondra à ta place..."},
    {name:"Second life", text:"Si tu ne réussis pas la prochaine question, tu peux piocher une autre..."},
    {name:"No way", text:"Réponds correctement à la question sinon tu offres 1 point à chacun..."},
    {name:"Double", text:"Si tu réussis la question, tu gagnes 2 points."},
    {name:"Téléportation", text:"Réussite → +1 point + tu choisis la prochaine case"},
    {name:"+1 ou -1", text:"Réussite → +2 points / Échec → -1 point"},
    {name:"Everybody", text:"Tout le monde joue !"},
    {name:"Double or quits", text:"Tout doubler ou tout perdre"},
    {name:"It's your choice", text:"Tu choisis l'action que tu veux !"},
    {name:"Everybody", text:"Tout le monde joue !"},
    {name:"No way", text:"Réponds correctement sinon tu offres 1 point à chacun..."},
    {name:"Quadruple", text:"Si tu réussis la question, tu gagnes 4 points."}
  ];

  actions.forEach(a => {
    const card = document.createElement('div');
    card.className = 'actionCard';
    card.innerHTML = `
      <div class="round">
        <div class="tree" style="background:url('assets/plateau.png') center/70% no-repeat;"></div>
      </div>
      <h3>ACTION</h3>
      <h4>${a.name}</h4>
      <p>${a.text}</p>
    `;
    grid.appendChild(card);
  });
}

function updatePawns(players) {
  $('pions').innerHTML = '';
  const img = $('plateau');
  if (!img || !board) return;
  const w = img.offsetWidth, h = img.offsetHeight;

  players.forEach((p, i) => {
    const pos = board.positions[p.pos];
    const x = (pos.x / 100) * w;
    const y = (pos.y / 100) * h;

    const pawn = document.createElement('div');
    pawn.style.cssText = `
      position:absolute;width:60px;height:60px;border-radius:50%;
      background:${['#d32f2f','#388e3c','#fbc02d','#1976d2','#f57c00','#7b1fa2'][i%6]};
      border:8px solid white;box-shadow:0 15px 40px rgba(0,0,0,0.8);
      color:white;font-size:32px;font-weight:bold;display:flex;
      align-items:center;justify-content:center;
      left:${x}px;top:${y}px;transform:translate(-50%,-50%);
    `;
    pawn.textContent = i + 1;
    pawn.title = `${p.name} – ${p.score} pts`;
    $('pions').appendChild(pawn);
  });
}

function showPossibleCases(currentPos, steps) {
  const reachable = new Set();
  const q = [{pos: currentPos, rem: steps}];
  while (q.length) {
    const {pos, rem} = q.shift();
    if (rem === 0) { reachable.add(pos); continue; }
    if (pos < 48) {
      q.push({pos: (pos + 1) % 48, rem: rem - 1});
      if (pos % 4 === 0) {
        const b = 48 + Math.floor(pos / 4) * 3;
        if (b < 84) q.push({pos: b, rem: rem - 1});
      }
    }
    if (pos >= 48 && pos < 84 && pos + 1 <= 84) q.push({pos: pos + 1, rem: rem - 1});
  }

  $('possibleCases').innerHTML = '';
  const img = $('plateau');
  const w = img.offsetWidth, h = img.offsetHeight;

  reachable.forEach(pos => {
    const p = board.positions[pos];
    const x = (p.x / 100) * w;
    const y = (p.y / 100) * h;

    const spot = document.createElement('div');
    spot.style.cssText = `
      position:absolute;width:90px;height:90px;
      background:radial-gradient(circle,gold,orange);
      border:10px solid white;border-radius:50%;
      left:${x}px;top:${y}px;transform:translate(-50%,-50%);
      cursor:pointer;box-shadow:0 0 120px gold;z-index:999;
    `;
    spot.onclick = () => {
      socket.emit('moveTo', {code: room, targetPos: pos});
      $('possibleCases').innerHTML = '';
    };
    $('possibleCases').appendChild(spot);
  });
}

function startTimer(sec) {
  if (timer) clearInterval(timer);
  $('timer').style.display = 'block';
  let t = sec;
  $('timer').textContent = t + 's';
  $('timer').style.background = sec === 30 ? '#d32f2f' : '#1976d2';

  timer = setInterval(() => {
    t--;
    $('timer').textContent = t + 's';
    if (t <= 0) { clearInterval(timer); $('timer').style.display = 'none'; }
  }, 1000);
}

// INTERACTIONS & SOCKET
window.createRoom = () => socket.emit('create', $('playerName').value || 'Hôte');
window.joinRoom = () => {
  const code = $('roomCode').value.trim().toUpperCase();
  if (!code) return alert('Code requis !');
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

socket.on('players', updatePawns);
socket.on('yourTurn', () => { $('rollBtn').disabled = false; $('rollBtn').textContent = 'Lancer le dé'; });
socket.on('rolled', data => {
  alert(`Tu as fait ${data.roll} ! Choisis une case dorée`);
  showPossibleCases(data.currentPos, data.roll);
});
socket.on('actionDrawn', data => {
  document.querySelectorAll('.actionCard').forEach(c => c.style.transform = 'scale(1)');
  document.querySelectorAll('.actionCard').forEach(c => {
    if (c.textContent.includes(data.action)) c.style.transform = 'scale(1.4)';
  });
});
socket.on('question', q => {
  $('themeTitle').textContent = q.theme || 'Maths';
  $('questionText').textContent = q.question;
  $('questionBox').style.display = 'block';
  $('answerInput').focus();
  startTimer(q.action === 'Flash' ? 30 : 60);
});
socket.on('result', data => {
  clearInterval(timer);
  $('timer').style.display = 'none';
  $('resultText').textContent = data.correct ? `BRAVO ${data.player} ! +1 point` : `Dommage ${data.player}...`;
  $('resultText').style.color = data.correct ? '#4caf50' : '#f44336';
  $('resultBox').style.display = 'block';
  setTimeout(() => {
    $('questionBox').style.display = 'none';
    $('resultBox').style.display = 'none';
  }, 5000);
});
