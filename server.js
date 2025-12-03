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

// ACTIONS
const ACTIONS = [
  { name: "Flash", flash: 30 },
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
  { name: "Quadruple", multiplier: 4 }
];

// LOAD DATA (questions + board)
let RAW_DATA = null;
let QUESTIONS_BY_THEME = {};
let THEMES = [];
try {
  const dataPath = path.join(__dirname, 'public', 'data.json');
  RAW_DATA = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
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
} catch (e) {
  console.error('Impossible de charger public/data.json :', e.message);
  QUESTIONS_BY_THEME = {}; THEMES = [];
}

let BOARD_JSON = null;
try {
  BOARD_JSON = JSON.parse(fs.readFileSync(path.join(__dirname, 'public', 'data', 'board.json'), 'utf8'));
} catch (e) {
  console.error('Impossible de charger board.json :', e.message);
  BOARD_JSON = null;
}

function pickRandomQuestion(theme) {
  if (!theme) theme = THEMES.length ? THEMES[Math.floor(Math.random() * THEMES.length)] : null;
  const pool = (theme && QUESTIONS_BY_THEME[theme]) ? QUESTIONS_BY_THEME[theme] : Object.values(QUESTIONS_BY_THEME).flat();
  if (!pool || pool.length === 0) return null;
  const raw = pool[Math.floor(Math.random() * pool.length)];
  const questionText = raw.question || raw.expression || raw.consigne || '';
  const correctionText = (raw.correction || raw.answer || raw.reponse || '').toString();
  return { raw, question: questionText, correction: correctionText };
}

// ROOMS
const rooms = {};

function generateCode() {
  let code;
  do { code = Math.random().toString(36).substring(2, 6).toUpperCase(); } while (rooms[code]);
  return code;
}
function getPlayer(room, id) { return room.players.find(p => p.id === id); }

