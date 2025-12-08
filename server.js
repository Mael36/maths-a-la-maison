// server.js
const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static(path.join(__dirname, 'public')));

// --- Load board.json and questions data ---
const BOARD_PATH = path.join(__dirname, 'public', 'data', 'board.json');
const DATA_PATH = path.join(__dirname, 'public', 'data.json');

let BOARD = null;
let QUESTION_DATA = null;
try {
  BOARD = JSON.parse(fs.readFileSync(BOARD_PATH, 'utf8'));
} catch (e) {
  console.error('Impossible de charger board.json:', e.message);
  process.exit(1);
}
try {
  QUESTION_DATA = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
} catch (e) {
  console.warn('data.json introuvable ou invalide, les questions seront vides');
  QUESTION_DATA = { categories: {} };
}
const THEMES = QUESTION_DATA.categories ? Object.keys(QUESTION_DATA.categories) : [];

// --- Actions definition (with properties used in flow) ---
const ACTIONS = [
  { name: "Flash", timer: 30, desc: "30s" },
  { name: "Battle on left", desc: "Battle left" },
  { name: "Battle on right", desc: "Battle right" },
  { name: "Call a friend", needPlayer: true },
  { name: "For you", needPlayer: true },
  { name: "Second life", desc: "Deux essais" },
  { name: "No way", desc: "Si faux -> +1 à tous les autres" },
  { name: "Double", desc: "Correct -> +2 pts" },
  { name: "Téléportation", desc: "TP aléatoire puis question" },
  { name: "+1 ou -1", desc: "+2 si ok, -1 si non" },
  { name: "Everybody", desc: "Tout le monde répond, 1er correct gagne" },
  { name: "Double or quits", desc: "Si ok -> pts *2, sinon -> 0" },
  { name: "It's your choice", needActionChoice: true },
  { name: "Quadruple", desc: "+4 si ok" }
];

// --- Game rooms storage ---
const rooms = {}; // key: code -> room object

function generateCode() {
  let code;
  do { code = Math.random().toString(36).substr(2, 4).toUpperCase(); } while (rooms[code]);
  return code;
}

function pickRandomQuestion(theme) {
  // theme may be undefined -> pick random theme
  const categories = QUESTION_DATA.categories || {};
  let pool = [];
  if (theme && categories[theme]) pool = categories[theme];
  else pool = Object.values(categories).flat();
  if (!pool || pool.length === 0) {
    // fallback: try to flatten whatever exists in data
    if (Array.isArray(QUESTION_DATA)) pool = QUESTION_DATA;
    else pool = [];
  }
  if (!pool.length) return null;
  const raw = pool[Math.floor(Math.random() * pool.length)];
  const questionText = raw.question || raw.expression || raw.consigne || raw.questionText || '';
  const correctionText = (raw.correction || raw.answer || raw.reponse || '').toString();
  return { raw, question: questionText, correction: correctionText };
}

// helper to find room by socket id
function findRoomBySocketId(id) {
  return Object.values(rooms).find(r => r.players.some(p => p.id === id));
}

