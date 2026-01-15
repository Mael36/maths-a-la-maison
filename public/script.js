const socket = io();
let room = null;
let board = null;
let players = [];
let currentPlayerId = null;
let activePlayers = [];
let clientTimer = null;
let requiredCategories = [];

// Récupération du username depuis localStorage (comme dans profile.html)
let currentUser = null;
try {
  const userData = localStorage.getItem('currentUser');
  if (userData) {
    currentUser = JSON.parse(userData);
  }
} catch (e) {
  console.error('Erreur parsing currentUser:', e);
}

// Si pas connecté → redirection vers login
if (!currentUser || !currentUser.username) {
  alert('Vous devez être connecté pour jouer.');
  window.location.href = '/login.html';
}

// Envoi automatique du username après connexion Socket
// Juste après const socket = io();
socket.on('connect', () => {
  const userData = localStorage.getItem('currentUser');
  if (!userData) {
    alert('Vous devez être connecté pour jouer.');
    window.location.href = '/login.html';
    return;
  }
  
  try {
    currentUser = JSON.parse(userData);
  } catch (e) {
    console.error('Erreur parse currentUser', e);
    alert('Session invalide. Veuillez vous reconnecter.');
    window.location.href = '/login.html';
    return;
  }

  if (!currentUser.username) {
    alert('Aucun nom d’utilisateur trouvé. Veuillez vous reconnecter.');
    window.location.href = '/login.html';
    return;
  }

  socket.emit('auth', currentUser.username);
  console.log('[Client] Auth envoyé pour :', currentUser.username);
});

// Helpers
const $ = id => document.getElementById(id);

// UI elements
const elMenu = $('menu');
const elGame = $('game');
const elCreate = $('createBtn');
const elJoin = $('joinBtn');
const elStart = $('startBtn');
const elRoll = $('rollBtn');
const elPlateau = $('plateau');
const elPions = $('pions');
const elPossible = $('possibleCases');
const elActionGrid = $('actionGrid');
const elScoreTable = $('scoreTable');
const elRoomDisplay = $('roomDisplay');
const elDiceResult = $('diceResult');
const elQuestionBox = $('questionBox');
const elThemeTitle = $('themeTitle');
const elQuestionText = $('questionText');
const elQuestionImg = $('questionImg');
const elAnswerInput = $('answerInput');
const elSendAnswer = $('sendAnswerBtn');
const elTimer = $('timer');
const elResultBox = $('resultBox');
const elResultText = $('resultText');
const elChoice = $('choice');

// Créer une partie (sans pseudo)
elCreate.onclick = () => {
  if (!socket.connected) return alert('Connexion en cours...');
  socket.emit('create', currentUser.username);
};

elJoin.onclick = () => {
  const code = ($('roomCode').value || '').trim().toUpperCase();
  if (!code) return alert('Code requis !');
  if (!socket.connected) return alert('Connexion en cours...');
  socket.emit('join', { code, name: currentUser.username });
};

// Démarrer la partie
elStart && (elStart.onclick = () => { if (room) socket.emit('start', room); });

// Lancer le dé
elRoll && (elRoll.onclick = () => {
  if (!room) return;
  socket.emit('roll', room);
  elRoll.disabled = true;
});

// Envoyer la réponse
elSendAnswer && (elSendAnswer.onclick = () => {
  const ans = (elAnswerInput.value || '').trim();
  if (!ans) return;
  socket.emit('answer', { code: room, answer: ans });
  hideQuestion();
});

