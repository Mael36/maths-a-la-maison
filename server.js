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

// ACTIONS simplifiées
const ACTIONS = [
  { name: "Flash", flash: 30 },
  { name: "Battle left", battleLeft: true },
  { name: "Battle right", battleRight: true },
  { name: "Call a friend", callFriend: true },
  { name: "For you", forYou: true },
  { name: "Second life", secondLife: true },
  { name: "No way", noWay: true },
  { name: "Double", multiplier: 2 },
  { name: "Teleport", teleport: true },
  { name: "+1/-1", plusOrMinus: true },
  { name: "Everybody", everybody: true },
  { name: "Double or quits", doubleOrQuits: true },
  { name: "Choice", freeChoice: true },
  { name: "Quadruple", multiplier: 4 }
];

// Chargement des données questions
let THEMES = [];
let QUESTIONS_BY_THEME = {};
try {
  const data = JSON.parse(fs.readFileSync(path.join(__dirname,'public','data.json'),'utf8'));
  if (data.categories) {
    QUESTIONS_BY_THEME = data.categories;
    THEMES = Object.keys(QUESTIONS_BY_THEME);
  } else {
    QUESTIONS_BY_THEME = { "Général": Array.isArray(data)?data:[] };
    THEMES = ["Général"];
  }
} catch(e){ console.error('Erreur data.json', e); }

// Chargement plateau
let BOARD_JSON = null;
try {
  BOARD_JSON = JSON.parse(fs.readFileSync(path.join(__dirname,'public','data','board.json'),'utf8'));
} catch(e){ console.error('Erreur board.json', e); }

// --- Rooms
const rooms = {};
function generateCode() { let c; do { c=Math.random().toString(36).slice(2,6).toUpperCase(); } while(rooms[c]); return c; }
function getPlayer(room,id){ return room.players.find(p=>p.id===id); }
function pickQuestion(theme){
  const pool = (theme && QUESTIONS_BY_THEME[theme])? QUESTIONS_BY_THEME[theme]: Object.values(QUESTIONS_BY_THEME).flat();
  if(!pool || pool.length===0) return null;
  const q = pool[Math.floor(Math.random()*pool.length)];
  return { question: q.question||q.expression||'', correction: (q.correction||q.answer||'').toString() };
}

