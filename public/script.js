const socket = io();
let room = null;
let lastRoll = 0;

const $ = id => document.getElementById(id);

// Définition des 16 actions avec descriptions et images
const ACTIONS = [
  { name: "Flash", flash: 30, img: "actions/flash.jpg", desc: "Réponds en moins de 30 secondes !" },
  { name: "Battle on left", battleLeft: true, img: "actions/battle_left.jpg", desc: "Plus rapide que ton voisin de gauche" },
  { name: "Battle on right", battleRight: true, img: "actions/battle_right.jpg", desc: "Plus rapide que ton voisin de droite" },
  { name: "Call a friend", callFriend: true, img: "actions/call_friend.jpg", desc: "Choisis un partenaire → +1 point chacun si bonne réponse" },
  { name: "For you", forYou: true, img: "actions/for_you.jpg", desc: "Désigne un joueur qui répond à ta place" },
  { name: "Second life", secondLife: true, img: "actions/second_life.jpg", desc: "Deuxième chance si tu échoues" },
  { name: "No way", noWay: true, img: "actions/no_way.jpg", desc: "Bonne réponse obligatoire, sinon +1 pt à tous les autres" },
  { name: "Double", multiplier: 2, img: "actions/double.jpg", desc: "×2 les points en cas de succès" },
  { name: "Téléportation", teleport: true, img: "actions/teleport.jpg", desc: "Réussite → +1 point + tu choisis la prochaine case" },
  { name: "+1 ou -1", plusOrMinus: true, img: "actions/plus_minus.jpg", desc: "Réussite → +2 points / Échec → -1 point" },
  { name: "Everybody", everybody: true, img: "actions/everybody.jpg", desc: "Tout le monde joue !" },
  { name: "Double or quits", doubleOrQuits: true, img: "actions/double_quits.jpg", desc: "Tout doubler ou tout perdre" },
  { name: "It's your choice", freeChoice: true, img: "actions/choice.jpg", desc: "Choisis l'action que tu veux !" },
  { name: "Everybody", everybody: true, img: "actions/everybody.jpg", desc: "Tout le monde joue !" },
  { name: "No way", noWay: true, img: "actions/no_way.jpg", desc: "Bonne réponse obligatoire, sinon +1 point à tous les autres" },
  { name: "Quadruple", multiplier: 4, img: "actions/quadruple.jpg", desc: "×4 les points en cas de succès" }
];

// Création de la grille 4×4 avec les cartes d'action
function createActionGrid() {
  if ($('actionGrid').children.length) return;
  ACTIONS.forEach(a => {
    const card = document.createElement('div');
    card.className = 'actionCard';
    card.innerHTML = `
      <img src="${a.img}" style="width:100%; height:140px; object-fit:cover; border-radius:10px;">
      <div style="padding:8px; background:#1565c0; color:white; border-radius:0 0 10px 10px;">
        <strong>${a.name}</strong><br>
        <small style="font-size:10px;">${a.desc}</small>
      </div>
    `;
    $('actionGrid').appendChild(card);
  });
}

// Mise à jour des positions des pions (approximation circulaire pour l'instant)
function updatePawns(players) {
  const container = $('pions');
  const img = $('plateau');
  const w = img.clientWidth, h = img.clientHeight;
  container.style.width = w + 'px';
  container.style.height = h + 'px';
  container.innerHTML = '';

  const cx = w / 2, cy = h / 2, radius = Math.min(w, h) * 0.39;
  const colors = ['#f44336', '#4caf50', '#ffeb3b', '#2196f3', '#ff9800', '#9c27b0'];

  players.forEach((p, i) => {
    const angle = (p.pos / 48) * Math.PI * 2 - Math.PI / 2; // Ajusté pour 48 cases
    const x = cx + Math.cos(angle) * radius;
    const y = cy + Math.sin(angle) * radius;
    const pawn = document.createElement('div');
    pawn.className = 'pawn';
    pawn.style.left = x + 'px';
    pawn.style.top = y + 'px';
    pawn.style.background = colors[i % 6];
    pawn.textContent = i + 1;
    pawn.title = `${p.name} – ${p.score} pts`;
    container.appendChild(pawn);
  });
}

// === FONCTIONS D'INTERACTION ===
window.createRoom = () => {
  const name = $('playerName').value || 'Hôte';
  socket.emit('create', name);
};

window.joinRoom = () => {
  const code = $('roomCode').value.trim().toUpperCase();
  const name = $('playerName').value || 'Joueur';
  if (!code) return alert('Entre un code !');
  socket.emit('join', { code, name });
};

window.rollDice = () => {
  console.log("Bouton dé cliqué – envoi roll à la salle", room);
  if (!room) return alert('Aucune salle active !');
  socket.emit('roll', room);
  $('rollBtn').disabled = true;
  $('rollBtn').textContent = "Dé lancé...";
};

window.chooseDir = dir => {
  console.log("Direction choisie:", dir, "roll:", lastRoll);
  if (!room || lastRoll === 0) return alert("Lance d'abord le dé !");
  socket.emit('move', { code: room, steps: lastRoll, direction: dir });
  $('directions').style.display = 'none';
  lastRoll = 0;
};

window.sendAnswer = () => {
  const ans = $('answerInput').value.trim();
  if (ans) socket.emit('answer', { code: room, answer: ans });
  $('answerInput').value = '';
};

// Démarrer la partie
$('startBtn').onclick = () => {
  if (room) socket.emit('start', room);
};

// SOCKET ÉVÉNEMENTS
socket.on('created', code => {
  room = code;
  showGame(code);
});

socket.on('joined', code => {
  room = code;
  showGame(code);
});

socket.on('error', msg => alert(msg));

function showGame(code) {
  $('menu').style.display = 'none';
  $('game').style.display = 'block';
  $('roomDisplay').textContent = code;
  createActionGrid();
}

socket.on('players', players => updatePawns(players));

socket.on('gameStart', () => {
  $('startBtn').style.display = 'none';
  alert('La partie est lancée !');
});

socket.on('yourTurn', () => {
  $('rollBtn').disabled = false;
  $('rollBtn').textContent = "Lancer le dé";
});

socket.on('rolled', data => {
  lastRoll = data.roll;
  alert(`Tu as fait ${data.roll} ! Choisis GAUCHE ou DROITE`);
  $('directions').style.display = 'block';
});

socket.on('actionDrawn', data => {
  document.querySelectorAll('.actionCard').forEach(c => c.classList.remove('currentAction'));
  const idx = ACTIONS.findIndex(a => a.name === data.action);
  if (idx >= 0) document.querySelectorAll('.actionCard')[idx].classList.add('currentAction');

  if (data.timer) {
    let t = data.timer;
    $('flashTimer').style.display = 'block';
    $('flashTimer').textContent = t + 's';
    const int = setInterval(() => {
      t--;
      $('flashTimer').textContent = t + 's';
      if (t <= 0) clearInterval(int);
    }, 1000);
  }
});

socket.on('question', q => {
  $('themeTitle').textContent = 'Thème : ' + q.theme;
  $('questionText').textContent = q.question;
  $('questionBox').style.display = 'block';
  $('answerInput').focus();
});

socket.on('results', data => {
  $('results').innerHTML = `<h3>${data.action}</h3>` + data.results.map(r => `${r.correct ? 'Correct' : 'Faux'} ${r.player} → ${r.score} pts`).join('<br>');
  $('questionBox').style.display = 'none';
  $('flashTimer').style.display = 'none';
});