// Voisins (inchangé)
const voisins = {
    1: [2, 48],
    2: [1, 3],
    3: [2, 4, 49],
    4: [3, 5],
    5: [4, 6],
    6: [5, 7],
    7: [6, 8, 51],
    8: [7, 9],
    9: [8, 10],
    10: [9, 11],
    11: [10, 12, 53],
    12: [11, 13],
    13: [12, 14],
    14: [13, 15],
    15: [14, 16, 55],
    16: [15, 17],
    17: [16, 18],
    18: [17, 19],
    19: [18, 20, 57],
    20: [19, 21],
    21: [20, 22],
    22: [21, 23],
    23: [22, 24, 59],
    24: [23, 25],
    25: [24, 26],
    26: [25, 27],
    27: [26, 28, 61],
    28: [27, 29],
    29: [28, 30],
    30: [29, 31],
    31: [30, 32, 63],
    32: [31, 33],
    33: [32, 34],
    34: [33, 35],
    35: [34, 36, 65],
    36: [35, 37],
    37: [36, 38],
    38: [37, 39],
    39: [38, 40, 67],
    40: [39, 41],
    41: [40, 42],
    42: [41, 43],
    43: [42, 44, 69],
    44: [43, 45],
    45: [44, 46],
    46: [45, 47],
    47: [46, 48, 71],
    48: [47, 1], 
    49: [3, 50],
    50: [49, 73],
    51: [7, 52],
    52: [51, 73],
    53: [11, 54],
    54: [53, 73],
    55: [15, 56],
    56: [55, 73],
    57: [19, 58],
    58: [57, 73],
    59: [23, 60],
    60: [59, 73],
    61: [27, 62],
    62: [61, 73],
    63: [31, 64],
    64: [63, 73],
    65: [35, 66],
    66: [65, 73],
    67: [39, 68],
    68: [67, 73],
    69: [43, 70],
    70: [69, 73],
    71: [47, 72],
    72: [71, 73],
    73: [50, 52, 54, 56, 58, 60, 62, 64, 66, 68, 70, 72]
}

// Création des cartes actions
function createActionCards() {
  if (!elActionGrid) return;
  elActionGrid.innerHTML = '';
  const actions = [
    "Flash","Battle on left","Battle on right","Call a friend","For you",
    "Second life","No way","Double","Téléportation","+1 ou -1",
    "Everybody","Double or quits","It's your choice","Quadruple"
  ];
  actions.forEach(a => {
    const c = document.createElement('div');
    c.className = 'actionCard';
    c.textContent = a;
    c.dataset.action = a;
    elActionGrid.appendChild(c);
  });
}
createActionCards();

// Mise à jour des pions
function updatePawns(list) {
  if (Array.isArray(list)) players = list;
  if (!board || !board.positions) return;
  elPions.innerHTML = '';
  (players || []).forEach((p, i) => {
    const idx = Math.max(0, Math.min(p.pos || 0, board.positions.length - 1));
    const pos = board.positions[idx];
    const pawn = document.createElement('div');
    pawn.className = 'pawn';
    pawn.style.position = 'absolute';
    pawn.style.left = `${pos.x}px`;
    pawn.style.top = `${pos.y}px`;
    pawn.style.transform = 'translate(-50%, -50%)';
    pawn.style.width = '36px';
    pawn.style.height = '36px';
    pawn.style.lineHeight = '36px';
    pawn.style.fontSize = '16px';
    pawn.style.background = ['#e53935','#43a047','#fb8c00','#1e88e5','#8e24aa','#fdd835'][i % 6];
    pawn.style.border = '2px solid #fff';
    pawn.style.boxShadow = '0 2px 6px rgba(0,0,0,0.5)';
    pawn.textContent = i + 1;
    elPions.appendChild(pawn);
  });
}

// Affichage des cases possibles
function showPossibleCases(currentPos, steps) {
  if (!board || !board.positions) return;
  elPossible.innerHTML = '';
  const currentPos1 = currentPos + 1;
  const reachable = new Set();
  const queue = [{ pos: currentPos1, rem: steps, visited: new Set([currentPos1]) }];
  while (queue.length) {
    const { pos, rem, visited } = queue.shift();
    if (rem === 0) {
      reachable.add(pos - 1);
      continue;
    }
    const nexts = voisins[pos] || [];
    nexts.forEach(next => {
      if (!visited.has(next)) {
        const newVisited = new Set(visited);
        newVisited.add(next);
        queue.push({ pos: next, rem: rem - 1, visited: newVisited });
      }
    });
  }
  Array.from(reachable).sort((a, b) => a - b).forEach(posIdx => {
    const pos = board.positions[posIdx];
    if (!pos) return;
    const spot = document.createElement('div');
    spot.className = 'spot';
    spot.style.position = 'absolute';
    spot.style.left = `${pos.x}px`;
    spot.style.top = `${pos.y}px`;
    spot.style.transform = 'translate(-50%, -50%)';
    spot.style.pointerEvents = 'auto';
    spot.addEventListener('click', () => {
      socket.emit('moveTo', { code: room, pos: posIdx });
      elPossible.innerHTML = '';
    });
    elPossible.appendChild(spot);
  });
}

