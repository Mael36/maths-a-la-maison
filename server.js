// server.js
const express = require('express');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { Server } = require('socket.io');
const MISTRAL_API_KEY = "UgqBwDkleUS5rgEDyCnWYoZOhEHH916x"  
const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// load board
let BOARD = null;
try {
  BOARD = JSON.parse(fs.readFileSync(path.join(__dirname, 'public', 'data', 'board.json')));
  console.log('Board loaded, cases:', BOARD.totalCases);
} catch (e) {
  console.error('Error loading board.json:', e.message);
  process.exit(1);
}

let QUESTIONS = [];

try {
  const raw = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'public', 'data.json'), 'utf-8')
  );

  if (typeof raw !== 'object' || raw === null) {
    throw new Error('data.json n’est pas un objet');
  }

  // Aplatit toutes les catégories
  QUESTIONS = Object.values(raw)
    .flat()
    .filter(q => q && q.q && q.a) // sécurité minimale
    .map(q => ({
      id: q.id ?? null,
      q: q.q,
      a: q.a,

      // champs optionnels (nouveau format)
      d: q.d ?? null,
      img: q.img ?? null,
      imgrep: q.imgrep ?? null
    }));

  console.log(`Questions chargées : ${QUESTIONS.length}`);
} catch (e) {
  console.error('Erreur data.json → questions désactivées :', e.message);
  QUESTIONS = [];
}




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
  { name: "Double or quits" },
  { name: "It's your choice", needActionChoice: true },
  { name: "Quadruple" }
];

const rooms = {}; // code -> room

function genCode() {
  let c;
  do { c = Math.random().toString(36).substr(2,4).toUpperCase(); } while (rooms[c]);
  return c;
}

