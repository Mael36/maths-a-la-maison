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

// CONFIG
const PORT = process.env.PORT || 3000;
const MAX_PLAYERS = 6;

// Load questions (public/data.json expected)
let QUESTIONS_BY_THEME = {};
let THEMES = [];
try {
  const raw = fs.readFileSync(path.join(__dirname, 'public', 'data.json'), 'utf8');
  const data = JSON.parse(raw);
  if (data.categories && typeof data.categories === 'object') {
    QUESTIONS_BY_THEME = data.categories;
    THEMES = Object.keys(QUESTIONS_BY_THEME);
  } else if (Array.isArray(data)) {
    QUESTIONS_BY_THEME = { "Général": data };
    THEMES = ["Général"];
  } else {
    QUESTIONS_BY_THEME = data;
    THEMES = Object.keys(QUESTIONS_BY_THEME);
  }
  console.log('Thèmes chargés:', THEMES.length);
} catch (e) {
  console.warn('Impossible de lire public/data.json — pas de questions chargées');
  QUESTIONS_BY_THEME = {};
  THEMES = [];
}

// Load board (public/data/board.json), fallback to simple board
let BOARD = null;
try {
  const raw = fs.readFileSync(path.join(__dirname, 'public', 'data', 'board.json'), 'utf8');
  BOARD = JSON.parse(raw);
  console.log('Board chargé — totalCases:', BOARD.totalCases);
} catch (e) {
  console.warn('Board non trouvé, génération simple.');
  BOARD = { totalCases: 32, center: 31, positions: [] };
  for (let i = 0; i < 32; i++) BOARD.positions.push({ x: (i % 8) * 12.5, y: Math.floor(i / 8) * 12.5 });
}

function pickQuestion(theme) {
  const pool = (theme && QUESTIONS_BY_THEME[theme]) ? QUESTIONS_BY_THEME[theme] : Object.values(QUESTIONS_BY_THEME).flat();
  if (!pool || pool.length === 0) return null;
  const raw = pool[Math.floor(Math.random() * pool.length)];
  const text = raw.question || raw.expression || raw.consigne || raw.text || '';
  const correction = (raw.correction || raw.answer || '').toString().trim();
  return { raw, question: text, correction };
}

// Action definitions
const ACTIONS = [
  { name: "Flash", type: "flash" },                  // 30s
  { name: "Battle on left", type: "battle", target: "left" },
  { name: "Battle on right", type: "battle", target: "right" },
  { name: "Call a friend", type: "callFriend" },     // choose player, both answer, if any correct both +1
  { name: "For you", type: "forYou" },               // choose player, that player answers; if correct both +1
  { name: "Second life", type: "secondLife" },       // 1st wrong => second chance
  { name: "No way", type: "noWay" },                 // correct +1, wrong => all others +1
  { name: "Double", type: "double" },                // correct: +2 (double the usual +1)
  { name: "Téléportation", type: "teleport" },       // teleport then question
  { name: "+1 ou -1", type: "plusOrMinus" },         // correct +2, wrong -1
  { name: "Everybody", type: "everybody" },          // anyone can answer; first correct gets +1
  { name: "Double or quits", type: "doubleOrQuits" },// correct => player's points *2 ; wrong => player's points = 0
  { name: "It's your choice", type: "choice" },      // player chooses an action (subset) before question
  { name: "Quadruple", type: "quadruple" }           // correct +4
];

// Rooms store
const rooms = {}; // key -> { code, host, players[], started, currentTurn, currentAction, currentQuestion, currentCorrection, activePlayers[], pendingAnswers Map, timer, waitingFor }

// Helpers
function genCode() {
  let c;
  do { c = Math.random().toString(36).substring(2, 6).toUpperCase(); } while (rooms[c]);
  return c;
}
function getPlayer(room, socketId) {
  return room.players.find(p => p.id === socketId);
}
function broadcastPlayers(room) {
  io.to(room.code).emit('players', room.players);
}
function sendBoard(socket) {
  // send board json already in memory (BOARD)
  socket.emit('boardData', BOARD);
}

