const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*"
  }
});

// Serve les fichiers du dossier public/
app.use(express.static(path.join(__dirname, 'public')));

// Chargement des questions
let questions = [];
try {
  const dataPath = path.join(__dirname, 'public', 'data.json');
  const data = fs.readFileSync(dataPath, 'utf8');
  questions = JSON.parse(data);
  console.log("Questions chargées :", questions.length);
} catch (e) {
  console.error("ERREUR : impossible de lire public/data.json");
}

// Actions possibles
const actions = [
  "Flash","Battle on left","Battle on right","Call a friend",
  "For you","Second life","No way","Double",
  "Téléportation","+1 ou -1","Everybody","Double or quits",
  "It's your choice","Everybody","No way","Quadruple"
];

const rooms = {};

io.on('connection', socket => {

  // Création
  socket.on('create', name => {
    const code = Math.random().toString(36).substring(2, 6).toUpperCase();
    rooms[code] = {
      players: [{ id: socket.id, name, pos: 0, score: 0 }],
      started: false,
      currentPlayer: 0
    };
    socket.join(code);
    socket.emit('created', code);
    io.to(code).emit('players', rooms[code].players);
  });

  // Rejoindre
  socket.on('join', ({code, name}) => {
    code = code.toUpperCase();
    if (!rooms[code]) return socket.emit('error', 'Salle inexistante');
    if (rooms[code].started) return socket.emit('error', 'Partie déjà commencée');

    rooms[code].players.push({ id: socket.id, name, pos: 0, score: 0 });
    socket.join(code);
    socket.emit('joined', code);
    io.to(code).emit('players', rooms[code].players);
  });

  // Démarrer la partie
  socket.on('start', code => {
    rooms[code].started = true;
    io.to(code).emit('gameStart');
    nextTurn(code);
  });

  // Tour suivant
  function nextTurn(code) {
    const room = rooms[code];
    if (!room) return;
    const player = room.players[room.currentPlayer];

    io.to(player.id).emit('yourTurn');

    room.currentPlayer = (room.currentPlayer + 1) % room.players.length;
  }

  // Dé
  socket.on('roll', code => {
    const roll = Math.floor(Math.random() * 6) + 1;
    const player = rooms[code].players.find(p => p.id === socket.id);

    socket.emit('rolled', { roll, currentPos: player.pos });
  });

  // Déplacement vers une case
  socket.on('moveTo', ({code, targetPos}) => {
    const player = rooms[code].players.find(p => p.id === socket.id);
    player.pos = targetPos;

    const action = actions[Math.floor(Math.random() * actions.length)];
    const question = questions[Math.floor(Math.random() * questions.length)];

    io.to(code).emit('actionDrawn', { action });
    io.to(code).emit('question', { ...question, action });
    io.to(code).emit('players', rooms[code].players);
  });

  // Réponse
  socket.on('answer', ({code, answer}) => {
    const player = rooms[code].players.find(p => p.id === socket.id);

    const correct = answer.trim().toLowerCase() === "42"; // À améliorer
    if (correct) player.score++;

    io.to(code).emit('result', {
      player: player.name,
      correct,
      points: correct ? 1 : 0
    });

    setTimeout(() => nextTurn(code), 5000);
  });

});

// ---- DÉMARRAGE ----
const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log("Serveur lancé sur le port " + PORT);
});
