const express = require('express');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static('public'));

// === CONFIGURATION DU JEU ===
const MAX_PLAYERS = 6;
const RECONNECT_MS = 60_000; // Délai pour reconnexion avant suppression de la salle
const ACTIONS = [
  { name: "Flash", desc: "Réponds en moins de 30 secondes !", timer: 30 },
  { name: "Double", multiplier: 2, desc: "Réussite → tu gagnes 2 points au lieu de 1" },
  { name: "Téléportation", teleport: true, desc: "Tu choisis et joues immédiatement la prochaine case" },
  { name: "No way", penalty: true, desc: "Bonne réponse obligatoire, sinon tu donnes 1 point à chaque adversaire" },
];

// Charger les données depuis `data.json`
const dataPath = path.join(__dirname, 'public', 'data.json');
let DATA = null;
if (fs.existsSync(dataPath)) {
  try {
    DATA = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
    console.log("Données chargées depuis public/data.json");
  } catch (e) {
    console.error("Erreur lors de la lecture de public/data.json :", e);
  }
}
const THEMES = DATA ? Object.keys(DATA.categories) : [];
const QUESTIONS = DATA ? DATA.categories : {};

// Générer le plateau de jeu
const BOARD = [];
const BOARD_LENGTH = 32;
for (let i = 0; i < BOARD_LENGTH; i++) {
  if (i % 2 === 0) {
    BOARD.push({ type: "action", name: ACTIONS[i % ACTIONS.length].name });
  } else {
    BOARD.push({ type: "theme", name: THEMES[i % THEMES.length] });
  }
}

// === GESTION DES SALLES ===
const rooms = {};

function generateCode() {
  let code;
  do {
    code = Math.random().toString(36).substring(2, 6).toUpperCase();
  } while (rooms[code]);
  return code;
}

function findPlayerIndex(room, socketId) {
  return room.players.findIndex(p => p.id === socketId);
}

function transferHost(room) {
  if (room.players.length > 0) {
    room.host = room.players[0].id;
    io.to(room.host).emit('host');
  }
}

function cleanupRoomIfEmpty(code) {
  const room = rooms[code];
  if (room && room.players.length === 0) {
    delete rooms[code];
    console.log("Salle supprimée :", code);
  }
}

