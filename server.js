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

const MAX_PLAYERS = 6;

// ACTIONS (noms EXACTS attendus côté client)
const ACTIONS = [
  { name: "Flash", flash: 30 },                    // chrono 30s
  { name: "Battle on left", battleLeft: true },
  { name: "Battle on right", battleRight: true },
  { name: "Call a friend", callFriend: true },
  { name: "For you", forYou: true },
  { name: "Second life", secondLife: true },       // 2 essais si 1er raté
  { name: "No way", noWay: true },
  { name: "Double", multiplier: 2 },
  { name: "Téléportation", teleport: true },
  { name: "+1 ou -1", plusOrMinus: true },
  { name: "Everybody", everybody: true },
  { name: "Double or quits", doubleOrQuits: true },// score *2 if success, 0 if fail
  { name: "It's your choice", choice: true },     // player chooses an action
  { name: "Quadruple", multiplier: 4 }
];

// Load questions data
let RAW_DATA = null;
let QUESTIONS_BY_THEME = {};
let THEMES = [];
try {
  const raw = fs.readFileSync(path.join(__dirname, 'public', 'data.json'), 'utf8');
  RAW_DATA = JSON.parse(raw);
  if (RAW_DATA.categories && typeof RAW_DATA.categories === 'object') {
    QUESTIONS_BY_THEME = RAW_DATA.categories;
    THEMES = Object.keys(QUESTIONS_BY_THEME);
  } else if (Array.isArray(RAW_DATA)) {
    QUESTIONS_BY_THEME = { "Général": RAW_DATA };
    THEMES = ["Général"];
  } else {
    QUESTIONS_BY_THEME = {};
    THEMES = [];
  }
  console.log('Questions chargées, thèmes:', THEMES.length);
} catch (e) {
  console.error('Impossible de charger public/data.json :', e.message);
  QUESTIONS_BY_THEME = {};
  THEMES = [];
}

// Load board
let BOARD_JSON = null;
try {
  BOARD_JSON = JSON.parse(fs.readFileSync(path.join(__dirname, 'public', 'data', 'board.json'), 'utf8'));
  console.log('Board chargé (totalCases =', BOARD_JSON.totalCases, ')');
} catch (e) {
  console.error('Impossible de charger public/data/board.json :', e.message);
  BOARD_JSON = null;
}

function pickRandomQuestion(theme) {
  if (!theme) theme = THEMES.length ? THEMES[Math.floor(Math.random() * THEMES.length)] : null;
  const pool = (theme && QUESTIONS_BY_THEME[theme]) ? QUESTIONS_BY_THEME[theme] : Object.values(QUESTIONS_BY_THEME).flat();
  if (!pool || pool.length === 0) return null;
  const raw = pool[Math.floor(Math.random() * pool.length)];
  const questionText = raw.question || raw.expression || raw.consigne || raw.questionText || '';
  const correctionText = (raw.correction || raw.answer || raw.reponse || '').toString();
  return { raw, question: questionText, correction: correctionText };
}

// Rooms store
const rooms = {};

function generateCode() {
  let code;
  do { code = Math.random().toString(36).substring(2, 6).toUpperCase(); } while (rooms[code]);
  return code;
}
function getPlayer(room, id) { return room.players.find(p => p.id === id); }
function playerIndex(room, id) { return room.players.findIndex(p => p.id === id); }
function leftPlayerId(room, id) {
  const idx = playerIndex(room, id);
  if (idx === -1) return null;
  const leftIdx = (idx - 1 + room.players.length) % room.players.length;
  return room.players[leftIdx].id;
}
function rightPlayerId(room, id) {
  const idx = playerIndex(room, id);
  if (idx === -1) return null;
  const rightIdx = (idx + 1) % room.players.length;
  return room.players[rightIdx].id;
}

