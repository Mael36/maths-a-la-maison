// server.js
const express = require('express');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static(path.join(__dirname, 'public')));

// --- CONFIG
const MAX_PLAYERS = 6;

// --- ACTIONS
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

// --- LOAD DATA
let RAW_DATA = null;
let THEMES = [];
let QUESTIONS_BY_THEME = {};
try {
  const dataPath = path.join(__dirname, 'public', 'data.json');
  RAW_DATA = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  if (RAW_DATA.categories) {
    QUESTIONS_BY_THEME = RAW_DATA.categories;
    THEMES = Object.keys(QUESTIONS_BY_THEME);
  } else {
    QUESTIONS_BY_THEME = { "Général": RAW_DATA };
    THEMES = ["Général"];
  }
} catch (e) {
  console.error('Impossible de charger data.json:', e.message);
  QUESTIONS_BY_THEME = {}; THEMES = [];
}

// --- LOAD BOARD
let BOARD_JSON = null;
let BOARD_LENGTH = 32;
try {
  const boardPath = path.join(__dirname, 'public', 'data', 'board.json');
  BOARD_JSON = JSON.parse(fs.readFileSync(boardPath, 'utf8'));
  BOARD_LENGTH = BOARD_JSON.totalCases || 32;
} catch(e){ console.error('Impossible de charger board.json:', e.message); }

const BOARD = [];
for(let i=0;i<BOARD_LENGTH;i++){
  BOARD.push({
    index:i,
    type: i%2===0 ? "action" : "theme",
    name: i%2===0 ? ACTIONS[i%ACTIONS.length].name : (THEMES[i%THEMES.length] || "Général")
  });
}

// --- ROOMS
const rooms = {};

function generateCode(){ let c; do{ c=Math.random().toString(36).substring(2,6).toUpperCase(); }while(rooms[c]); return c; }
function getPlayer(room,id){ return room.players.find(p=>p.id===id); }
function pickRandomQuestion(theme){
  if(!theme) theme = THEMES[Math.floor(Math.random()*THEMES.length)];
  const pool = QUESTIONS_BY_THEME[theme] || Object.values(QUESTIONS_BY_THEME).flat();
  if(!pool || pool.length===0) return null;
  const raw = pool[Math.floor(Math.random()*pool.length)];
  const questionText = raw.question || raw.expression || raw.consigne || '';
  const correctionText = (raw.correction||raw.answer||raw.reponse||'').toString();
  return { raw, question: questionText, correction: correctionText };
}

