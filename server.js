// server.js
const express = require('express');
const http = require('http');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');
const fse = require('fs-extra');           // ← ajouté pour writeJson avec { spaces: 4 }
const multer = require('multer');           // ← ajouté pour gérer l’upload d’images
const upload = multer({ dest: 'public/uploads/' });  // ← temp dir pour images
const { Server } = require('socket.io');
const fetch = require('node-fetch'); // si Node 22, fetch est global, sinon installer node-fetch
const MISTRAL_API_KEY = "UgqBwDkleUS5rgEDyCnWYoZOhEHH916x";

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// --- MIDDLEWARES ---
app.use(express.json());


// Route racine : sert index.html directement
// La vérification "connecté ou pas" se fait côté client dans index.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use(express.static(path.join(__dirname, 'public')));

// Sauvegarde complète de data.json depuis l'éditeur
app.post('/save-questions', (req, res) => {
  const newData = req.body;
  const filePath = path.join(__dirname, 'public', 'data.json');

  try {
    // Validation minimale
    if (typeof newData !== 'object' || newData === null || Array.isArray(newData)) {
      return res.status(400).json({ error: 'Données invalides : doit être un objet {catégorie: [questions]}' });
    }

    // Optionnel : on peut ajouter une validation plus stricte si besoin
    for (const [cat, questions] of Object.entries(newData)) {
      if (!Array.isArray(questions)) {
        return res.status(400).json({ error: `Catégorie "${cat}" doit être un tableau de questions.` });
      }
    }

    // Écriture du fichier (avec indentation pour lisibilité)
    fs.writeFileSync(filePath, JSON.stringify(newData, null, 2), 'utf-8');

    console.log('data.json mis à jour via éditeur');

    res.json({ success: true });
  } catch (err) {
    console.error('Erreur lors de la sauvegarde de data.json:', err);
    res.status(500).json({ error: 'Erreur serveur lors de la sauvegarde' });
  }
});

// Endpoint upload + sauvegarde question
app.post('/save-question', upload.fields([{ name: 'img' }, { name: 'imgrep' }]), async (req, res) => {
  const { category, q, a, d, isEdit, index } = req.body;
  const filePath = path.join(__dirname, 'public', 'data.json');

  let jsonData;
  try {
    jsonData = await fs.readJson(filePath);
  } catch {
    return res.status(500).json({ error: 'Erreur lecture data.json' });
  }

  if (!jsonData[category]) jsonData[category] = [];

  let questionId;
  if (isEdit === 'true' && index !== undefined) {
    questionId = jsonData[category][parseInt(index)].id;
  } else {
    questionId = jsonData[category].length 
      ? Math.max(...jsonData[category].map(q => q.id || 0)) + 1 
      : 1;
  }

  const newQ = { id: questionId, q: q || '', a: a || '', d: d || undefined };

  // Image question
  if (req.files['img'] && req.files['img'].length) {
    const file = req.files['img'][0];
    const ext = path.extname(file.originalname) || '.png';
    const name = `Question${questionId}${ext}`;
    const dest = path.join(__dirname, 'public', 'image', name);
    await fs.move(file.path, dest, { overwrite: true });
    newQ.img = `./image/${name}`;
  }

  // Image réponse
  if (req.files['imgrep'] && req.files['imgrep'].length) {
    const file = req.files['imgrep'][0];
    const ext = path.extname(file.originalname) || '.png';
    const name = `Correction${questionId}${ext}`;
    const dest = path.join(__dirname, 'public', 'imgrep', name);
    await fs.move(file.path, dest, { overwrite: true });
    newQ.imgrep = `./imgrep/${name}`;
  }

  if (isEdit === 'true' && index !== undefined) {
    jsonData[category][parseInt(index)] = { ...jsonData[category][parseInt(index)], ...newQ };
  } else {
    jsonData[category].push(newQ);
  }

  try {
    await fs.writeJson(filePath, jsonData, { spaces: 4 });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Erreur sauvegarde' });
  }
});

const USERS_FILE = path.join(__dirname, 'public', 'data', 'users.json');
function loadUsers() {
  if (!fs.existsSync(USERS_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(USERS_FILE, 'utf-8'));
  } catch (e) {
    console.error('Erreur lecture users.json:', e.message);
    return {};
  }
}

function saveUsers(users) {
  try {
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf-8');
  } catch (e) {
    console.error('Erreur écriture users.json:', e.message);
  }
}


// --- ROUTES LOGIN / USERS ---
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  const users = loadUsers();

  const user = users[username]; // clé = username

  if (!user) {
    return res.status(401).json({ error: 'Utilisateur inconnu' });
  }

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) {
    return res.status(401).json({ error: 'Mot de passe incorrect' });
  }

  res.json({
    success: true,
    username: user.username,
    role: user.role,
    dailyHighScore: user.dailyHighScore || 0
  });
});

