// server.js
const express = require('express');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static(path.join(__dirname, 'public')));

// CONFIG
const MAX_PLAYERS = 6;
const DEFAULT_BOARD_LENGTH = 32;

// ACTIONS (conservés, un peu nettoyés)
const ACTIONS = [
  { name: "Flash", flash: 30, desc: "Réponds en moins de 30 secondes !" },
  { name: "Battle on left", battleLeft: true, desc: "Plus rapide que ton voisin de gauche" },
  { name: "Battle on right", battleRight: true, desc: "Plus rapide que ton voisin de droite" },
  { name: "Call a friend", callFriend: true, desc: "Choisis un partenaire → +1 point chacun si bonne réponse" },
  { name: "For you", forYou: true, desc: "Désigne un joueur qui répond à ta place" },
  { name: "Second life", secondLife: true, desc: "Deuxième chance si tu échoues" },
  { name: "No way", noWay: true, desc: "Bonne réponse obligatoire, sinon +1 point à tous les autres" },
  { name: "Double", multiplier: 2, desc: "×2 les points en cas de succès" },
  { name: "Téléportation", teleport: true, desc: "Réussite → +1 point + tu choisis la prochaine case" },
  { name: "+1 ou -1", plusOrMinus: true, desc: "Réussite → +2 points / Échec → -1 point" },
  { name: "Everybody", everybody: true, desc: "Tout le monde joue !" },
  { name: "Double or quits", doubleOrQuits: true, desc: "Tout doubler ou tout perdre" },
  { name: "It's your choice", freeChoice: true, desc: "Choisis l'action que tu veux !" },
  { name: "Everybody", everybody: true, desc: "Tout le monde joue !" },
  { name: "No way", noWay: true, desc: "Bonne réponse obligatoire, sinon +1 point à tous les autres" },
  { name: "Quadruple", multiplier: 4, desc: "×4 les points en cas de succès" }
];

// --- Chargement des données (data.json)
let RAW_DATA = null;
let THEMES = [];
let QUESTIONS_BY_THEME = {};

try {
  const dataPath = path.join(__dirname, 'public', 'data.json');
  const raw = fs.readFileSync(dataPath, 'utf8');
  RAW_DATA = JSON.parse(raw);

  // Si data.json a une propriété "categories" (comme ton exemple), on l'utilise.
  if (RAW_DATA.categories && typeof RAW_DATA.categories === 'object') {
    QUESTIONS_BY_THEME = RAW_DATA.categories;
    THEMES = Object.keys(QUESTIONS_BY_THEME);
  } else if (Array.isArray(RAW_DATA)) {
    // si c'est un tableau, on met tout dans "Général"
    QUESTIONS_BY_THEME = { "Général": RAW_DATA };
    THEMES = ["Général"];
  } else {
    // sinon aplatir les objets-collections
    QUESTIONS_BY_THEME = Object.values(RAW_DATA).flat().length ? RAW_DATA : {};
    THEMES = Object.keys(QUESTIONS_BY_THEME);
  }

  console.log('Data chargé — thèmes:', THEMES.length);
} catch (e) {
  console.error('Impossible de charger public/data.json :', e.message);
  QUESTIONS_BY_THEME = {};
  THEMES = [];
}

// --- Chargement du board (board.json)
let BOARD_JSON = null;
let BOARD_LENGTH = DEFAULT_BOARD_LENGTH;

try {
  const boardPath = path.join(__dirname, 'public', 'data', 'board.json');
  const raw = fs.readFileSync(boardPath, 'utf8');
  BOARD_JSON = JSON.parse(raw);
  if (BOARD_JSON && Number.isFinite(BOARD_JSON.totalCases)) {
    BOARD_LENGTH = BOARD_JSON.totalCases;
  }
  console.log('Board chargé (totalCases =', BOARD_JSON && BOARD_JSON.totalCases, ')');
} catch (e) {
  console.error('Impossible de charger public/data/board.json :', e.message);
  BOARD_JSON = null;
  BOARD_LENGTH = DEFAULT_BOARD_LENGTH;
}

// Génération d'un board simplifié côté serveur pour assigner types si besoin
const BOARD = [];
for (let i = 0; i < BOARD_LENGTH; i++) {
  if (i % 2 === 0) {
    BOARD.push({ index: i, type: "action", name: ACTIONS[i % ACTIONS.length].name });
  } else {
    BOARD.push({ index: i, type: "theme", name: THEMES.length ? THEMES[i % THEMES.length] : "Général" });
  }
}

