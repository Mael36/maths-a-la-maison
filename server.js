const express = require('express');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static(path.join(__dirname, 'public')));

// CONFIG
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

// --- Chargement data.json
let RAW_DATA = {};
let THEMES = [];
let QUESTIONS_BY_THEME = {};
try {
  RAW_DATA = JSON.parse(fs.readFileSync(path.join(__dirname, 'public', 'data.json'), 'utf8'));
  if (RAW_DATA.categories) {
    QUESTIONS_BY_THEME = RAW_DATA.categories;
    THEMES = Object.keys(QUESTIONS_BY_THEME);
  } else QUESTIONS_BY_THEME = { "Général": RAW_DATA };
} catch (e) { QUESTIONS_BY_THEME = { "Général": [] }; THEMES = ["Général"]; }

// --- Chargement board.json
let BOARD_JSON = { positions: [] };
try {
  BOARD_JSON = JSON.parse(fs.readFileSync(path.join(__dirname, 'public/data/board.json'), 'utf8'));
} catch (e) { BOARD_JSON.positions = Array.from({ length: 32 }, (_,i)=>({ x: i*3, y: i*3 })); }

// --- Rooms
const rooms = {};

function generateCode() { let c; do { c = Math.random().toString(36).substr(2,4).toUpperCase(); } while (rooms[c]); return c; }
function getPlayer(room, id) { return room.players.find(p=>p.id===id); }
function pickRandomQuestion(theme) {
  const pool = (theme && QUESTIONS_BY_THEME[theme]) ? QUESTIONS_BY_THEME[theme] : Object.values(QUESTIONS_BY_THEME).flat();
  if (!pool.length) return null;
  const raw = pool[Math.floor(Math.random()*pool.length)];
  return { raw, question: raw.question||raw.expression||'', correction: (raw.correction||raw.answer||'').toString() };
}

// --- Socket.io
io.on('connection', socket => {
  console.log('Connecté:', socket.id);

  socket.on('create', name => {
    const code = generateCode();
    const room = {
      code, host: socket.id, started: false, currentTurn: -1,
      players: [{ id: socket.id, name: name||'Hôte', pos:0, score:0 }],
      currentAction:null, currentQuestion:null, currentCorrection:null,
      activePlayers:[], pendingAnswers:new Map(), timer:null,
      awaitingTeleport:null, awaitingForYou:null
    };
    rooms[code] = room;
    socket.join(code);
    socket.emit('created', code);
    io.to(code).emit('players', room.players);
    socket.emit('boardData', BOARD_JSON);
  });

  socket.on('join', ({code,name})=>{
    code = (code||'').toUpperCase();
    const room = rooms[code];
    if(!room){ socket.emit('error','Salle inexistante'); return; }
    if(room.players.length>=MAX_PLAYERS){ socket.emit('error','Salle pleine'); return; }
    if(room.started){ socket.emit('error','Partie déjà commencée'); return; }
    const player={id:socket.id,name:name||'Joueur',pos:0,score:0};
    room.players.push(player);
    socket.join(code);
    socket.emit('joined', code);
    io.to(code).emit('players', room.players);
    socket.emit('boardData', BOARD_JSON);
  });

  socket.on('start', code=>{
    const room = rooms[code]; if(!room||room.host!==socket.id) return;
    room.started=true; io.to(code).emit('gameStart'); nextTurn(room);
  });

  function nextTurn(room){
    room.currentTurn++;
    if(!room.players.length) return;
    const idx = room.currentT