app.post('/api/create-user', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Nom d\'utilisateur et mot de passe requis' });
  }

  const users = loadUsers();

  // Vérifie si l'utilisateur existe déjà (clé = username recommandé)
  if (users[username]) {
    return res.status(400).json({ error: 'Utilisateur déjà existant' });
  }

  try {
    const passwordHash = await bcrypt.hash(password, 10);

    users[username] = {
      username: username,
      role: 'élève',
      passwordHash: passwordHash
    };

    saveUsers(users);
    console.log(`[PROF] Élève créé : ${username}`);
    res.json({ success: true });
  } catch (err) {
    console.error('[PROF] Erreur création élève :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Suppression d'un élève (seulement accessible au prof)
app.delete('/api/students/:username', (req, res) => {
  // Sécurité : vérifier que c'est un prof (tu peux ajouter une vérif de session ou token si tu veux)
  const currentUser = JSON.parse(req.headers['x-current-user'] || '{}'); // exemple simple via header
  if (!currentUser || currentUser.role !== 'prof') {
    return res.status(403).json({ error: 'Accès interdit' });
  }

  const usernameToDelete = req.params.username;
  const users = loadUsers();

  if (!users[usernameToDelete]) {
    return res.status(404).json({ error: 'Élève non trouvé' });
  }

  if (usernameToDelete === currentUser.username) {
    return res.status(403).json({ error: 'Impossible de supprimer son propre compte' });
  }

  delete users[usernameToDelete];
  saveUsers(users);

  console.log(`[PROF] Élève supprimé : ${usernameToDelete}`);
  res.json({ success: true, message: `Élève ${usernameToDelete} supprimé` });
});

app.post('/api/change-password', async (req, res) => {
  const { username, oldPassword, newPassword } = req.body;
  const users = loadUsers();

  const user = users[username];
  if (!user) {
    return res.status(400).json({ error: 'Utilisateur inconnu' });
  }

  const ok = await bcrypt.compare(oldPassword, user.passwordHash);
  if (!ok) {
    return res.status(401).json({ error: 'Ancien mot de passe incorrect' });
  }

  user.passwordHash = await bcrypt.hash(newPassword, 10);
  saveUsers(users);
  res.json({ success: true });
});

async function checkWithMistral(userAnswer, expectedAnswer) {
  try {
    const res = await fetch('https://api.mistral.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${MISTRAL_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'mistral-small-latest',
        messages: [{
          role: 'user',
          content: `
Compare deux réponses de mathématiques.

Réponse attendue :
${expectedAnswer}

Réponse utilisateur :
${userAnswer}

Règles :
- Réponds UNIQUEMENT par "true" ou "false"
- true si les réponses sont équivalentes mathématiquement ou sémantiquement
- false si la réponse est fausse, incomplète ou hors sujet
- false si l'utilisateur répond par des phrases vagues comme :
  "c'est la même réponse", "idem", "voir question", etc.
- false si l'utilisateur reformule la question au lieu de répondre

Aucune explication. Un seul mot : true ou false.
`
        }],
        temperature: 0,
        max_tokens: 5
      })
    });

    const data = await res.json();
    const answer = data.choices?.[0]?.message?.content?.trim().toLowerCase();
    return answer === 'true';
  } catch (e) {
    console.error('Erreur Mistral:', e.message);
    return false;
  }
}

app.post('/api/solo/check', async (req, res) => {
  try {
    const { answer, expected } = req.body;

    if (
      typeof answer !== 'string' ||
      typeof expected !== 'string'
    ) {
      return res.status(400).json({ correct: false });
    }

    const correct = await checkWithMistral(answer, expected);

    res.json({ correct });
  } catch (e) {
    console.error('[SOLO] Erreur vérification:', e.message);
    res.status(500).json({ correct: false });
  }
});

// --- LOAD BOARD ---
let BOARD = null;
try {
  BOARD = JSON.parse(fs.readFileSync(path.join(__dirname, 'public', 'data', 'board.json')));
  console.log('Board loaded, cases:', BOARD.totalCases);
} catch (e) {
  console.error('Error loading board.json:', e.message);
  process.exit(1);
}

let QUESTIONS_BY_CATEGORY = {};
let ALL_QUESTIONS = [];

try {
  const raw = JSON.parse(fs.readFileSync(path.join(__dirname, 'public', 'data.json'), 'utf-8'));
  if (!raw || typeof raw !== 'object') throw new Error('data.json n’est pas un objet');

  QUESTIONS_BY_CATEGORY = Object.keys(raw).reduce((acc, cat) => {
    acc[cat] = raw[cat]
      .filter(q => q && q.q && q.a)
      .map(q => ({
        id: q.id ?? null,
        q: q.q,
        a: q.a,
        d: q.d ?? null,
        img: q.img ?? null,
        imgrep: q.imgrep ?? null,
        category: cat
      }));
    return acc;
  }, {});

  ALL_QUESTIONS = Object.values(QUESTIONS_BY_CATEGORY).flat();

  console.log(`Questions chargées : ${ALL_QUESTIONS.length} au total`);
  console.log(`Catégories disponibles : ${Object.keys(QUESTIONS_BY_CATEGORY).join(', ')}`);
} catch (e) {
  console.error('Erreur data.json → questions désactivées :', e.message);
  QUESTIONS_BY_CATEGORY = {};
  ALL_QUESTIONS = [];
}

