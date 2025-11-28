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
    $('roomCode').textContent = room;
    amHost = !!isHost;
    $('startButton').style.display = amHost ? 'inline-block' : 'none';
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
      // centrer sur la case : ajouter 0.5 pour aller au milieu de la case, pas entre deux
      const angle = ((pos + 0.5) / BOARD_LENGTH) * Math.PI * 2 - Math.PI/2;
      const x = cx + Math.cos(angle) * radius;
      const y = cy + Math.sin(angle) * radius;
      const dot = document.createElement('div');
      dot.className = 'pawn';
      dot.style.background = COLORS[i % COLORS.length];
      dot.style.left = x + 'px';
      dot.style.top = y + 'px';
      dot.title = p.name;
      pions.appendChild(dot);
    });
  }

  // action display + timer
  let _actionTimerInterval = null;
  function clearActionDisplay() {
    if (_actionTimerInterval) { clearInterval(_actionTimerInterval); _actionTimerInterval = null; }
    $('actionDesc').textContent = '';
    $('actionTimer').textContent = '';
  }

  // fonctions globales utilisées par index.html
  window.createRoom = function() {
    const name = ($('playerName') && $('playerName').value.trim()) || 'Hôte';
    myName = name;
    socket.emit('create', name);
  };

  window.joinRoom = function() {
    const name = ($('playerName') && $('playerName').value.trim()) || 'Joueur';
    const code = ($('roomCodeInput') && $('roomCodeInput').value.trim()) || '';
    if (!code) { alert('Entrez un code de salle.'); return; }
    myName = name;
    socket.emit('join', { code, name });
  };

  window.submitAnswer = function() {
    const ans = ($('answerInput') && $('answerInput').value) || '';
    if (!currentRoom) { alert('Pas dans une salle'); return; }
    socket.emit('answer', { code: currentRoom, answer: ans });
    if ($('answerInput')) $('answerInput').value = '';
    $('questionContainer').style.display = 'none';
  };

  // roll button -> demande au serveur de lancer le dé
  function enableRoll() {
    const rollBtn = $('rollButton');
    if (rollBtn) rollBtn.disabled = false;
  }
  function disableRoll() {
    const rollBtn = $('rollButton');
    if (rollBtn) rollBtn.disabled = true;
  }

  document.addEventListener('DOMContentLoaded', () => {
    const sb = $('startButton');
    if (sb) sb.addEventListener('click', () => {
      if (!currentRoom) return;
      socket.emit('start', currentRoom);
    });

    const rollBtn = $('rollButton');
    if (rollBtn) {
      rollBtn.addEventListener('click', () => {
        if (!currentRoom) { alert('Pas dans une salle'); return; }
        socket.emit('roll', currentRoom);
        disableRoll();
      });
    }

    // boutons direction créés dynamiquement (left / right)
    const controls = $('controls');
    if (controls) {
      const dirDiv = document.createElement('div');
      dirDiv.id = 'dirChoices';
      ['left', 'right'].forEach(d => {
        const b = document.createElement('button');
        b.textContent = d === 'left' ? 'Gauche' : 'Droite';
        b.className = 'dirBtn';
        b.style.margin = '4px';
        b.disabled = true;
        b.addEventListener('click', () => {
          // steps kept from last rolled value stored on client
          const steps = +controls.dataset.lastRoll || 1;
          socket.emit('move', { code: currentRoom, steps, direction: d });
          // disable choices until next turn
          document.querySelectorAll('.dirBtn').forEach(btn => btn.disabled = true);
        });
        dirDiv.appendChild(b);
      });
      controls.appendChild(dirDiv);
    }
  });

  // SOCKET handlers
  socket.on('connect', () => { myId = socket.id; });

  socket.on('created', (code) => {
    currentRoom = code;
    showGame(code, true);
    alert('Salle créée: ' + code);
  });

  socket.on('joined', (code) => {
    currentRoom = code;
    showGame(code, false);
    alert('Rejoint: ' + code);
  });

  socket.on('players', (players) => {
    const playerList = $('playerList');
    playerList.innerHTML = '';
    players.forEach(player => {
      const li = document.createElement('li');
      li.textContent = `${player.name} - Score: ${player.score || 0} - Position: ${player.pos || 0}`;
      playerList.appendChild(li);
    });
    renderPawns(players);
  });

  socket.on('gameStart', (info) => {
    alert('Partie démarrée');
  });

  // serveur signale que c'est ton tour : activer roll
  socket.on('yourTurn', () => {
    enableRoll();
    alert("C'est ton tour. Clique sur 'Lancer le dé'.");
  });

  // serveur renvoie le résultat du lancer
  socket.on('rolled', ({ roll }) => {
    const controls = $('controls');
    if (controls) controls.dataset.lastRoll = roll;
    // activer choix direction
    document.querySelectorAll('.dirBtn').forEach(btn => btn.disabled = false);
    alert('Tu as fait ' + roll + '. Choisis Gauche ou Droite.');
  });

  // info publique sur le roll
  socket.on('rolledInfo', (info) => {
    // console.log(info);
  });

  socket.on('turn', (data) => {
    // mise à jour sommaire (position + action info)
    // joueurs seront mis à jour via event players
  });

  // réception d'une action tirée
  socket.on('actionDrawn', (data) => {
    // data: { player, action, timer }
    $('actionDesc').textContent = `${data.player} → ${data.action}`;
    // ne pas clear automatiquement ici : attendre actionClear du serveur
    if (data.timer && Number(data.timer) > 0) {
      let remaining = Number(data.timer);
      $('actionTimer').textContent = ` (${remaining}s)`;
      if (_actionTimerInterval) clearInterval(_actionTimerInterval);
      _actionTimerInterval = setInterval(() => {
        remaining--;
        if (remaining <= 0) {
          clearActionDisplay();
        } else {
          $('actionTimer').textContent = ` (${remaining}s)`;
        }
      }, 1000);
    }
  });

  // serveur ordonne de retirer l'affichage de l'action (après résolution)
  socket.on('actionClear', () => {
    clearActionDisplay();
  });

  // afficher la question (visible au joueur ciblé, everybody=true pour tous)
  socket.on('question', (data) => {
    const { theme, question } = data;
    $('questionTheme').textContent = `Thème : ${theme}`;
    $('questionText').textContent = question;
    $('questionContainer').style.display = 'block';
    $('answerInput').focus();
  });

  socket.on('noQuestion', () => {
    alert("Aucune question disponible pour cette case.");
  });

  socket.on('result', (res) => {
    alert(`${res.player} — ${res.correct ? 'Bonne réponse' : 'Mauvaise réponse'} — score: ${res.score}`);
  });

  socket.on('actionDrawn', (d) => {
    // double affichage minimal
    $('actionInfo').textContent = `${d.player} → ${d.action}`;
    setTimeout(() => $('actionInfo').textContent = '', 3000);
  });
  
  socket.on('choosePlayer', ({ action }) => {
  alert(`Action: ${action}\nChoisis un joueur (clique sur son nom dans la liste)`);
  document.querySelectorAll('#playerList li').forEach(li => {
    li.style.cursor = 'pointer';
    li.onclick = () => {
      const targetName = li.textContent.split(' - ')[0];
      const target = players.find(p => p.name === targetName);
      if (target) {
        socket.emit('playerChosen', { code: currentRoom, targetId: target.id });
        li.onclick = null;
      }
    };
  });
});