// Sélection joueur ou action
function showSelection(payload) {
  elChoice.style.display = 'block';
  elChoice.style.zIndex = '100000';
  elChoice.innerHTML = '';

  const title = document.createElement('div');
  title.style.fontWeight = 'bold';
  title.style.marginBottom = '15px';
  title.textContent = payload.message || 'Choisir';
  elChoice.appendChild(title);

  if (payload.type === 'player') {
    // Filtre : on retire le joueur actuel (socket.id)
    const otherPlayers = (players || []).filter(p => p.id !== socket.id);

    // Affichage des autres joueurs seulement
    otherPlayers.forEach(p => {
      const b = document.createElement('button');
      b.textContent = p.name;
      b.style.margin = '6px';
      b.style.padding = '8px 16px';
      b.style.background = '#1976d2';
      b.style.color = 'white';
      b.style.border = 'none';
      b.style.borderRadius = '6px';
      b.style.cursor = 'pointer';
      b.onclick = () => {
        socket.emit('selectPlayer', { code: room, targetId: p.id });
        elChoice.style.display = 'none';
      };
      elChoice.appendChild(b);
    });
  } 
  else if (payload.type === 'action') {
    // Pas de changement pour le choix d'action (It's your choice)
    (payload.actions || []).forEach(act => {
      const b = document.createElement('button');
      b.textContent = act;
      b.style.margin = '6px';
      b.style.padding = '8px 16px';
      b.style.background = '#43a047';
      b.style.color = 'white';
      b.style.border = 'none';
      b.style.borderRadius = '6px';
      b.style.cursor = 'pointer';
      b.onclick = () => {
        socket.emit('chooseAction', { code: room, chosenAction: act });
        elChoice.style.display = 'none';
      };
      elChoice.appendChild(b);
    });
  }

  // Pas de bouton "Annuler" comme demandé
}

// Affichage question
function showQuestion(payload) {
  console.log('[showQuestion] payload reçu :', payload);
  if (!payload) return;
  if (payload.recipients && Array.isArray(payload.recipients) && !payload.recipients.includes(socket.id)) return;

  if (payload.flashCancelled) {
    const msgDiv = document.createElement('div');
    msgDiv.style.color = 'red';
    msgDiv.style.fontWeight = 'bold';
    msgDiv.style.margin = '10px 0';
    msgDiv.textContent = payload.message || "Flash annulé par cette question spéciale !";
    elQuestionBox.insertBefore(msgDiv, elQuestionText);
  }

  const elQuestionImg = $('questionImg');
  $('themeTitle').textContent = payload.theme || 'Maths';
  $('questionText').textContent = payload.question || '';
  $('answerInput').value = '';

  if (payload.img && elQuestionImg) {
    elQuestionImg.src = payload.img;
    elQuestionImg.style.display = 'block';
  } else if (elQuestionImg) {
    elQuestionImg.src = '';
    elQuestionImg.style.display = 'none';
  }

  $('questionBox').style.display = 'block';
  startTimer(payload.timer || 60);
}

// Cacher question
function hideQuestion() {
  $('questionBox').style.display = 'none';
  if ($('questionImg')) {
    $('questionImg').style.display = 'none';
    $('questionImg').src = '';
  }
  stopTimer();
}

// Timer
function startTimer(seconds) {
  stopTimer();
  let t = seconds;
  elTimer.style.display = 'block';
  elTimer.textContent = t + 's';
  clientTimer = setInterval(() => {
    t--;
    elTimer.textContent = t + 's';
    if (t <= 0) {
      stopTimer();
      socket.emit('timeout', { code: room });
    }
  }, 1000);
}

function stopTimer() {
  if (clientTimer) clearInterval(clientTimer);
  clientTimer = null;
  if (elTimer) elTimer.style.display = 'none';
}

