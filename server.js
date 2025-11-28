const express = require('express');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static('public'));

const MAX_PLAYERS = 6;
const BOARD_LENGTH = 32;

// === LES 16 ACTIONS (pleinement implémentées) ===
const ACTIONS = [
  { name: "Flash", flash: 30, desc: "Réponds en moins de 30 secondes !" },
  { name: "Battle on left", battleLeft: true, desc: "Plus rapide que ton voisin de gauche" },
  { name: "Battle on right", battleRight: true, desc: "Plus rapide que ton voisin de droite" },
  { name: "Call a friend", callFriend: true, desc: "Choisis un partenaire → +1 point chacun si bonne réponse" },
  { name: "For you", forYou: true, desc: "Désigne un joueur qui répond à ta place" },
  { name: "Second life", secondLife: true, desc: "Deuxième chance si tu échoues" },
  { name: "No way", noWay: true, desc: "Bonne réponse obligatoire, sinon -1 point à tous les autres" },
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

// Charger data.json
let DATA = null;
try {
  const dataPath = path.join(__dirname, 'public', 'data.json');
  DATA = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
} catch (e) {
  console.error("Erreur data.json :", e);
}
const THEMES = DATA ? Object.keys(DATA.categories) : [];
const QUESTIONS = DATA ? DATA.categories : {};

// Générer le plateau
const BOARD = [];
for (let i = 0; i < BOARD_LENGTH; i++) {
  if (i % 2 === 0) {
    BOARD.push({ type: "action", name: ACTIONS[i % ACTIONS.length].name });
  } else {
    BOARD.push({ type: "theme", name: THEMES[i % THEMES.length] || "Général" });
  }
}

const rooms = {};

function generateCode() {
  let code;
  do { code = Math.random().toString(36).substring(2, 6).toUpperCase(); } while (rooms[code]);
  return code;
}

function getPlayer(room, id) { return room.players.find(p => p.id === id); }
function getNextPlayer(room) { return room.players[room.currentTurn % room.players.length]; }

// === SOCKET.IO ===
io.on('connection', (socket) => {
  console.log("Connecté:", socket.id);

  socket.on('create', (name) => {
    const code = generateCode();
    rooms[code] = {
      code, host: socket.id, started: false, currentTurn: 0,
      players: [{ id: socket.id, name: name || "Hôte", pos: 0, score: 0 }],
      currentAction: null, currentQuestion: null, activePlayers: [], pendingAnswers: new Map()
    };
    socket.join(code);
    socket.emit('created', code);
    io.to(code).emit('players', rooms[code].players);
  });

  socket.on('join', ({ code, name }) => {
    const room = rooms[code];
    if (!room || room.players.length >= MAX_PLAYERS) {
      socket.emit('error', room ? "Salle pleine" : "Salle introuvable");
      return;
    }
    room.players.push({ id: socket.id, name: name || "Joueur", pos: 0, score: 0 });
    socket.join(code);
    socket.emit('joined', code);
    io.to(code).emit('players', room.players);
  });

  socket.on('start', (code) => {
    const room = rooms[code];
    if (!room || room.host !== socket.id) return;
    room.started = true;
    io.to(code).emit('gameStart');
    nextTurn(room);
  });

  function nextTurn(room) {
    room.currentTurn++;
    const player = getNextPlayer(room);
    room.activePlayers = [player.id];
    room.pendingAnswers = new Map();
    io.to(player.id).emit('yourTurn');
  }

  socket.on('roll', (code) => {
    const room = rooms[code];
    if (!room || !room.started) return;
    const player = getPlayer(room, socket.id);
    if (!player || room.activePlayers[0] !== socket.id) return;

    const roll = Math.floor(Math.random() * 6) + 1;
    io.to(code).emit('rolledInfo', { player: player.name, roll });
    io.to(socket.id).emit('rolled', { roll });
  });

  socket.on('move', ({ code, steps, direction }) => {
    const room = rooms[code];
    if (!room || room.activePlayers[0] !== socket.id) return;

    const player = getPlayer(room, socket.id);
    if (direction === 'left') {
      player.pos = (player.pos - steps + BOARD_LENGTH) % BOARD_LENGTH;
    } else {
      player.pos = (steps + player.pos) % BOARD_LENGTH;
    }

    const action = ACTIONS[Math.floor(Math.random() * ACTIONS.length)];
    room.currentAction = action;

    const cell = BOARD[player.pos];
    const theme = cell.type === 'theme' ? cell.name : THEMES[Math.floor(Math.random() * THEMES.length)];
    const q = getRandomQuestion(theme);

    if (!q) {
      io.to(code).emit('noQuestion');
      endTurn(room);
      return;
    }

    room.currentQuestion = q;
    room.pendingAnswers = new Map();

    // Appliquer action
    io.to(code).emit('actionDrawn', { player: player.name, action: action.desc, timer: action.flash || null });

    if (action.everybody) {
      room.activePlayers = room.players.map(p => p.id);
      io.to(code).emit('question', { theme, question: q.question, everybody: true });
    } else if (action.callFriend || action.forYou) {
      io.to(socket.id).emit('choosePlayer', { action: action.name });
    } else if (action.freeChoice) {
      io.to(socket.id).emit('chooseAction', { actions: ACTIONS.map(a => ({ name: a.name, desc: a.desc })) });
    } else {
      room.activePlayers = [socket.id];
      io.to(socket.id).emit('question', { theme, question: q.question });
    }

    io.to(code).emit('players', room.players);
  });

  socket.on('playerChosen', ({ code, targetId }) => {
    const room = rooms[code];
    if (!room || room.activePlayers[0] !== socket.id) return;
    const action = room.currentAction;
    if (action.callFriend || action.forYou) {
      room.activePlayers = [socket.id, targetId];
      io.to(code).emit('question', { theme: room.currentQuestion.theme, question: room.currentQuestion.question });
    }
  });

  socket.on('actionChosen', ({ code, actionName }) => {
    const room = rooms[code];
    if (!room || room.activePlayers[0] !== socket.id) return;
    const newAction = ACTIONS.find(a => a.name === actionName);
    if (newAction) {
      room.currentAction = newAction;
      io.to(code).emit('actionDrawn', { player: getPlayer(room, socket.id).name, action: newAction.desc });
      // relancer la question avec la nouvelle action
      io.to(code).emit('question', { theme: room.currentQuestion.theme, question: room.currentQuestion.question, everybody: newAction.everybody });
    }
  });

  socket.on('answer', ({ code, answer }) => {
    const room = rooms[code];
    if (!room || !room.currentQuestion) return;
    if (!room.activePlayers.includes(socket.id)) return;

    const player = getPlayer(room, socket.id);
    const correct = (room.currentQuestion.answer + "").trim().toLowerCase() === (answer + "").trim().toLowerCase();

    // Enregistrer réponse
    room.pendingAnswers.set(socket.id, { correct, answered: true });

    const action = room.currentAction;

    // Si tout le monde a répondu ou pas everybody
    const allAnswered = room.activePlayers.every(id => room.pendingAnswers.has(id));

    if (!action.everybody || allAnswered) {
      applyActionResults(room, action);
      endTurn(room);
    }
  });

  function applyActionResults(room, action) {
    room.activePlayers.forEach(id => {
      const res = room.pendingAnswers.get(id);
      if (!res) return;
      const player = getPlayer(room, id);
      if (!player) return;

      if (res.correct) {
        let points = action.multiplier || 1;
        if (action.plusOrMinus) points = 2;
        if (action.doubleOrQuits) player.score *= 2;
        if (action.doubleOrQuits && player.score === 0) player.score = 1;
        player.score += points;
      } else {
        if (action.plusOrMinus) player.score = Math.max(0, player.score - 1);
        if (action.noWay) {
          room.players.forEach(p => { if (p.id !== id) p.score += 1; });
        }
        if (action.doubleOrQuits) player.score = 0;
      }
    });

    // Téléportation
    if (action.teleport && room.pendingAnswers.get(room.activePlayers[0])?.correct) {
      io.to(room.activePlayers[0]).emit('teleport');
    }

    // Broadcast résultats
    room.activePlayers.forEach(id => {
      const p = getPlayer(room, id);
      const res = room.pendingAnswers.get(id);
      io.to(room.code).emit('result', { player: p.name, correct: res.correct, score: p.score });
    });
  }

  function endTurn(room) {
    io.to(room.code).emit('actionClear', {});
    room.currentQuestion = null;
    room.currentAction = null;
    room.activePlayers = [];
    room.pendingAnswers = new Map();
    setTimeout(() => nextTurn(room), 3000);
  }

  function getRandomQuestion(theme) {
    const list = QUESTIONS[theme] || Object.values(QUESTIONS).flat();
    return list.length > 0 ? list[Math.floor(Math.random() * list.length)] : null;
  }

  socket.on('disconnect', () => {
    Object.values(rooms).forEach(room => {
      const idx = room.players.findIndex(p => p.id === socket.id);
      if (idx !== -1) {
        room.players.splice(idx, 1);
        io.to(room.code).emit('players', room.players);
        if (room.host === socket.id && room.players.length > 0) {
          room.host = room.players[0].id;
        }
        if (room.players.length === 0) delete rooms[room.code];
      }
    });
  });
});

server.listen(3000, () => console.log("Serveur démarré → http://localhost:3000"));

