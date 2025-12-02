// public/script.js
const socket = io();
let room = null;
let board = null;
let timer = null;
let currentPlayerId = null;
let activePlayers = [];

const $ = id => document.getElementById(id);

function createActionCards() {
  const grid = $('actionGrid');
  if (!grid || grid.children.length) return;

  const actions = [
    "Flash","Battle on left","Battle on right","Call a friend","For you",
    "Second life","No way","Double","Téléportation","+1 ou -1",
    "Everybody","Double or quits","It's your choice","Quadruple"
  ];

  grid.innerHTML = '';
  actions.forEach(a=>{
    const card = document.createElement('div');
    card.className = 'actionCard';
    card.innerHTML = `<h4>${a}</h4>`;
    grid.appendChild(card);
  });
}

function updatePawns(players) {
  const container = $('pions');
  if (!container || !board) return;
  container.innerHTML = '';
  const img = $('plateau');
  const w = img.offsetWidth, h = img.offsetHeight;

  players.forEach((p,i) => {
    const posIndex = Math.min(Math.max(p.pos||0,0), board.positions.length-1);
    const pos = board.positions[posIndex];
    const x = (pos.x/100)*w;
    const y = (pos.y/100)*h;

    const pawn = document.createElement('div');
    pawn.style.cssText = `
      position:absolute;width:35px;height:35px;border-radius:50%;
      background:${['#d32f2f','#388e3c','#fbc02d','#1976d2','#f57c00','#7b1fa2'][i%6]};
      border:3px solid white;display:flex;align-items:center;justify-content:center;
      left:${x}px;top:${y}px;transform:translate(-50%,-50%);
    `;
    pawn.textContent = i+1;
    pawn.title = `${p.name} – ${p.score} pts`;
    container.appendChild(pawn);
  });
}

function showPossibleCases(currentPos, steps) {
  if(!board) return;
  const reachable = new Set();
  const q = [{pos:currentPos, rem:steps}];
  while(q.length){
    const {pos, rem} = q.shift();
    if(rem===0){ reachable.add(pos); continue; }
    if(pos<board.positions.length-1) q.push({pos:pos+1, rem:rem-1});
  }

  const el = $('possibleCases');
  el.innerHTML='';
  const img = $('plateau');
  const w = img.offsetWidth, h = img.offsetHeight;

  reachable.forEach(pos=>{
    const p = board.positions[pos];
    const x=(p.x/100)*w, y=(p.y/100)*h;
    const spot = document.createElement('div');
    spot.style.cssText = `
      position:absolute;width:50px;height:50px;border-radius:50%;
      background:radial-gradient(circle,gold,orange);border:4px solid white;
      left:${x}px;top:${y}px;transform:translate(-50%,-50%);
      cursor:pointer;z-index:999;
    `;
    spot.onclick = ()=>{ socket.emit('moveTo',{code:room,pos}); el.innerHTML=''; };
    el.appendChild(spot);
  });
}

function startTimer(sec){
  if(timer) clearInterval(timer);
  const el=$('timer');
  el.style.display='block';
  let t=sec;
  el.textContent=t+'s';
  timer=setInterval(()=>{
    t--;
    el.textContent=t+'s';
    if(t<=0){ clearInterval(timer); el.style.display='none'; clearInterval(timer); }
  },1000);
}

function updateScoreTable(players){
  const container=$('scoreTable');
  if(!container){
    const table=document.createElement('div');
    table.id='scoreTable';
    table.style.cssText='position:absolute;top:10px;right:10px;background:#fff;padding:5px;border-radius:5px;';
    document.body.appendChild(table);
  }
  const table=$('scoreTable');
  table.innerHTML='<b>Scores :</b><br>';
  players.forEach((p,i)=>{
    const line=document.createElement('div');
    line.textContent=`${p.name}: ${p.score} pts`;
    if(activePlayers.includes(p.id)){
      line.style.fontWeight='bold';
      if(currentPlayerId && currentPlayerId!==p.id){
        line.style.opacity='0.5';
      }
    }
    line.dataset.playerId=p.id;
    line.onclick = ()=>{ socket.emit('selectPlayer',{target:p.id, code:room}); };
    table.appendChild(line);
  });
}

// UI wiring
$('createBtn').onclick = () => socket.emit('create',$('playerName').value||'Hôte');
$('joinBtn').onclick = () => socket.emit('join',{code:$('roomCode').value.trim().toUpperCase(),name:$('playerName').value||'Joueur'});
$('startBtn').onclick = () => socket.emit('start', room);
$('rollBtn').onclick = ()=>{ socket.emit('roll',room); $('rollBtn').disabled=true; };
$('sendAnswerBtn').onclick = ()=>{
  const ans=$('answerInput').value.trim();
  if(ans) socket.emit('answer',{code:room,answer:ans});
  $('answerInput').value='';
};

// Socket events
socket.on('created', code=>{ room=code; showGame(); });
socket.on('joined', code=>{ room=code; showGame(); });
socket.on('boardData', b=>{ board=b; createActionCards(); updatePawns([]); });
socket.on('players', players=>{ updatePawns(players); updateScoreTable(players); });

socket.on('yourTurn', data=>{
  currentPlayerId=data?.playerId||null;
  activePlayers=[currentPlayerId];
  $('rollBtn').disabled = currentPlayerId!==socket.id;
  $('rollBtn').textContent='Lancer le dé';
});

socket.on('rolled', data=>{
  if(!data) return;
  const isActive = activePlayers.includes(socket.id);
  if(isActive) showPossibleCases(data.currentPos, data.roll);
});

socket.on('actionDrawn', data=>{
  if(!data) return;
  document.querySelectorAll('.actionCard').forEach(c=>c.style.transform='scale(1)');
  document.querySelectorAll('.actionCard').forEach(c=>{
    if(c.textContent.includes(data.action)) c.style.transform='scale(1.2)';
  });
});

socket.on('question', data=>{
  if(!data) return;
  const isActive = activePlayers.includes(socket.id);
  if(!isActive) return;
  $('themeTitle').textContent=data.theme||'Général';
  $('questionText').textContent=data.question;
  $('questionBox').style.display='block';
  startTimer(data.timer||60);
});

socket.on('timeOut', data=>{
  clearInterval(timer); $('timer').style.display='none';
  $('resultText').textContent=data?.message||'Temps écoulé';
  $('resultText').style.color='#f44336';
  $('resultBox').style.display='block';
  setTimeout(()=>{ $('resultBox').style.display='none'; $('questionBox').style.display='none'; },2500);
});

socket.on('results', data=>{
  clearInterval(timer); $('timer').style.display='none';
  if(!data) return;
  $('resultText').textContent = data.correct ? 'Bonne réponse' : 'Mauvaise réponse';
  $('resultText').style.color = data.correct ? '#388e3c' : '#f44336';
  $('resultBox').style.display='block';
  updateScoreTable(data.players);
  setTimeout(()=>{ $('questionBox').style.display='none'; $('resultBox').style.display='none'; },2500);
});

socket.on('actionClear', ()=>{ document.querySelectorAll('.actionCard').forEach(c=>c.style.transform='scale(1)'); });

function showGame(){
  $('menu').style.display='none';
  $('game').style.display='block';
  $('roomDisplay').textContent=room;
  socket.emit('requestBoard');
}