// Résultats
function showResults(correct, message, correction = '', detail = '') {
  const popup = document.createElement('div');
  popup.style.cssText = `
    position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
    background: white; padding: 30px; border-radius: 12px; box-shadow: 0 8px 30px rgba(0,0,0,0.4);
    z-index: 1000; max-width: 500px; text-align: center;
  `;

  popup.innerHTML = `
    <h2 style="color: ${correct ? '#2e7d32' : '#c62828'};">${correct ? 'Bonne réponse !' : 'Mauvaise réponse'}</h2>
    <p style="font-size: 1.2em; margin: 20px 0;">${message || ''}</p>
    ${!correct ? `
      <div style="background: #f5f5f5; padding: 15px; border-radius: 8px; text-align: left;">
        <strong>Bonne réponse :</strong> ${correction || 'Non disponible'}<br><br>
        ${detail ? `<strong>Détail :</strong> ${detail}` : ''}
      </div>
    ` : ''}
    <button id="closeResultPopup" style="margin-top: 20px; padding: 10px 25px; background: #1976d2; color: white; border: none; border-radius: 6px; cursor: pointer;">
      Passer au tour suivant
    </button>
  `;

  document.body.appendChild(popup);

  document.getElementById('closeResultPopup').onclick = () => {
    popup.remove();
    // Optionnel : demander au serveur de passer au suivant
    if (room) socket.emit('acknowledgeResults', { code: room });
  };
}

// Tableau des scores
function renderScoreTable(list) {
  players = Array.isArray(list) ? list : players;
  elScoreTable.innerHTML = '<b>Scores</b><br>';
  (players || []).forEach((p, i) => {
    const row = document.createElement('div');
    row.textContent = `${i+1}. ${p.name} — ${p.score || 0} pts`;
    row.style.cursor = 'pointer';
    row.style.padding = '8px';
    row.style.borderRadius = '6px';
    row.style.transition = 'background 0.15s';
    row.onmouseover = () => { row.style.background = '#f0f0f0'; };
    row.onmouseout = () => { row.style.background = ''; };

    // Clic → affiche les catégories
    row.onclick = () => {
      showPlayerCategories(p);
    };

    if (p.id === currentPlayerId) {
      row.style.fontWeight = 'bold';
      row.style.background = '#e3f2fd';
    }

    elScoreTable.appendChild(row);
  });
}

socket.on('categoriesList', categories => {
  requiredCategories = categories;
  console.log('Catégories requises reçues :', requiredCategories);
});

// Ajoute cette fonction après renderScoreTable par exemple
function showPlayerCategories(player) {
  if (!player) return;

  console.log("Joueur cliqué :", player.name);
  console.log("categoriesCompleted reçu :", player.categoriesCompleted);
  console.log("Type :", Array.isArray(player.categoriesCompleted) ? "tableau" : typeof player.categoriesCompleted);

  // Récupère la liste complète envoyée par le serveur
  // (requiredCategories est une variable globale remplie par socket.on('categoriesList'))
  const allCategories = requiredCategories.length > 0 
    ? requiredCategories 
    : ["Calcul litteral", "Nombres", "Transformations", "Communiquer", "Géométrie dans l'espace", "Proportionnalité", "Stats ou probas", "Géométrie", "Informatique", "Logique", "Calculs", "Fonctions"]; // fallback temporaire

  // player.categoriesCompleted est un tableau (grâce à la sérialisation serveur)
  const completedArray = Array.isArray(player.categoriesCompleted) 
    ? player.categoriesCompleted 
    : [];

  const completed = new Set(completedArray);
  const missing = allCategories.filter(cat => !completed.has(cat));

  // Création de la popup
  const popup = document.createElement('div');
  popup.style.position = 'fixed';
  popup.style.inset = '50% auto auto 50%';
  popup.style.transform = 'translate(-50%, -50%)';
  popup.style.background = 'white';
  popup.style.padding = '30px';
  popup.style.borderRadius = '12px';
  popup.style.boxShadow = '0 8px 30px rgba(0,0,0,0.4)';
  popup.style.zIndex = '1000';
  popup.style.maxWidth = '420px';
  popup.style.textAlign = 'center';
  popup.style.fontFamily = 'Arial, sans-serif';
  popup.style.lineHeight = '1.5';

  popup.innerHTML = `
    <h3 style="margin: 0 0 24px; color: #1a237e;">${player.name}</h3>
    
    <div style="margin-bottom: 20px;">
      <p style="font-weight: bold; color: #2e7d32; margin: 0 0 8px;">
        Validées (${completed.size} / ${allCategories.length})
      </p>
      <ul style="list-style: none; padding: 0; margin: 0;">
        ${completed.size > 0 
          ? Array.from(completed).map(cat => `
              <li style="margin: 6px 0; color: #2e7d32;">✓ ${cat}</li>
            `).join('')
          : '<li style="color: #757575; font-style: italic;">Aucune catégorie validée pour l’instant</li>'}
      </ul>
    </div>

    <div style="margin-bottom: 30px;">
      <p style="font-weight: bold; color: #c62828; margin: 0 0 8px;">
        Restantes (${missing.length})
      </p>
      <ul style="list-style: none; padding: 0; margin: 0;">
        ${missing.length > 0 
          ? missing.map(cat => `
              <li style="margin: 6px 0; color: #424242;">• ${cat}</li>
            `).join('')
          : '<li style="color: #2e7d32; font-weight: bold;">Bravo ! Toutes les catégories sont validées 🎉</li>'}
      </ul>
    </div>

    <button id="closePopupBtn" style="
      padding: 12px 32px;
      font-size: 1.1em;
      background: #1976d2;
      color: white;
      border: none;
      border-radius: 8px;
      cursor: pointer;
      transition: background 0.2s;
    ">
      Fermer
    </button>
  `;

  document.body.appendChild(popup);

  // Gestion de la fermeture
  document.getElementById('closePopupBtn').onclick = () => popup.remove();
  popup.addEventListener('click', (e) => {
    if (e.target === popup) popup.remove();
  });
}