const REQUIRED_CATEGORIES = new Set(Object.keys(QUESTIONS_BY_CATEGORY));

const ACTIONS = [
  { name: "Flash", timer: 30 },
  { name: "Battle on left" },
  { name: "Battle on right" },
  { name: "Call a friend", needPlayer: true },
  { name: "For you", needPlayer: true },
  { name: "Second life" },
  { name: "No way" },
  { name: "Double" },
  { name: "Téléportation" },
  { name: "+1 ou -1" },
  { name: "Everybody" },
  { name: "It's your choice", needActionChoice: true },
  { name: "Quadruple" }
];

const rooms = {}; // code -> room

function genCode() {
  let c;
  do { c = Math.random().toString(36).substr(2,4).toUpperCase(); } while (rooms[c]);
  return c;
}

function pickQuestion(category = null) {
  let pool;

  if (!category || category === "") {
    pool = ALL_QUESTIONS;
  } else {
    pool = QUESTIONS_BY_CATEGORY[category] || [];
    if (pool.length === 0) {
      console.warn(`Aucune question pour "${category}" → fallback toutes catégories`);
      pool = ALL_QUESTIONS;
    }
  }

  if (!pool.length) {
    console.error('Aucune question disponible');
    return null;
  }

  const q = pool[Math.floor(Math.random() * pool.length)];

  return {
    question: q.q || '',
    correction: (q.a || '').toString(),
    detail: q.d || null,
    img: q.img || null,
    imgrep: q.imgrep || null,
    category: q.category || 'Inconnue'
  };
}


function findRoomBySocket(id) {
  return Object.values(rooms).find(r => r.players.some(p => p.id === id));
}