io.on('connection', socket => {
  console.log('Client connecté', socket.id);

  // Provide board on demand
  socket.on('requestBoard', () => {
    if (BOARD_JSON) socket.emit('boardData', BOARD_JSON);
  });

  socket.on('create', (name) => {
    const code = generateCode();
    const room = {
      code,
      host: socket.id,
      started: false,
      currentTurn: -1,
      players: [{ id: socket.id, name: name || 'Hôte', pos: 0, score: 0 }],
      currentAction: null,         // object from ACTIONS
      currentQuestion: null,       // string
      currentCorrection: null,     // normalized string
      activePlayers: [],           // ids which should answer right now
      pendingAnswers: new Map(),   // id -> { correct: bool }
      secondLifePending: new Set(),// ids that are in second-life second try
      timer: null                  // timeout handle
    };
    rooms[code] = room;
    socket.join(code);
    socket.emit('created', code);
    io.to(code).emit('players', room.players);
    if (BOARD_JSON) socket.emit('boardData', BOARD_JSON);
    console.log('Salle créée', code, 'par', socket.id);
  });

  socket.on('join', ({ code, name }) => {
    code = (code || '').toUpperCase();
    const room = rooms[code];
    if (!room) { socket.emit('error', 'Salle inexistante'); return; }
    if (room.players.length >= MAX_PLAYERS) { socket.emit('error', 'Salle pleine'); return; }
    if (room.started) { socket.emit('error', 'Partie déjà commencée'); return; }
    const player = { id: socket.id, name: name || 'Joueur', pos: 0, score: 0 };
    room.players.push(player);
    socket.join(code);
    socket.emit('joined', code);
    io.to(code).emit('players', room.players);
    if (BOARD_JSON) socket.emit('boardData', BOARD_JSON);
    console.log('Client', socket.id, 'a rejoint', code);
  });

  socket.on('start', (code) => {
    const room = rooms[code];
    if (!room) return;
    if (room.host !== socket.id) return;
    room.started = true;
    io.to(code).emit('gameStart');
    nextTurn(room);
    console.log('Partie démarrée', code);
  });

  function nextTurn(room) {
    room.currentTurn++;
    if (!room.players || room.players.length === 0) return;
    const idx = room.currentTurn % room.players.length;
    const player = room.players[idx];
    room.activePlayers = [player.id];
    room.pendingAnswers = new Map();
    room.currentAction = null;
    room.currentQuestion = null;
    room.currentCorrection = null;
    room.secondLifePending = new Set();
    if (room.timer) { clearTimeout(room.timer); room.timer = null; }
    io.to(player.id).emit('yourTurn', { playerId: player.id });
    io.to(room.code).emit('players', room.players);
    io.to(room.code).emit('activePlayers', room.activePlayers);
    console.log('Tour suivant dans', room.code, '->', player.name);
  }

  socket.on('roll', (code) => {
    const room = rooms[code];
    if (!room) return;
    if (!room.activePlayers || room.activePlayers[0] !== socket.id) return;
    const roll = Math.floor(Math.random() * 6) + 1;
    const player = getPlayer(room, socket.id);
    if (!player) return;
    // send rolled to roller and broadcast optionally
    socket.emit('rolled', { roll, currentPos: player.pos });
    io.to(room.code).emit('rolled', { roll, currentPos: player.pos });
    console.log('roll', roll, 'par', player.name, 'dans', code);
  });

  // client may also emit choiceAction for "It's your choice"
  socket.on('choiceAction', ({ code, action }) => {
    const room = rooms[code];
    if (!room) return;
    // validate name
    const act = ACTIONS.find(a => a.name === action);
    if (!act) return;
    // set currentAction in room so when moving we consider it
    room.currentAction = act;
    socket.emit('choiceConfirmed', { action: act.name });
    console.log('ChoiceAction', action, 'in', code);
  });

  // Selecting a player (for Call a friend / For you)
  socket.on('selectPlayer', ({ code, target }) => {
    const room = rooms[code];
    if (!room || !room.currentAction) return;
    const action = room.currentAction;
    // ensure target exists
    const targetPlayer = room.players.find(p => p.id === target);
    if (!targetPlayer) return;

    if (action.forYou) {
      // activePlayers becomes chosen player only
      room.activePlayers = [target];
      // send question to target
      io.to(target).emit('question', { theme: 'Général', question: room.currentQuestion, players: room.activePlayers, timer: action.flash || 60 });
      io.to(room.code).emit('activePlayers', room.activePlayers);
      console.log('For you: target', targetPlayer.name);
    } else if (action.callFriend) {
      // activePlayers becomes [host-triggering-player, target]
      const initiator = room.players.find(p => room.activePlayers.includes(p.id));
      const initiatorId = initiator ? initiator.id : room.activePlayers[0];
      room.activePlayers = [initiatorId, target];
      // send question to both
      room.activePlayers.forEach(id => io.to(id).emit('question', { theme: 'Général', question: room.currentQuestion, players: room.activePlayers, timer: action.flash || 60 }));
      io.to(room.code).emit('activePlayers', room.activePlayers);
      console.log('Call a friend between', initiator ? initiator.name : 'unknown', 'and', targetPlayer.name);
    }
  });

  // moveTo: draw action BEFORE moving to allow teleport
  socket.on('moveTo', ({ code, pos, friend }) => {
    const room = rooms[code];
    if (!room || !room.activePlayers.includes(socket.id)) return;
    const player = getPlayer(room, socket.id);
    if (!player) return;

    // If currentAction already set (choiceAction), use it; otherwise draw one now
    let action = room.currentAction;
    if (!action) {
      action = ACTIONS[Math.floor(Math.random() * ACTIONS.length)];
      room.currentAction = action;
    }

    // apply teleport if needed
    if (action.teleport) {
      const positionsLen = (BOARD_JSON && Array.isArray(BOARD_JSON.positions)) ? BOARD_JSON.positions.length : Math.max(1, pos + 1 || 1);
      const randomPos = Math.floor(Math.random() * positionsLen);
      player.pos = randomPos;
      io.to(room.code).emit('teleport', { playerId: player.id, pos: player.pos });
      console.log('Téléportation de', player.name, '->', player.pos);
    } else {
      // valid pos within board positions if provided
      if (typeof pos === 'number') {
        const max = (BOARD_JSON && Array.isArray(BOARD_JSON.positions)) ? BOARD_JSON.positions.length - 1 : pos;
        player.pos = Math.max(0, Math.min(pos, max));
      }
    }

    // broadcast players update
    io.to(room.code).emit('players', room.players);

    // pick question
    const theme = THEMES.length ? THEMES[Math.floor(Math.random() * THEMES.length)] : null;
    const q = pickRandomQuestion(theme);
    if (!q) {
      io.to(room.code).emit('error', 'Aucune question disponible');
      return endTurn(room);
    }

    room.currentQuestion = q.question;
    room.currentCorrection = (q.correction || '').toString().trim().toLowerCase();
    room.pendingAnswers = new Map();
    room.secondLifePending = new Set();

    // determine activePlayers based on action
    if (action.everybody) {
      room.activePlayers = room.players.map(p => p.id);
    } else if (action.callFriend) {
      if (friend && room.players.find(p => p.id === friend)) {
        // friend passed via payload
        room.activePlayers = [socket.id, friend];
      } else {
        // wait for selectPlayer event; keep initiator as active for UI
        room.activePlayers = [socket.id];
      }
    } else if (action.forYou) {
      // wait for selectPlayer to set final target; keep initiator visible
      room.activePlayers = [socket.id];
    } else {
      room.activePlayers = [socket.id];
    }

    // notify action name (exact) and who must answer
    io.to(room.code).emit('actionDrawn', { action: action.name, timer: action.flash || 60 });
    io.to(room.code).emit('players', room.players);
    io.to(room.code).emit('activePlayers', room.activePlayers);

    // send question to relevant clients (if forYou/callFriend selection not done, we send to initiator only)
    const duration = action.flash || 60;
    if (action.everybody) {
      io.to(room.code).emit('question', { theme: theme || 'Général', question: room.currentQuestion, players: room.activePlayers, timer: duration });
    } else if (action.callFriend && room.activePlayers.length === 2) {
      room.activePlayers.forEach(id => io.to(id).emit('question', { theme: theme || 'Général', question: room.currentQuestion, players: room.activePlayers, timer: duration }));
    } else if (action.forYou && room.activePlayers.length === 1 && room.activePlayers[0] === socket.id) {
      // only initiator sees a placeholder/question until selection: send placeholder to initiator
      io.to(socket.id).emit('question', { theme: theme || 'Général', question: room.currentQuestion, players: room.activePlayers, timer: duration });
    } else {
      io.to(room.activePlayers[0]).emit('question', { theme: theme || 'Général', question: room.currentQuestion, players: room.activePlayers, timer: duration });
    }

    // start timeout: when expires, treat non-responders as incorrect (with action-specific behavior)
    if (room.timer) { clearTimeout(room.timer); room.timer = null; }
    room.timer = setTimeout(() => {
      // For every active player who hasn't answered, mark incorrect
      room.activePlayers.forEach(id => {
        if (!room.pendingAnswers.has(id)) room.pendingAnswers.set(id, { correct: false, timeout: true });
      });
      // handle timeout results per action
      handleResolution(room);
    }, duration * 1000);
  });

  // answer handler
  socket.on('answer', ({ code, answer }) => {
    const room = rooms[code];
    if (!room || !room.currentQuestion) return;
    if (!room.activePlayers.includes(socket.id)) return;

    const clean = (answer || '').toString().trim().toLowerCase();
    const correct = clean === (room.currentCorrection || '').toLowerCase();
    room.pendingAnswers.set(socket.id, { correct });

    // If action is Everybody: first correct ends the question for all
    // For other multi flows we branch in handleResolution
    handleResolution(room, socket.id);
  });

  // timeout explicit from client (if client-side timer used), treat same as server
  socket.on('timeout', ({ code }) => {
    const room = rooms[code];
    if (!room) return;
    // mark non-responders incorrect
    room.activePlayers.forEach(id => {
      if (!room.pendingAnswers.has(id)) room.pendingAnswers.set(id, { correct: false, timeout: true });
    });
    handleResolution(room);
  });

  socket.on('disconnect', () => {
    // remove from rooms
    Object.values(rooms).forEach(room => {
      const idx = room.players.findIndex(p => p.id === socket.id);
      if (idx !== -1) {
        const name = room.players[idx].name;
        room.players.splice(idx, 1);
        io.to(room.code).emit('players', room.players);
        if (room.host === socket.id && room.players.length > 0) room.host = room.players[0].id;
        if (room.players.length === 0) delete rooms[room.code];
        console.log('Client déconnecté et retiré de la room', name);
      }
    });
    console.log('Client déconnecté', socket.id);
  });

  // Main resolution function: decides what happens after answers/timeouts
  function handleResolution(room, recentResponderId) {
    if (!room || !room.currentAction) {
      // fallback: clear and end turn
      if (room) { clearAndEnd(room); }
      return;
    }
    const action = room.currentAction;
    // Helper: map correctness
    const correctness = {};
    room.players.forEach(p => correctness[p.id] = false);
    // Provide players snapshot for results events
    const playersSnapshot = room.players.map(p => ({ name: p.name, score: p.score }));

    // --- EVERYBODY ---
    if (action.everybody) {
      // If any responder is correct -> award that one +1 and end question for all
      const correctResponder = Array.from(room.pendingAnswers.entries()).find(([id, res]) => res.correct);
      if (correctResponder) {
        const winnerId = correctResponder[0];
        const winner = getPlayer(room, winnerId);
        if (winner) winner.score += 1;
        // set correctness map
        room.players.forEach(p => correctness[p.id] = (p.id === winnerId));
        io.to(room.code).emit('results', { players: playersSnapshot, correctness });
        clearAndEnd(room);
        return;
      }
      // else: people who answered incorrectly get local 'results', but question stays for those who haven't answered?
      // As per spec: if wrong, question disappears for that player; remains for others.
      // So if everyone answered incorrectly or timeout for all, we end.
      const allActiveAnswered = room.activePlayers.every(id => room.pendingAnswers.has(id));
      if (allActiveAnswered) {
        // no one succeeded
        room.players.forEach(p => correctness[p.id] = false);
        io.to(room.code).emit('results', { players: playersSnapshot, correctness });
        clearAndEnd(room);
        return;
      }
      // else wait for others (do nothing)
      // but notify the one who answered wrong
      if (recentResponderId) {
        const res = room.pendingAnswers.get(recentResponderId);
        if (res && !res.correct) {
          const partial = {}; partial[recentResponderId] = false;
          io.to(recentResponderId).emit('results', { players: playersSnapshot, correctness: partial });
        }
      }
      return;
    }

    // --- CALL A FRIEND ---
    if (action.callFriend) {
      // activePlayers should contain the two players when ready
      if (room.activePlayers.length < 2) {
        // still waiting for friend selection -> do nothing
        return;
      }
      // If any of the two is correct => both get +1 (even if the other answered wrong)
      const pairIds = room.activePlayers.slice(0, 2);
      const anyCorrect = pairIds.some(id => room.pendingAnswers.get(id)?.correct);
      if (anyCorrect) {
        pairIds.forEach(id => {
          const p = getPlayer(room, id);
          if (p) p.score += 1;
          correctness[id] = true;
        });
        io.to(room.code).emit('results', { players: playersSnapshot, correctness });
        clearAndEnd(room);
        return;
      }
      // If both answered and none correct -> end
      const bothAnswered = pairIds.every(id => room.pendingAnswers.has(id));
      if (bothAnswered) {
        pairIds.forEach(id => correctness[id] = false);
        io.to(room.code).emit('results', { players: playersSnapshot, correctness });
        clearAndEnd(room);
        return;
      }
      // If only one answered wrong => inform him and keep question for other
      if (recentResponderId && room.pendingAnswers.get(recentResponderId) && !room.pendingAnswers.get(recentResponderId).correct) {
        const partial = {}; partial[recentResponderId] = false;
        io.to(recentResponderId).emit('results', { players: playersSnapshot, correctness: partial });
      }
      return;
    }

    // --- FOR YOU ---
    if (action.forYou) {
      // activePlayers should contain only the chosen target
      if (room.activePlayers.length !== 1 || (room.activePlayers[0] === room.players[room.currentTurn % room.players.length].id && room.activePlayers[0] === room.players[room.currentTurn % room.players.length].id && room.activePlayers[0] === room.players.find(p=>p.id===room.activePlayers[0])?.id && room.activePlayers[0] === room.players[room.currentTurn % room.players.length].id)) {
        // proceed only if a chosen target exists (activePlayers[0] is the chosen)
      }
      const targetId = room.activePlayers[0];
      const res = room.pendingAnswers.get(targetId);
      if (res && res.correct) {
        // award both: the chosen and the original player (initiator)
        // initiator is the player who triggered the action: we consider it the player of currentTurn
        const initiator = room.players[(room.currentTurn) % room.players.length];
        if (initiator) initiator.score += 1;
        const chosen = getPlayer(room, targetId);
        if (chosen) chosen.score += 1;
        correctness[targetId] = true;
        if (initiator) correctness[initiator.id] = true;
        io.to(room.code).emit('results', { players: playersSnapshot, correctness });
        clearAndEnd(room);
        return;
      } else if (res && !res.correct) {
        // wrong: remove question for chosen only and end turn
        correctness[targetId] = false;
        io.to(room.code).emit('results', { players: playersSnapshot, correctness });
        clearAndEnd(room);
        return;
      } else {
        // no answer yet: wait
        return;
      }
    }

    // --- BATTLE (left / right) ---
    if (action.battleLeft || action.battleRight) {
      // battle between initiator and left/right neighbor
      const initiatorId = room.players[room.currentTurn % room.players.length].id;
      const opponentId = action.battleLeft ? leftPlayerId(room, initiatorId) : rightPlayerId(room, initiatorId);
      const contestants = [initiatorId, opponentId].filter(Boolean);
      // check if any of contestants answered correct
      const correctOne = contestants.find(id => room.pendingAnswers.get(id)?.correct);
      if (correctOne) {
        // award +1 to the correctOne
        const p = getPlayer(room, correctOne);
        if (p) p.score += 1;
        contestants.forEach(id => correctness[id] = (id === correctOne));
        io.to(room.code).emit('results', { players: playersSnapshot, correctness });
        clearAndEnd(room);
        return;
      }
      // if both answered and none correct => end
      const bothAnswered = contestants.every(id => room.pendingAnswers.has(id));
      if (bothAnswered) {
        contestants.forEach(id => correctness[id] = false);
        io.to(room.code).emit('results', { players: playersSnapshot, correctness });
        clearAndEnd(room);
        return;
      }
      // if one answered wrong, notify him only
      if (recentResponderId && room.pendingAnswers.get(recentResponderId) && !room.pendingAnswers.get(recentResponderId).correct) {
        const partial = {}; partial[recentResponderId] = false;
        io.to(recentResponderId).emit('results', { players: playersSnapshot, correctness: partial });
      }
      return;
    }

    // --- CALLS that affect initiator only or single-player flows ---
    // plusOrMinus, double, double or quits, quadruple, noWay, secondLife, normal single-player flows

    // If the action is plusOrMinus
    if (action.plusOrMinus) {
      // handle responder if present
      const responderId = recentResponderId || room.activePlayers[0];
      const res = room.pendingAnswers.get(responderId);
      const player = getPlayer(room, responderId);
      if (res) {
        if (res.correct) {
          if (player) player.score += 2;
          correctness[responderId] = true;
        } else {
          if (player) player.score = Math.max(0, player.score - 1);
          correctness[responderId] = false;
        }
        io.to(room.code).emit('results', { players: playersSnapshot, correctness });
        clearAndEnd(room);
      }
      return;
    }

    // Double or Quits
    if (action.doubleOrQuits) {
      // find responder (only actor)
      const responderId = recentResponderId || room.activePlayers[0];
      const res = room.pendingAnswers.get(responderId);
      const p = getPlayer(room, responderId);
      if (res) {
        if (res.correct) {
          // multiply TOTAL score by 2
          if (p) p.score = p.score * 2;
          correctness[responderId] = true;
        } else {
          if (p) p.score = 0;
          correctness[responderId] = false;
        }
        io.to(room.code).emit('results', { players: playersSnapshot, correctness });
        clearAndEnd(room);
      }
      return;
    }

    // Double (multiplier 2 but only add 2 points on success)
    if (action.multiplier && action.multiplier === 2 && !action.doubleOrQuits && !action.quadruple) {
      // single-player
      const responderId = recentResponderId || room.activePlayers[0];
      const res = room.pendingAnswers.get(responderId);
      const p = getPlayer(room, responderId);
      if (res) {
        if (res.correct) {
          if (p) p.score += (action.multiplier || 1);
          correctness[responderId] = true;
        } else {
          correctness[responderId] = false;
        }
        io.to(room.code).emit('results', { players: playersSnapshot, correctness });
        clearAndEnd(room);
      }
      return;
    }

    // Quadruple (multiplier 4)
    if (action.multiplier && action.multiplier === 4) {
      const responderId = recentResponderId || room.activePlayers[0];
      const res = room.pendingAnswers.get(responderId);
      const p = getPlayer(room, responderId);
      if (res) {
        if (res.correct) {
          if (p) p.score += 4;
          correctness[responderId] = true;
        } else {
          correctness[responderId] = false;
        }
        io.to(room.code).emit('results', { players: playersSnapshot, correctness });
        clearAndEnd(room);
      }
      return;
    }

    // No way
    if (action.noWay) {
      const responderId = recentResponderId || room.activePlayers[0];
      const res = room.pendingAnswers.get(responderId);
      if (res) {
        if (res.correct) {
          const p = getPlayer(room, responderId);
          if (p) p.score += 1;
          correctness[responderId] = true;
        } else {
          // give +1 to each other player
          room.players.forEach(pl => {
            if (pl.id !== responderId) {
              pl.score += 1;
              correctness[pl.id] = true; // mark others as benefiting? we mark only the others true
            } else {
              correctness[pl.id] = false;
            }
          });
        }
        io.to(room.code).emit('results', { players: playersSnapshot, correctness });
        clearAndEnd(room);
      }
      return;
    }

    // Second life: if first attempt wrong -> allow second immediate attempt
    if (action.secondLife) {
      const responderId = recentResponderId || room.activePlayers[0];
      const res = room.pendingAnswers.get(responderId);
      const p = getPlayer(room, responderId);
      if (!res) return; // wait
      if (res.correct) {
        if (p) p.score += 1;
        correctness[responderId] = true;
        io.to(room.code).emit('results', { players: playersSnapshot, correctness });
        clearAndEnd(room);
        return;
      } else {
        // if not yet in secondLifePending -> give second try
        if (!room.secondLifePending.has(responderId)) {
          room.secondLifePending.add(responderId);
          // remove the previous incorrect marker so client can attempt again
          room.pendingAnswers.delete(responderId);
          // send question again to that player (immediate second attempt)
          io.to(responderId).emit('question', { theme: 'Général', question: room.currentQuestion, players: [responderId], timer: action.flash || 60 });
          // leave turn active for that player (do not end)
          return;
        } else {
          // second attempt also failed => end, no points
          correctness[responderId] = false;
          io.to(room.code).emit('results', { players: playersSnapshot, correctness });
          clearAndEnd(room);
          return;
        }
      }
    }

    // Default single-player normal question
    {
      const responderId = recentResponderId || room.activePlayers[0];
      const res = room.pendingAnswers.get(responderId);
      const p = getPlayer(room, responderId);
      if (!res) return; // wait
      if (res.correct) {
        if (p) p.score += 1;
        correctness[responderId] = true;
      } else {
        correctness[responderId] = false;
      }
      io.to(room.code).emit('results', { players: playersSnapshot, correctness });
      clearAndEnd(room);
    }
  }

  // Helper to clear question & timer and advance turn
  function clearAndEnd(room) {
    try {
      io.to(room.code).emit('clearQuestion');
      room.currentQuestion = null;
      room.currentCorrection = null;
      room.currentAction = null;
      room.activePlayers = [];
      room.pendingAnswers = new Map();
      room.secondLifePending = new Set();
      if (room.timer) { clearTimeout(room.timer); room.timer = null; }
      // emit players updated
      io.to(room.code).emit('players', room.players);
      setTimeout(() => nextTurn(room), 1200);
    } catch (e) {
      console.error('Erreur clearAndEnd', e);
    }
  }

  // Expose some debug endpoint via socket if needed
  socket.on('debugRooms', () => {
    socket.emit('debug', { rooms: Object.keys(rooms) });
  });
});

const PORT = 3000;
server.listen(PORT, '0.0.0.0', () => console.log('Serveur lancé sur le port', PORT));

