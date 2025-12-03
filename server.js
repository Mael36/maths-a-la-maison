const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

const BOARD_LENGTH = 32;
const MAX_PLAYERS = 6;

// Board simple avec positions x/y %
const BOARD = {
  positions: Array.from({length:BOARD_LENGTH}, (_,i)=>({x:(i%8)*12.5,y:Math.floor(i/8)*12.5}))
};

// Charger questions
let THEMES = [];
let QUESTIONS_BY_THEME = {};
try{
  const raw = fs.readFileSync(path.join(__dirname,'public/data.json'),'utf8');
  const data = JSON.parse(raw);
  if(data.categories){
    QUESTIONS_BY_THEME = data.categories;
    THEMES = Object.keys(QUESTIONS_BY_THEME);
  }else{
    QUESTIONS_BY_THEME = { 'Général': data };
    THEMES = ['Général'];
  }
}catch(e){ QUESTIONS_BY_THEME={}; THEMES=[]; }

function generateCode(){ let c; do{ c=Math.random().toString(36).substr(2,4).toUpperCase(); }while(rooms[c]); return c; }
function getPlayer(room,id){ return room.players.find(p=>p.id===id); }
function pickQuestion(theme){
  if(!theme) theme = THEMES.length? THEMES[Math.floor(Math.random()*THEMES.length)]: 'Général';
  const pool = QUESTIONS_BY_THEME[theme]||Object.values(QUESTIONS_BY_THEME).flat();
  if(!pool || pool.length===0) return null;
  const q = pool[Math.floor(Math.random()*pool.length)];
  return { question:q.question || '', correction:(q.correction || q.answer || '').toString().trim() };
}

// Actions avec type
const ACTIONS = [
  { name:'Flash', type:'flash' },
  { name:'Battle on left', type:'battle', target:'left' },
  { name:'Battle on right', type:'battle', target:'right' },
  { name:'Call a friend', type:'callFriend' },
  { name:'For you', type:'forYou' },
  { name:'Second life', type:'secondLife' },
  { name:'No way', type:'noWay' },
  { name:'Double', type:'double' },
  { name:'Téléportation', type:'teleport' },
  { name:'+1 ou -1', type:'plusOrMinus' },
  { name:'Everybody', type:'everybody' },
  { name:'Double or quits', type:'doubleOrQuits' },
  { name:"It's your choice", type:'choice' },
  { name:'Quadruple', type:'quadruple' }
];

const rooms = {};

