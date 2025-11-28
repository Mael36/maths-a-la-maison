const socket = io();
let room = null;
let roll = 0;
let board = null;

const $ = id => document.getElementById(id);

// 16 vraies cartes Action (images dans public/actions/)
const ACTIONS = [
  {name:"Flash", img:"actions/flash.jpg", text:"Tu dois répondre en moins de 30 secondes !"},
  {name:"Battle on left", img:"actions/battle_left.jpg", text:"Plus rapide que ton voisin de gauche"},
  {name:"Battle on right", img:"actions/battle_right.jpg", text:"Plus rapide que ton voisin de droite"},
  {name:"Call a friend", img:"actions/call_friend.jpg", text:"Choisis un partenaire → +1 point chacun"},
  {name:"For you", img:"actions/for_you.jpg", text:"Désigne qui répond à ta place"},
  {name:"Second life", img:"actions/second_life.jpg", text:"Deuxième chance si tu échoues"},
  {name:"No way", img:"actions/no_way.jpg", text:"Bonne réponse obligatoire, sinon +1 pt à tous les autres"},
  {name:"Double", img:"actions/double.jpg", text:"×2 les points"},
  {name:"Téléportation", img:"actions/teleport.jpg", text:"Tu choisis la prochaine case"},
  {name:"+1 ou -1", img:"actions/plus_minus.jpg", text:"+2 si bonne / -1 si fausse"},
  {name:"Everybody", img:"actions/everybody.jpg", text:"Tout le monde joue !"},
  {name:"Double or quits", img:"actions/double_quits.jpg", text:"Tout doubler ou tout perdre"},
  {name:"It's your choice", img:"actions/choice.jpg", text:"Tu choisis l'action"},
  {name:"Everybody", img:"actions/everybody.jpg", text:"Tout le monde joue !"},
  {name:"No way", img:"actions/no_way.jpg", text:"Bonne réponse obligatoire"},
  {name:"Quadruple", img:"actions/quadruple.jpg", text:"×4 les points"}
];

fetch('/data/board.json').then(r => r.json()).then(data => {
  board = data;
  createActionGrid();
});

function createActionGrid() {
  const grid = $('actionGrid');
  ACTIONS.forEach(a => {
    const card = document.createElement('div');
    card.className = 'actionCard';
    card.innerHTML = `
      <img src="${a.img}" style="width:100%;height:160px;object-fit:cover;border-radius:12px;">
      <div style="padding:8px;background:#1565c0;color:white;border-radius:0 0 12px 12px;">
        <strong>${a.name}</strong><br>
        <small style="font-size:10px;">${a.text}</small>
      </div>
    `;
    grid.appendChild(card);
  });
}

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

function showPossibleCases(currentPos, steps) {
  const reachable = new Set();
  const queue = [{pos: currentPos, left: steps}];

  while (queue.length) {
    const {pos, left} = queue.shift();
    if (left === 0) { reachable.add(pos); continue; }

    if (pos < 48) {
      queue.push({pos: (pos + 1) % 48, left: left - 1});
      if (pos % 4 === 0) {
        const branch = 48 + (pos / 4) * 3;
        if (branch < 84) queue.push({pos: branch, left: left - 1});
      }
    }
    if (pos >= 48 && pos < 84) {
      const next = pos + 1;
      if (next <= 84) queue.push({pos: next, left: left - 1});
    }
  }

  $('possibleCases').innerHTML = '';
  reachable.forEach(pos => {
    const p = board.positions[pos];
    const spot = document.createElement('div');
    spot.style.position = 'absolute';
    spot.style.width = '90px'; spot.style.height = '90px';
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

window.rollDice = () => socket.emit('roll', room);

socket.on('rolled', data => {
  roll = data.roll;
  alert(`Tu as fait ${roll} ! Clique sur une case dorée`);
  showPossibleCases(data.currentPos, roll);
});

socket.on('players', p => updatePawns(p));
socket.on('yourTurn', () => {
  $('rollBtn').disabled = false;
  $('rollBtn').textContent = 'Lancer le dé';
});

socket.on('actionDrawn', data => {
  document.querySelectorAll('.actionCard').forEach(c => c.classList.remove('currentAction'));
  const card = [...document.querySelectorAll('.actionCard')].find(c => c.textContent.includes(data.action));
  if (card) card.classList.add('currentAction');
});
