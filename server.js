const express = require('express');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static(path.join(__dirname, 'public')));

const MAX_PLAYERS = 6;
const DEFAULT_BOARD_LENGTH = 20;

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

// --- Data / board
let RAW_DATA = [];
let THEMES = ["Général"];
let QUESTIONS_BY_THEME = {};
try {
  const raw = fs.readFileSync(path.join(__dirname,'public','data.json'),'utf8');
  RAW_DATA = JSON.parse(raw);
  QUESTIONS_BY_THEME = RAW_DATA.categories || { "Général": RAW_DATA };
  THEMES = Object.keys(QUESTIONS_BY_THEME);
} catch(e){ console.error("Impossible de charger data.json",e); }

let BOARD_JSON = null;
let BOARD_LENGTH = DEFAULT_BOARD_LENGTH;
try {
  const raw = fs.readFileSync(path.join(__dirname,'public','data','board.json'),'utf8');
  BOARD_JSON = JSON.parse(raw);
  BOARD_LENGTH = BOARD_JSON.totalCases || DEFAULT_BOARD_LENGTH;
} catch(e){ console.error("Impossible de charger board.json",e); }

const BOARD = [];
for(let i=0;i<BOARD_LENGTH;i++){
  BOARD.push({ index:i, type:i%2===0?"action":"theme", name: ACTIONS[i%ACTIONS.length].name });
}

// --- Rooms
const rooms = {};
function generateCode(){ let c; do{ c=Math.random().toString(36).slice(2,6).toUpperCase(); } while(rooms[c]); return c; }
function getPlayer(room,id){ return room.players.find(p=>p.id===id); }
function pickRandomQuestion(theme){
  if(!theme) theme=THEMES[Math.floor(Math.random()*THEMES.length)];
  const pool = QUESTIONS_BY_THEME[theme]||Object.values(QUESTIONS_BY_THEME).flat();
  if(!pool || pool.length===0) return null;
  const raw = pool[Math.floor(Math.random()*pool.length)];
  const questionText = raw.question || raw.expression || '';
  const correctionText = (raw.correction || raw.answer || '').toString().trim().toLowerCase();
  return { raw, question: questionText, correction: correctionText };
}

io.on('connection', socket=>{
  console.log('Client connecté', socket.id);

  socket.on('create', name=>{
    const code = generateCode();
    const room = {
      code,
      host: socket.id,
      started: false,
      currentTurn: -1,
      players:[{id:socket.id,name:name||"Hôte",pos:0,score:0}],
      currentAction:null,
      currentQuestion:null,
      currentCorrection:null,
      activePlayers:[],
      pendingAnswers:new Map(),
      timer:null
    };
    rooms[code]=room;
    socket.join(code);
    socket.emit('created', code);
    io.to(code).emit('players', room.players);
    if(BOARD_JSON) socket.emit('boardData', BOARD_JSON);
  });

  socket.on('join', ({code,name})=>{
    code = code.toUpperCase();
    const room = rooms[code];
    if(!room){ socket.emit('error','Salle inexistante'); return; }
    if(room.players.length>=MAX_PLAYERS){ socket.emit('error','Salle pleine'); return; }
    if(room.started){ socket.emit('error','Partie déjà commencée'); return; }

    const player = {id:socket.id,name:name||"Joueur",pos:0,score:0};
    room.players.push(player);
    socket.join(code);
    socket.emit('joined', code);
    io.to(code).emit('players', room.players);
    if(BOARD_JSON) socket.emit('boardData', BOARD_JSON);
  });

  socket.on('start', code=>{
    const room = rooms[code]; if(!room) return;
    if(room.host!==socket.id) return;
    room.started=true;
    io.to(code).emit('gameStart');
    nextTurn(room);
  });

  function nextTurn(room){
    room.currentTurn++;
    if(!room.players.length) return;
    const idx = room.currentTurn%room.players.length;
    const player = room.players[idx];
    room.activePlayers = [player.id];
    room.pendingAnswers = new Map();
    room.currentAction = null;
    room.currentQuestion = null;
    room.currentCorrection = null;
    if(room.timer){ clearTimeout(room.timer); room.timer=null; }
    io.to(player.id).emit('yourTurn',{playerId:player.id});
    io.to(room.code).emit('players', room.players);
  }

  socket.on('roll', code=>{
    const room = rooms[code]; if(!room) return;
    if(!room.activePlayers.includes(socket.id)) return;
    const roll = Math.floor(Math.random()*6)+1;
    const player = getPlayer(room,socket.id);
    io.to(socket.id).emit('rolled',{roll,currentPos:player.pos});
  });

  socket.on('moveTo', ({code,pos})=>{
    const room = rooms[code]; if(!room) return;
    if(!room.activePlayers.includes(socket.id)) return;

    const player = getPlayer(room,socket.id);
    player.pos = pos;
    io.to(room.code).emit('players', room.players);

    // Tirer action et question
    const action = ACTIONS[Math.floor(Math.random()*ACTIONS.length)];
    room.currentAction = action;

    const theme = THEMES[Math.floor(Math.random()*THEMES.length)];
    const q = pickRandomQuestion(theme);
    if(!q){ io.to(room.code).emit('error','Aucune question disponible'); return endTurn(room); }

    room.currentQuestion = q.question;
    room.currentCorrection = q.correction;
    room.pendingAnswers = new Map();

    room.activePlayers = action.everybody ? room.players.map(p=>p.id) : [socket.id];

    io.to(room.code).emit('actionDrawn',{action:action.name});

    const duration = action.flash||60;
    room.timer = setTimeout(()=>{
      room.activePlayers.forEach(id=>{
        if(!room.pendingAnswers.has(id)) room.pendingAnswers.set(id,{correct:false});
      });
      io.to(room.activePlayers).emit('results', {correct:false, players:room.players});
      endTurn(room);
    },duration*1000);

    // Envoyer question aux bons joueurs
    room.activePlayers.forEach(id=>{
      io.to(id).emit('question',{theme,question:q.question,timer:duration});
    });
  });

  socket.on('answer', ({code,answer})=>{
    const room = rooms[code]; if(!room) return;
    if(!room.currentQuestion || !room.activePlayers.includes(socket.id)) return;

    const clean = (answer||'').trim().toLowerCase();
    const correct = clean===room.currentCorrection;
    room.pendingAnswers.set(socket.id,{correct});

    // Envoyer résultat immédiat au joueur
    io.to(socket.id).emit('results',{correct,players:room.players});

    // Pour actions everybody, for you, call a friend : si au moins un correct, fin du tour
    if(correct || room.pendingAnswers.size>=room.activePlayers.length){
      if(room.timer){ clearTimeout(room.timer); room.timer=null; }
      endTurn(room);
    }
  });

  function endTurn(room){
    io.to(room.code).emit('clearQuestion');
    room.currentQuestion=null;
    room.currentCorrection=null;
    room.currentAction=null;
    room.activePlayers=[];
    room.pendingAnswers = new Map();
    if(room.timer){ clearTimeout(room.timer); room.timer=null; }
    setTimeout(()=>nextTurn(room),2000);
  }

  socket.on('disconnect', ()=>{
    Object.values(rooms).forEach(room=>{
      const idx = room.players.findIndex(p=>p.id===socket.id);
      if(idx!==-1){
        room.players.splice(idx,1);
        io.to(room.code).emit('players', room.players);
        if(room.host===socket.id && room.players.length>0) room.host=room.players[0].id;
        if(room.players.length===0) delete rooms[room.code];
      }
    });
  });
});

server.listen(3000, ()=>console.log('Serveur lancé sur 3000'));