// Turn management
function nextTurn(room) {
  if (!room.players || room.players.length === 0) return;
  room.currentTurn = (room.currentTurn + 1) % room.players.length;
  const current = room.players[room.currentTurn];
  room.activePlayers = [current.id];
  room.pendingAnswers = new Map();
  room.currentAction = null;
  room.currentQuestion = null;
  room.currentCorrection = null;
  if (room.timer) { clearTimeout(room.timer); room.timer = null; }
  io.to(current.id).emit('yourTurn', { playerId: current.id });
  broadcastPlayers(room);
}

// Cleanly end question / apply results
function endQuestion(room, resolved = false) {
  if (room.timer) { clearTimeout(room.timer); room.timer = null; }
  room.currentAction = null;
  room.currentQuestion = null;
  room.currentCorrection = null;
  room.activePlayers = [];
  room.pendingAnswers = new Map();
  io.to(room.code).emit('actionClear');
  setTimeout(() => nextTurn(room), 1500);
}

// Apply results per action
function applyResults(room) {
  const action = room.currentAction || {};
  // helper to award points safely
  function award(playerId, pts) {
    const p = getPlayer(room, playerId);
    if (!p) return;
    p.score = (p.score || 0) + pts;
  }

  // Everybody special: first correct wins
  if (action.type === 'everybody') {
    // pendingAnswers map may contain some answers. We reward first correct found by timestamp simulation: we stored insertion order; we treat first correct in Map iteration as first.
    for (const [id, answerObj] of room.pendingAnswers.entries()) {
      if (answerObj.correct) {
        award(id, 1);
        io.to(room.code).emit('results', { players: room.players, correct: true, winnerId: id });
        return;
      }
    }
    // nobody correct
    io.to(room.code).emit('results', { players: room.players, correct: false });
    return;
  }

  // For other actions, evaluate each active player (often a single player)
  for (const playerId of room.activePlayers) {
    const res = room.pendingAnswers.get(playerId) || { correct: false, retry: false };
    const p = getPlayer(room, playerId);
    if (!p) continue;

    switch (action.type) {
      case 'flash':
      case undefined:
      case null:
        // default normal question: +1 if correct
        if (res.correct) award(playerId, 1);
        break;

      case 'battle':
        // Two players involved (activePlayers should contain both). The one who answered correctly first wins +1.
        // If both incorrect: nobody.
        // We assume pendingAnswers preserves answer order; find earliest correct among pendingAnswers keys in insertion order.
        {
          let winner = null;
          for (const [id, ans] of room.pendingAnswers.entries()) {
            if (ans.correct) { winner = id; break; }
          }
          if (winner) award(winner, 1);
        }
        break;

      case 'callFriend':
        // Two players: initiator and chosen. If any of them answers correctly, BOTH get +1.
        {
          const [a, b] = room.activePlayers;
          const aRes = room.pendingAnswers.get(a);
          const bRes = room.pendingAnswers.get(b);
          const anyCorrect = (aRes && aRes.correct) || (bRes && bRes.correct);
          if (anyCorrect) {
            award(a, 1); award(b, 1);
          }
        }
        break;

      case 'forYou':
        // question answered by chosen player only; if correct both initiator and chosen get +1
        {
          const initiatorId = action.initiator;
          const chosenId = room.activePlayers[0]; // only chosen is active
          const chosenRes = room.pendingAnswers.get(chosenId);
          if (chosenRes && chosenRes.correct) {
            award(chosenId, 1);
            if (initiatorId && initiatorId !== chosenId) award(initiatorId, 1);
          }
        }
        break;

      case 'secondLife':
        // If a player answered wrong and not yet retried, give them retry (server should have set a retry flag by not applying yet)
        // We implement this by: if res.retryRequested is true, we re-emit question to that player with shortened timer
        // But here when applyResults is called, we check: if any res.retry is true we delay awarding until second attempt handled.
        if (res.correct) award(playerId, 1);
        // If incorrect and res.retryRequested true => we would have scheduled a new question earlier and returned without endQuestion.
        break;

      case 'noWay':
        if (res.correct) award(playerId, 1);
        else {
          // give +1 to everyone else
          room.players.forEach(pp => {
            if (pp.id !== playerId) pp.score = (pp.score || 0) + 1;
          });
        }
        break;

      case 'double':
        if (res.correct) award(playerId, 2); // double of default +1 => +2
        break;

      case 'plusOrMinus':
        if (res.correct) award(playerId, 2);
        else { p.score = (p.score || 0) - 1; }
        break;

      case 'doubleOrQuits':
        if (res.correct) { p.score = (p.score || 0) * 2; }
        else { p.score = 0; }
        break;

      case 'quadruple':
        if (res.correct) award(playerId, 4);
        break;

      case 'teleport':
        // teleportation only changes position earlier; scoring default +1
        if (res.correct) award(playerId, 1);
        break;

      default:
        if (res.correct) award(playerId, 1);
    }
  }

  // After applying, emit results with boolean: true if any correct among actives
  const anyCorrect = Array.from(room.pendingAnswers.values()).some(a => a.correct);
  io.to(room.code).emit('results', { players: room.players, correct: anyCorrect });
}

