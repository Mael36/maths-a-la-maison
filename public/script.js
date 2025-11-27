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

})();