const socket = io();
let room=null;
let board=null;
let timer=null;
let currentPlayerId=null;
let activePlayers=[];

const $ = id=>document.getElementById(id);

function createActionCards(){
  const grid=$('actionGrid');
  grid.innerHTML='';
  const actions=[
    "Flash","Battle on left","Battle on right","Call a friend","For you",
    "Second life","No way","Double","Téléportation","+1 ou -1",
    "Everybody","Double or quits","It's your choice","Quadruple"
  ];
  actions.forEach(a=>{
    const c=document.createElement('div');
    c.className='actionCard';
    c.textContent=a;
    c.dataset.action=a;
    c.onclick = ()=>{
      socket.emit("choiceAction",{code:room,action:a});
    };
    grid.appendChild(c);
  });
}

function updatePawns(players){
  const cont=$('pions'); if(!cont||!board) return; cont.innerHTML='';
  const img=$('plateau'); const w=img.offsetWidth,h=img.offsetHeight;
  players.forEach((p,i)=>{
    const pos=board.positions[Math.max(0,Math.min(board.positions.length-1,p.pos))];
    const x=(pos.x/100)*w, y=(pos.y/100)*h;
    const pawn=document.createElement('div');
    pawn.style.cssText=`position:absolute;width:35px;height:35px;border-radius:50%;
      background:${['#d32f2f','#388e3c','#fbc02d','#1976d2','#f57c00','#7b1fa2'][i%6]};
      border:3px solid white;display:flex;align-items:center;justify-content:center;
      left:${x}px;top:${y}px;transform:translate(-50%,-50%);`;
    pawn.textContent=i+1;
    cont.appendChild(pawn);
  });
}

function showPossibleCases(currentPos,steps){
  const el=$('possibleCases'); if(!board) return; el.innerHTML='';
  const img=$('plateau'); const w=img.offsetWidth,h=img.offsetHeight;
  const reachable=new Set(); const q=[{pos:currentPos,rem:steps}];
  while(q.length){
    const {pos,rem}=q.shift();
    if(rem===0){ reachable.add(pos); continue; }
    if(pos<board.positions.length-1) q.push({pos:pos+1,rem:rem-1});
  }
  reachable.forEach(pos=>{
    const p=board.positions[pos]; const x=(p.x/100)*w, y=(p.y/100)*h;
    const d=document.createElement('div');
    d.style.cssText=`position:absolute;width:50px;height:50px;border-radius:50%;
      background:radial-gradient(circle,gold,orange);border:4px solid white;
      left:${x}px;top:${y}px;transform:translate(-50%,-50%);
      cursor:pointer;z-index:999;`;
    d.onclick = ()=>{ socket.emit('moveTo',{code:room,pos}); el.innerHTML=''; };
    el.appendChild(d);
  });
}

function startTimer(sec){
  if(timer) clearInterval(timer);
  const t=$('timer'); t.style.display='block'; t.textContent=sec+"s";
  timer=setInterval(()=>{
    sec--; t.textContent=sec+"s";
    if(sec<=0){ clearInterval(timer); t.style.display='none'; socket.emit("timeout",{code:room}); }
  },1000);
}

function updateScoreTable(players){
  const table=$('scoreTable'); table.innerHTML="<b>Scores :</b><br>";
  players.forEach(p=>{
    const line=document.createElement('div'); line.textContent=`${p.name}: ${p.score} pts`;
    line.dataset.id=p.id; line.style.cursor="pointer";
    line.onclick = ()=>{ socket.emit("selectPlayer",{code:room,target:p.id}); };
    if(activePlayers.includes(p.id)) line.style.fontWeight="bold";
    table.appendChild(line);
  });
}

$('createBtn').onclick = ()=> socket.emit('create',$('playerName').value||"Hôte");
$('joinBtn').onclick = ()=> socket.emit('join',{
  code:$('roomCode').value.trim().toUpperCase(),
  name:$('playerName').value||"Joueur"
});
$('startBtn').onclick = ()=> socket.emit('start',room);
$('rollBtn').onclick = ()=>{ socket.emit('roll',room); $('rollBtn').disabled=true; };
$('sendAnswerBtn').onclick = ()=>{ const v=$('answerInput').value.trim(); if(v) socket.emit('answer',{code:room,answer:v}); $('answerInput').value=''; };

socket.on("created", code=>{ room=code; showGame(); });
socket.on("joined", code=>{ room=code; showGame(); });
socket.on("boardData", b=>{ board=b; createActionCards(); });
socket.on("players", players=>{ updatePawns(players); updateScoreTable(players); });
socket.on("yourTurn", data=>{ currentPlayerId=data.playerId; activePlayers=[currentPlayerId]; $('rollBtn').disabled = currentPlayerId!==socket.id; });
socket.on("rolled", data=>{ $('diceResult').textContent = data.roll; if(socket.id===currentPlayerId) showPossibleCases(data.currentPos,data.roll); });
socket.on("actionDrawn", data=>{ document.querySelectorAll('.actionCard').forEach(c=>{ c.style.transform="scale(1)"; if(c.dataset.action===data.action) c.style.transform="scale(1.2)"; }); });
socket.on("activePlayers", ids=>{ activePlayers = ids; });
socket.on("question", data=>{ if(!activePlayers.includes(socket.id)) return; $('themeTitle').textContent=data.theme; $('questionText').textContent=data.question; $('questionBox').style.display='block'; startTimer(data.timer); });
socket.on("results", data=>{
  clearInterval(timer); $('timer').style.display="none";
  if(!data) return;
  $('resultText').textContent = data.correct ? "Bonne réponse" : "Mauvaise réponse";
  $('resultText').style.color = data.correct ? "#2e7d32" : "#c62828";
  $('resultBox').style.display='block';
  updateScoreTable(data.players);
  setTimeout(()=>{ $('questionBox').style.display='none'; $('resultBox').style.display='none'; },2500);
});
socket.on("clearQuestion", ()=>{ $('questionBox').style.display='none'; $('resultBox').style.display='none'; });

function showGame(){ $('menu').style.display='none'; $('game').style.display='block'; $('roomDisplay').textContent=room; socket.emit('requestBoard'); }