// Mise en évidence action tirée
function highlightAction(name) {
  document.querySelectorAll('.actionCard').forEach(c => {
    c.classList.toggle('activeAction', c.dataset.action === name);
  });
}

// Événements Socket
socket.on('created', code => { room = code; showGame(); });
socket.on('joined', code => { room = code; showGame(); });
socket.on('players', list => {
  console.log("Nouvelle liste players reçue :", list);
  players = list;                     // ← cette ligne est cruciale
  renderScoreTable(players);
  updatePawns(players);
});
socket.on('boardData', b => { board = b; updatePawns(players); createActionCards(); });
socket.on('yourTurn', data => {
  currentPlayerId = data?.playerId;

  console.log('[yourTurn reçu]', {
    currentPlayerId,
    monId: socket.id,
    estMonTour: socket.id === currentPlayerId,
    boutonExistant: !!elRoll
  });

  if (elRoll) {
    const isMyTurn = socket.id === currentPlayerId;


    // Applique l’état final
    elRoll.style.display = 'inline-block';
    elRoll.disabled = 'false';

    console.log('[yourTurn] Bouton mis à jour → display:', elRoll.style.display, 'disabled:', elRoll.disabled);
  } else {
    console.warn('[yourTurn] elRoll n’existe pas dans le DOM');
  }

  // Cache le bouton démarrer (si présent)
  if (elStart) {
    elStart.style.display = 'none';
  }

  renderScoreTable(players);
});
socket.on('rolled', data => {
  if (!data) return;
  if (elDiceResult) elDiceResult.textContent = data.roll;
  if (socket.id === currentPlayerId) showPossibleCases(data.currentPos, data.roll);
});
socket.on("actionDrawn", data => {
  if (!data || !data.action) return;
  document.querySelectorAll('.actionCard').forEach(c => c.classList.remove("activeAction"));
  const selected = [...document.querySelectorAll('.actionCard')]
    .find(c => c.dataset.action === data.action);
  if (selected) selected.classList.add("activeAction");
});
socket.on('currentQuestionInfo', payload => {
  const infoDiv = document.getElementById('currentQuestionInfo');
  if (!infoDiv) return;

  document.getElementById('currentPlayerName').textContent = payload.name || 'Inconnu';
  document.getElementById('currentTheme').textContent = payload.theme || 'Général';
  document.getElementById('currentQText').textContent = payload.question || '';

  const img = document.getElementById('currentQImg');
  if (payload.img) {
    img.src = payload.img;
    img.style.display = 'block';
  } else {
    img.style.display = 'none';
  }

  infoDiv.style.display = 'block';
});
socket.on('requestSelection', payload => {
  if (!payload) return;
  if (payload.initiatorId && payload.initiatorId !== socket.id) return;
  showSelection(payload);
});
socket.on('question', payload => showQuestion(payload));
socket.on('timeOut', d => {
  stopTimer();
  showResults(false, d && d.message ? d.message : 'Temps écoulé');
});
socket.on('results', data => {
  stopTimer();
  if (data && data.players) renderScoreTable(data.players);
  if (elRoll) {
    elRoll.style.display = 'none';
    elRoll.disabled = true;
  }
  const isCorrect = data.correct === true;

  // Crée la popup de résultat
  const popup = document.createElement('div');
  popup.style.cssText = `
    position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
    background: white; padding: 30px; border-radius: 12px;
    box-shadow: 0 8px 30px rgba(0,0,0,0.4); z-index: 1000;
    max-width: 500px; text-align: center;
  `;

  popup.innerHTML = `
    <h2 style="color: ${isCorrect ? '#2e7d32' : '#c62828'}; margin-bottom: 15px;">
      ${isCorrect ? 'Bonne réponse !' : 'Mauvaise réponse'}
    </h2>
    <p style="font-size: 1.2em; margin: 15px 0;">${data.message || ''}</p>
  `;

  // Si mauvaise réponse → montre correction + détail + timer
  if (data.correction) {
    const correctionDiv = document.createElement('div');
    correctionDiv.style.cssText = `
      background: #f5f5f5; padding: 15px; border-radius: 8px; text-align: left;
      margin: 20px 0; font-size: 1.1em;
    `;
    correctionDiv.innerHTML = `
      <strong>Bonne réponse :</strong> ${data.correction || 'Non disponible'}<br><br>
      ${data.detail ? `<strong>Détail :</strong> ${data.detail}` : ''}
    `;
    popup.appendChild(correctionDiv);

    // Timer 5 secondes + message
    const timerDiv = document.createElement('div');
    timerDiv.style.marginTop = '20px';
    timerDiv.style.fontSize = '1.1em';
    timerDiv.style.color = '#555';
    popup.appendChild(timerDiv);

    let remaining = 5;
    timerDiv.textContent = `Prochain tour dans ${remaining} secondes...`;

    const interval = setInterval(() => {
      remaining--;
      timerDiv.textContent = `Prochain tour dans ${remaining} secondes...`;
      if (remaining <= 0) {
        clearInterval(interval);
        popup.remove();
      }
    }, 1000);

    // Auto-fermeture après 5s
    setTimeout(() => {
      clearInterval(interval);
      popup.remove();
    }, 5000);
  } else {
    // Bonne réponse → disparaît après 2.5s (comme avant)
    setTimeout(() => popup.remove(), 2500);
  }

  document.body.appendChild(popup);
  document.getElementById('currentQuestionInfo').style.display = 'none';
});

