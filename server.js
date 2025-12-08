// server.js
const express = require('express');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { Server } = require('socket.io');

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

// load questions (optional)
let QUESTIONS_RAW = null;
try {
  QUESTIONS_RAW = JSON.parse(fs.readFileSync(path.join(__dirname, 'public', 'data.json')));
  console.log('Questions loaded');
} catch (e) {
  console.warn('No data.json or invalid JSON; questions disabled');
  QUESTIONS_RAW = { categories: {} };
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
  const categories = QUESTIONS_RAW.categories || {};
  const pool = Object.values(categories).flat();
  if (!pool || pool.length === 0) return null;
  const raw = pool[Math.floor(Math.random() * pool.length)];
  const questionText = raw.question || raw.expression || raw.consigne || '';
  const correctionText = (raw.correction || raw.answer || raw.reponse || '').toString();
  return { question: questionText, correction: correctionText };
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

  socket.on('answer', ({ code, answer }) => {
    const room = rooms[code];
    if (!room) return;
    const player = room.players.find(p => p.id === socket.id);
    if (!player) return;
    if (!room.activePlayers || !room.activePlayers.includes(socket.id)) return;
    if (!room.currentQuestion) return;

    const given = (answer || '').toString().trim().toLowerCase();
    const correct = given === (room.currentCorrection || '').toString().trim().toLowerCase();

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
    // Teleport handling: move initiator to random pos (then question)
    if (action && action.name === 'Téléportation') {
      const randPos = Math.floor(Math.random() * room.board.positions.length);
      initiator.pos = randPos;
      io.to(room.code).emit('teleport', { pos: randPos });
      io.to(room.code).emit('players', room.players);
    }

    // pick question
    const q = pickQuestion();
    if (!q) {
      io.to(room.code).emit('error', 'Aucune question disponible');
      endTurn(room);
      return;
    }
    room.currentQuestion = q.question;
    room.currentCorrection = (q.correction || '').toString().trim().toLowerCase();

    // define recipients & timer
    let recipients = [];
    let timerSec = (action && action.timer) ? action.timer : 60;

    switch (action && action.name) {
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
        const selected = meta.selectedPlayer || room.players.find(p => p.id !== initiator.id).id;
        recipients = [initiator.id, selected];
        break;
      }
      case 'For you': {
        const chosen = meta.selectedPlayer || initiator.id;
        recipients = [chosen];
        break;
      }
      case 'Second life':
      case 'Double':
      case '+1 ou -1':
      case 'No way':
      case 'Double or quits':
      case 'Quadruple':
      case 'Téléportation':
        recipients = [initiator.id];
        break;
      case 'Everybody':
        recipients = room.players.map(p => p.id);
        break;
      default:
        recipients = [initiator.id];
    }

    room.activePlayers = recipients.slice();
    room.pendingAnswers = new Map();

    // send question to recipients (include recipients list)
    recipients.forEach(id => {
      io.to(id).emit('question', { theme: 'Général', question: room.currentQuestion, timer: timerSec, recipients });
    });

    // server-side timer
    clearRoomTimer(room);
    room.timer = setTimeout(() => {
      // special second life handling
      if (action && action.name === 'Second life' && !room.secondLifeRetry) {
        room.secondLifeRetry = true;
        room.pendingAnswers = new Map();
        io.to(initiator.id).emit('question', { theme: 'Général', question: room.currentQuestion, timer: timerSec });
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

}); // end connection

const PORT = 3000;
server.listen(PORT, '0.0.0.0', () => console.log('Serveur lancé sur le port', PORT));
