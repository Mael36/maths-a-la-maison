const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.use(express.static('public'));

// Chargement des questions
let questions = [];
try {
  const data = fs.readFileSync(path.join(__dirname, 'public', 'data.json'), 'utf8');
  const parsed = JSON.parse(data);
  questions = Object.values(parsed).flat(); // Toutes les questions dans un seul tableau
} catch (err) {
  console.error("Erreur chargement data.json :", err);
}

// Plateau : 32 cases
const BOARD_SIZE = 32;

// Génère un code de salle aléatoire
function generateCode() {
  return Math.random().toString(36).substring(2, 6).toUpperCase();
}

// Stockage des salles
const rooms = new Map();

io.on('connection', (socket) => {
  console.log('Joueur connecté:', socket.id);

  socket.on('create', (name) => {
    const code = generateCode();
    const room = {
      code,
      players: [],
      host: socket.id,
      started: false,
      currentPlayerIndex: 0,
      currentQuestion: null,
      currentCorrection: null,
      currentAction: null,
      pendingAnswers: new Map(),
      questionTimer: null
    };
    socket.join(code);
    const player = { id: socket.id, name, pos: 0, score: 0 };
    room.players.push(player);
    rooms.set(code, room);
    socket.emit('created', code);
    io.to(code).emit('players', room.players);
  });

  socket.on('join', ({ code, name }) => {
    code = code.toUpperCase();
    const room = rooms.get(code);
    if (!room) return socket.emit('error', 'Salle introuvable');
    if (room.started) return socket.emit('error', 'Partie déjà commencée');
    if (room.players.length >= 6) return socket.emit('error', 'Salle pleine');

    socket.join(code);
    const player = { id: socket.id, name, pos: 0, score: 0 };
    room.players.push(player);
    socket.emit('joined', code);
    io.to(code).emit('players', room.players);
  });

  socket.on('start', (code) => {
    const room = rooms.get(code);
    if (!room || room.host !== socket.id) return;
    room.started = true;
    io.to(code).emit('gameStart');
    nextTurn(room);
  });

  socket.on('roll', (code) => {
    const room = rooms.get(code);
    if (!room || !room.started) return;
    const current = room.players[room.currentPlayerIndex];
    if (current.id !== socket.id) return;

    const roll = Math.floor(Math.random() * 6) + 1;
    io.to(code).emit('rolled', { player: current.name, roll });
    socket.emit('rolled', { roll });
  });

  socket.on('move', ({ code, steps, direction }) => {
    const room = rooms.get(code);
    if (!room || !room.started) return;
    const player = room.players.find(p => p.id === socket.id);
    if (!player || room.players[room.currentPlayerIndex].id !== socket.id) return;

    let newPos = player.pos + (direction === 'right' ? steps : -steps);
    if (newPos < 0) newPos = 0;
    if (newPos >= BOARD_SIZE) newPos = BOARD_SIZE - 1;
    player.pos = newPos;

    // Tirer une action
    const actionIndex = Math.floor(Math.random() * 16);
    const action = ACTIONS[actionIndex];
    room.currentAction = action;

    io.to(code).emit('actionDrawn', {
      action: action.name,
      timer: action.flash ? 30 : null
    });

    // Poser une question
    const question = questions[Math.floor(Math.random() * questions.length)];
    room.currentQuestion = question;
    room.currentCorrection = question.correction.toString().trim().toLowerCase();
    room.pendingAnswers.clear();

    io.to(code).emit('question', {
      theme: "Calculs",
      question: question.question || "Calcul rapide !"
    });

    // Timer
    const duration = action.flash ? 30 : 60;
    if (room.questionTimer) clearTimeout(room.questionTimer);
    room.questionTimer = setTimeout(() => {
      if (room.currentQuestion) {
        applyActionResults(room, action, true); // true = timeout
        endTurn(room);
        io.to(code).emit('timeOut', { message: "Temps écoulé !" });
      }
    }, duration * 1000);

    io.to(code).emit('players', room.players);
  });

  socket.on('answer', ({ code, answer }) => {
    const room = rooms.get(code);
    if (!room || !room.currentQuestion) return;
    const player = room.players.find(p => p.id === socket.id);
    if (!player) return;

    const correct = (answer + "").trim().toLowerCase() === room.currentCorrection;
    room.pendingAnswers.set(socket.id, { correct, player: player.name });

    // Si tout le monde a répondu ou action spéciale
    if (room.pendingAnswers.size >= room.players.length || room.currentAction.everybody) {
      clearTimeout(room.questionTimer);
      applyActionResults(room, room.currentAction);
      endTurn(room);
    }
  });

  socket.on('disconnect', () => {
    for (const [code, room] of rooms) {
      const index = room.players.findIndex(p => p.id === socket.id);
      if (index !== -1) {
        room.players.splice(index, 1);
        if (room.players.length === 0) rooms.delete(code);
        else io.to(code).emit('players', room.players);
      }
    }
  });
});

// === LES 16 ACTIONS EXACTEMENT COMME SUR TES CARTES ===
const ACTIONS = [
  { name: "Flash", flash: true },
  { name: "Battle on left", battleLeft: true },
  { name: "Battle on right", battleRight: true },
  { name: "Call a friend", callFriend: true },
  { name: "For you", forYou: true },
  { name: "Second life", secondLife: true },
  { name: "No way", noWay: true },
  { name: "Double", multiplier: 2 },
  { name: "Téléportation", teleport: true },
  { name: "+1 ou -1", plusOrMinus: true },
  { name: "Everybody", everybody: true },
  { name: "Double or quits", doubleOrQuits: true },
  { name: "It's your choice", freeChoice: true },
  { name: "Everybody", everybody: true },
  { name: "No way", noWay: true },
  { name: "Quadruple", multiplier: 4 }
];

// Appliquer les résultats selon l'action
function applyActionResults(room, action, isTimeout = false) {
  const results = [];

  room.players.forEach(player => {
    const answerData = room.pendingAnswers.get(player.id) || { correct: false };
    let points = 0;
    let correct = answerData.correct;

    if (isTimeout) correct = false;

    if (action.flash || action.battleLeft || action.battleRight || action.everybody) {
      if (correct) points += 1 * (action.multiplier || 1);
    } else if (action.noWay) {
      if (!correct) {
        room.players.forEach(p => { if (p.id !== player.id) p.score += 1; });
      } else {
        points += 1;
      }
    } else if (action.doubleOrQuits) {
      if (correct) points += 2;
      else player.score = Math.max(0, player.score - 2);
    } else if (action.plusOrMinus) {
      points += correct ? 2 : -1;
    } else {
      if (correct) points += 1 * (action.multiplier || 1);
    }

    player.score += points;
    results.push({ player: player.name, correct, score: player.score });
  });

  io.to(room.code).emit('results', { action: action.name, results });
  room.currentQuestion = null;
}

function endTurn(room) {
  room.currentPlayerIndex = (room.currentPlayerIndex + 1) % room.players.length;
  io.to(room.code).emit('players', room.players);
  setTimeout(() => nextTurn(room), 4000);
}

function nextTurn(room) {
  const next = room.players[room.currentPlayerIndex];
  if (next) io.to(next.id).emit('yourTurn');
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Serveur lancé sur le port ${PORT}`);
  console.log(`http://localhost:${PORT}`);
});