socket.on('teleport', payload => {
  console.log('teleported to', payload.pos);
});
socket.on('actionClear', () => {
  elPossible.innerHTML = '';
  elChoice.style.display = 'none';
  if (elRoll) {
    elRoll.style.display = 'none';
    elRoll.disabled = true;
  }
  hideQuestion();
  highlightAction('');
  document.getElementById('currentQuestionInfo').style.display = 'none';
});

// Demande board/players après join
socket.on('joined', () => {
  socket.emit('requestBoard');
  socket.emit('requestPlayers');
});

socket.on('gameEnd', data => {
  console.log("gameEnd reçu :", data);

  // Masquage complet de tous les éléments du jeu actif
  // 1. Appelle hideQuestion si elle existe (pour la zone question/timer)
  if (typeof hideQuestion === 'function') {
    hideQuestion();
  }

  // 2. Masque les zones principales via leurs IDs (avec vérification)
  const idsToHide = [
    'diceZone',           // zone du dé
    'plateauContainer',   // plateau + pions
    'actionGrid',         // cartes actions
    'possibleCases',      // cases cliquables
    'choice',             // popup de sélection
    'questionBox',        // zone question (au cas où hideQuestion n'a pas tout caché)
    'resultBox',          // zone résultat
    'topBar',             // barre du haut (salle + scores)
    'scoreTable'          // tableau des scores (optionnel, à cacher si tu veux)
  ];

  idsToHide.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.style.display = 'none';
      console.log(`Masqué : #${id}`);
    }
  });

  // 3. Optionnel : masque aussi le header / menu si présent
  const header = document.querySelector('header');
  if (header) header.style.display = 'none';

  const menu = document.getElementById('menu');
  if (menu) menu.style.display = 'none';

  // 4. Vide ou masque complètement #game pour éviter les restes
  const game = document.getElementById('game');
  if (game) {
    game.innerHTML = '';           // vide tout ce qui reste dedans
    game.style.display = 'block';  // garde visible pour afficher l'écran de fin
  }

  const gameContainer = document.getElementById('game');
  if (!gameContainer) return console.error("#game introuvable");

  gameContainer.innerHTML = ''; // Vide le contenu

  // TRI PAR SCORE DESCENDANT (le plus important)
  const sortedPlayers = [...data.players].sort((a, b) => b.score - a.score);

  // Création de l'écran
  const endScreen = document.createElement('div');
  endScreen.id = 'endScreen';
  endScreen.style.cssText = `
    text-align: center;
    padding: 40px;
    background: #f8f9fa;
    border-radius: 12px;
    max-width: 600px;
    margin: 40px auto;
    box-shadow: 0 4px 20px rgba(0,0,0,0.15);
  `;

  endScreen.innerHTML = `
    <h2 style="color: #2e7d32; margin-bottom: 20px;">Partie terminée !</h2>
    <h3 style="margin: 20px 0;">Gagnant : ${sortedPlayers[0]?.name || 'Inconnu'}</h3>
    <h4 style="margin: 30px 0 15px;">Classement final</h4>
  `;

  const ranking = document.createElement('div');
  ranking.style.margin = '20px 0';

  sortedPlayers.forEach((p, i) => {
    const row = document.createElement('div');
    row.style.cssText = `
      padding: 12px;
      background: ${i === 0 ? '#fff9c4' : '#ffffff'};
      border: 1px solid #ddd;
      border-radius: 8px;
      margin: 8px 0;
      font-size: 1.1em;
    `;
    row.innerHTML = `${i+1}. <strong>${p.name}</strong> — ${p.score} points`;
    ranking.appendChild(row);
  });

  endScreen.appendChild(ranking);

  const backBtn = document.createElement('button');
  backBtn.textContent = 'Retour à l’accueil';
  backBtn.style.cssText = `
    padding: 14px 32px;
    font-size: 1.2em;
    margin-top: 30px;
    background: #1976d2;
    color: white;
    border: none;
    border-radius: 8px;
    cursor: pointer;
  `;
  backBtn.onclick = () => window.location.href = '/';
  endScreen.appendChild(backBtn);

  gameContainer.appendChild(endScreen);
  gameContainer.style.display = 'block';

  console.log("Écran de fin affiché avec classement trié !");
});