io.on('connection', socket => {
  console.log('Client connecté', socket.id);

  // send board on request
  socket.on('requestBoard', () => {
    if (BOARD_JSON) socket.emit('boardData', BOARD_JSON);
  });

  socket.on('create', name => {
    const code = generateCode();
    const room = {
      code,
      host: socket.id,
      started: false,
      currentTurn: -1,
      players: [{ id: socket.id, name: name || 'Hôte', pos: 0, score: 0 }],
      currentAction: null,
      currentQuestion: null,
      currentCorrection: null,
      activePlayers: [],
      pendingAnswers: new Map(),
      secondLifePlayers: new Set(),
      timer: null
    };
    rooms[code] = room;
    socket.join(code);
    socket.emit('created', code);
    io.to(code).emit('players', room.players);
    if (BOARD_JSON) socket.emit('boardData', BOARD_JSON);
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
  });

  socket.on('start', code => {
    const room = rooms[code];
    if (!room || room.host !== socket.id) return;
    room.started = true;
    io.to(code).emit('gameStart');
    nextTurn(room);
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
    if (room.timer) { clearTimeout(room.timer); room.timer = null; }
    io.to(player.id).emit('yourTurn', { playerId: player.id });
    io.to(room.code).emit('players', room.players);
  }

  socket.on('roll', code => {
    const room = rooms[code];
    if (!room) return;
    if (!room.activePlayers || room.activePlayers[0] !== socket.id) return;
    const roll = Math.floor(Math.random() * 6) + 1;
    const player = getPlayer(room, socket.id);
    if (!player) return;
    // send only to roller (and also broadcast if you want everyone to see)
    socket.emit('rolled', { roll, currentPos: player.pos });
    io.to(room.code).emit('rolled', { roll, currentPos: player.pos });
  });

  // MOVE and draw action: IMPORTANT — draw action BEFORE moving so teleport works
  socket.on('moveTo', ({ code, pos, friend }) => {
    const room = rooms[code];
    if (!room || !room.activePlayers.includes(socket.id)) return;
    const player = getPlayer(room, socket.id);
    if (!player) return;

    // draw action first
    const action = ACTIONS[Math.floor(Math.random() * ACTIONS.length)];
    room.currentAction = action;

    // apply teleport immediately if that action
    if (action.teleport) {
      const positionsLen = (BOARD_JSON && Array.isArray(BOARD_JSON.positions)) ? BOARD_JSON.positions.length : Math.max(1, pos + 1);
      const randomPos = Math.floor(Math.random() * positionsLen);
      player.pos = randomPos;
    } else {
      // move to selected pos
      player.pos = (typeof pos === 'number') ? pos : player.pos;
    }

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

    // determine who must answer
    if (action.everybody) {
      room.activePlayers = room.players.map(p => p.id);
    } else if (action.callFriend) {
      // if friend provided in payload, use it; otherwise wait for selectPlayer from client
      if (friend) room.activePlayers = [socket.id, friend];
      else room.activePlayers = [socket.id];
    } else if (action.forYou) {
      // forYou: we need the chosen player (selectPlayer) - until then keep only host as active to show UI
      room.activePlayers = [socket.id];
    } else {
      room.activePlayers = [socket.id];
    }

    // notify action to clients (exact name)
    io.to(room.code).emit('actionDrawn', { action: action.name, timer: action.flash || null });

    // send question to appropriate sockets:
    const duration = action.flash || 60;
    // If action.everybody -> broadcast question to all; if callFriend/forYou with friend provided -> send to those; otherwise send to socket.id (will update later when selection arrives)
    if (action.everybody) {
      io.to(room.code).emit('question', { theme: theme || 'Général', question: room.currentQuestion, players: room.activePlayers, timer: duration });
    } else if (action.callFriend && room.activePlayers.length === 2) {
      room.activePlayers.forEach(id => io.to(id).emit('question', { theme: theme || 'Général', question: room.currentQuestion, players: room.activePlayers, timer: duration }));
    } else if (action.forYou && room.activePlayers.length === 1) {
      // only host for now; when client sends selectPlayer server will re-send to target
      io.to(socket.id).emit('question', { theme: theme || 'Général', question: room.currentQuestion, players: [socket.id], timer: duration });
    } else {
      io.to(socket.id).emit('question', { theme: theme || 'Général', question: room.currentQuestion, players: [socket.id], timer: duration });
    }

    // start timeout
    if (room.timer) { clearTimeout(room.timer); room.timer = null; }
    room.timer = setTimeout(() => {
      // mark unanswered as incorrect
      room.activePlayers.forEach(id => {
        if (!room.pendingAnswers.has(id)) room.pendingAnswers.set(id, { correct: false });
      });
      // apply default results for those marked
      applyActionResults(room, action);
      endTurn(room);
    }, duration * 1000);

    // update players list for everyone
    io.to(room.code).emit('players', room.players);
  });

  // selectPlayer: used by clients to choose friend/forYou target (clicked in scoreboard)
  socket.on('selectPlayer', ({ target, code }) => {
    const room = rooms[code];
    if (!room || !room.currentAction) return;
    const action = room.currentAction;
    if (action.forYou) {
      // set activePlayers to the chosen player only
      room.activePlayers = [target];
      io.to(target).emit('question', { theme: 'Général', question: room.currentQuestion, players: [target], timer: action.flash || 60 });
    } else if (action.callFriend) {
      // set activePlayers to host + chosen friend
      const hostId = room.players.find(p => p.id !== target)?.id; // fallback
      // better: the player who triggered is the one who is not target and was active earlier; keep players that were in room.activePlayers[0] as host
      const host = room.players.find(p => room.activePlayers.includes(p.id));
      const hostIdUsed = host ? host.id : (room.players.length ? room.players[0].id : null);
      room.activePlayers = [hostIdUsed, target];
      // send question to both
      room.activePlayers.forEach(id => io.to(id).emit('question', { theme: 'Général', question: room.currentQuestion, players: room.activePlayers, timer: action.flash || 60 }));
    }
  });

  socket.on('answer', ({ code, answer }) => {
    const room = rooms[code];
    if (!room || !room.currentQuestion || !room.activePlayers.includes(socket.id)) return;

    const clean = (answer || '').toString().trim().toLowerCase();
    const correct = clean === (room.currentCorrection || '').toLowerCase();
    room.pendingAnswers.set(socket.id, { correct, player: getPlayer(room, socket.id).name });

    const action = room.currentAction || {};

    // Handling per action:
    // EVERYBODY: if any correct => that player gets point, question removed for all
    if (action.everybody) {
      if (correct) {
        // give point to the player who answered correctly
        const winner = getPlayer(room, socket.id);
        if (winner) winner.score += (action.multiplier || 1);
        // prepare correctness map
        const correctness = {};
        room.players.forEach(p => correctness[p.id] = false);
        correctness[socket.id] = true;
        // broadcast final results (scoreboard + per-player correctness)
        io.to(room.code).emit('results', { players: room.players.map(p => ({ name: p.name, score: p.score })), correctness });
        // stop timer & end turn
        if (room.timer) { clearTimeout(room.timer); room.timer = null; }
        return endTurn(room);
      } else {
        // wrong answer: only notify the one who answered
        io.to(socket.id).emit('results', { players: room.players.map(p => ({ name: p.name, score: p.score })), correctness: { [socket.id]: false } });
        return; // wait for others
      }
    }

    // CALL A FRIEND: question for two players; if one correct => both get +1, even if the other had answered wrong.
    if (action.callFriend) {
      if (correct) {
        // award both players +1
        const active = room.activePlayers.slice(0, 2);
        active.forEach(id => {
          const p = getPlayer(room, id);
          if (p) p.score += 1;
        });
        const correctness = {};
        room.players.forEach(p => correctness[p.id] = false);
        active.forEach(id => correctness[id] = true);
        io.to(room.code).emit('results', { players: room.players.map(p => ({ name: p.name, score: p.score })), correctness });
        if (room.timer) { clearTimeout(room.timer); room.timer = null; }
        return endTurn(room);
      } else {
        // wrong: remove question only for that player (mark as false) and continue waiting for the other
        room.pendingAnswers.set(socket.id, { correct: false });
        io.to(socket.id).emit('results', { players: room.players.map(p => ({ name: p.name, score: p.score })), correctness: { [socket.id]: false } });
        // if both answered and both false -> end turn
        if (room.pendingAnswers.size >= room.activePlayers.length) {
          // no-one succeeded
          const correctness = {};
          room.players.forEach(p => correctness[p.id] = false);
          io.to(room.code).emit('results', { players: room.players.map(p => ({ name: p.name, score: p.score })), correctness });
          if (room.timer) { clearTimeout(room.timer); room.timer = null; }
          return endTurn(room);
        }
        return;
      }
    }

    // FOR YOU: question only to chosen player; if correct both get +1; if wrong, only the chosen player's question disappears
    if (action.forYou) {
      if (correct) {
        // give both: the active (host who chose) and the chosen player
        const hostId = room.players.find(p => p.id !== socket.id && room.currentTurn % room.players.length >= 0) ? room.players[room.currentTurn % room.players.length].id : null;
        // fallback: consider first player in players array who is not socket.id
        const host = room.players.find(p => p.id !== socket.id);
        const hostUsedId = host ? host.id : null;
        if (hostUsedId) {
          const hostP = getPlayer(room, hostUsedId);
          if (hostP) hostP.score += 1;
        }
        const chosenP = getPlayer(room, socket.id);
        if (chosenP) chosenP.score += 1;

        const correctness = {};
        room.players.forEach(p => correctness[p.id] = false);
        correctness[socket.id] = true;
        if (hostUsedId) correctness[hostUsedId] = true;

        io.to(room.code).emit('results', { players: room.players.map(p => ({ name: p.name, score: p.score })), correctness });
        if (room.timer) { clearTimeout(room.timer); room.timer = null; }
        return endTurn(room);
      } else {
        // wrong: remove question for chosen only (notify him)
        io.to(socket.id).emit('results', { players: room.players.map(p => ({ name: p.name, score: p.score })), correctness: { [socket.id]: false } });
        // end turn after wrong (question disappears)
        if (room.timer) { clearTimeout(room.timer); room.timer = null; }
        return endTurn(room);
      }
    }

    // +1 ou -1 : +2 points if good, -1 if bad
    if (action.plusOrMinus) {
      const p = getPlayer(room, socket.id);
      if (correct) {
        if (p) p.score += 2;
      } else {
        if (p) p.score = Math.max(0, p.score - 1);
      }
      const correctness = {}; room.players.forEach(pl => correctness[pl.id] = false); correctness[socket.id] = correct;
      io.to(room.code).emit('results', { players: room.players.map(p => ({ name: p.name, score: p.score })), correctness });
      if (room.timer) { clearTimeout(room.timer); room.timer = null; }
      return endTurn(room);
    }

    // normal single-player actions (Double, Quadruple, No way, etc.)
    // Double: multiplier property handled here
    if (correct) {
      const p = getPlayer(room, socket.id);
      if (p) p.score += action.multiplier || 1;
    } else {
      if (action.noWay) {
        // offer 1 point to others
        room.players.forEach(pl => { if (pl.id !== socket.id) pl.score += 1; });
      }
      // if plusOrMinus handled above
    }

    // build correctness map where only the answering player has the boolean
    const correctness = {};
    room.players.forEach(pl => correctness[pl.id] = false);
    correctness[socket.id] = correct;
    io.to(room.code).emit('results', { players: room.players.map(p => ({ name: p.name, score: p.score })), correctness });

    if (room.timer) { clearTimeout(room.timer); room.timer = null; }
    return endTurn(room);
  });

  // helper to apply default results when timeout or generic resolution (not used for special action flows)
  function applyActionResults(room, action) {
    if (!action) action = {};
    room.activePlayers.forEach(id => {
      const res = room.pendingAnswers.get(id) || { correct: false };
      const player = getPlayer(room, id);
      if (!player) return;
      if (res.correct) {
        player.score += action.multiplier || 1;
      } else if (action.noWay) {
        room.players.forEach(p => { if (p.id !== id) p.score += 1; });
      }
    });
    io.to(room.code).emit('players', room.players);
  }

  function endTurn(room) {
    io.to(room.code).emit('actionClear');
    room.currentQuestion = null;
    room.currentCorrection = null;
    room.currentAction = null;
    room.activePlayers = [];
    room.pendingAnswers = new Map();
    if (room.timer) { clearTimeout(room.timer); room.timer = null; }
    setTimeout(() => nextTurn(room), 1200);
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
    console.log('Client déconnecté', socket.id);
  });

});

const PORT = 3000;
server.listen(PORT, '0.0.0.0', () => console.log('Serveur lancé sur le port', PORT));
