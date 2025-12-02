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

// --- Actions
const ACTIONS = [
  { name:"Flash", flash:30 },
  { name:"Battle on left", battleLeft:true },
  { name:"Battle on right", battleRight:true },
  { name:"Call a friend", callFriend:true },
  { name:"For you", forYou:true },
  { name:"Second life", secondLife:true },
  { name:"No way", noWay:true },
  { name:"Double", multiplier:2 },
  { name:"Téléportation", teleport:true },
  { name:"+1 ou -1", plusOrMinus:true },
  { name:"Everybody", everybody:true },
  { name:"Double or quits", doubleOrQuits:true },
  { name:"It's your choice", freeChoice:true },
  { name:"Quadruple", multiplier:4 }
];

// --- Chargement des questions
let RAW_DATA = null;
let THEMES = [];
let QUESTIONS_BY_THEME = {};
try {
  const dataPath = path.join(__dirname,'public','data.json');
  RAW_DATA = JSON.parse(fs.readFileSync(dataPath,'utf8'));
  if(RAW_DATA.categories) QUESTIONS_BY_THEME = RAW_DATA.categories;
  else QUESTIONS_BY_THEME = { "Général": Array.isArray(RAW_DATA)?RAW_DATA:[] };
  THEMES = Object.keys(QUESTIONS_BY_THEME);
} catch(e){
  console.error("Impossible de charger data.json", e.message);
}

// --- Chargement du board
let BOARD_JSON = null;
try{
  const boardPath = path.join(__dirname,'public','data','board.json');
  BOARD_JSON = JSON.parse(fs.readFileSync(boardPath,'utf8'));
} catch(e){
  console.error("Impossible de charger board.json", e.message);
}

// --- Rooms
const rooms = {};

function generateCode(){
  let code;
  do { code = Math.random().toString(36).substring(2,6).toUpperCase(); } while(rooms[code]);
  return code;
}

function getPlayer(room, id){ return room.players.find(p=>p.id===id); }
function pickRandomQuestion(theme){
  if(!theme) theme = THEMES[Math.floor(Math.random()*THEMES.length)];
  const pool = QUESTIONS_BY_THEME[theme] || Object.values(QUESTIONS_BY_THEME).flat();
  if(!pool || !pool.length) return null;
  const raw = pool[Math.floor(Math.random()*pool.length)];
  return { raw, question: raw.question||raw.expression||'', correction: (raw.correction||raw.answer||'').toString() };
}