io.on('connection', socket => {
  console.log('conn:', socket.id);

  // create room
  socket.on('create', name => {
    const code = generateCode();
    const room = {
      code,
      host: socket.id,
      players: [{ id: socket.id, name: name || 'Hôte', pos: 0, score: 0 }],
      board: BOARD,
      currentIndex: 0, // index in players array whose turn it is
      state: 'waiting',
      currentAction: null,
      currentQuestion: null,
      currentCorrection: null,
      activePlayers: [],
      pendingAnswers: new Map(),
      timer: null,
      secondLifeRetry: false
    };
    rooms[code] = room;
    socket.join(code);
    socket.emit('created', code);
    io.to(code).emit('players', room.players);
    socket.emit('boardData', room.board);
    console.log('room created', code);
  });

  // join
  socket.on('join', ({ code, name }) => {
    code = (code || '').toString().toUpperCase();
    const room = rooms[code];
    if (!room) return socket.emit('error', 'Salle inexistante');
    if (room.players.length >= 6) return socket.emit('error', 'Salle pleine (6 max)');
    if (room.state !== 'waiting') return socket.emit('error', 'Partie déjà commencée');
    room.players.push({ id: socket.id, name: name || 'Joueur', pos: 0, score: 0 });
    socket.join(code);
    socket.emit('joined', code);
    io.to(code).emit('players', room.players);
    socket.emit('boardData', room.board);
  });

  // request players or board
  socket.on('requestPlayers', () => {
    const room = findRoomBySocketId(socket.id);
    if (room) socket.emit('players', room.players);
  });
  socket.on('requestBoard', () => {
    const room = findRoomBySocketId(socket.id);
    if (room) socket.emit('boardData', room.board);
  });

  // start
  socket.on('start', code => {
    const room = rooms[code];
    if (!room) return;
    if (room.host !== socket.id) return socket.emit('error', 'Tu n’es pas l’hôte');
    room.state = 'playing';
    room.currentIndex = 0;
    const currentPlayer = room.players[room.currentIndex];
    io.to(code).emit('gameStart');
    io.to(code).emit('players', room.players);
    io.to(currentPlayer.id).emit('yourTurn', { playerId: currentPlayer.id });
    io.to(code).emit('yourTurn', { playerId: currentPlayer.id }); // for UI sync
  });

  // roll dice
  socket.on('roll', code => {
    const room = rooms[code];
    if (!room) return;
    const current = room.players[room.currentIndex];
    if (!current || current.id !== socket.id) return; // only current player
    const roll = Math.floor(Math.random() * 6) + 1;
    io.to(code).emit('rolled', { roll, currentPos: current.pos });
  });

  // move to chosen case (after clicking spot)
  socket.on('moveTo', ({ code, pos }) => {
    const room = rooms[code];
    if (!room) return;
    const current = room.players[room.currentIndex];
    if (!current || current.id !== socket.id) return;
    // update position
    current.pos = pos;
    io.to(code).emit('players', room.players);
    // pick action and handle
    const action = ACTIONS[Math.floor(Math.random() * ACTIONS.length)];
    room.currentAction = action;
    room.pendingAnswers = new Map();
    room.secondLifeRetry = false;
    // send action drawn
    io.to(code).emit('actionDrawn', { action: action.name, timer: action.timer || null });

    // if action needs player selection or action selection, ask current player
    if (action.needPlayer) {
      // ask current player to choose someone
      io.to(current.id).emit('requestSelection', { type: 'player', message: 'Choisis un joueur', initiatorId: current.id });
      // store that we are waiting for selection -> handle in selectPlayer event
      room.waitingForSelection = { type: 'player', initiator: current.id, action: action.name };
      return;
    }
    if (action.needActionChoice) {
      // propose a list of actions to choose from
      const choices = ["Second life", "Double", "Quadruple", "No way", "Flash", "+1 ou -1"];
      io.to(current.id).emit('requestSelection', { type: 'action', message: 'Choisis ton action', initiatorId: current.id, actions: choices });
      room.waitingForSelection = { type: 'action', initiator: current.id, action: action.name };
      return;
    }

    // otherwise immediately proceed to ask question (or perform teleport)
    proceedToQuestion(room, current, action);
  });

  // selection of player (for Call a friend / For you) or action choice
  socket.on('selectPlayer', ({ code, targetId }) => {
    const room = rooms[code];
    if (!room || !room.waitingForSelection) return;
    const sel = room.waitingForSelection;
    const initiator = room.players[room.currentIndex];
    if (!initiator || initiator.id !== socket.id) return; // only initiator can select
    const target = room.players.find(p => p.id === targetId);
    if (!target) return socket.emit('error', 'Joueur introuvable');

    // clear waiting state
    room.waitingForSelection = null;

    // depending on action: Call a friend or For you
    const actionName = sel.action || room.currentAction && room.currentAction.name;
    if (!actionName) return;

    if (actionName === 'Call a friend') {
      // both current and target will be active players; then ask question
      proceedToQuestion(room, initiator, room.currentAction, { selectedPlayer: target.id, mode: 'call' });
    } else if (actionName === 'For you') {
      // only target answers; if correct both get +1
      proceedToQuestion(room, initiator, room.currentAction, { selectedPlayer: target.id, mode: 'forYou' });
    } else {
      // fallback
      proceedToQuestion(room, initiator, room.currentAction);
    }
  });

  socket.on('chooseAction', ({ code, chosenAction }) => {
    const room = rooms[code];
    if (!room || !room.waitingForSelection) return;
    const sel = room.waitingForSelection;
    const initiator = room.players[room.currentIndex];
    if (!initiator || initiator.id !== socket.id) return;
    room.waitingForSelection = null;
    // map chosenAction string to a virtual action object and proceed
    const actionObj = ACTIONS.find(a => a.name.toLowerCase() === (chosenAction || '').toLowerCase()) ||
                      { name: chosenAction, desc: 'Choisie', timer: null };
    room.currentAction = actionObj;
    proceedToQuestion(room, initiator, actionObj);
  });

  // answer handler
  socket.on('answer', ({ code, answer }) => {
    const room = rooms[code];
    if (!room) return;
    const player = room.players.find(p => p.id === socket.id);
    if (!player) return;
    // must be active player
    if (!room.activePlayers || !room.activePlayers.includes(socket.id)) return;
    // if no question, ignore
    if (!room.currentQuestion) return;

    const given = (answer || '').toString().trim().toLowerCase();
    const correct = given === (room.currentCorrection || '').toString().trim().toLowerCase();

    // store answer
    room.pendingAnswers.set(socket.id, { correct, playerId: socket.id });

    // handle by action type
    const action = room.currentAction && room.currentAction.name;

    // Helper: finish round and emit results, advance turn
    const finishTurn = (resultObj) => {
      // resultObj: { correct: boolean|null, message?:string }
      clearRoomTimer(room);
      io.to(code).emit('results', Object.assign({ players: room.players }, resultObj || {}));
      endTurn(room);
    };

    // ACTION LOGIC
    switch (action) {
      case 'Flash':
      case 'Téléportation':
      case 'Double':
      case '+1 ou -1':
      case 'Quadruple':
      case 'No way':
      case 'Double or quits':
      case 'Second life':
        // single-player actions mostly resolved immediately
        resolveSinglePlayerAction(room, player, correct, action);
        break;

      case 'Everybody':
        // first correct answer wins and stops question for all
        if (correct) {
          // award +1 to answering player
          player.score = (player.score || 0) + 1;
          finishTurn({ correct: true });
        } else {
          // wrong — mark that this player is done; if all have answered incorrectly -> finish
          const alreadyAnswered = Array.from(room.pendingAnswers.values()).filter(a => a.playerId);
          if (alreadyAnswered.length >= room.activePlayers.length) {
            finishTurn({ correct: false });
          } else {
            // still waiting; do nothing (others can answer)
          }
        }
        break;

      case 'Battle on left':
      case 'Battle on right':
        // between two players: first correct wins
        if (correct) {
          player.score = (player.score || 0) + 1;
          finishTurn({ correct: true });
        } else {
          // if both answered and none correct -> finish false
          const answeredCount = room.pendingAnswers.size;
          if (answeredCount >= room.activePlayers.length) finishTurn({ correct: false });
        }
        break;

      case 'Call a friend':
        // two players: if any correct => both +1; if both answered wrong -> none
        if (correct) {
          // award +1 to both initiator and the friend
          const initiator = room.players[room.currentIndex];
          const friendId = room.actionMeta && room.actionMeta.selectedPlayer;
          const friend = room.players.find(p => p.id === friendId);
          if (initiator) initiator.score = (initiator.score || 0) + 1;
          if (friend) friend.score = (friend.score || 0) + 1;
          finishTurn({ correct: true });
        } else {
          // if all active players answered and none correct -> finish false
          if (room.pendingAnswers.size >= room.activePlayers.length) finishTurn({ correct: false });
        }
        break;

      case 'For you':
        // question asked to chosen player only, but if correct both get +1
        if (correct) {
          const initiator = room.players[room.currentIndex];
          player.score = (player.score || 0) + 1;
          if (initiator) initiator.score = (initiator.score || 0) + 1;
          finishTurn({ correct: true });
        } else {
          // wrong -> question disappears and no points
          finishTurn({ correct: false });
        }
        break;

      default:
        // fallback
        if (correct) {
          player.score = (player.score || 0) + 1;
          finishTurn({ correct: true });
        } else {
          finishTurn({ correct: false });
        }
    }
  });

  // timeout handling from client or auto timer
  socket.on('timeout', ({ code }) => {
    const room = rooms[code];
    if (!room) return;
    // treat as wrong for active players, but specific actions might allow second chance (Second life)
    const action = room.currentAction && room.currentAction.name;
    if (action === 'Second life') {
      // if first attempt timed out or wrong, allow second attempt
      if (!room.secondLifeRetry) {
        room.secondLifeRetry = true;
        room.pendingAnswers = new Map();
        // re-send question only to current player
        const qpayload = { theme: 'Général', question: room.currentQuestion, timer: 60 };
        io.to(room.players[room.currentIndex].id).emit('question', qpayload);
        return;
      } else {
        // second attempt exhausted -> finish false
        finalizeFalse(room, code);
        return;
      }
    } else if (action === 'Double or quits') {
      // timeout => treat as wrong -> set player's pts to 0
      const pl = room.players[room.currentIndex];
      pl.score = 0;
      clearRoomTimer(room);
      io.to(code).emit('results', { correct: false, players: room.players, message: 'Temps écoulé' });
      endTurn(room);
      return;
    } else {
      // default: finish as wrong
      finalizeFalse(room, code);
    }
  });

  socket.on('disconnect', () => {
    // remove player from any rooms
    Object.values(rooms).forEach(room => {
      const idx = room.players.findIndex(p => p.id === socket.id);
      if (idx !== -1) {
        room.players.splice(idx, 1);
        io.to(room.code).emit('players', room.players);
        // if host left assign new host
        if (room.host === socket.id && room.players.length > 0) room.host = room.players[0].id;
        // if no players left, delete room
        if (room.players.length === 0) delete rooms[room.code];
      }
    });
    console.log('disconnect', socket.id);
  });

  // Helper functions inside connection scope

  function proceedToQuestion(room, initiator, action, meta = {}) {
    // meta can contain { selectedPlayer, mode }
    room.actionMeta = meta;
    // action could be an object or string
    const actionName = (action && action.name) ? action.name : (action || 'Général');
    // Teleport special: pick random case among all positions (excluding current maybe)
    if (actionName === 'Téléportation') {
      const randPos = Math.floor(Math.random() * room.board.positions.length);
      initiator.pos = randPos;
      io.to(room.code).emit('teleport', { pos: randPos });
      io.to(room.code).emit('players', room.players);
      // continue to question as normal for initiator
    }

    // pick question (theme not specified -> random)
    const q = pickRandomQuestion();
    if (!q) {
      io.to(room.code).emit('error', 'Aucune question disponible');
      endTurn(room);
      return;
    }
    room.currentQuestion = q.question || '';
    room.currentCorrection = (q.correction || '').toString().trim().toLowerCase();

    // determine activePlayers and timer based on action
    let recipients = []; // socket ids who should see question
    let timerSec = (action && action.timer) ? action.timer : 60;

    switch (actionName) {
      case 'Flash':
        recipients = [initiator.id];
        timerSec = 30;
        break;

      case 'Battle on left': {
        const leftIdx = (room.currentIndex - 1 + room.players.length) % room.players.length;
        const left = room.players[leftIdx];
        recipients = [initiator.id, left.id];
        break;
      }
      case 'Battle on right': {
        const rightIdx = (room.currentIndex + 1) % room.players.length;
        const right = room.players[rightIdx];
        recipients = [initiator.id, right.id];
        break;
      }
      case 'Call a friend': {
        const friendId = meta.selectedPlayer;
        if (!friendId) {
          // fallback: pick random other player
          const others = room.players.filter(p => p.id !== initiator.id);
          if (others.length) recipients = [initiator.id, others[0].id];
          else recipients = [initiator.id];
        } else recipients = [initiator.id, friendId];
        break;
      }
      case 'For you': {
        const chosen = meta.selectedPlayer;
        recipients = chosen ? [chosen] : [initiator.id];
        break;
      }
      case 'Second life':
        recipients = [initiator.id];
        room.secondLifeRetry = false;
        break;
      case 'No way':
      case 'Double':
      case '+1 ou -1':
      case 'Double or quits':
      case 'Quadruple':
      case 'Téléportation':
        recipients = [initiator.id];
        break;
      case 'Everybody':
        recipients = room.players.map(p => p.id);
        break;
      case "It's your choice":
        // Should not happen because It's your choice triggers selection earlier
        recipients = [initiator.id];
        break;
      default:
        recipients = [initiator.id];
    }

    room.activePlayers = recipients.slice();
    room.pendingAnswers = new Map();

    // emit question ONLY to recipients (include recipients array for client safety)
    io.to(room.code).emit('players', room.players); // update positions/scores before question
    recipients.forEach(id => {
      io.to(id).emit('question', { theme: 'Général', question: room.currentQuestion, timer: timerSec, recipients });
    });

    // start server-side timer to autofail
    clearRoomTimer(room);
    room.timer = setTimeout(() => {
      // if Second life and first attempt not retried yet -> allow second attempt
      if (actionName === 'Second life' && !room.secondLifeRetry) {
        room.secondLifeRetry = true;
        room.pendingAnswers = new Map();
        // re-emit question to initiator for second attempt
        io.to(initiator.id).emit('question', { theme: 'Général', question: room.currentQuestion, timer: timerSec });
        // start timer again
        clearRoomTimer(room);
        room.timer = setTimeout(() => {
          finalizeFalse(room, room.code);
        }, timerSec * 1000);
        return;
      }
      // otherwise finalize as false (wrong)
      finalizeFalse(room, room.code);
    }, timerSec * 1000);
  }

  function resolveSinglePlayerAction(room, player, correct, actionName) {
    // actions: Flash, Double, +1 ou -1, Quadruple, No way, Double or quits, Second life, Téléportation
    const code = room.code;
    if (actionName === 'Second life') {
      if (correct) {
        player.score = (player.score || 0) + 1;
        clearRoomTimer(room);
        io.to(code).emit('results', { correct: true, players: room.players });
        endTurn(room);
      } else {
        if (!room.secondLifeRetry) {
          // give second try: allow question again to same player
          room.secondLifeRetry = true;
          room.pendingAnswers = new Map();
          clearRoomTimer(room);
          // re-send question to the player
          io.to(player.id).emit('question', { theme: 'Général', question: room.currentQuestion, timer: 60 });
          // restart server timer handled in proceedToQuestion when second life was set
        } else {
          // second try failed -> 0 pts
          clearRoomTimer(room);
          io.to(code).emit('results', { correct: false, players: room.players });
          endTurn(room);
        }
      }
      return;
    }

    if (actionName === 'Double') {
      if (correct) player.score = (player.score || 0) + 2; // double = +2
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
      if (correct) {
        player.score = (player.score || 0) + 1;
      } else {
        // add +1 to all other players
        room.players.forEach(p => { if (p.id !== player.id) p.score = (p.score || 0) + 1; });
      }
      clearRoomTimer(room);
      io.to(code).emit('results', { correct, players: room.players });
      endTurn(room);
      return;
    }

    if (actionName === 'Double or quits') {
      if (correct) {
        player.score = (player.score || 0) * 2;
      } else {
        player.score = 0;
      }
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

    // default fallback
    if (correct) player.score = (player.score || 0) + 1;
    clearRoomTimer(room);
    io.to(code).emit('results', { correct, players: room.players });
    endTurn(room);
  }

  function finalizeFalse(room, code) {
    clearRoomTimer(room);
    io.to(code).emit('results', { correct: false, players: room.players, message: 'Mauvaise réponse / Temps écoulé' });
    endTurn(room);
  }

  function clearRoomTimer(room) {
    if (!room) return;
    if (room.timer) { clearTimeout(room.timer); room.timer = null; }
  }

  function endTurn(room) {
    clearRoomTimer(room);
    // reset some state
    room.currentAction = null;
    room.currentQuestion = null;
    room.currentCorrection = null;
    room.activePlayers = [];
    room.pendingAnswers = new Map();
    room.actionMeta = null;
    room.secondLifeRetry = false;

    // advance to next player
    if (room.players && room.players.length > 0) {
      room.currentIndex = (room.currentIndex + 1) % room.players.length;
      const next = room.players[room.currentIndex];
      // update all clients with players
      io.to(room.code).emit('players', room.players);
      // notify next player
      io.to(next.id).emit('yourTurn', { playerId: next.id });
      io.to(room.code).emit('yourTurn', { playerId: next.id });
    }
  }

}); // end io.on('connection')

const PORT = 3000;
server.listen(PORT, '0.0.0.0', () => console.log('Serveur lancé sur le port', PORT));
