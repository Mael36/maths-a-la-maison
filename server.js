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

// ACTIONS
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

// DATA
let DATA = null;
try {
  const dataPath = path.join(process.cwd(), 'public', 'data.json');
  DATA = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
} catch (e) {
  console.error("Erreur data.json :", e);
}
const THEMES = DATA ? Object.keys(DATA.categories) : [];
const QUESTIONS = DATA ? DATA.categories : {};

// BOARD
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

io.on('connection', (socket) => {
  console.log("Connecté:", socket.id);

  socket.on('create', (name) => {
    const code = generateCode();
    rooms[code] = {
      code, host: socket.id, started: false, currentTurn: 0,
      players: [{ id: socket.id, name: name || "Hôte", pos: 0, score: 0 }],
      currentAction: null, currentQuestion: null, activePlayers: [], pendingAnswers: new Map(),
      timer: null
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
    const player = room.players[room.currentTurn % room.players.length];
    room.activePlayers = [player.id];
    room.pendingAnswers = new Map();
    io.to(player.id).emit('yourTurn');
  }

  socket.on('roll', (code) => {
    const room = rooms[code];
    if (!room || room.activePlayers[0] !== socket.id) return;
    const roll = Math.floor(Math.random() * 6) + 1;
    io.to(code).emit('rolledInfo', { player: getPlayer(room, socket.id).name, roll });
    io.to(socket.id).emit('rolled', { roll });
  });

  socket.on('move', ({ code, steps, direction }) => {
    const room = rooms[code];
    if (!room || room.activePlayers[0] !== socket.id) return;

    const player = getPlayer(room, socket.id);
    if (direction === 'left') {
      player.pos = (player.pos - steps + BOARD_LENGTH) % BOARD_LENGTH;
    } else {
      player.pos = (player.pos + steps) % BOARD_LENGTH;
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
    room.currentCorrection = q.correction;
    room.pendingAnswers = new Map();

    // Envoyer action
    io.to(code).emit('actionDrawn', { player: player.name, action: action.name, desc: action.desc, timer: action.flash || null });

    // Timer 60s ou 30s pour Flash
    const timerDuration = action.flash || 60;
    room.timer = setTimeout(() => {
      if (room.currentQuestion) {
        io.to(room.code).emit('timeOut', { message: 'Temps écoulé !' });
        $('questionBox').style.display = 'none';
        applyActionResults(room, action);
        endTurn(room);
      }
    }, timerDuration * 1000);

    if (action.everybody) {
      room.activePlayers = room.players.map(p => p.id);
      io.to(code).emit('question', { theme, question: q.question, everybody: true });
    } else if (action.callFriend || action.forYou || action.freeChoice) {
      io.to(socket.id).emit('choosePlayerOrAction', { type: action.callFriend || action.forYou ? 'player' : 'action' });
    } else {
      room.activePlayers = [socket.id];
      io.to(socket.id).emit('question', { theme, question: q.question });
    }

    io.to(code).emit('players', room.players);
  });

  socket.on('answer', ({ code, answer }) => {
    const room = rooms[code];
    if (!room || !room.currentQuestion || !room.activePlayers.includes(socket.id)) return;

    const player = getPlayer(room, socket.id);
    const correct = (room.currentCorrection + "").trim().toLowerCase() === (answer + "").trim().toLowerCase();
    room.pendingAnswers.set(socket.id, { correct, player: player.name });

    const action = room.currentAction;

    if (!action.everybody) {
      if (room.timer) clearTimeout(room.timer);
      applyActionResults(room, action);
      endTurn(room);
    } else if (room.pendingAnswers.size === room.activePlayers.length) {
      if (room.timer) clearTimeout(room.timer);
      applyActionResults(room, action);
      endTurn(room);
    }
  });

  function applyActionResults(room, action) {
    room.activePlayers.forEach(id => {
      const res = room.pendingAnswers.get(id);
      if (!res) return;
      const player = getPlayer(room, id);

      if (res.correct) {
        let points = action.multiplier || 1;
        if (action.plusOrMinus) points = 2;
        player.score += points;
        if (action.doubleOrQuits) player.score *= 2;
        if (action.teleport && id === room.activePlayers[0]) {
          io.to(id).emit('teleportChoice');
        }
      } else {
        if (action.plusOrMinus) player.score = Math.max(0, player.score - 1);
        if (action.noWay) {
          room.players.forEach(p => { if (p.id !== id) p.score += 1; });
        }
        if (action.doubleOrQuits) player.score = 0;
      }
    });

    io.to(room.code).emit('results', {
      action: action.name,
      results: room.activePlayers.map(id => ({
        player: room.pendingAnswers.get(id)?.player,
        correct: room.pendingAnswers.get(id)?.correct,
        score: getPlayer(room, id).score
      }))
    });
  }

  function endTurn(room) {
    if (room.timer) clearTimeout(room.timer);
    room.timer = null;
    room.currentQuestion = null;
    room.currentCorrection = null;
    room.currentAction = null;
    room.activePlayers = [];
    room.pendingAnswers = new Map();
    io.to(room.code).emit('actionClear');
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
        if (room.host === socket.id && room.players.length > 0) room.host = room.players[0].id;
        if (room.players.length === 0) delete rooms[room.code];
      }
    });
  });
});

server.listen(3000, () => console.log("Serveur démarré → http://localhost:3000"));