io.on('connection', socket=>{

  socket.on('create', name=>{
    const code = generateCode();
    rooms[code] = {
      code,
      host: socket.id,
      started:false,
      currentTurn:-1,
      players:[{id:socket.id,name:name||'Hôte',pos:0,score:0}],
      currentAction:null,
      currentQuestion:null,
      currentCorrection:null,
      activePlayers:[],
      pendingAnswers:new Map(),
      timer:null
    };
    socket.join(code);
    socket.emit('created', code);
    io.to(code).emit('players', rooms[code].players);
    socket.emit('boardData', BOARD);
  });

  socket.on('join', ({code,name})=>{
    code=code.toUpperCase();
    const room = rooms[code];
    if(!room){ socket.emit('error','Salle inexistante'); return; }
    if(room.players.length>=MAX_PLAYERS){ socket.emit('error','Salle pleine'); return; }
    if(room.started){ socket.emit('error','Partie déjà commencée'); return; }
    const player = {id:socket.id,name:name||'Joueur',pos:0,score:0};
    room.players.push(player);
    socket.join(code);
    socket.emit('joined', code);
    io.to(code).emit('players', room.players);
    socket.emit('boardData', BOARD);
  });

  socket.on('start', code=>{
    const room=rooms[code]; if(!room || room.host!==socket.id) return;
    room.started=true;
    io.to(code).emit('gameStart');
    nextTurn(room);
  });

  function nextTurn(room){
    room.currentTurn++;
    const idx = room.currentTurn % room.players.length;
    const player = room.players[idx];
    room.activePlayers=[player.id];
    room.pendingAnswers = new Map();
    room.currentAction=null;
    room.currentQuestion=null;
    room.currentCorrection=null;
    if(room.timer){ clearTimeout(room.timer); room.timer=null; }
    io.to(player.id).emit('yourTurn',{playerId:player.id});
    io.to(room.code).emit('players', room.players);
  }

  socket.on('roll', code=>{
    const room = rooms[code]; if(!room) return;
    if(!room.activePlayers.includes(socket.id)) return;
    const roll = Math.floor(Math.random()*6)+1;
    const player = getPlayer(room,socket.id);
    socket.emit('rolled',{roll,currentPos:player.pos});
  });

  socket.on('moveTo', ({code,pos})=>{
    const room = rooms[code]; if(!room) return;
    if(!room.activePlayers.includes(socket.id)) return;
    const player = getPlayer(room,socket.id); if(!player) return;

    player.pos = pos;
    io.to(room.code).emit('players', room.players);

    // Tirage action
    const action = ACTIONS[Math.floor(Math.random()*ACTIONS.length)];
    room.currentAction = action;

    if(action.type==='teleport'){
      player.pos = Math.min(Math.floor(Math.random()*BOARD_LENGTH), BOARD_LENGTH-1);
      io.to(room.code).emit('players', room.players);
    }

    const q = pickQuestion();
    if(!q){ io.to(room.code).emit('error','Aucune question'); return endTurn(room); }

    room.currentQuestion = q.question;
    room.currentCorrection = q.correction;
    room.pendingAnswers = new Map();

    // Active players selon action
    if(['everybody'].includes(action.type)){
      room.activePlayers = room.players.map(p=>p.id);
    } else room.activePlayers = [socket.id];

    io.to(room.code).emit('actionDrawn',{action:action.name});

    let duration=60;
    if(action.type==='flash') duration=30;
    room.timer = setTimeout(()=>{
      room.activePlayers.forEach(id=>{
        if(!room.pendingAnswers.has(id)) room.pendingAnswers.set(id,{correct:false});
      });
      io.to(room.code).emit('timeOut',{message:'Temps écoulé'});
      applyActionResults(room, action);
      endTurn(room);
    },duration*1000);

    const payload = {theme:'Général',question:q.question,timer:duration};
    if(action.type==='everybody') io.to(room.code).emit('question', payload);
    else io.to(socket.id).emit('question', payload);
  });

  socket.on('answer', ({code,answer})=>{
    const room = rooms[code]; if(!room || !room.currentQuestion) return;
    if(!room.activePlayers.includes(socket.id)) return;

    const clean = (answer||'').toString().trim().toLowerCase();
    const correct = clean === (room.currentCorrection||'').toLowerCase();
    room.pendingAnswers.set(socket.id,{correct});

    const everyoneAnswered = room.pendingAnswers.size===room.activePlayers.length;
    if(!room.currentAction) return;

    if(everyoneAnswered || room.currentAction.type!=='everybody'){
      if(room.timer){ clearTimeout(room.timer); room.timer=null; }
      applyActionResults(room, room.currentAction);
      endTurn(room);
    }
  });

  function applyActionResults(room, action){
    room.activePlayers.forEach(id=>{
      const res = room.pendingAnswers.get(id) || {correct:false};
      const player = getPlayer(room,id); if(!player) return;

      switch(action.type){
        case 'secondLife':
          if(!res.correct && !res.retry){
            room.pendingAnswers.set(id,{correct:false,retry:true});
            io.to(id).emit('question',{theme:'Général',question:room.currentQuestion,timer:30});
            return;
          }
          if(res.correct) player.score++;
          break;
        case 'double':
          if(res.correct) player.score += 2; break;
        case 'doubleOrQuits':
          if(res.correct) player.score *= 2; else player.score = 0; break;
        case 'plusOrMinus':
          player.score += res.correct?2:-1; break;
        case 'noWay':
          if(res.correct) player.score++; else room.players.filter(p=>p.id!==id).forEach(p=>p.score++); break;
        case 'quadruple':
          if(res.correct) player.score +=4; break;
        default:
          if(res.correct) player.score++;
      }

      io.to(room.code).emit('results',{
        players:room.players.map(p=>({id:p.id,name:p.name,score:p.score})),
        correct:res.correct
      });
    });
  }

  function endTurn(room){
    io.to(room.code).emit('actionClear');
    room.activePlayers=[];
    room.pendingAnswers=new Map();
    room.currentAction=null;
    room.currentQuestion=null;
    room.currentCorrection=null;
    if(room.timer){ clearTimeout(room.timer); room.timer=null; }
    setTimeout(()=>nextTurn(room),2500);
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

server.listen(3000,()=>console.log('Serveur lancé'));