io.on('connection', socket => {
  console.log('conn', socket.id);

  socket.on('create', name => {
    const code = genCode();
    const room = {
      code,
      host: socket.id,
      players: [{ id: socket.id, name: name || 'Hôte', pos: 0, score: 0, categoriesCompleted: new Set() }],
      board: BOARD,
      currentIndex: 0,
      state: 'waiting',
      currentAction: null,
      currentQuestion: null,
      currentCorrection: null,
      activePlayers: [],
      pendingAnswers: new Map(),
      timer: null,
      secondLifeRetry: false,
      waitingForSelection: null,
      actionMeta: null
    };
    rooms[code] = room;
    socket.join(code);
    socket.emit('created', code);
    io.to(code).emit('players', serializePlayers(room.players));
    socket.emit('boardData', room.board);
    console.log('created', code);
  });

  socket.on('join', ({ code, name }) => {
    code = (code || '').toString().toUpperCase();
    const room = rooms[code];
    if (!room) return socket.emit('error', 'Salle inexistante');
    if (room.players.length >= 6) return socket.emit('error', 'Salle pleine');
    if (room.state !== 'waiting') return socket.emit('error', 'Partie déjà commencée');
    room.players.push({ id: socket.id, name: name || 'Hôte', pos: 0, score: 0, categoriesCompleted: new Set() });
    socket.join(code);
    socket.emit('joined', code);
    io.to(code).emit('players', serializePlayers(room.players));
    socket.emit('boardData', room.board);
  });

  socket.on('requestPlayers', () => {
    const room = findRoomBySocket(socket.id);
    if (room) socket.emit('players', room.players);
  });
  socket.on('requestBoard', () => {
    const room = findRoomBySocket(socket.id);
    if (room) socket.emit('boardData', room.board);
  });

  socket.on('start', code => {
    const room = rooms[code];
    if (!room) return;
    if (room.host !== socket.id) return socket.emit('error', 'Tu n’es pas l’hôte');
    room.state = 'playing';
    // Liste des catégories requises (on envoie uniquement les noms)
    const categoryNames = Array.from(REQUIRED_CATEGORIES);
    io.to(code).emit('categoriesList', categoryNames);
    room.currentIndex = 0;
    io.to(code).emit('gameStart');
    io.to(code).emit('players', serializePlayers(room.players));
    const current = room.players[room.currentIndex];
    io.to(code).emit('yourTurn', { playerId: current.id });
    io.to(current.id).emit('yourTurn', { playerId: current.id });
  });

  socket.on('roll', code => {
    const room = rooms[code];
    if (!room) return;
    const current = room.players[room.currentIndex];
    if (!current || current.id !== socket.id) return;
    const roll = Math.floor(Math.random() * 6) + 1;
    io.to(code).emit('rolled', { roll, currentPos: current.pos });
  });

  socket.on('moveTo', ({ code, pos }) => {
    const room = rooms[code];
    if (!room) return;

    const current = room.players[room.currentIndex];
    if (!current || current.id !== socket.id) return;

    // Position EXACTE envoyée par le client
    current.pos = Math.max(0, Math.min(pos, room.board.positions.length - 1)); // pos est déjà 0-based
    console.log('[moveTo] Position reçue (0-based) :', pos, '→ case ID:', current.pos);

    io.to(code).emit('players', serializePlayers(room.players));

    // Tirage d'une action aléatoire
    const action = ACTIONS[Math.floor(Math.random() * ACTIONS.length)];
    room.currentAction = action;
    room.pendingAnswers = new Map();
    room.secondLifeRetry = false;
    room.actionMeta = null;

    console.log('[moveTo] Action tirée :', action.name);

    io.to(code).emit('actionDrawn', { action: action.name, timer: action.timer || null });

    // Demande sélection si nécessaire
    if (action.needPlayer) {
      room.waitingForSelection = { type: 'player', initiator: current.id, action: action.name };
      io.to(current.id).emit('requestSelection', {
        type: 'player',
        message: 'Choisis un joueur',
        initiatorId: current.id
      });
      return;
    }

    if (action.needActionChoice) {
      room.waitingForSelection = { type: 'action', initiator: current.id, action: action.name };
      const choices = ["Second life", "Double", "Quadruple", "No way", "+1 ou -1", "Flash"];
      io.to(current.id).emit('requestSelection', {
        type: 'action',
        message: 'Choisis ton action',
        initiatorId: current.id,
        actions: choices
      });
      return;
    }

    // Passe directement à la question si pas de sélection requise
    proceedToQuestion(room, current, action);
  });

  socket.on('selectPlayer', ({ code, targetId }) => {
    const room = rooms[code];
    if (!room || !room.waitingForSelection) return;
    const sel = room.waitingForSelection;
    const initiator = room.players[room.currentIndex];
    if (!initiator || initiator.id !== socket.id) return;
    room.waitingForSelection = null;
    room.actionMeta = { selectedPlayer: targetId };

    const actionObj = room.currentAction;
    proceedToQuestion(room, initiator, actionObj, { selectedPlayer: targetId });
  });

  socket.on('chooseAction', ({ code, chosenAction }) => {
    const room = rooms[code];
    if (!room || !room.waitingForSelection) return;
    const initiator = room.players[room.currentIndex];
    if (!initiator || initiator.id !== socket.id) return;
    room.waitingForSelection = null;
    // find matching action object if exists
    const found = ACTIONS.find(a => a.name.toLowerCase() === (chosenAction || '').toLowerCase());
    room.currentAction = found || { name: chosenAction };
    proceedToQuestion(room, initiator, room.currentAction);
  });

  socket.on('answer', async ({ code, answer }) => {
    const room = rooms[code];
    if (!room) return;
    const player = room.players.find(p => p.id === socket.id);
    if (!player) return;
    if (!room.activePlayers || !room.activePlayers.includes(socket.id)) return;
    if (!room.currentQuestion) return;

    const given = (answer || '').toString().trim().toLowerCase();
    const correct = await checkWithMistral(
      answer,
      room.currentCorrection
    );

    room.pendingAnswers.set(socket.id, { correct, playerId: socket.id });

    const actionName = room.currentAction && room.currentAction.name;

    // helper to conclude
    function conclude(correctFlag) {
      clearRoomTimer(room);

      io.to(room.code).emit('results', {
        correct: correctFlag,
        players: room.players,
        message: correctFlag ? 'Bonne réponse' : 'Mauvaise réponse',
        correction: room.currentCorrection || null
      });

      endTurn(room);
    }


    // logic per action
    switch (actionName) {
      case 'Flash':
      case 'Téléportation':
      case 'Double':
      case '+1 ou -1':
      case 'Quadruple':
      case 'No way':
      case 'Second life':
        // single player actions: resolve immediately with resolveSinglePlayerAction
        resolveSinglePlayerAction(room, player, correct, actionName);
        break;

      case 'Everybody':
        if (correct) {
          // give point to the player who answered correctly
          player.score = (player.score || 0) + 1;
          if (checkVictory(room, player, room.currentQuestionCategory)) return;
          io.to(room.code).emit('players', serializePlayers(room.players));
          conclude(true);
        } else {
          // if all active players have answered and none correct, finish false
          if (room.pendingAnswers.size >= room.activePlayers.length) conclude(false);
        }
        break;

      case 'Battle on left':
      case 'Battle on right':
        if (correct) {
          player.score = (player.score || 0) + 1;
          if (checkVictory(room, player, room.currentQuestionCategory)) return;
          io.to(room.code).emit('players', serializePlayers(room.players));
          conclude(true, 'Victoire au battle');
        } else {
          if (room.pendingAnswers.size >= room.activePlayers.length) conclude(false);
        }
        break;

      case 'Call a friend':
        if (correct) {
          // both initiator and friend get +1
          const initiator = room.players[room.currentIndex];
          const friendId = room.actionMeta && room.actionMeta.selectedPlayer;
          const friend = room.players.find(p => p.id === friendId);
          if (initiator) initiator.score = (initiator.score || 0) + 1;
          if (friend) friend.score = (friend.score || 0) + 1;
          if (checkVictory(room, initiator, room.currentQuestionCategory)) return;
          io.to(room.code).emit('players', serializePlayers(room.players));
          conclude(true);
        } else {
          if (room.pendingAnswers.size >= room.activePlayers.length) conclude(false);
        }
        break;

      case 'For you':
        if (correct) {
          const initiator = room.players[room.currentIndex];
          player.score = (player.score || 0) + 1;
          if (initiator) initiator.score = (initiator.score || 0) + 1;
          if (checkVictory(room, initiator, room.currentQuestionCategory)) return;
          io.to(room.code).emit('players', serializePlayers(room.players));
          conclude(true);
        } else {
          conclude(false);
        }
        break;

      default:
        // fallback
        if (correct) {
          player.score = (player.score || 0) + 1;
          if (checkVictory(room, player, room.currentQuestionCategory)) return;
          io.to(room.code).emit('players', serializePlayers(room.players));
          conclude(true);
        } else {
          conclude(false);
        }
    }
  });

  socket.on('timeout', ({ code }) => {
    const room = rooms[code];
    if (!room) return;

    console.log(`[TIMEOUT] Timer expiré dans room ${code}, action: ${room.currentAction?.name || 'aucune'}`);

    const actionName = room.currentAction?.name || '';

    // Cas spéciaux
    if (actionName === 'Second life') {
      if (!room.secondLifeRetry) {
        room.secondLifeRetry = true;
        room.pendingAnswers = new Map();
        const current = room.players[room.currentIndex];
        io.to(current.id).emit('question', {
          theme: 'Général',
          question: room.currentQuestion,
          timer: 60,
          recipients: [current.id]
        });
        clearRoomTimer(room);
        room.timer = setTimeout(() => {
          finalizeFalse(room);
          endTurn(room); // ← force endTurn même en retry
        }, 60000);
        return;
      }
      // Si déjà retry → on tombe dans le cas général
    }

    // Cas général : timeout = faux → finalise et termine le tour
    finalizeFalse(room);
    endTurn(room); // ← force toujours la fin du tour ici
  });

  socket.on('disconnect', () => {
    Object.values(rooms).forEach(room => {
      const idx = room.players.findIndex(p => p.id === socket.id);
      if (idx !== -1) {
        const disconnectedPlayer = room.players[idx];
        room.players.splice(idx, 1);

        io.to(room.code).emit('players', serializePlayers(room.players));

        // Si c'était l'hôte, passe à un autre
        if (room.host === socket.id && room.players.length > 0) {
          room.host = room.players[0].id;
        }

        // Si c'était le joueur en cours ET qu'il reste au moins un joueur
        if (room.currentIndex === idx && room.players.length > 0) {
          // Ajuste l'index pour éviter out-of-bounds
          room.currentIndex = room.currentIndex % room.players.length;
          if (room.currentIndex < 0) room.currentIndex = 0; // sécurité

          const next = room.players[room.currentIndex];
          if (next) {  // ← vérification cruciale
            console.log(`[DISCONNECT] Tour passé au joueur ${next.name} après déconnexion de ${disconnectedPlayer.name}`);
            io.to(room.code).emit('yourTurn', { playerId: next.id });
            io.to(next.id).emit('yourTurn', { playerId: next.id });
          }
        } else if (room.currentIndex > idx && room.players.length > 0) {
          room.currentIndex--;
        }

        // Force fin du tour si on était en train de jouer
        if (room.state === 'playing') {
          endTurn(room);
        }

        // Nettoyage final
        if (room.players.length === 0) {
          delete rooms[room.code];
          console.log(`[ROOM] Room ${room.code} supprimée (vide)`);
        } else if (room.state === 'finished') {
          delete rooms[room.code];
        }
      }
    });
    console.log('disconnect', socket.id);
  });

  // Helpers
  function proceedToQuestion(room, initiator, action, meta = {}) {
  room.actionMeta = meta;
  room.currentAction = action;

  // --- TELEPORTATION : effet immédiat ---
  if (action && action.name === 'Téléportation') {
    const randPos = Math.floor(Math.random() * room.board.positions.length);
    initiator.pos = randPos;

    io.to(room.code).emit('players', serializePlayers(room.players));
    io.to(room.code).emit('teleport', {
      playerId: initiator.id,
      pos: randPos
    });
    // on continue volontairement vers la question
  }
  // Récupérer la position actuelle (après téléportation éventuelle)
  const currentPos = initiator.pos;
  const currentCase = room.board.positions[currentPos];

  // Catégorie de la case actuelle (vide pour case 72)
  const category = currentCase?.category || "";

  // Tirer la question selon la catégorie
  const q = pickQuestion(category);
  if (!q) {
    io.to(room.code).emit('error', 'Aucune question disponible');
    endTurn(room);
    return;
  }

  room.currentQuestion = q.question;
  room.currentQuestionCategory = q.category;
  room.currentQuestionDetail = q.d || null;  // ← pour afficher le détail en cas d’erreur
  room.currentCorrection = (q.correction || '')
    .toString()
    .trim()
    .toLowerCase();

  // --- recipients & timer ---
  let recipients = [];
  let timerSec = action?.timer || 60;

  switch (action?.name) {
    case 'Flash':
      recipients = [initiator.id];
      timerSec = 30;
      break;

    case 'Battle on left': {
      const leftIdx = (room.currentIndex - 1 + room.players.length) % room.players.length;
      recipients = [initiator.id, room.players[leftIdx].id];
      break;
    }

    case 'Battle on right': {
      const rightIdx = (room.currentIndex + 1) % room.players.length;
      recipients = [initiator.id, room.players[rightIdx].id];
      break;
    }

    case 'Call a friend': {
      const selected = meta.selectedPlayer;
      recipients = [initiator.id, selected];
      break;
    }

    case 'For you':
      recipients = [meta.selectedPlayer || initiator.id];
      break;

    case 'Everybody':
      recipients = room.players.map(p => p.id);
      break;

    default:
      recipients = [initiator.id];
  }

  room.activePlayers = recipients.slice();
  room.pendingAnswers = new Map();

  const currentPlayerInfo = {
    id: initiator.id,
    name: initiator.name,
    pos: initiator.pos,
    question: room.currentQuestion,  // la question visible pour tous
    theme: q.category || 'Général',
    img: q.img || null,
    timer: timerSec
  };

  io.to(room.code).emit('currentQuestionInfo', currentPlayerInfo);

  recipients.forEach(id => {
  io.to(id).emit('question', {
    theme: q.category || 'Général',
    question: room.currentQuestion,
    timer: timerSec,
    recipients,
    img: q.img || null,        // <-- ajouté pour que le client voie l'image
    detail: q.detail || null   // <-- optionnel, pour texte explicatif
  });
});

console.log(`[Question envoyée] à ${recipients.length} joueurs :`, {
  question: room.currentQuestion,
  img: q.img,
  recipients
});


  // --- timer serveur ---
  clearRoomTimer(room);
  room.timer = setTimeout(() => {
    if (action?.name === 'Second life' && !room.secondLifeRetry) {
      room.secondLifeRetry = true;
      room.pendingAnswers.clear();

      io.to(initiator.id).emit('question', {
        theme: 'Général',
        question: room.currentQuestion,
        timer: timerSec
      });

      clearRoomTimer(room);
      room.timer = setTimeout(() => finalizeFalse(room), timerSec * 1000);
      return;
    }

    finalizeFalse(room);
  }, timerSec * 1000);
}


  function resolveSinglePlayerAction(room, player, correct, actionName) {
    const code = room.code;

    // Cas spécial : Second life
    if (actionName === 'Second life') {
      if (correct) {
        player.score = (player.score || 0) + 1;
        if (checkVictory(room, player, room.currentQuestionCategory)) return;
        io.to(code).emit('players', serializePlayers(room.players));
        clearRoomTimer(room);
        io.to(code).emit('results', {
          correct: true,
          players: room.players,
          message: 'Bonne réponse !',
          correction: room.currentCorrection || '',
          detail: room.currentQuestionDetail || null
        });
        endTurn(room);
      } else {
        if (!room.secondLifeRetry) {
          room.secondLifeRetry = true;
          room.pendingAnswers = new Map();
          clearRoomTimer(room);
          io.to(player.id).emit('question', {
            theme: 'Général',
            question: room.currentQuestion,
            timer: 60,
            recipients: [player.id]
          });
          room.timer = setTimeout(() => {
            finalizeFalse(room);
            endTurn(room);
          }, 60000);
        } else {
          clearRoomTimer(room);
          io.to(code).emit('results', {
            correct: false,
            players: room.players,
            message: 'Mauvaise réponse / Temps écoulé',
            correction: room.currentCorrection || '',
            detail: room.currentQuestionDetail || null
          });
          endTurn(room);
        }
      }
      return;
    }

    // Calcul du changement de score selon l’action
    let scoreChange = 0;

    switch (actionName) {
      case 'Double':
        scoreChange = correct ? 2 : 0;
        break;
      case '+1 ou -1':
        scoreChange = correct ? 2 : -1;
        break;
      case 'Quadruple':
        scoreChange = correct ? 4 : 0;
        break;
      case 'No way':
        if (correct) scoreChange = 1;
        else room.players.forEach(p => { if (p.id !== player.id) p.score = (p.score || 0) + 1; });
        break;
      case 'Téléportation':
      case 'Flash':
        scoreChange = correct ? 1 : 0;
        break;
      default:
        scoreChange = correct ? 1 : 0;
    }

    // Applique le changement
    player.score = (player.score || 0) + scoreChange;

    // Vérifie victoire
    if (correct && checkVictory(room, player, room.currentQuestionCategory)) {
      return;
    }

    // Mise à jour et résultats
    io.to(code).emit('players', serializePlayers(room.players));
    clearRoomTimer(room);

    io.to(code).emit('results', {
      correct,
      players: room.players,
      message: correct ? 'Bonne réponse !' : 'Mauvaise réponse',
      correction: room.currentCorrection || '',
      detail: room.currentQuestionDetail || null
    });

    endTurn(room);
  }

  function ensureAuth(role = null) {
    return (req, res, next) => {
      if (!req.session.user) {
        return res.redirect('/login.html');
      }
      if (role && req.session.user.role !== role) {
        return res.status(403).send('Accès interdit');
      }
      next();
    };
  }

  function finalizeFalse(room) {
    clearRoomTimer(room);

    io.to(room.code).emit('results', {
      correct: false,
      players: room.players,
      message: 'Mauvaise réponse',
      correction: room.currentCorrection || '',
      detail: room.currentQuestionDetail || null
    });

    endTurn(room);
  }


  function clearRoomTimer(room) {
    if (!room) return;
    if (room.timer) { clearTimeout(room.timer); room.timer = null; }
  }

  // Helper pour sérialiser les players (convertit Set en Array pour Socket.IO)
  function serializePlayers(players) {
    return players.map(p => ({
      ...p,
      categoriesCompleted: Array.from(p.categoriesCompleted || [])  // transforme Set → tableau
    }));
  }

  function endTurn(room) {
    clearRoomTimer(room);
    room.currentAction = null;
    room.currentQuestion = null;
    room.currentCorrection = null;
    room.activePlayers = [];
    room.pendingAnswers = new Map();
    room.actionMeta = null;
    room.secondLifeRetry = false;
    room.waitingForSelection = null;
  
    if (room.players && room.players.length > 0) {
      room.currentIndex = (room.currentIndex + 1) % room.players.length;
      const next = room.players[room.currentIndex];
    
      // 1. Mise à jour globale de la liste des joueurs
      io.to(room.code).emit('players', serializePlayers(room.players));
    
      // 2. Envoi yourTurn à TOUTE la room (important !)
      io.to(room.code).emit('yourTurn', { playerId: next.id });
    
      // 3. Envoi spécifique au joueur suivant (redondance)
      io.to(next.id).emit('yourTurn', { playerId: next.id });
    
      // Nettoyage interface pour tout le monde
      io.to(room.code).emit('actionClear');
    }
  }

  function checkVictory(room, player, category) {
    console.log(`[checkVictory] Joueur ${player.name}, catégorie reçue: ${category}`);
    console.log(`Set avant: ${Array.from(player.categoriesCompleted)}`);

    if (category && REQUIRED_CATEGORIES.has(category)) {
      player.categoriesCompleted.add(category);
      console.log(`Ajouté ! Set après: ${Array.from(player.categoriesCompleted)}`);
    }

    if (player.categoriesCompleted.size === REQUIRED_CATEGORIES.size) {
      console.log(`VICTOIRE pour ${player.name} !`);
      room.state = 'finished';
      const sortedPlayers = [...room.players].sort((a, b) => b.score - a.score);
      io.to(room.code).emit('gameEnd', { winner: player.id, players: serializePlayers(room.players) });
      return true;
    }
    return false;
  }
}); // end connection

