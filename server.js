const express=require('express');
const http=require('http');
const fs=require('fs');
const path=require('path');
const {Server}=require('socket.io');

const app=express();
const server=http.createServer(app);
const io=new Server(server,{cors:{origin:"*"}});

app.use(express.static(path.join(__dirname,'public')));

const MAX_PLAYERS=6;
const DEFAULT_BOARD_LENGTH=32;

const ACTIONS=[
  {name:"Flash",flash:30},
  {name:"Battle on left",battleLeft:true},
  {name:"Battle on right",battleRight:true},
  {name:"Call a friend",callFriend:true},
  {name:"For you",forYou:true},
  {name:"Second life",secondLife:true},
  {name:"No way",noWay:true},
  {name:"Double",multiplier:2},
  {name:"Téléportation",teleport:true},
  {name:"+1 ou -1",plusOrMinus:true},
  {name:"Everybody",everybody:true},
  {name:"Double or quits",doubleOrQuits:true},
  {name:"It's your choice",freeChoice:true},
  {name:"Quadruple",multiplier:4}
];

let RAW_DATA=null; let THEMES=[]; let QUESTIONS_BY_THEME={};
try{
  const raw=fs.readFileSync(path.join(__dirname,'public','data.json'),'utf8');
  RAW_DATA=JSON.parse(raw);
  if(RAW_DATA.categories){ QUESTIONS_BY_THEME=RAW_DATA.categories; THEMES=Object.keys(QUESTIONS_BY_THEME);}
  else if(Array.isArray(RAW_DATA)){ QUESTIONS_BY_THEME={"Général":RAW_DATA}; THEMES=["Général"]; }
  else { QUESTIONS_BY_THEME=Object.values(RAW_DATA).flat(); THEMES=Object.keys(QUESTIONS_BY_THEME);}
}catch(e){ QUESTIONS_BY_THEME={}; THEMES=[];}

let BOARD_JSON=null; let BOARD_LENGTH=DEFAULT_BOARD_LENGTH;
try{
  const raw=fs.readFileSync(path.join(__dirname,'public','data','board.json'),'utf8');
  BOARD_JSON=JSON.parse(raw);
  if(BOARD_JSON && Number.isFinite(BOARD_JSON.totalCases)) BOARD_LENGTH=BOARD_JSON.totalCases;
}catch(e){ BOARD_JSON=null; BOARD_LENGTH=DEFAULT_BOARD_LENGTH; }

const BOARD=[];
for(let i=0;i<BOARD_LENGTH;i++){
  if(i%2===0) BOARD.push({index:i,type:"action",name:ACTIONS[i%ACTIONS.length].name});
  else BOARD.push({index:i,type:"theme",name:THEMES.length?THEMES[i%THEMES.length]:"Général"});
}

const rooms={};

function generateCode(){let c; do{c=Math.random().toString(36).substring(2,6).toUpperCase();}while(rooms[c]); return c;}
function getPlayer(room,id){return room.players.find(p=>p.id===id);}
function pickRandomQuestion(theme){
  if(!theme) theme=THEMES.length?THEMES[Math.floor(Math.random()*THEMES.length)]:null;
  const pool=(theme && QUESTIONS_BY_THEME[theme])?QUESTIONS_BY_THEME[theme]:Object.values(QUESTIONS_BY_THEME).flat();
  if(!pool||pool.length===0) return null;
  const raw=pool[Math.floor(Math.random()*pool.length)];
  const questionText=raw.question||raw.expression||raw.consigne||'';
  const correctionText=(raw.correction||raw.answer||raw.reponse||'').toString();
  return {raw,question:questionText,correction:correctionText};
}