function pickQuestion() {
  if (!QUESTIONS.length) return null;

  const q = QUESTIONS[Math.floor(Math.random() * QUESTIONS.length)];

  return {
    question: q.q || '',
    correction: (q.a || '').toString(),
    detail: q.d || null,      // optionnel
    img: q.img || null        // <-- ajouter le chemin de l'image
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
      players: [{ id: socket.id, name: name || 'Hôte', pos: 0, score: 0 }],
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
    io.to(code).emit('players', room.players);
    socket.emit('boardData', room.board);
    console.log('created', code);
  });

  socket.on('join', ({ code, name }) => {
    code = (code || '').toString().toUpperCase();
    const room = rooms[code];
    if (!room) return socket.emit('error', 'Salle inexistante');
    if (room.players.length >= 6) return socket.emit('error', 'Salle pleine');
    if (room.state !== 'waiting') return socket.emit('error', 'Partie déjà commencée');
    room.players.push({ id: socket.id, name: name || 'Joueur', pos: 0, score: 0 });
    socket.join(code);
    socket.emit('joined', code);
    io.to(code).emit('players', room.players);
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
    room.currentIndex = 0;
    io.to(code).emit('gameStart');
    io.to(code).emit('players', room.players);
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

    // set player's position
    current.pos = Math.max(0, Math.min(pos, room.board.positions.length - 1));
    io.to(code).emit('players', room.players);

    // choose random action
    const action = ACTIONS[Math.floor(Math.random() * ACTIONS.length)];
    room.currentAction = action;
    room.pendingAnswers = new Map();
    room.secondLifeRetry = false;
    room.actionMeta = null;
    io.to(code).emit('actionDrawn', { action: action.name, timer: action.timer || null });

    // if action requires selection of player or action, request it from current player
    if (action.needPlayer) {
      room.waitingForSelection = { type: 'player', initiator: current.id, action: action.name };
      io.to(current.id).emit('requestSelection', { type: 'player', message: 'Choisis un joueur', initiatorId: current.id });
      return;
    }
    if (action.needActionChoice) {
      room.waitingForSelection = { type: 'action', initiator: current.id, action: action.name };
      const choices = ["Second life","Double","Quadruple","No way","+1 ou -1","Flash"];
      io.to(current.id).emit('requestSelection', { type: 'action', message: 'Choisis ton action', initiatorId: current.id, actions: choices });
      return;
    }

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
    function conclude(correctFlag, message) {
      clearRoomTimer(room);
      io.to(room.code).emit('results', { correct: correctFlag, players: room.players, message });
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
      case 'Double or quits':
      case 'Second life':
        // single player actions: resolve immediately with resolveSinglePlayerAction
        resolveSinglePlayerAction(room, player, correct, actionName);
        break;

      case 'Everybody':
        if (correct) {
          // give point to the player who answered correctly
          player.score = (player.score || 0) + 1;
          conclude(true, 'Un joueur a répondu correctement');
        } else {
          // if all active players have answered and none correct, finish false
          if (room.pendingAnswers.size >= room.activePlayers.length) conclude(false, 'Personne n’a répondu correctement');
        }
        break;

      case 'Battle on left':
      case 'Battle on right':
        if (correct) {
          player.score = (player.score || 0) + 1;
          conclude(true, 'Victoire au battle');
        } else {
          if (room.pendingAnswers.size >= room.activePlayers.length) conclude(false, 'Aucun correct');
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
          conclude(true, 'Call a friend: bonne réponse');
        } else {
          if (room.pendingAnswers.size >= room.activePlayers.length) conclude(false, 'Call a friend: personne n’a répondu correctement');
        }
        break;

      case 'For you':
        if (correct) {
          const initiator = room.players[room.currentIndex];
          player.score = (player.score || 0) + 1;
          if (initiator) initiator.score = (initiator.score || 0) + 1;
          conclude(true, 'For you: bonne réponse');
        } else {
          conclude(false, 'For you: mauvaise réponse');
        }
        break;

      default:
        // fallback
        if (correct) {
          player.score = (player.score || 0) + 1;
          conclude(true);
        } else {
          conclude(false);
        }
    }
  });

  socket.on('timeout', ({ code }) => {
    const room = rooms[code];
    if (!room) return;
    const actionName = room.currentAction && room.currentAction.name;

    if (actionName === 'Second life') {
      if (!room.secondLifeRetry) {
        room.secondLifeRetry = true;
        room.pendingAnswers = new Map();
        const current = room.players[room.currentIndex];
        io.to(current.id).emit('question', { theme: 'Général', question: room.currentQuestion, timer: 60, recipients: [current.id] });
        // start a new timer server-side
        clearRoomTimer(room);
        room.timer = setTimeout(() => finalizeFalse(room), 60 * 1000);
        return;
      } else {
        // second try exhausted
        finalizeFalse(room);
        return;
      }
    }

    if (actionName === 'Double or quits') {
      const pl = room.players[room.currentIndex];
      pl.score = 0;
      clearRoomTimer(room);
      io.to(room.code).emit('results', { correct: false, players: room.players, message: 'Temps écoulé - Double or quits perdu' });
      endTurn(room);
      return;
    }

    finalizeFalse(room);
  });

  socket.on('disconnect', () => {
    // remove from rooms
    Object.values(rooms).forEach(room => {
      const idx = room.players.findIndex(p => p.id === socket.id);
      if (idx !== -1) {
        room.players.splice(idx, 1);
        io.to(room.code).emit('players', room.players);
        if (room.host === socket.id && room.players.length > 0) room.host = room.players[0].id;
        if (room.players.length === 0) delete rooms[room.code];
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

    io.to(room.code).emit('players', room.players);
    io.to(room.code).emit('teleport', {
      playerId: initiator.id,
      pos: randPos
    });
    // on continue volontairement vers la question
  }

  // --- pick question ---
  const q = pickQuestion();
  if (!q) {
    io.to(room.code).emit('error', 'Aucune question disponible');
    endTurn(room);
    return;
  }

  room.currentQuestion = q.question;
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

  recipients.forEach(id => {
  io.to(id).emit('question', {
    theme: 'Général',
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
    if (actionName === 'Second life') {
      if (correct) {
        player.score = (player.score || 0) + 1;
        clearRoomTimer(room);
        io.to(code).emit('results', { correct: true, players: room.players });
        endTurn(room);
      } else {
        if (!room.secondLifeRetry) {
          room.secondLifeRetry = true;
          room.pendingAnswers = new Map();
          clearRoomTimer(room);
          io.to(player.id).emit('question', { theme: 'Général', question: room.currentQuestion, timer: 60, recipients: [player.id] });
          room.timer = setTimeout(() => finalizeFalse(room), 60 * 1000);
        } else {
          clearRoomTimer(room);
          io.to(code).emit('results', { correct: false, players: room.players });
          endTurn(room);
        }
      }
      return;
    }

    if (actionName === 'Double') {
      if (correct) player.score = (player.score || 0) + 2;
      clearRoomTimer(room);
      io.to(code).emit('results', { correct, players: room.players });
      endTurn(room);
      return;
    }

    if (actionName === '+1 ou -1') {
      if (correct) player.score = (player.score || 0) + 2;
      else player.score = (player.score || 0) - 1;
      clearRoomTimer(room);
      io.to(code).emit('results', { correct, players: room.players });
      endTurn(room);
      return;
    }

    if (actionName === 'Quadruple') {
      if (correct) player.score = (player.score || 0) + 4;
      clearRoomTimer(room);
      io.to(code).emit('results', { correct, players: room.players });
      endTurn(room);
      return;
    }

    if (actionName === 'No way') {
      if (correct) player.score = (player.score || 0) + 1;
      else room.players.forEach(p => { if (p.id !== player.id) p.score = (p.score || 0) + 1; });
      clearRoomTimer(room);
      io.to(code).emit('results', { correct, players: room.players });
      endTurn(room);
      return;
    }

    if (actionName === 'Double or quits') {
      if (correct) player.score = (player.score || 0) * 2;
      else player.score = 0;
      clearRoomTimer(room);
      io.to(code).emit('results', { correct, players: room.players });
      endTurn(room);
      return;
    }

    if (actionName === 'Téléportation') {
      if (correct) player.score = (player.score || 0) + 1;
      clearRoomTimer(room);
      io.to(code).emit('results', { correct, players: room.players });
      endTurn(room);
      return;
    }

    if (actionName === 'Flash') {
      if (correct) player.score = (player.score || 0) + 1;
      clearRoomTimer(room);
      io.to(code).emit('results', { correct, players: room.players });
      endTurn(room);
      return;
    }

    // fallback
    if (correct) player.score = (player.score || 0) + 1;
    clearRoomTimer(room);
    io.to(code).emit('results', { correct, players: room.players });
    endTurn(room);
  }

  function finalizeFalse(room) {
    clearRoomTimer(room);
    io.to(room.code).emit('results', { correct: false, players: room.players, message: 'Mauvaise réponse / Temps écoulé' });
    endTurn(room);
  }

  function clearRoomTimer(room) {
    if (!room) return;
    if (room.timer) { clearTimeout(room.timer); room.timer = null; }
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
      io.to(room.code).emit('players', room.players);
      io.to(next.id).emit('yourTurn', { playerId: next.id });
      io.to(room.code).emit('yourTurn', { playerId: next.id });
      // clear action highlight & possible cases
      io.to(room.code).emit('actionClear');
    }
  }
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
}); // end connection

const PORT = 3000;
server.listen(PORT, '0.0.0.0', () => console.log('Serveur lancé sur le port', PORT));