// === SOCKET.IO ===
io.on('connection', (socket) => {
  console.log("Connecté :", socket.id);

  // Créer une salle
  socket.on('create', (name) => {
    const code = generateCode();
    rooms[code] = {
      code,
      players: [{ id: socket.id, name: name || "Hôte", pos: 0, score: 0 }],
      host: socket.id,
      started: false,
      currentTurn: 0,
      currentQuestion: null,
      currentAction: null,
      activePlayerId: null // id du joueur qui doit répondre
    };
    socket.join(code);
    socket.emit('created', code);
    io.to(code).emit('players', rooms[code].players);
    console.log("Salle créée :", code);
  });

  // Rejoindre une salle
  socket.on('join', ({ code, name }) => {
    const room = rooms[code];
    if (!room) {
      socket.emit('error', "Salle introuvable");
      return;
    }
    if (room.players.length >= MAX_PLAYERS) {
      socket.emit('error', "Salle pleine");
      return;
    }
    room.players.push({ id: socket.id, name: name || "Joueur", pos: 0, score: 0 });
    socket.join(code);
    socket.emit('joined', code);
    io.to(code).emit('players', room.players);
    console.log(`${name} a rejoint la salle ${code}`);
  });

  // Lancer la partie (host)
  socket.on('start', (code) => {
    const room = rooms[code];
    if (!room || room.host !== socket.id) return;
    room.started = true;
    room.currentTurn = 0;
    io.to(code).emit('gameStart', { boardLength: BOARD.length, themes: THEMES });
    // Notifier le premier joueur
    const first = room.players[0];
    if (first) {
      room.activePlayerId = first.id;
      io.to(first.id).emit('yourTurn');
    }
    io.to(code).emit('players', room.players);
  });

  // Le joueur demande un lancer (serveur génère le dé)
  socket.on('roll', (code) => {
    const room = rooms[code];
    if (!room || !room.started) return;
    const currentIdx = room.currentTurn % room.players.length;
    const player = room.players[currentIdx];
    if (!player || player.id !== socket.id) {
      socket.emit('error', "Ce n'est pas votre tour");
      return;
    }
    const roll = Math.floor(Math.random() * 6) + 1;
    // envoyer le résultat seulement au joueur courant (et au salon pour info)
    io.to(socket.id).emit('rolled', { roll });
    io.to(code).emit('rolledInfo', { player: player.name, roll });
    // indiquer au joueur qu'il doit choisir une direction maintenant
    io.to(socket.id).emit('chooseDirection', { roll });
  });

  // Mouvement : le joueur envoie la direction choisie (left/right) et le serveur applique le mouvement
  socket.on('move', ({ code, steps, direction }) => {
    const room = rooms[code];
    if (!room || !room.started) return;
    const currentIdx = room.currentTurn % room.players.length;
    const player = room.players[currentIdx];
    if (!player || player.id !== socket.id) {
      socket.emit('error', "Ce n'est pas votre tour");
      return;
    }
    if (!direction || (direction !== 'left' && direction !== 'right')) {
      socket.emit('error', "Direction invalide. Choisissez 'left' ou 'right'.");
      return;
    }
    // appliquer mouvement
    if (direction === 'left') {
      player.pos = (player.pos - steps + BOARD.length) % BOARD.length;
    } else {
      player.pos = (player.pos + steps) % BOARD.length;
    }

    // tirer une action aléatoire (toujours piochée au début du tour)
    const action = ACTIONS[Math.floor(Math.random() * ACTIONS.length)];
    room.currentAction = action;

    const cell = BOARD[player.pos];
    io.to(code).emit('turn', { player: player.name, roll: steps, pos: player.pos, cell, action });

    // choisir une question selon la case d'arrivée
    const theme = (cell && cell.type === 'theme' && cell.name) ? cell.name : THEMES[Math.floor(Math.random() * THEMES.length)];
    const q = getRandomQuestion(theme);
    room.currentQuestion = q || null;
    room.activePlayerId = player.id; // qui doit répondre (pour actions everybody on traitera différemment)
    // notifier action et question au joueur (et au salon si action everybody)
    io.to(code).emit('actionDrawn', { player: player.name, action: action.desc, timer: action.timer || null });
    if (!q) {
      io.to(player.id).emit('noQuestion');
      // incrémente le tour si aucune question
      room.currentQuestion = null;
      room.currentAction = null;
      io.to(code).emit('actionClear'); // <-- clear persistant côté client
      room.currentTurn++;
      const next = room.players[room.currentTurn % room.players.length];
      room.activePlayerId = next.id;
      io.to(next.id).emit('yourTurn');
      io.to(code).emit('players', room.players);
      return;
    }
    // envoi de la question au joueur actif (si action.everybody, on envoie à tout le monde)
    if (action.everybody) {
      io.to(code).emit('question', { theme, question: q.question, id: q.id, action: action.desc, everybody: true });
    } else {
      io.to(player.id).emit('question', { theme, question: q.question, id: q.id, action: action.desc });
    }

    // mettre à jour positions visibles
    io.to(code).emit('players', room.players);
  });

  // Réponse d'un joueur
  socket.on('answer', ({ code, answer }) => {
    const room = rooms[code];
    if (!room || !room.currentQuestion) return;

    // déterminer si c'est le bon joueur qui répond (ou everybody)
    const action = room.currentAction || {};
    const isEverybody = !!action.everybody;
    if (!isEverybody && socket.id !== room.activePlayerId) {
      socket.emit('error', "Ce n'est pas à vous de répondre");
      return;
    }

    // évaluer la réponse (tolérance minime)
    const expected = (room.currentQuestion.answer || '').toString().trim().toLowerCase();
    const given = (answer || '').toString().trim().toLowerCase();
    const correct = expected.length > 0 && given === expected;

    // appliquer effets de l'action et attribution des points
    if (isEverybody) {
      // tout le monde qui répond correctement gagne un point
      room.players.forEach(p => {
        // on ne gère pas réponses multiples simultanées ici ; le client doit envoyer sa réponse
      });
      // pour simplicité, on récompense uniquement l'auteur du message qui a envoyé la réponse correcte
      const pl = room.players.find(p => p.id === socket.id);
      if (correct && pl) {
        pl.score += (action.multiplier || 1);
      }
      io.to(code).emit('result', { player: (room.players.find(p => p.id === socket.id) || {}).name, correct, score: (room.players.find(p => p.id === socket.id) || {}).score });
    } else {
      const pl = room.players.find(p => p.id === room.activePlayerId);
      if (!pl) return;
      if (correct) {
        // appliquer multiplicateur si présent
        pl.score += (action.multiplier || 1);
      } else {
        if (action.penalty) {
          // donner 1 point à chaque adversaire
          room.players.forEach(p => { if (p.id !== pl.id) p.score += 1; });
        }
      }
      io.to(code).emit('result', { player: pl.name, correct, score: pl.score });
    }

    // nettoyer état de la manche
    room.currentQuestion = null;
    room.currentAction = null;
    io.to(code).emit('actionClear'); // <-- clear côté client

    // passer au joueur suivant
    room.currentTurn++;
    const nextPlayer = room.players[room.currentTurn % room.players.length];
    room.activePlayerId = nextPlayer.id;
    io.to(nextPlayer.id).emit('yourTurn');

    // mettre à jour la liste des joueurs
    io.to(code).emit('players', room.players);
  });

  // Déconnexion
  socket.on('disconnect', () => {
    console.log("Déconnecté :", socket.id);
    Object.values(rooms).forEach(room => {
      const idx = findPlayerIndex(room, socket.id);
      if (idx >= 0) {
        room.players.splice(idx, 1);
        io.to(room.code).emit('players', room.players);
        if (room.host === socket.id) transferHost(room);
        cleanupRoomIfEmpty(room.code);
      }
    });
  });

});

// === FONCTIONS UTILES ===
function getRandomQuestion(theme) {
  const questions = QUESTIONS[theme] || [];
  return questions[Math.floor(Math.random() * questions.length)];
}

function applyAction(action, player, room) {
  io.to(room.code).emit('action', { player: player.name, action: action.desc });
  if (action.multiplier) {
    player.score *= action.multiplier;
  }
  if (action.teleport) {
    player.pos = Math.floor(Math.random() * BOARD.length);
  }
  if (action.penalty) {
    room.players.forEach(p => {
      if (p.id !== player.id) p.score += 1;
    });
  }
}

// === LANCEMENT DU SERVEUR ===
server.listen(3000, () => console.log("Serveur démarré sur http://localhost:3000"));