// Resize / load
window.addEventListener('resize', () => updatePawns(players));
elPlateau && elPlateau.addEventListener('load', () => updatePawns(players));

// Affichage jeu
function showGame() {
  if (elMenu) elMenu.style.display = 'none';
  if (elGame) elGame.style.display = 'block';
  if (elRoomDisplay) elRoomDisplay.textContent = room;
  socket.emit('requestBoard');
  socket.emit('requestPlayers');
  if (elRoll) {
    elRoll.style.display = 'none';
    elRoll.disabled = true;
  }

  // Affiche le bouton Retour quand on est en jeu
  const backBtn = document.getElementById('btnBack');
  if (backBtn) backBtn.style.display = 'inline-block';
   // Masquer le bouton "Mon Profil" une fois le jeu lancé
  const profileBtn = document.querySelector('header button[onclick*="profile.html"]');
  if (profileBtn) profileBtn.style.display = 'none';

  // Masquer la partie basse de la page (modes solo/revision)
  document.querySelectorAll('hr').forEach(hr => hr.style.display = 'none');
  
  document.querySelectorAll('h2').forEach(h2 => {
    // On masque uniquement les h2 qui concernent les modes de jeu
    if (h2.textContent.includes('Mode Solo') || h2.textContent.includes('Mode Révision')) {
      h2.style.display = 'none';
    }
  });

  document.querySelectorAll('p').forEach(p => {
    if (p.textContent.includes('vies') || p.textContent.includes('limite')) {
      p.style.display = 'none';
    }
  });

  document.querySelectorAll('button[onclick*="solo-"], button[onclick*="revision.html"]').forEach(btn => {
    btn.style.display = 'none';
  });
}