io.on('connection',socket=>{
  console.log('Client connecté',socket.id);

  socket.on('create',name=>{
    const code=generateCode();
    const roomObj={code,host:socket.id,started:false,currentTurn:-1,
      players:[{id:socket.id,name:name||'Hôte',pos:0,score:0}],
      currentAction:null,currentQuestion:null,currentCorrection:null,
      activePlayers:[],pendingAnswers:new Map(),timer:null};
    rooms[code]=roomObj;
    socket.join(code);
    socket.emit('created',code);
    io.to(code).emit('players',roomObj.players);
    if(BOARD_JSON) socket.emit('boardData',BOARD_JSON);
  });

  socket.on('join',({code,name})=>{
    code=(code||'').toString().toUpperCase();
    const room=rooms[code];
    if(!room){socket.emit('error','Salle inexistante');return;}
    if(room.players.length>=MAX_PLAYERS){socket.emit('error','Salle pleine');return;}
    if(room.started){socket.emit('error','Partie déjà commencée');return;}
    const player={id:socket.id,name:name||'Joueur',pos:0,score:0};
    room.players.push(player);
    socket.join(code);
    socket.emit('joined',code);
    io.to(code).emit('players',room.players);
    if(BOARD_JSON) socket.emit('boardData',BOARD_JSON);
  });

  socket.on('start',code=>{
    const room=rooms[code];
    if(!room||room.host!==socket.id) return;
    room.started=true; io.to(code).emit('gameStart'); nextTurn(room);
  });

  function nextTurn(room){
    room.currentTurn++;
    if(!room.players||room.players.length===0) return;
    const idx=room.currentTurn%room.players.length;
    const player=room.players[idx];
    room.activePlayers=[player.id]; room.pendingAnswers=new Map();
    room.currentAction=null; room.currentQuestion=null; room.currentCorrection=null;
    if(room.timer){clearTimeout(room.timer); room.timer=null;}
    activePlayerId=player.id;
    io.to(player.id).emit('yourTurn',{playerId:player.id});
    io.to(room.code).emit('players',room.players);
  }

  socket.on('roll',code=>{
    const room=rooms[code]; if(!room) return;
    if(!room.activePlayers||room.activePlayers[0]!==socket.id) return;
    const roll=Math.floor(Math.random()*6)+1;
    const player=getPlayer(room,socket.id);
    io.to(socket.id).emit('rolled',{roll,currentPos:player.pos,playerId:socket.id});
  });

  socket.on('moveTo',({code,pos})=>{
    const room=rooms[code]; if(!room) return;
    if(!room.activePlayers||!room.activePlayers.includes(socket.id)) return;
    const player=getPlayer(room,socket.id); if(!player) return;
    player.pos=pos;
    io.to(room.code).emit('players',room.players);

    const action=ACTIONS[Math.floor(Math.random()*ACTIONS.length)];
    room.currentAction=action;

    const theme=THEMES.length?THEMES[Math.floor(Math.random()*THEMES.length)]:null;
    const q=pickRandomQuestion(theme);
    if(!q){io.to(room.code).emit('error','Aucune question disponible'); return endTurn(room);}
    room.currentQuestion=q.question;
    room.currentCorrection=(q.correction||'').trim().toLowerCase();
    room.pendingAnswers=new Map();
    room.activePlayers=action.everybody?room.players.map(p=>p.id):[socket.id];

    io.to(room.code).emit('actionDrawn',{action:action.name,timer:action.flash||null});
    io.to(room.code).emit('players',room.players);

    const duration=action.flash||60;
    room.timer=setTimeout(()=>{
      room.activePlayers.forEach(id=>{if(!room.pendingAnswers.has(id)) room.pendingAnswers.set(id,{correct:false});});
      io.to(room.code).emit('timeOut',{message:'Temps écoulé'});
      applyActionResults(room,action);
      endTurn(room);
    },duration*1000);

    const questionPayload={theme,question:q.question,playerId:action.everybody?null:socket.id,everybody:!!action.everybody};
    if(action.everybody) io.to(room.code).emit('question',questionPayload);
    else io.to(socket.id).emit('question',questionPayload);
  });

  socket.on('answer',({code,answer})=>{
    const room=rooms[code]; if(!room) return;
    if(!room.currentQuestion||!room.activePlayers.includes(socket.id)) return;
    const clean=(answer||'').toString().trim().toLowerCase();
    const correct=clean===(room.currentCorrection||'').toLowerCase();
    room.pendingAnswers.set(socket.id,{correct,player:getPlayer(room,socket.id).name});

    const everyoneAnswered=room.pendingAnswers.size===room.activePlayers.length;
    const action=room.currentAction||{};
    if(!action.everybody||everyoneAnswered){
      if(room.timer){clearTimeout(room.timer);room.timer=null;}
      applyActionResults(room,action);
      endTurn(room);
    } else {
      io.to(room.code).emit('waitingAnswers',{received:room.pendingAnswers.size});
    }
  });

  function applyActionResults(room,action){
    if(!action) action={};
    room.activePlayers.forEach(id=>{
      const res=room.pendingAnswers.get(id)||{correct:false};
      const player=getPlayer(room,id); if(!player) return;
      if(res.correct){
        player.score+=action.multiplier||1;
        if(action.teleport) player.pos=Math.floor(Math.random()*(board.length||32));
      } else {
        if(action.noWay) room.players.forEach(p=>{if(p.id!==id) p.score+=1;});
        if(action.plusOrMinus) player.score=Math.max(0,player.score-1);
      }
    });
    io.to(room.code).emit('results',{
      players:room.players.map(p=>({id:p.id,name:p.name,score:p.score})),
      correct:room.pendingAnswers.get(room.activePlayers[0])?.correct||false
    });
  }

  function endTurn(room){
    io.to(room.code).emit('actionClear');
    room.currentQuestion=null; room.currentCorrection=null; room.currentAction=null;
    room.activePlayers=[]; room.pendingAnswers=new Map();
    if(room.timer){clearTimeout(room.timer);room.timer=null;}
    setTimeout(()=>nextTurn(room),1500);
  }

  socket.on('disconnect',()=>{
    Object.values(rooms).forEach(room=>{
      const idx=room.players.findIndex(p=>p.id===socket.id);
      if(idx!==-1){
        room.players.splice(idx,1);
        io.to(room.code).emit('players',room.players);
        if(room.host===socket.id&&room.players.length>0) room.host=room.players[0].id;
        if(room.players.length===0) delete rooms[room.code];
      }
    });
    console.log('Client déconnecté',socket.id);
  });
});

const PORT=3000;
server.listen(PORT,'0.0.0.0',()=>console.log('Serveur lancé sur le port',PORT));
