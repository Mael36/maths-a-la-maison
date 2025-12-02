const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.use(express.static('public'));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

let rooms = {};
let questions = [];

try {
  const data = fs.readFileSync('public/data.json', 'utf8');
  questions = JSON.parse(data);
} catch (e) {
  console.log("data.json non trouvé ou invalide");
}

const actions = [
  "Flash","Battle on left","Battle on right","Call a friend",
  "For you","Second life","No way","Double",
  "Téléportation","+1 ou -1","Everybody","Double or quits",
  "It's your choice","Everybody","No way","Quadruple"
];

io.on('connection', socket => {
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

  socket.on('join', ({code, name}) => {
    code = code.toUpperCase();
    if (!rooms[code]) return socket.emit('error', 'Salle inexistante');
    if (rooms[code].started) return socket.emit('error', 'Partie déjà commencée');
    rooms[code].players.push({ id: socket.id, name, pos: 0, score: 0 });
    socket.join(code);
    socket.emit('joined', code);
    io.to(code).emit('players', rooms[code].players);
  });

  socket.on('start', code => {
    if (!rooms[code]) return;
    rooms[code].started = true;
    io.to(code).emit('gameStart');
    nextTurn(code);
  });

  function nextTurn(code) {
    const room = rooms[code];
    if (!room) return;
    const player = room.players[room.currentPlayer];
    io.to(code).emit('yourTurn', player.id);
    socket.to(code).emit('waiting', player.name);
  }

  socket.on('roll', code => {
    if (!rooms[code]) return;
    const roll = Math.floor(Math.random() * 6) + 1;
    const player = rooms[code].players.find(p => p.id === socket.id);
    if (!player) return;
    socket.emit('rolled', { roll, currentPos: player.pos });
    socket.to(code).emit('playerRolled', { name: player.name, roll });
  });

  socket.on('moveTo', ({code, targetPos}) => {
    const room = rooms[code];
    const player = room.players.find(p => p.id === socket.id);
    if (!player) return;
    player.pos = targetPos;

    // Tirage d'une action
    const action = actions[Math.floor(Math.random() * actions.length)];
    io.to(code).emit('actionDrawn', { action });

    // Tirage d'une question aléatoire
    const q = questions[Math.floor(Math.random() * questions.length)];
    io.to(code).emit('question', { ...q, action });

    io.to(code).emit('players', room.players);
  });

  socket.on('answer', ({code, answer}) => {
    const room = rooms[code];
    const player = room.players.find(p => p.id === socket.id);
    if (!player) return;

    const correct = answer.trim().toLowerCase() === "42"; // À remplacer par vraie logique plus tard
    const points = correct ? 1 : 0;

    player.score += points;

    io.to(code).emit('result', {
      player: player.name,
      correct,
      points: correct ? 1 : 0
    });

    // Passe au joueur suivant
    room.currentPlayer = (room.currentPlayer + 1) % room.players.length;
    setTimeout(() => nextTurn(code), 5000);
    io.to(code).emit('players', room.players);
  });

  socket.on('disconnect', () => {
    for (const code in rooms) {
      rooms[code].players = rooms[code].players.filter(p => p.id !== socket.id);
      if (rooms[code].players.length === 0) delete rooms[code];
      else io.to(code).emit('players', rooms[code].players);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Serveur lancé sur le port ${PORT}`));