// --- WAITING FOR SELECTION helpers ---
// When an action requires the player to choose another player or an action, we set room.waitingFor = { type:'player'|'action', initiator: socket.id, actionName: ... }
// Then handle 'selectPlayer' and 'chooseAction' events.

io.on('connection', socket => {
  socket.on('create', (name) => {
    const code = genCode();
    const room = {
      code,
      host: socket.id,
      started: false,
      players: [{ id: socket.id, name: name || 'Hôte', pos: 0, score: 0 }],
      currentTurn: -1,
      currentAction: null,
      currentQuestion: null,
      currentCorrection: null,
      activePlayers: [],
      pendingAnswers: new Map(),
      timer: null,
      waitingFor: null
    };
    rooms[code] = room;
    socket.join(code);
    socket.emit('created', code);
    broadcastPlayers(room);
    sendBoard(socket);
  });

  socket.on('join', ({ code, name }) => {
    if (!code) return socket.emit('error', 'Code requis');
    code = code.toUpperCase();
    const room = rooms[code];
    if (!room) return socket.emit('error', 'Salle inexistante');
    if (room.players.length >= MAX_PLAYERS) return socket.emit('error', 'Salle pleine');
    if (room.started) return socket.emit('error', 'Partie déjà commencée');
    const player = { id: socket.id, name: name || 'Joueur', pos: 0, score: 0 };
    room.players.push(player);
    socket.join(code);
    socket.emit('joined', code);
    broadcastPlayers(room);
    sendBoard(socket);
  });

  socket.on('start', (code) => {
    const room = rooms[code];
    if (!room) return;
    if (room.host !== socket.id) return;
    room.started = true;
    io.to(code).emit('gameStart');
    nextTurn(room);
  });

  socket.on('roll', (code) => {
    const room = rooms[code];
    if (!room) return;
    if (!room.activePlayers.includes(socket.id)) return;
    const roll = Math.floor(Math.random() * 6) + 1;
    const player = getPlayer(room, socket.id);
    socket.emit('rolled', { roll, currentPos: player.pos });
    // also emit to room to show dice result globally
    io.to(room.code).emit('rolled', { roll, currentPos: player.pos });
  });

  socket.on('moveTo', ({ code, pos }) => {
    const room = rooms[code];
    if (!room) return;
    if (!room.activePlayers.includes(socket.id)) return;
    const player = getPlayer(room, socket.id);
    if (!player) return;
    // sanitize pos
    const pIndex = Math.max(0, Math.min((BOARD.positions || []).length - 1, pos || 0));
    player.pos = pIndex;
    broadcastPlayers(room);

    // draw action
    const action = ACTIONS[Math.floor(Math.random() * ACTIONS.length)];
    room.currentAction = Object.assign({}, action);
    room.currentQuestion = null;
    room.currentCorrection = null;
    room.pendingAnswers = new Map();

    // If action needs choice before asking question (forYou, callFriend, choice), set waitingFor
    if (action.type === 'forYou' || action.type === 'callFriend') {
      room.waitingFor = { type: 'player', initiator: socket.id, action: action.type };
      io.to(socket.id).emit('requestSelection', { type: 'player', message: 'Choisis un joueur' });
      io.to(room.code).emit('actionDrawn', { action: action.name });
      return;
    }
    if (action.type === 'choice') {
      room.waitingFor = { type: 'action', initiator: socket.id, action: action.type };
      io.to(socket.id).emit('requestSelection', { type: 'action', message: 'Choisis une action (secondLife/double/quadruple/noWay/flash)' });
      io.to(room.code).emit('actionDrawn', { action: action.name });
      return;
    }

    // Teleport action: perform teleport immediately
    if (action.type === 'teleport') {
      const maxIndex = (BOARD.positions && BOARD.positions.length) ? BOARD.positions.length - 1 : Math.max(0, BOARD.totalCases - 1);
      const newPos = Math.floor(Math.random() * (maxIndex + 1));
      player.pos = newPos;
      broadcastPlayers(room);
    }

    // set active players: everybody => all players; battle => initiator + neighbor; default => initiator only
    if (action.type === 'everybody') {
      room.activePlayers = room.players.map(p => p.id);
    } else if (action.type === 'battle') {
      // battle left/right: initiator and neighbor
      const idx = room.players.findIndex(p => p.id === socket.id);
      let opponentIdx;
      if (action.target === 'left') opponentIdx = (idx - 1 + room.players.length) % room.players.length;
      else opponentIdx = (idx + 1) % room.players.length;
      room.activePlayers = [room.players[idx].id, room.players[opponentIdx].id];
    } else {
      room.activePlayers = [socket.id];
    }

    io.to(room.code).emit('actionDrawn', { action: action.name });

    // pick question now
    const theme = THEMES.length ? THEMES[Math.floor(Math.random() * THEMES.length)] : null;
    const q = pickQuestion(theme);
    if (!q) {
      io.to(room.code).emit('error', 'Aucune question disponible');
      return endQuestion(room);
    }
    room.currentQuestion = q.question;
    room.currentCorrection = (q.correction || '').toString().trim().toLowerCase();

    // start timer: flash = 30s else 60s
    const duration = (action.type === 'flash') ? 30 : 60;
    room.timer = setTimeout(() => {
      // mark unanswered as incorrect
      room.activePlayers.forEach(id => {
        if (!room.pendingAnswers.has(id)) room.pendingAnswers.set(id, { correct: false, time: Date.now() });
      });
      io.to(room.code).emit('timeOut', { message: 'Temps écoulé' });
      applyResults(room);
      endQuestion(room);
    }, duration * 1000);

    // deliver question: if everybody => to all; if battle/callFor/forYou => handled below; otherwise: to initiator only
    const payload = { theme: theme || 'Général', question: room.currentQuestion, timer: duration };
    if (action.type === 'everybody') io.to(room.code).emit('question', payload);
    else {
      // send to specific active players
      room.activePlayers.forEach(id => {
        io.to(id).emit('question', payload);
      });
    }
  });

  // selection of player when a choice-required action
  socket.on('selectPlayer', ({ code, targetId }) => {
    const room = rooms[code];
    if (!room || !room.waitingFor) return;
    if (room.waitingFor.type !== 'player') return;
    // Only initiator can select
    if (room.waitingFor.initiator !== socket.id) return;
    const actionType = room.waitingFor.action;
    room.waitingFor = null;

    // set action metadata
    room.currentAction = { type: actionType, name: (actionType === 'forYou') ? 'For you' : 'Call a friend', initiator: socket.id };

    // active players for these actions:
    if (actionType === 'forYou') {
      // chosen player will answer only
      room.activePlayers = [targetId];
      // store initiator in action
      room.currentAction.initiator = socket.id;
    } else if (actionType === 'callFriend') {
      // both initiator and target may answer
      room.activePlayers = [socket.id, targetId];
      room.currentAction.partner = targetId;
    }

    io.to(room.code).emit('actionDrawn', { action: room.currentAction.name });
    // pick and send question
    const q = pickQuestion();
    if (!q) { io.to(room.code).emit('error', 'Aucune question'); return endQuestion(room); }
    room.currentQuestion = q.question;
    room.currentCorrection = (q.correction || '').toString().trim().toLowerCase();

    const duration = (room.currentAction.type === 'flash') ? 30 : 60;
    room.timer = setTimeout(() => {
      room.activePlayers.forEach(id => {
        if (!room.pendingAnswers.has(id)) room.pendingAnswers.set(id, { correct: false, time: Date.now() });
      });
      io.to(room.code).emit('timeOut', { message: 'Temps écoulé' });
      applyResults(room);
      endQuestion(room);
    }, duration * 1000);

    const payload = { theme: 'Général', question: room.currentQuestion, timer: duration };
    room.activePlayers.forEach(id => io.to(id).emit('question', payload));
  });

  // choose an action for "It's your choice"
  socket.on('chooseAction', ({ code, chosenAction }) => {
    const room = rooms[code];
    if (!room || !room.waitingFor || room.waitingFor.type !== 'action') return;
    if (room.waitingFor.initiator !== socket.id) return;

    // Map chosenAction textual values to action types behavior - we accept a small allowed list
    const mapping = {
      'second_life': 'secondLife',
      'double': 'double',
      'quadruple': 'quadruple',
      'no_way': 'noWay',
      'flash': 'flash'
    };
    const mapped = mapping[chosenAction];
    if (!mapped) return socket.emit('error', 'Action non valide');
    room.waitingFor = null;
    room.currentAction = { type: mapped, name: "It's your choice (" + chosenAction + ")", initiator: socket.id };
    // proceed to question for initiator
    room.activePlayers = [socket.id];
    io.to(room.code).emit('actionDrawn', { action: room.currentAction.name });

    const q = pickQuestion();
    if (!q) { io.to(room.code).emit('error', 'Aucune question'); return endQuestion(room); }
    room.currentQuestion = q.question;
    room.currentCorrection = (q.correction || '').toString().trim().toLowerCase();

    const duration = (mapped === 'flash') ? 30 : 60;
    room.timer = setTimeout(() => {
      room.activePlayers.forEach(id => {
        if (!room.pendingAnswers.has(id)) room.pendingAnswers.set(id, { correct: false });
      });
      io.to(room.code).emit('timeOut', { message: 'Temps écoulé' });
      applyResults(room);
      endQuestion(room);
    }, duration * 1000);

    const payload = { theme: 'Général', question: room.currentQuestion, timer: duration };
    io.to(socket.id).emit('question', payload);
  });

  // answer event
  socket.on('answer', ({ code, answer }) => {
    const room = rooms[code];
    if (!room || !room.currentQuestion) return;
    if (!room.activePlayers.includes(socket.id)) return;

    // normalize
    const clean = (answer || '').toString().trim().toLowerCase();
    // compare with currentCorrection
    const correct = clean === (room.currentCorrection || '').toLowerCase();

    // For some actions, special behavior needed:
    const actionType = room.currentAction ? room.currentAction.type : null;

    // For secondLife: if first wrong, give retry: implement by checking pendingAnswers and a retry flag
    if (actionType === 'secondLife') {
      // if player doesn't have any entry: it's first try
      const prev = room.pendingAnswers.get(socket.id);
      if (!prev) {
        if (correct) {
          room.pendingAnswers.set(socket.id, { correct: true, time: Date.now() });
          // award handled below
        } else {
          // give second try: do not call applyResults yet; mark retry state and re-send question with shorter timer
          room.pendingAnswers.set(socket.id, { correct: false, retry: true });
          // send second chance only to that player
          if (room.timer) { clearTimeout(room.timer); room.timer = null; }
          const short = 30;
          room.timer = setTimeout(() => {
            // if still no answer on retry, treat as false
            if (!room.pendingAnswers.get(socket.id).correct) {
              room.pendingAnswers.set(socket.id, { correct: false });
              applyResults(room);
              endQuestion(room);
            }
          }, short * 1000);
          io.to(socket.id).emit('question', { theme: 'Général', question: room.currentQuestion, timer: short });
          return;
        }
      } else {
        // previous existed (retry or something) — accept it as final
        room.pendingAnswers.set(socket.id, { correct, time: Date.now() });
      }
    } else if (actionType === 'everybody') {
      // If anybody answers correctly, award to that person and finish question for all.
      room.pendingAnswers.set(socket.id, { correct, time: Date.now() });
      if (correct) {
        // clear timer and apply immediately
        if (room.timer) { clearTimeout(room.timer); room.timer = null; }
        applyResults(room);
        endQuestion(room);
      } else {
        // just record and wait for others or timeout
      }
      return;
    } else if (actionType === 'callFriend') {
      // record; if any correct among the two, award both; but we need to allow both to answer
      room.pendingAnswers.set(socket.id, { correct, time: Date.now() });
      // If someone is correct, give both points even if other had wrong earlier -> award now
      const [a, b] = room.activePlayers;
      const aRes = room.pendingAnswers.get(a);
      const bRes = room.pendingAnswers.get(b);
      if ((aRes && aRes.correct) || (bRes && bRes.correct)) {
        if (room.timer) { clearTimeout(room.timer); room.timer = null; }
        applyResults(room);
        endQuestion(room);
      } else {
        // wait for the other or timeout
      }
      return;
    } else if (actionType === 'forYou') {
      // only chosen player answers (activePlayers contains only chosen). If correct, both get +1
      room.pendingAnswers.set(socket.id, { correct, time: Date.now() });
      if (room.timer) { clearTimeout(room.timer); room.timer = null; }
      applyResults(room);
      endQuestion(room);
      return;
    } else if (actionType === 'battle') {
      // record and if someone correct, award first correct
      room.pendingAnswers.set(socket.id, { correct, time: Date.now() });
      if (correct) {
        if (room.timer) { clearTimeout(room.timer); room.timer = null; }
        applyResults(room);
        endQuestion(room);
      } else {
        // wait for opponent or timeout
      }
      return;
    } else if (actionType === 'doubleOrQuits') {
      room.pendingAnswers.set(socket.id, { correct, time: Date.now() });
      if (room.timer) { clearTimeout(room.timer); room.timer = null; }
      applyResults(room);
      endQuestion(room);
      return;
    } else {
      // default actions (single-player actions)
      room.pendingAnswers.set(socket.id, { correct, time: Date.now() });
      if (room.timer) { clearTimeout(room.timer); room.timer = null; }
      applyResults(room);
      endQuestion(room);
      return;
    }
  });

  socket.on('selectPlayer', ({ code, targetId }) => {
    // alias to selectPlayer event for client convenience
    socket.emit('selectPlayer', { code, targetId });
  });

  // gracefully handle disconnection
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

server.listen(PORT, () => console.log('Serveur lancé sur le port', PORT));