// --- Rooms
const rooms = {};

function generateCode() {
  let code;
  do { code = Math.random().toString(36).substring(2, 6).toUpperCase(); } while (rooms[code]);
  return code;
}

function getPlayer(room, id) { return room.players.find(p => p.id === id); }

function pickRandomQuestion(theme) {
  if (!theme) theme = THEMES.length ? THEMES[Math.floor(Math.random() * THEMES.length)] : null;
  const pool = (theme && QUESTIONS_BY_THEME[theme]) ? QUESTIONS_BY_THEME[theme] : Object.values(QUESTIONS_BY_THEME).flat();
  if (!pool || pool.length === 0) return null;

  // les éléments dans ton data ont parfois "question" ou "expression". On renvoie un objet normalisé.
  const raw = pool[Math.floor(Math.random() * pool.length)];
  const questionText = raw.question || raw.expression || raw.consigne || raw.questionText || '';
  const correctionText = (raw.correction || raw.answer || raw.reponse || '').toString();
  return { raw, question: questionText, correction: correctionText };
}

io.on('connection', (socket) => {
  console.log('Client connecté', socket.id);

  socket.on('create', (name) => {
    const code = generateCode();
    const room = {
      code,
      host: socket.id,
      started: false,
      currentTurn: -1,
      players: [{ id: socket.id, name: name || 'Hôte', pos: 0, score: 0 }],
      currentAction: null,
      currentQuestion: null,
      currentCorrection: null,
      activePlayers: [],
      pendingAnswers: new Map(),
      timer: null
    };
    rooms[code] = room;
    socket.join(code);
    socket.emit('created', code);
    io.to(code).emit('players', room.players);
    // envoi du plateau au créateur
    if (BOARD_JSON) socket.emit('boardData', BOARD_JSON);
  });

  socket.on('join', ({ code, name }) => {
    code = (code || '').toString().toUpperCase();
    const room = rooms[code];
    if (!room) { socket.emit('error', 'Salle inexistante'); return; }
    if (room.players.length >= MAX_PLAYERS) { socket.emit('error', 'Salle pleine'); return; }
    if (room.started) { socket.emit('error', 'Partie déjà commencée'); return; }

    const player = { id: socket.id, name: name || 'Joueur', pos: 0, score: 0 };
    room.players.push(player);
    socket.join(code);
    socket.emit('joined', code);
    io.to(code).emit('players', room.players);
    // envoi du board
    if (BOARD_JSON) socket.emit('boardData', BOARD_JSON);
  });

  socket.on('start', (code) => {
    const room = rooms[code];
    if (!room) return;
    if (room.host !== socket.id) return;
    room.started = true;
    io.to(code).emit('gameStart');
    // start first turn
    nextTurn(room);
  });

  function nextTurn(room) {
    // incrémenter currentTurn et choisir joueur
    room.currentTurn++;
    if (!room.players || room.players.length === 0) return;
    const idx = room.currentTurn % room.players.length;
    const player = room.players[idx];
    // reset état
    room.activePlayers = [player.id];
    room.pendingAnswers = new Map();
    room.currentAction = null;
    room.currentQuestion = null;
    room.currentCorrection = null;
    if (room.timer) { clearTimeout(room.timer); room.timer = null; }
    io.to(player.id).emit('yourTurn');
    io.to(room.code).emit('players', room.players);
  }

  socket.on('roll', (code) => {
    const room = rooms[code];
    if (!room) return;
    // only current active player can roll
    if (!room.activePlayers || room.activePlayers[0] !== socket.id) return;
    const roll = Math.floor(Math.random() * 6) + 1;
    const player = getPlayer(room, socket.id);
    socket.emit('rolled', { roll, currentPos: player.pos });
    io.to(room.code).emit('rolled', { roll, currentPos: player.pos }); // broadcast aussi
  });

  socket.on('moveTo', ({ code, pos }) => {
    const room = rooms[code];
    if (!room) return;
    if (!room.activePlayers || !room.activePlayers.includes(socket.id)) return;

    const player = getPlayer(room, socket.id);
    if (!player) return;
    player.pos = pos;
    io.to(room.code).emit('players', room.players);

    // tirer une action et une question
    const action = ACTIONS[Math.floor(Math.random() * ACTIONS.length)];
    room.currentAction = action;

    const theme = THEMES.length ? THEMES[Math.floor(Math.random() * THEMES.length)] : null;
    const q = pickRandomQuestion(theme);
    if (!q) {
      // pas de question disponible : fin du tour
      io.to(room.code).emit('error', 'Aucune question disponible');
      return endTurn(room);
    }

    room.currentQuestion = q.question;
    room.currentCorrection = (q.correction || '').trim().toLowerCase();
    room.pendingAnswers = new Map();
    room.activePlayers = action.everybody ? room.players.map(p => p.id) : [socket.id];

    // notifier l'action et la question
    io.to(room.code).emit('actionDrawn', { action: action.name, timer: action.flash || null });
    io.to(room.code).emit('players', room.players);

    const duration = action.flash || 60;
    // start timer that will autofail active players when ends
    room.timer = setTimeout(() => {
      // marquer comme incorrect pour ceux qui n'ont pas répondu
      room.activePlayers.forEach(id => {
        if (!room.pendingAnswers.has(id)) room.pendingAnswers.set(id, { correct: false });
      });
      io.to(room.code).emit('timeOut', { message: 'Temps écoulé' });
      applyActionResults(room, action);
      endTurn(room);
    }, duration * 1000);

    // envoyer la question : soit à tous soit au joueur actif
    const questionPayload = { theme: theme || 'Général', question: room.currentQuestion };
    if (action.everybody) io.to(room.code).emit('question', questionPayload);
    else io.to(socket.id).emit('question', questionPayload);
  });

  socket.on('answer', ({ code, answer }) => {
    const room = rooms[code];
    if (!room) return;
    if (!room.currentQuestion || !room.activePlayers.includes(socket.id)) return;

    const clean = (answer || '').toString().trim().toLowerCase();
    const correct = clean === (room.currentCorrection || '').toLowerCase();

    room.pendingAnswers.set(socket.id, { correct, player: getPlayer(room, socket.id).name });

    // si everyone must answer wait for all replies, otherwise we can resolve immediately
    const everyoneAnswered = room.pendingAnswers.size === room.activePlayers.length;
    const action = room.currentAction || {};
    if (!action.everybody || everyoneAnswered) {
      if (room.timer) { clearTimeout(room.timer); room.timer = null; }
      applyActionResults(room, action);
      endTurn(room);
    } else {
      // still waiting for others
      io.to(room.code).emit('waitingAnswers', { received: room.pendingAnswers.size });
    }
  });

  function applyActionResults(room, action) {
    // default action fallback
    if (!action) action = {};

    // appliquer résultats sur chaque joueur actif
    room.activePlayers.forEach(id => {
      const res = room.pendingAnswers.get(id) || { correct: false };
      const player = getPlayer(room, id);
      if (!player) return;
      if (res.correct) {
        player.score += action.multiplier || 1;
      } else {
        if (action.noWay) {
          // offrir 1 point à chacun des autres
          room.players.forEach(p => { if (p.id !== id) p.score += 1; });
        }
      }
    });

    io.to(room.code).emit('results', {
      players: room.players.map(p => ({ name: p.name, score: p.score })),
      message: 'Résultats appliqués'
    });
  }

  function endTurn(room) {
    io.to(room.code).emit('actionClear');
    room.currentQuestion = null;
    room.currentCorrection = null;
    room.currentAction = null;
    room.activePlayers = [];
    room.pendingAnswers = new Map();
    if (room.timer) { clearTimeout(room.timer); room.timer = null; }
    setTimeout(() => nextTurn(room), 1500);
  }

  function getRandomQuestion(theme) {
    return pickRandomQuestion(theme);
  }

  socket.on('disconnect', () => {
    // retirer le joueur de toutes les rooms
    Object.values(rooms).forEach(room => {
      const idx = room.players.findIndex(p => p.id === socket.id);
      if (idx !== -1) {
        room.players.splice(idx, 1);
        io.to(room.code).emit('players', room.players);
        if (room.host === socket.id && room.players.length > 0) room.host = room.players[0].id;
        if (room.players.length === 0) {
          delete rooms[room.code];
        }
      }
    });
    console.log('Client déconnecté', socket.id);
  });
});

const PORT = 3000;
server.listen(PORT, '0.0.0.0', () => console.log('Serveur lancé sur le port', PORT));
