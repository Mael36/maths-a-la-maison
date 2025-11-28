(() => {
  const socket = io();
  let currentRoom = null;
  let myName = '';
  let amHost = false;
  let myId = null;
  const BOARD_LENGTH = 32;
  const COLORS = ['#e6194b','#3cb44b','#ffe119','#4363d8','#f58231','#911eb4'];

  const $ = id => document.getElementById(id);

  function showGame(room, isHost) {
    $('menu').style.display = 'none';
    $('game').style.display = 'block';
    $('roomCodeDisplay').textContent = `Salle : ${room}`;
    amHost = !!isHost;
    currentRoom = room;
  }

  function renderPawns(players) {
    const pions = $('pions');
    const img = $('boardImg');
    if (!pions || !img) return;
    const w = img.clientWidth || 400;
    pions.style.width = w + 'px';
    pions.style.height = w + 'px';
    pions.innerHTML = '';
    const cx = w / 2;
    const cy = w / 2;
    const radius = w * 0.38;
    players.forEach((p, i) => {
      const pos = (typeof p.pos === 'number') ? p.pos : 0;
      const angle = ((pos + 0.5) / BOARD_LENGTH) * Math.PI * 2 - Math.PI/2;
      const x = cx + Math.cos(angle) * radius;
      const y = cy + Math.sin(angle) * radius;
      const dot = document.createElement('div');
      dot.className = 'pawn';
      dot.style.background = COLORS[i % COLORS.length];
      dot.style.left = (x - 22) + 'px';
      dot.style.top = (y - 22) + 'px';
      dot.title = `${p.name} (${p.score || 0} pts)`;
      dot.innerHTML = i + 1;
      pions.appendChild(dot);
    });
  }

  // === GRILLE DES 16 ACTIONS ===
  function createActionGrid() {
    if (document.getElementById('actionGrid')) return;
    const grid = document.createElement('div');
    grid.id = 'actionGrid';

    ACTIONS.forEach(action => {
      const card = document.createElement('div');
      card.className = 'actionCard';
      card.innerHTML = `
        <div class="actionIcon">${action.name}</div>
        <div class="actionDesc">${action.desc}</div>
      `;
      card.title = action.desc;
      grid.appendChild(card);
    });

    $('gameBoard').appendChild(grid);
  }

  // === FONCTIONS DU JEU ===
  window.createRoom = () => {
    const name = $('playerName').value.trim() || 'Hôte';
    myName = name;
    socket.emit('create', name);
  };

  window.joinRoom = () => {
    const name = $('playerName').value.trim() || 'Joueur';
    const code = $('roomCodeInput').value.trim().toUpperCase();
    if (!code) return alert('Entre le code de la salle !');
    myName = name;
    socket.emit('join', { code, name });
  };

  window.rollDice = () => {
    if (!currentRoom) return;
    socket.emit('roll', currentRoom);
    $('rollButton').disabled = true;
  };

  window.chooseDirection = (dir) => {
    if (!currentRoom) return;
    socket.emit('move', { code: currentRoom, steps: +$('controls').dataset.lastRoll || 1, direction: dir });
    document.querySelectorAll('.dirBtn').forEach(btn => btn.disabled = true);
  };

  window.submitAnswer = () => {
    const ans = $('answerInput').value.trim();
    if (!ans || !currentRoom) return;
    socket.emit('answer', { code: currentRoom, answer: ans });
    $('answerInput').value = '';
  };

  // === SOCKET EVENTS ===
  socket.on('connect', () => { myId = socket.id; });

  socket.on('created', (code) => {
    currentRoom = code;
    showGame(code, true);
    $('roomInfo').innerHTML = `<h3>🎉 Salle créée : <strong>${code}</strong></h3><p>Partage ce code avec tes amis !</p>`;
  });

  socket.on('joined', (code) => {
    currentRoom = code;
    showGame(code, false);
    $('roomInfo').innerHTML = `<h3>✅ Rejoint : <strong>${code}</strong></h3>`;
  });

  socket.on('players', (players) => {
    const list = $('playerList');
    list.innerHTML = '';
    players.forEach(p => {
      const div = document.createElement('div');
      div.innerHTML = `<strong>${p.name}</strong> - ${p.score || 0} pts - Case ${p.pos || 0}`;
      list.appendChild(div);
    });
    renderPawns(players);
  });

  socket.on('gameStart', () => {
    $('startButton').style.display = 'none';
    $('rollButton').style.display = 'inline-block';
    createActionGrid();
    alert('🎮 Partie lancée ! Premier joueur, lance le dé.');
  });

  socket.on('yourTurn', () => {
    $('rollButton').disabled = false;
    alert('🎲 C\'est ton tour ! Lance le dé.');
  });

  socket.on('rolled', ({ roll }) => {
    $('controls').dataset.lastRoll = roll;
    document.querySelectorAll('.dirBtn').forEach(btn => btn.disabled = false);
    alert(`Tu as fait ${roll} ! Choisis GAUCHE ← ou DROITE →`);
  });

  socket.on('rolledInfo', ({ player, roll }) => {
    console.log(`${player} a fait ${roll}`);
  });

  socket.on('actionDrawn', (data) => {
    const timer = $('flashTimer');
    if (data.timer) {
      timer.style.display = 'block';
      let time = data.timer;
      timer.textContent = `${time}s`;
      const int = setInterval(() => {
        time--;
        timer.textContent = `${time}s`;
        if (time <= 0) clearInterval(int);
      }, 1000);
    } else {
      timer.style.display = 'none';
    }

    // Surligner l'action
    setTimeout(() => {
      document.querySelectorAll('.actionCard').forEach(c => c.classList.remove('currentAction'));
      const cards = document.querySelectorAll('.actionCard');
      const index = ACTIONS.findIndex(a => a.name === data.action);
      if (cards[index]) cards[index].classList.add('currentAction');
    }, 100);
  });

  socket.on('question', (data) => {
    $('questionTheme').textContent = `Thème : ${data.theme}`;
    $('questionText').textContent = data.question;
    $('questionContainer').style.display = 'block';
    $('answerInput').focus();
    $('answerInput').value = '';
  });

  socket.on('results', (data) => {
    $('results').innerHTML = `<h3>🎯 Résultats : ${data.action}</h3>`;
    data.results.forEach(r => {
      const emoji = r.correct ? '✅' : '❌';
      $('results').innerHTML += `<div>${emoji} ${r.player} : ${r.score} pts</div>`;
    });
    setTimeout(() => $('questionContainer').style.display = 'none', 3000);
  });

  socket.on('actionClear', () => {
    $('flashTimer').style.display = 'none';
    document.querySelectorAll('.actionCard').forEach(c => c.classList.remove('currentAction'));
  });

  // === ÉVÉNEMENTS DOM ===
  document.addEventListener('DOMContentLoaded', () => {
    const startBtn = $('startButton');
    if (startBtn) startBtn.addEventListener('click', () => socket.emit('start', currentRoom));
  });
})();