const PORT = 3000;
server.listen(PORT, '0.0.0.0', () => console.log('Serveur lancé sur le port', PORT));

// Route pour servir data.json (déjà implicite via static, mais au cas où)
app.get('/data.json', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/data.json'));
});

// Nouvel endpoint pour sauvegarder data.json
app.post('/save-data', async (req, res) => {
  const newData = req.body;
  const filePath = path.join(__dirname, 'public/data.json');
  try {
    // Validation basique : doit être un objet avec des arrays pour les cats
    if (typeof newData !== 'object' || newData === null || Array.isArray(newData)) {
      return res.status(400).json({ error: 'Données invalides : doit être un objet avec catégories.' });
    }
    // Écrit le JSON pretty-print
    await fs.writeJson(filePath, newData, { spaces: 4 });
    res.json({ success: true });
    // Optionnel : Broadcast via Socket.io pour notifier les clients connectés
    io.emit('dataUpdated');
  } catch (err) {
    console.error('Erreur save data.json:', err);
    res.status(500).json({ error: 'Erreur serveur lors de la sauvegarde.' });
  }
});

// Socket.io logic (basé sur tes fichiers comme script.js et data.js)
// Ajoute ton code existant ici, par ex :
io.on('connection', (socket) => {
  console.log('Un user connecté');
  
  // Exemples d'events de ton script.js
  socket.on('create', (name) => { /* ton code pour créer room */ });
  socket.on('join', (data) => { /* ton code */ });
  // ... Ajoute tous tes socket.on existants
  
  // Nouveau : Pour request board/players, etc.
  socket.on('requestBoard', () => { /* envoie board */ });
  socket.on('requestPlayers', () => { /* envoie players */ });
  
  socket.on('disconnect', () => { console.log('User déconnecté'); });
});