// --- SOCKET.IO
io.on('connection', socket=>{
  console.log('Connecté:', socket.id);

  socket.on('create', name=>{
    const code = generateCode();
    const room = {
      code, host: socket.id, started: false, currentTurn: -1,
      players:[{id:socket.id,name:name||'Hôte',pos:0,score:0}],
      currentAction:null, currentQuestion:null, currentCorrection:null,
      activePlayers:[], pendingAnswers:new Map(), timer:null
    };
    rooms[code]=room;
    socket.join(code);
    socket.emit('created',code);
    io.to(code).emit('players',room.players);
    if(BOARD_JSON) socket.emit('boardData',BOARD_JSON);
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
    socket.emit('joined',code);
    io.to(code).emit('players',room.players);
    if(BOARD_JSON) socket.emit('boardData',BOARD_JSON);
  });

  socket.on('start', code=>{
    const room = rooms[code]; if(!room||room.host!==socket.id) return;
    room.started = true;
    io.to(code).emit('gameStart');
    nextTurn(room);
  });

  function nextTurn(room){
    room.currentTurn++;
    if(!room.players||!room.players.length) return;
    const idx = room.currentTurn % room.players.length;
    const player = room.players[idx];
    room.activePlayers=[player.id];
    room.pendingAnswers=new Map();
    room.currentAction=null;
    room.currentQuestion=null;
    room.currentCorrection=null;
    if(room.timer){ clearTimeout(room.timer); room.timer=null; }
    io.to(player.id).emit('yourTurn');
    io.to(room.code).emit('players',room.players);
  }

  socket.on('roll', code=>{
    const room = rooms[code];
    if(!room||room.activePlayers[0]!==socket.id) return;
    const roll=Math.floor(Math.random()*6)+1;
    const player = getPlayer(room,socket.id);
    socket.emit('rolled',{roll,currentPos:player.pos});
    io.to(room.code).emit('rolled',{roll,currentPos:player.pos});
  });

  socket.on('moveTo', ({code,pos})=>{
    const room=rooms[code]; if(!room||!room.activePlayers.includes(socket.id)) return;
    const player=getPlayer(room,socket.id); if(!player) return;

    player.pos=pos; io.to(room.code).emit('players',room.players);

    let action = ACTIONS[Math.floor(Math.random()*ACTIONS.length)];
    room.currentAction=action;

    if(action.teleport){
      // choisir case aléatoire
      pos=Math.floor(Math.random()*(BOARD.length)); player.pos=pos;
      io.to(room.code).emit('players',room.players);
    }

    // choisir question
    const theme = THEMES.length ? THEMES[Math.floor(Math.random()*THEMES.length)] : null;
    const q = pickRandomQuestion(theme);
    if(!q){ io.to(room.code).emit('error','Aucune question dispo'); return endTurn(room); }

    room.currentQuestion=q.question;
    room.currentCorrection=q.correction.trim().toLowerCase();
    room.pendingAnswers=new Map();

    if(action.everybody){
      room.activePlayers = room.players.map(p=>p.id);
      io.to(room.code).emit('question',{theme:theme||'Général',question:q.question});
    } else if(action.callFriend||action.forYou){
      // for now activePlayers includes only the ones who should answer
      if(action.forYou){
        // room.activePlayers should already contain the player chosen by front-end
      } else if(action.callFriend){
        // room.activePlayers = [joueur+ami choisi] (selected from front-end)
      }
      room.activePlayers.forEach(id=>{
        io.to(id).emit('question',{theme:theme||'Général',question:q.question});
      });
    } else {
      room.activePlayers=[socket.id];
      io.to(socket.id).emit('question',{theme:theme||'Général',question:q.question});
    }

    const duration = action.flash || 60;
    room.timer = setTimeout(()=>{
      room.activePlayers.forEach(id=>{
        if(!room.pendingAnswers.has(id)) room.pendingAnswers.set(id,{correct:false});
      });
      io.to(room.code).emit('timeOut',{message:'Temps écoulé'});
      applyResults(room,action);
      endTurn(room);
    }, duration*1000);

    io.to(room.code).emit('actionDrawn',{action:action.name,timer:action.flash||null});
    io.to(room.code).emit('players',room.players);
  });

  socket.on('answer', ({code,answer})=>{
    const room = rooms[code]; if(!room||!room.currentQuestion||!room.activePlayers.includes(socket.id)) return;
    const clean=(answer||'').toString().trim().toLowerCase();
    const correct = clean===room.currentCorrection;

    room.pendingAnswers.set(socket.id,{correct,player:getPlayer(room,socket.id).name});

    const action = room.currentAction||{};
    const everyoneAnswered = room.pendingAnswers.size===room.activePlayers.length;

    if(!action.everybody||everyoneAnswered||(action.callFriend||action.forYou)){
      if(room.timer){ clearTimeout(room.timer); room.timer=null; }
      applyResults(room,action);
      endTurn(room);
    } else {
      io.to(room.code).emit('waitingAnswers',{received:room.pendingAnswers.size});
    }
  });

  function applyResults(room,action){
    if(!action) action={};
    room.activePlayers.forEach(id=>{
      const res = room.pendingAnswers.get(id)||{correct:false};
      const player = getPlayer(room,id); if(!player) return;

      if(res.correct){
        player.score += action.multiplier||1;
        if(action.forYou){
          const host = getPlayer(room,room.activePlayers[0]);
          if(host) host.score += action.multiplier||1;
        }
        if(action.callFriend){
          room.activePlayers.forEach(pid=>{
            const p = getPlayer(room,pid);
            if(p) p.score +=1;
          });
        }
      } else if(action.noWay){
        room.players.forEach(p=>{ if(p.id!==id) p.score+=1; });
      }
    });

    // envoyer résultat correct pour chaque joueur actif
    room.activePlayers.forEach(id=>{
      const res = room.pendingAnswers.get(id)||{correct:false};
      io.to(id).emit('results',{
        players: room.players.map(p=>({name:p.name,score:p.score})),
        correct:res.correct
      });
    });
  }

  function endTurn(room){
    io.to(room.code).emit('actionClear');
    room.currentQuestion=null;
    room.currentCorrection=null;
    room.currentAction=null;
    room.activePlayers=[];
    room.pendingAnswers=new Map();
    if(room.timer){ clearTimeout(room.timer); room.timer=null; }
    setTimeout(()=>nextTurn(room),1500);
  }

  socket.on('disconnect', ()=>{
    Object.values(rooms).forEach(room=>{
      const idx = room.players.findIndex(p=>p.id===socket.id);
      if(idx!==-1){
        room.players.splice(idx,1);
        io.to(room.code).emit('players',room.players);
        if(room.host===socket.id && room.players.length>0) room.host=room.players[0].id;
        if(room.players.length===0) delete rooms[room.code];
      }
    });
    console.log('Client déconnecté',socket.id);
  });
});

const PORT=3000;
server.listen(PORT,'0.0.0.0',()=>console.log('Serveur lancé sur le port',PORT));