// SOCKET.IO
io.on('connection', socket => {
  console.log('Client connecté', socket.id);

  socket.on('create', name => {
    const code = generateCode();
    rooms[code] = {
      code, host: socket.id, started:false, currentTurn:-1,
      players:[{id:socket.id, name:name||'Hôte', pos:0, score:0}],
      currentAction:null, currentQuestion:null, currentCorrection:null,
      activePlayers:[], pendingAnswers:new Map(), timer:null
    };
    socket.join(code);
    socket.emit('created', code);
    io.to(code).emit('players', rooms[code].players);
    if(BOARD_JSON) socket.emit('boardData', BOARD_JSON);
  });

  socket.on('join', ({code,name})=>{
    code = code.toUpperCase();
    const room = rooms[code];
    if(!room) return socket.emit('error','Salle introuvable');
    if(room.players.length>=MAX_PLAYERS) return socket.emit('error','Salle pleine');
    if(room.started) return socket.emit('error','Partie déjà commencée');
    room.players.push({id:socket.id, name:name||'Joueur', pos:0, score:0});
    socket.join(code);
    socket.emit('joined', code);
    io.to(code).emit('players', room.players);
    if(BOARD_JSON) socket.emit('boardData', BOARD_JSON);
  });

  socket.on('start', code=>{
    const room=rooms[code]; if(!room||room.host!==socket.id) return;
    room.started=true; io.to(code).emit('gameStart'); nextTurn(room);
  });

  function nextTurn(room){
    room.currentTurn++;
    if(!room.players.length) return;
    const player = room.players[room.currentTurn % room.players.length];
    room.activePlayers=[player.id]; room.pendingAnswers=new Map(); room.currentAction=null;
    room.currentQuestion=null; room.currentCorrection=null;
    if(room.timer){ clearTimeout(room.timer); room.timer=null; }
    io.to(player.id).emit('yourTurn');
    io.to(room.code).emit('players', room.players);
  }

  socket.on('roll', code=>{
    const room=rooms[code]; if(!room || room.activePlayers[0]!==socket.id) return;
    const roll = Math.floor(Math.random()*6)+1;
    const player=getPlayer(room,socket.id);
    io.to(room.code).emit('rolled',{roll,currentPos:player.pos});
  });

  socket.on('moveTo', ({code,pos})=>{
    const room=rooms[code]; if(!room||!room.activePlayers.includes(socket.id)) return;
    const player=getPlayer(room,socket.id); if(!player) return;
    player.pos=pos; io.to(room.code).emit('players', room.players);

    // tirer action + question
    const action = ACTIONS[Math.floor(Math.random()*ACTIONS.length)];
    room.currentAction=action;
    const theme = THEMES[Math.floor(Math.random()*THEMES.length)];
    const q = pickQuestion(theme); if(!q){ endTurn(room); return; }
    room.currentQuestion=q.question;
    room.currentCorrection=(q.correction||'').trim().toLowerCase();
    room.activePlayers=action.everybody?room.players.map(p=>p.id):[socket.id];
    room.pendingAnswers=new Map();
    io.to(room.code).emit('actionDrawn',{action:action.name, timer:action.flash||null});
    const duration=action.flash||60;
    room.timer=setTimeout(()=>{
      room.activePlayers.forEach(id=>{ if(!room.pendingAnswers.has(id)) room.pendingAnswers.set(id,{correct:false}); });
      io.to(room.code).emit('timeOut',{message:'Temps écoulé'});
      applyActionResults(room, action); endTurn(room);
    }, duration*1000);
    const questionPayload={theme,question:room.currentQuestion};
    if(action.everybody) io.to(room.code).emit('question',questionPayload);
    else io.to(socket.id).emit('question',questionPayload);
  });

  socket.on('answer', ({code,answer})=>{
    const room=rooms[code]; if(!room||!room.currentQuestion||!room.activePlayers.includes(socket.id)) return;
    const clean = (answer||'').toString().trim().toLowerCase();
    const correct = clean === (room.currentCorrection||'');
    room.pendingAnswers.set(socket.id,{correct,player:getPlayer(room,socket.id).name});
    const everyoneAnswered = room.pendingAnswers.size === room.activePlayers.length;
    const action=room.currentAction||{};
    if(!action.everybody || everyoneAnswered){
      if(room.timer){ clearTimeout(room.timer); room.timer=null; }
      applyActionResults(room, action); endTurn(room);
    }
  });

  function applyActionResults(room,action){
    room.activePlayers.forEach(id=>{
      const res=room.pendingAnswers.get(id)||{correct:false};
      const player=getPlayer(room,id); if(!player) return;
      if(res.correct) player.score += action.multiplier||1;
      else if(action.noWay) room.players.forEach(p=>{if(p.id!==id)p.score+=1;});
    });
    io.to(room.code).emit('results',{players:room.players.map(p=>({name:p.name,score:p.score})), message:'Résultats appliqués'});
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
      const idx=room.players.findIndex(p=>p.id===socket.id);
      if(idx!==-1){
        room.players.splice(idx,1); io.to(room.code).emit('players', room.players);
        if(room.host===socket.id && room.players.length>0) room.host=room.players[0].id;
        if(room.players.length===0) delete rooms[room.code];
      }
    });
    console.log('Client déconnecté', socket.id);
  });

  // client peut demander le board
  socket.on('requestBoard', () => {
  if (BOARD_JSON) socket.emit('boardData', BOARD_JSON);
});
});

server.listen(3000,'0.0.0.0',()=>console.log('Serveur lancé'));