// Nouvel endpoint pour sauvegarder data.json (évite conflit avec /save-data existant)
app.post('/save-questions', async (req, res) => {
  const newData = req.body;
  const filePath = path.join(__dirname, 'public/data.json');
  try {
    // Validation basique : doit être un objet avec des arrays pour les catégories
    if (typeof newData !== 'object' || newData === null || Array.isArray(newData)) {
      return res.status(400).json({ error: 'Données invalides : doit être un objet avec catégories.' });
    }
    // Validation supplémentaire : check que chaque catégorie est un array d'objets avec id, q, a
    for (const [cat, questions] of Object.entries(newData)) {
      if (!Array.isArray(questions)) {
        return res.status(400).json({ error: `Catégorie "${cat}" invalide : doit être un array de questions.` });
      }
      questions.forEach(q => {
        if (!q.id || !q.q || !q.a) {
          return res.status(400).json({ error: 'Chaque question doit avoir id, q et a.' });
        }
      });
    }
    // Écrit le JSON pretty-print (spaces: 4 comme dans ton exemple)
    await fse.writeJson(filePath, newData, { spaces: 4 });
    res.json({ success: true });
    // Broadcast via Socket.io pour notifier les clients connectés (ex: refresh revision)
    io.emit('dataUpdated');
  } catch (err) {
    console.error('Erreur save data.json:', err);
    res.status(500).json({ error: 'Erreur serveur lors de la sauvegarde.' });
  }
});