socket.on('chooseAction', ({ actions }) => {
  const list = actions.map(a => `${a.name}: ${a.desc}`).join('\n');
  const choice = prompt(`Choisis une action:\n\n${list}`);
  if (choice) socket.emit('actionChosen', { code: currentRoom, actionName: choice.split(':')[0].trim() });
});

socket.on('teleport', () => {
  const pos = prompt("Téléportation ! Choisis une case (0 à 31):");
  if (pos && !isNaN(pos)) {
    socket.emit('move', { code: currentRoom, steps: 0, direction: 'right', teleportTo: +pos });
  }
});
  
// === GRILLE DES ACTIONS + TIMER FLASH ===
function createActionGrid() {
  if (document.getElementById('actionGrid')) return;

  const grid = document.createElement('div');
  grid.id = 'actionGrid';
  grid.style.cssText = `position:absolute;top:8px;left:8px;z-index:999;display:grid;grid-template-columns:repeat(4,1fr);gap:9px;background:rgba(240,248,255,0.97);padding:14px;border-radius:16px;box-shadow:0 8px 32px rgba(0,0,0,0.25);border:3px solid #1976d2;font-size:11px;max-width:480px;backdrop-filter:blur(8px);`;

  ACTIONS.forEach(action => {
    const card = document.createElement('div');
    card.className = 'actionCard';
    card.innerHTML = `<div style="font-weight:bold;color:#1976d2;margin-bottom:4px;">${action.name}</div><div style="font-size:10px;line-height:1.3;">${action.desc}</div>`;
    card.title = action.desc;
    grid.appendChild(card);
  });

  const board = document.getElementById('board');
  board.style.position = 'relative';
  board.appendChild(grid);

  // Timer Flash visible
  const timerDiv = document.createElement('div');
  timerDiv.id = 'flashTimer';
  timerDiv.style.cssText = `position:absolute;top:10px;right:10px;background:#d32f2f;color:white;padding:10px 20px;border-radius:50px;font-size:20px;font-weight:bold;box-shadow:0 4px 15px rgba(0,0,0,0.3);display:none;z-index:1000;`;
  board.appendChild(timerDiv);
}

socket.on('gameStart', () => setTimeout(createActionGrid, 600));

socket.on('actionDrawn', (data) => {
  document.querySelectorAll('.actionCard').forEach(c => c.classList.remove('currentAction'));
  const card = Array.from(document.querySelectorAll('.actionCard')).find(c => c.textContent.includes(data.action));
  if (card) card.classList.add('currentAction');

  const timer = document.getElementById('flashTimer');
  if (data.timer) {
    timer.style.display = 'block';
    timer.textContent = `${data.timer}s`;
  } else {
    timer.style.display = 'none';
  }
});

socket.on('timerUpdate', ({ time }) => {
  const timer = document.getElementById('flashTimer');
  timer.textContent = `${time}s`;
  if (time <= 10) timer.style.background = '#b71c1c';
});

socket.on('choosePlayerOrAction', ({ type }) => {
  if (type === 'player') {
    alert("Clique sur le nom d’un joueur dans la liste pour le choisir !");
  } else {
    const list = ACTIONS.map(a => a.name).join('\n');
    const choice = prompt(`Choisis une action :\n${list}`);
    if (choice) socket.emit('actionChosen', { code: currentRoom, actionName: choice });
  }
});

socket.on('teleportChoice', () => {
  const pos = prompt("Téléportation ! Choisis une case (0 à 31) :");
  if (pos && !isNaN(pos) && pos >= 0 && pos < 32) {
    // Le serveur gère le déplacement
  }
});
})();