io.on('connection', socket=>{
  console.log('Connecté', socket.id);

  socket.on('create', name=>{
    const code = generateCode();
    const room = {
      code,
      host: socket.id,
      started: false,
      currentTurn: -1,
      players: [{ id: socket.id, name:name||'Hôte', pos:0, score:0 }],
      currentAction: null,
      currentQuestion:null,
      currentCorrection:null,
      activePlayers: [],
      pendingAnswers: new Map(),
      secondLifePlayers: new Set(),
      timer:null
    };
    rooms[code]=room;
    socket.join(code);
    socket.emit('created', code);
    io.to(code).emit('players', room.players);
    if(BOARD_JSON) socket.emit('boardData', BOARD_JSON);
  });

  socket.on('join', ({code,name})=>{
    code = (code||'').toString().toUpperCase();
    const room = rooms[code];
    if(!room){ socket.emit('error','Salle inexistante'); return; }
    if(room.players.length>=MAX_PLAYERS){ socket.emit('error','Salle pleine'); return; }
    if(room.started){ socket.emit('error','Partie déjà commencée'); return; }
    const player={id:socket.id,name:name||'Joueur',pos:0,score:0};
    room.players.push(player);
    socket.join(code);
    socket.emit('joined', code);
    io.to(code).emit('players', room.players);
    if(BOARD_JSON) socket.emit('boardData', BOARD_JSON);
  });

  socket.on('start', code=>{
    const room=rooms[code];
    if(!room || room.host!==socket.id) return;
    room.started=true;
    nextTurn(room);
  });

  function nextTurn(room){
    room.currentTurn++;
    if(!room.players.length) return;
    const idx=room.currentTurn%room.players.length;
    const player=room.players[idx];
    room.activePlayers=[player.id];
    room.pendingAnswers=new Map();
    room.currentAction=null;
    room.currentQuestion=null;
    room.currentCorrection=null;
    if(room.timer){ clearTimeout(room.timer); room.timer=null; }
    io.to(player.id).emit('yourTurn',{playerId:player.id});
    io.to(room.code).emit('players', room.players);
  }

  socket.on('roll', code=>{
    const room=rooms[code];
    if(!room) return;
    if(!room.activePlayers.includes(socket.id)) return;
    const roll=Math.floor(Math.random()*6)+1;
    const player=getPlayer(room,socket.id);
    socket.emit('rolled',{roll,currentPos:player.pos});
    io.to(room.code).emit('rolled',{roll,currentPos:player.pos});
  });

  socket.on('moveTo', ({code,pos})=>{
    const room=rooms[code];
    if(!room || !room.activePlayers.includes(socket.id)) return;
    const player=getPlayer(room,socket.id);
    if(!player) return;

    // TELEPORTATION
    if(room.currentAction?.teleport){
      const randomPos=Math.floor(Math.random()*BOARD_JSON.positions.length);
      player.pos=randomPos;
    } else player.pos=pos;

    io.to(room.code).emit('players', room.players);

    // Tirer action et question
    const action=ACTIONS[Math.floor(Math.random()*ACTIONS.length)];
    room.currentAction=action;

    const theme=THEMES.length?THEMES[Math.floor(Math.random()*THEMES.length)]:null;
    const q=pickRandomQuestion(theme);
    if(!q){ io.to(room.code).emit('error','Aucune question'); return endTurn(room); }

    room.currentQuestion=q.question;
    room.currentCorrection=q.correction.trim().toLowerCase();
    room.pendingAnswers=new Map();

    // Définir joueurs actifs
    if(action.everybody) room.activePlayers=room.players.map(p=>p.id);
    else if(action.callFriend || action.forYou) room.activePlayers=[socket.id]; // le serveur gérera la sélection

    // Notifier action et question
    io.to(room.code).emit('actionDrawn',{action:action.name, timer:action.flash||null});

    const duration=action.flash||60;
    room.timer=setTimeout(()=>{
      // Timeout : marquer incorrect ceux qui n'ont pas répondu
      room.activePlayers.forEach(id=>{
        if(!room.pendingAnswers.has(id)) room.pendingAnswers.set(id,{correct:false});
      });
      // Résultats
      applyActionResults(room,action);
      endTurn(room);
    },duration*1000);

    // Envoyer question aux joueurs actifs
    room.activePlayers.forEach(id=>{
      io.to(id).emit('question',{theme:theme||'Général',question:room.currentQuestion,timer:duration});
    });
  });

  socket.on('answer', ({code,answer})=>{
    const room=rooms[code];
    if(!room || !room.currentQuestion || !room.activePlayers.includes(socket.id)) return;
    const clean=(answer||'').toString().trim().toLowerCase();
    const correct=clean===room.currentCorrection;

    room.pendingAnswers.set(socket.id,{correct,player:getPlayer(room,socket.id).name});

    // Pour everybody, callFriend, forYou, gérer suppression question dès qu'une bonne réponse
    if(room.currentAction.everybody){
      if(correct){
        // Stop question pour tous et attribuer point
        room.activePlayers.forEach(id=>{
          if(room.pendingAnswers.get(id)?.correct!==false) getPlayer(room,id).score+=(room.currentAction.multiplier||1);
        });
        io.to(room.code).emit('results',{players:room.players,correct:true});
        endTurn(room);
        return;
      } else {
        io.to(socket.id).emit('results',{players:room.players,correct:false});
      }
    } else if(room.currentAction.callFriend || room.currentAction.forYou){
      if(correct){
        room.activePlayers.forEach(id=>{
          getPlayer(room,id).score+=(room.currentAction.multiplier||1);
        });
        io.to(room.code).emit('results',{players:room.players,correct:true});
        endTurn(room);
        return;
      } else {
        io.to(socket.id).emit('results',{players:room.players,correct:false});
      }
    } else {
      // Joueur seul
      const player=getPlayer(room,socket.id);
      if(correct) player.score+=(room.currentAction.multiplier||1);
      io.to(socket.id).emit('results',{players:room.players,correct:correct});
      endTurn(room);
    }
  });

  function applyActionResults(room, action){
    if(!action) action={};
    room.activePlayers.forEach(id=>{
      const res=room.pendingAnswers.get(id)||{correct:false};
      const player=getPlayer(room,id);
      if(!player) return;
      if(res.correct) player.score += action.multiplier||1;
      else if(action.noWay){
        room.players.forEach(p=>{ if(p.id!==id) p.score+=1; });
      }
    });
    io.to(room.code).emit('players',room.players);
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
      const idx=room.players.findIndex(p=>p.id===socket.id);
      if(idx!==-1){
        room.players.splice(idx,1);
        io.to(room.code).emit('players',room.players);
        if(room.host===socket.id && room.players.length>0) room.host=room.players[0].id;
        if(room.players.length===0) delete rooms[room.code];
      }
    });
    console.log('Déconnecté', socket.id);
  });

  socket.on('selectPlayer', ({target,code})=>{
    const room=rooms[code];
    if(!room || !room.currentAction) return;
    if(room.currentAction.forYou || room.currentAction.callFriend){
      if(room.currentAction.forYou) room.activePlayers=[target];
      else if(room.currentAction.callFriend) room.activePlayers=[socket.id,target];
      // envoyer la question aux joueurs sélectionnés
      room.activePlayers.forEach(id=>{
        io.to(id).emit('question',{theme:'Général',question:room.currentQuestion,timer:60});
      });
    }
  });
});

const PORT=3000;
server.listen(PORT,'0.0.0.0',()=>console.log('Serveur lancé sur',PORT));
