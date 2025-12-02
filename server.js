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
    const idx = room.currentTurn%room.players.length;
    const player = room.players[idx];
    room.activePlayers=[player.id]; room.pendingAnswers=new Map();
    room.currentAction=null; room.currentQuestion=null; room.currentCorrection=null;
    if(room.timer){ clearTimeout(room.timer); room.timer=null; }
    io.to(player.id).emit('yourTurn');
    io.to(room.code).emit('players', room.players);
  }

  socket.on('roll', code=>{
    const room = rooms[code]; if(!room) return;
    if(!room.activePlayers.includes(socket.id)) return;
    const roll = Math.floor(Math.random()*6)+1;
    io.to(room.code).emit('rolled', { roll, currentPos:getPlayer(room,socket.id).pos });
  });

  socket.on('moveTo', ({code,pos})=>{
    const room = rooms[code]; if(!room||!room.activePlayers.includes(socket.id)) return;
    const player = getPlayer(room,socket.id); if(!player) return;
    player.pos=pos; io.to(room.code).emit('players', room.players);

    const action = ACTIONS[Math.floor(Math.random()*ACTIONS.length)];
    room.currentAction=action;
    const theme = THEMES[Math.floor(Math.random()*THEMES.length)]||'Général';
    const q = pickRandomQuestion(theme);
    if(!q){ io.to(room.code).emit('error','Pas de question'); return endTurn(room); }

    room.currentQuestion = q.question;
    room.currentCorrection = q.correction.trim().toLowerCase();
    room.pendingAnswers = new Map();
    room.activePlayers = action.everybody ? room.players.map(p=>p.id) : [socket.id];

    io.to(room.code).emit('actionDrawn',{action:action.name, timer:action.flash||60});
    const questionPayload={theme,question:q.question};
    if(action.everybody) io.to(room.code).emit('question',questionPayload);
    else io.to(socket.id).emit('question',questionPayload);

    room.timer = setTimeout(()=>{
      room.activePlayers.forEach(id=>{ if(!room.pendingAnswers.has(id)) room.pendingAnswers.set(id,{correct:false}); });
      io.to(room.code).emit('timeOut',{message:'Temps écoulé'});
      applyActionResults(room,action);
      endTurn(room);
    },(action.flash||60)*1000);
  });

  socket.on('answer', ({code,answer})=>{
    const room = rooms[code]; if(!room||!room.currentQuestion||!room.activePlayers.includes(socket.id)) return;
    const clean = (answer||'').toString().trim().toLowerCase();
    const correct = clean === (room.currentCorrection||'').toLowerCase();
    room.pendingAnswers.set(socket.id,{correct,player:getPlayer(room,socket.id).name});
    const everyoneAnswered = room.pendingAnswers.size===room.activePlayers.length;
    const action = room.currentAction||{};
    if(!action.everybody || everyoneAnswered){
      if(room.timer){ clearTimeout(room.timer); room.timer=null; }
      applyActionResults(room,action);
      endTurn(room);
    }
  });

  function applyActionResults(room,action){
    room.activePlayers.forEach(id=>{
      const res = room.pendingAnswers.get(id) || { correct:false };
      const player = getPlayer(room,id); if(!player) return;

      // SECOND LIFE
      if(action.secondLife && !res.correct && !player.secondLifeUsed){
        player.secondLifeUsed=true;
        room.activePlayers=[player.id];
        io.to(player.id).emit('yourTurn'); return;
      }

      // TELEPORTATION
      if(action.teleport && res.correct){
        io.to(player.id).emit('chooseTeleport'); room.awaitingTeleport=player.id; return;
      }

      // FOR YOU
      if(action.forYou && res.correct){
        io.to(player.id).emit('choosePlayerForYou',{players:room.players.filter(p=>p.id!==player.id)});
        room.awaitingForYou=player.id; return;
      }

      // POINTS
      if(res.correct) player.score += action.multiplier||1;
      else if(action.noWay) room.players.forEach(p=>{if(p.id!==id)p.score+=1;});
      else if(action.plusOrMinus) player.score += res.correct?2:-1;
      else if(action.doubleOrQuits && !res.correct) player.score = 0;
      else if(action.callFriend && res.correct && room.activePlayers.length>1)
        room.activePlayers.forEach(pid=>{if(pid!==id){const f=getPlayer(room,pid);if(f)f.score+=1;}});
    });

    io.to(room.code).emit('results',{
      players: room.players.map(p=>({name:p.name,score:p.score})),
      correctById: Object.fromEntries([...room.pendingAnswers].map(([id,v])=>[id,v.correct])),
      message:'Résultat appliqué'
    });
  }

  function endTurn(room){
    io.to(room.code).emit('actionClear');
    room.currentQuestion=null; room.currentCorrection=null; room.currentAction=null;
    room.activePlayers=[]; room.pendingAnswers=new Map();
    if(room.timer){ clearTimeout(room.timer); room.timer=null; }
    setTimeout(()=>nextTurn(room),1500);
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

server.listen(3000,'0.0.0.0',()=>console.log('Serveur lancé sur 3000'));