// Nouvelle route pour upload + save question
app.post('/upload-and-save-question', upload.fields([{ name: 'img' }, { name: 'imgrep' }]), async (req, res) => {
  const { category, q, a, d, isEdit, index } = req.body;
  const filePath = path.join(__dirname, 'public', 'data.json');

  let jsonData;
  try {
    jsonData = await fse.readJson(filePath);
  } catch (err) {
    return res.status(500).json({ error: 'Erreur lecture data.json' });
  }

  if (!jsonData[category]) jsonData[category] = [];

  let questionId;
  let qIndex = parseInt(index);
  if (isEdit === 'true' && !isNaN(qIndex)) {
    questionId = jsonData[category][qIndex].id;
  } else {
    // Nouveau ID : max global +1
    let maxId = 0;
    Object.values(jsonData).flat().forEach(q => { if (q.id > maxId) maxId = q.id; });
    questionId = maxId + 1;
  }

  const newQ = { id: questionId, q, a };
  if (d && d.trim()) newQ.d = d;

  // Gérer img
  if (req.files['img'] && req.files['img'][0]) {
    const file = req.files['img'][0];
    const ext = path.extname(file.originalname) || '.png';
    const name = `Question${questionId}${ext}`;
    const dest = path.join(__dirname, 'public/image', name);
    await fse.move(file.path, dest, { overwrite: true });
    newQ.img = `./image/${name}`;
  } else if (isEdit === 'true' && jsonData[category][qIndex].img) {
    newQ.img = jsonData[category][qIndex].img; // Garder existant si pas remplacé
  }

  // Gérer imgrep
  if (req.files['imgrep'] && req.files['imgrep'][0]) {
    const file = req.files['imgrep'][0];
    const ext = path.extname(file.originalname) || '.png';
    const name = `Correction${questionId}${ext}`;
    const dest = path.join(__dirname, 'public/imgrep', name);
    await fse.move(file.path, dest, { overwrite: true });
    newQ.imgrep = `./imgrep/${name}`;
  } else if (isEdit === 'true' && jsonData[category][qIndex].imgrep) {
    newQ.imgrep = jsonData[category][qIndex].imgrep; // Garder existant
  }

  if (isEdit === 'true' && !isNaN(qIndex)) {
    jsonData[category][qIndex] = newQ;
  } else {
    jsonData[category].push(newQ);
  }

  try {
    await fse.writeJson(filePath, jsonData, { spaces: 4 });
    io.emit('dataUpdated'); // Pour refresh live
    res.json({ success: true });
  } catch (err) {
    console.error('Erreur save data.json:', err);
    res.status(500).json({ error: 'Erreur serveur lors de la sauvegarde.' });
  }

});



