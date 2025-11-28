const socket = io();
let room = null;
let roll = 0;
let board = null;

const $ = id => document.getElementById(id);

fetch('/data/board.json').then(r => r.json()).then(data => {
  board = data;
  createActionGrid();
});

function createActionGrid() {
  const actions = [
    {name:"Flash",img:"actions/flash.jpg"},
    {name:"Battle on left",img:"actions/battle_left.jpg"},
    {name:"Battle on right",img:"actions/battle_right.jpg"},
    {name:"Call a friend",img:"actions/call_friend.jpg"},
    {name:"For you",img:"actions/for_you.jpg"},
    {name:"Second life",img:"actions/second_life.jpg"},
    {name:"No way",img:"actions/no_way.jpg"},
    {name:"Double",img:"actions/double.jpg"},
    {name:"Téléportation",img:"actions/teleport.jpg"},
    {name:"+1 ou -1",img:"actions/plus_minus.jpg"},
    {name:"Everybody",img:"actions/everybody.jpg"},
    {name:"Double or quits",img:"actions/double_quits.jpg"},
    {name:"It's your choice",img:"actions/choice.jpg"},
    {name:"Everybody",img:"actions/everybody.jpg"},
    {name:"No way",img:"actions/no_way.jpg"},
    {name:"Quadruple",img:"actions/quadruple.jpg"}
  ];
  actions.forEach(a => {
    const card = document.createElement('div');
    card.className = 'actionCard';
    card.innerHTML = `<img src="${a.img}" style="width:100%;border-radius:10px;"><strong>${a.name}</strong>`;
    $('actionGrid').appendChild(card);
  });
}

function updatePawns(players) {
  $('pions').innerHTML = '';
  const img = $('plateau');
  const rect = img.getBoundingClientRect();

  players.forEach((p, i) => {
    const pos = board.positions[p.pos];
    const x = rect.left + rect.width * (pos.x / 100);
    const y = rect.top + rect.height * (pos.y / 100);

    const pawn = document.createElement('div');
    pawn.className = 'pawn';
    pawn.style.left = (x - 28) + 'px';
    pawn.style.top = (y - 28) + 'px';
    pawn.style.background = ['#f44336','#4caf50','#ffeb3b','#2196f3','#ff9800','#9c27b0'][i];
    pawn.textContent = i + 1;
    pawn.title = p.name + ' – ' + p.score + ' pts';
    $('pions').appendChild(pawn);
  });
}

// Afficher toutes les cases atteignables (ramifications incluses)
function showPossibleCases(currentPos, steps) {
  const reachable = new Set();
  const queue = [{pos: currentPos, remaining: steps}];

  while (queue.length) {
    const {pos, remaining} = queue.shift();
    if (remaining === 0) {
      reachable.add(pos);
      continue;
    }
    // Avancer sur le cercle
    if (pos < 48) {
      const next = (pos + 1) % 48;
      queue.push({pos: next, remaining: remaining - 1});
    }
    // Entrer dans une branche si on est sur une case d'embranchement
    if (pos < 48 && pos % 4 === 0) {
      const branchIndex = pos / 4;
      const branchStart = 48 + branchIndex * 3;
      if (branchStart < 84) {
        queue.push({pos: branchStart, remaining: remaining - 1});
      }
    }
    // Avancer dans une branche
    if (pos >= 48 && pos < 84) {
      const nextInBranch = pos + 1;
      if (nextInBranch < 84 || nextInBranch === 84) {
        queue.push({pos: nextInBranch, remaining: remaining - 1});
      }
    }
  }

  // Affichage visuel
  $('possibleCases').innerHTML = '';
  reachable.forEach(pos => {
    const p = board.positions[pos];
    const spot = document.createElement('div');
    spot.style.position = 'absolute';
    spot.style.width = '70px';
    spot.style.height = '70px';
    spot.style.background = 'rgba(255,215,0,0.7)';
    spot.style.border = '5px solid gold';
    spot.style.borderRadius = '50%';
    spot.style.left = (p.x / 100 * img.width - 35) + 'px';
    spot.style.top = (p.y / 100 * img.height - 35) + 'px';
    spot.style.cursor = 'pointer';
    spot.style.boxShadow = '0 0 40px gold';
    spot.onclick = () => socket.emit('moveTo', {code: room, pos});
    $('possibleCases').appendChild(spot);
  });
}

// === ÉVÉNEMENTS ===
window.rollDice = () => socket.emit('roll', room);

socket.on('rolled', data => {
  roll = data.roll;
  alert(`Tu as fait ${roll} ! Clique sur une case dorée`);
  showPossibleCases(data.currentPos, roll);
});

socket.on('players', players => updatePawns(players));
socket.on('yourTurn', () => $('rollBtn').disabled = false);
socket.on('actionDrawn', a => {
  document.querySelectorAll('.actionCard').forEach(c => c.classList.remove('currentAction'));
  const card = [...document.querySelectorAll('.actionCard')].find(c => c.textContent.includes(a.name));
  if (card) card.classList.add('currentAction');
});
