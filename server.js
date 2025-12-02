const express=require('express');
const http=require('http');
const fs=require('fs');
const path=require('path');
const { Server }=require('socket.io');

const app=express();
const server=http.createServer(app);
const io=new Server(server,{cors:{origin:"*"}});

app.use(express.static(path.join(__dirname,'public')));

const MAX_PLAYERS=6;

// Actions avec effets
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

let DATA=null,BOARD=null,THEMES=[];
try{
  const dataPath=path.join(__dirname,'public','data.json');
  DATA=JSON.parse(fs.readFileSync(dataPath,'utf8'));
  THEMES=Object.keys(DATA.categories||{});
}catch(e){console.error(e);}
try{
  const boardPath=path.join(__dirname,'public','data','board.json');
  BOARD=JSON.parse(fs.readFileSync(boardPath,'utf8'));
}catch(e){BOARD={positions:[]};}

const rooms={};

function generateCode(){let code; do{code=Math.random().toString(36).substring(2,6).toUpperCase();}while(rooms[code]); return code;}
function getPlayer(room,id){return room.players.find(p=>p.id===id);}
function pickQuestion(theme){const pool=DATA.categories[theme]||[];if(!pool.length)return null;const raw=pool[Math.floor(Math.random()*pool.length)];return {question:raw.question||raw.expression||'',correction:(raw.correction||'').toString()};}

io.on('connection',socket=>{
  console.log('Connecté',socket.id);

  socket.on('create',name=>{
    const code=generateCode();
    rooms[code]={code,host:socket.id,started:false,currentTurn:-1,players:[{id:socket.id,name:name||'Hôte',pos:0,score:0}],activePlayers:[],currentAction:null,currentQuestion:null,currentCorrection:null,pendingAnswers:new Map(),timer:null};
    socket.join(code);
    socket.emit('created',code);
    io.to(code).emit('players',rooms[code].players);
    if(BOARD) socket.emit('boardData',BOARD);
  });

  socket.on('join',({code,name})=>{
    code=(code||'').toUpperCase(); const room=rooms[code];
    if(!room){socket.emit('error','Salle inexistante');return;}
    if(room.players.length>=MAX_PLAYERS){socket.emit('error','Salle pleine');return;}
    const player={id:socket.id,name:name||'Joueur',pos:0,score:0};
    room.players.push(player); socket.join(code);
    socket.emit('joined',code);
    io.to(code).emit('players',room.players);
    if(BOARD) socket.emit('boardData',BOARD);
  });

  socket.on('start',code=>{
    const room=rooms[code]; if(!room||room.host!==socket.id)return;
    room.started=true;
    nextTurn(room);
  });

  function nextTurn(room){
    room.currentTurn++; if(!room.players.length)return;
    const idx=room.currentTurn%room.players.length; const player=room.players[idx];
    room.activePlayers=[player.id]; room.pendingAnswers=new Map(); room.currentAction=null; room.currentQuestion=null; room.currentCorrection=null;
    if(room.timer){clearTimeout(room.timer);room.timer=null;}
    io.to(room.code).emit('yourTurn',{playerId:player.id});
    io.to(room.code).emit('players',room.players);
  }

  socket.on('roll',code=>{
    const room=rooms[code]; if(!room||room.activePlayers[0]!==socket.id)return;
    const roll=Math.floor(Math.random()*6)+1;
    const player=getPlayer(room,socket.id);
    socket.emit('rolled',{roll,currentPos:player.pos});
  });

  socket.on('moveTo',({code,pos,friend})=>{
    const room=rooms[code]; if(!room||!room.activePlayers.includes(socket.id))return;
    const player=getPlayer(room,socket.id); if(!player)return;
    if(room.currentAction && room.currentAction.teleport){ pos=Math.floor(Math.random()*BOARD.positions.length);}
    player.pos=pos; io.to(room.code).emit('players',room.players);

    const action=ACTIONS[Math.floor(Math.random()*ACTIONS.length)];
    room.currentAction=action;

    let playersForQuestion=[socket.id];
    if(action.everybody) playersForQuestion=room.players.map(p=>p.id);
    else if(action.callFriend && friend) playersForQuestion=[socket.id,friend];
    else if(action.forYou && friend) playersForQuestion=[friend];

    const q=pickQuestion(THEMES[Math.floor(Math.random()*THEMES.length)]);
    if(!q){return nextTurn(room);}
    room.currentQuestion=q.question;
    room.currentCorrection=q.correction;
    room.pendingAnswers=new Map();
    room.activePlayers=playersForQuestion;

    io.to(room.code).emit('actionDrawn',{action:action.name});
    const payload={theme:THEMES[Math.floor(Math.random()*THEMES.length)]||'Général',question:q.question,players:playersForQuestion};
    playersForQuestion.forEach(id=>io.to(id).emit('question',payload));

    room.timer=setTimeout(()=>{
      room.activePlayers.forEach(id=>{if(!room.pendingAnswers.has(id))room.pendingAnswers.set(id,{correct:false});});
      io.to(room.code).emit('timeOut',{message:'Temps écoulé'});
      applyResults(room,action);
      endTurn(room);
    },(action.flash||60)*1000);
  });

  socket.on('answer',({code,answer})=>{
    const room=rooms[code]; if(!room||!room.currentQuestion||!room.activePlayers.includes(socket.id))return;
    const correct=(answer||'').toString().trim().toLowerCase()===room.currentCorrection.toLowerCase();
    room.pendingAnswers.set(socket.id,{correct,player:getPlayer(room,socket.id).name});
    const action=room.currentAction;

    let allAnswered=room.pendingAnswers.size===room.activePlayers.length;
    if(action.everybody){
      if(correct){ room.activePlayers.forEach(id=>{room.pendingAnswers.set(id,{correct:true});}); allAnswered=true;}
    }
    if(action.forYou || action.callFriend){ if(correct) allAnswered=true; }

    if(allAnswered){if(room.timer){clearTimeout(room.timer);room.timer=null;} applyResults(room,action); endTurn(room);}
  });

  function applyResults(room,action){
    room.activePlayers.forEach(id=>{
      const res=room.pendingAnswers.get(id)||{correct:false};
      const player=getPlayer(room,id);
      if(!player) return;
      if(res.correct){
        player.score+=action.multiplier||1;
        if(action.forYou && room.activePlayers[0]!==id){const p=getPlayer(room,room.activePlayers[0]); if(p) p.score+=action.multiplier||1;}
        if(action.callFriend){room.activePlayers.forEach(pid=>{const p=getPlayer(room,pid); if(p)p.score+=1;});}
      } else if(action.noWay){room.players.forEach(p=>{if(p.id!==id)p.score+=1;});}
    });
    io.to(room.code).emit('results',{players:room.players.map(p=>({name:p.name,score:p.score})),correct:true});
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
      if(idx!==-1){ room.players.splice(idx,1); io.to(room.code).emit('players',room.players);
        if(room.host===socket.id && room.players.length>0) room.host=room.players[0].id;
        if(room.players.length===0) delete rooms[room.code]; }
    });
    console.log('Déconnecté',socket.id);
  });

});

const PORT=3000;
server.listen(PORT,'0.0.0.0',()=>console.log('Serveur lancé sur',PORT));
