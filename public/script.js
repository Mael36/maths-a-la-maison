// =========================================================
// VARIABLES GLOBALES
// =========================================================
const socket = io();

let board = null;
let lastPlayersState = [];
let currentAction = null;
let awaitingChoice = false;
let chosenTargetPlayer = null;
let chosenAction = null;

let timer = null;
let remaining = 0;

const $ = id => document.getElementById(id);

// =========================================================
// CHARGEMENT DU PLATEAU
// =========================================================
$('plateau').addEventListener("load", () => {
    if (board && lastPlayersState.length > 0) {
        updatePawns(lastPlayersState);
    }
});

window.addEventListener("resize", () => {
    if (board && lastPlayersState.length > 0) {
        updatePawns(lastPlayersState);
    }
});

// =========================================================
// CHARGEMENT DU BOARD
// =========================================================
fetch('/board.json')
    .then(r => r.json())
    .then(json => {
        board = json;
        console.log("Plateau chargé", board);
        updatePawns(lastPlayersState);
    });

// =========================================================
// SOCKET.IO
// =========================================================
socket.on('players', players => {
    lastPlayersState = players;
    updatePawns(players);
    updateScoreTable(players);
});

socket.on('question', q => {
    displayQuestion(q);
});

socket.on('timer', t => {
    startTimer(t);
});

socket.on('feedback', f => {
    showFeedback(f);
});

// =========================================================
// TABLEAU DES SCORES
// =========================================================
function updateScoreTable(players) {
    const tab = $('scores');
    tab.innerHTML = "";

    players.forEach(p => {
        const line = document.createElement("div");
        line.className = "scoreLine";
        line.innerHTML = `
            <strong>${p.name}</strong> — ${p.points} pts — Case ${p.pos}
        `;
        tab.appendChild(line);
    });
}

// =========================================================
// POSITIONNEMENT DES PIONS (robuste + responsive)
// =========================================================
function updatePawns(players) {
    const cont = $('pions');
    const img = $('plateau');

    if (!cont || !board) return;

    if (!img.complete || img.naturalWidth === 0) {
        setTimeout(() => updatePawns(players), 50);
        return;
    }

    const w = img.clientWidth;
    const h = img.clientHeight;

    cont.innerHTML = "";

    players.forEach((p, i) => {
        const posIndex = Math.max(0, Math.min(board.positions.length - 1, p.pos));
        const pos = board.positions[posIndex];

        const x = (pos.x / 100) * w;
        const y = (pos.y / 100) * h;

        const pawn = document.createElement("div");
        pawn.className = "pawn";
        pawn.style.left = `${x}px`;
        pawn.style.top = `${y}px`;

        pawn.style.background = [
            "#e53935","#43a047","#fb8c00","#1e88e5","#8e24aa","#fdd835"
        ][i % 6];

        pawn.textContent = (i + 1);
        cont.appendChild(pawn);
    });
}

// =========================================================
// AFFICHAGE DES QUESTIONS
// =========================================================
function displayQuestion(q) {
    $('question').textContent = q.text;

    const repCtn = $('reponses');
    repCtn.innerHTML = "";

    q.answers.forEach((r, i) => {
        const btn = document.createElement("button");
        btn.className = "repBtn";
        btn.textContent = r;

        btn.onclick = () => sendAnswer(i);

        repCtn.appendChild(btn);
    });
}

// =========================================================
// ENVOI DES RÉPONSES
// =========================================================
function sendAnswer(i) {
    socket.emit("answer", i);
}

// =========================================================
// TIMER
// =========================================================
function startTimer(t) {
    remaining = t;
    $('timer').textContent = `${remaining}s`;

    if (timer) clearInterval(timer);

    timer = setInterval(() => {
        remaining--;
        $('timer').textContent = `${remaining}s`;

        if (remaining <= 0) clearInterval(timer);
    }, 1000);
}

// =========================================================
// FEEDBACK (corrigé + délai 2.5 sec)
// =========================================================
function showFeedback(f) {
    const fb = $('feedback');
    fb.style.display = "block";

    if (f.good === true) fb.textContent = "Bonne réponse !";
    else fb.textContent = "Mauvaise réponse...";

    setTimeout(() => {
        fb.style.display = "none";
    }, 2500);
}

// =========================================================
// GESTION DES ACTIONS
// =========================================================
socket.on("action", data => {
    currentAction = data.type;
    chosenTargetPlayer = null;
    chosenAction = null;

    switch (data.type) {

        case "second_life":
            alert("Seconde vie : tu peux te tromper une première fois !");
            break;

        case "double_or_quits":
            alert("Double or Quits : bonne réponse = points ×2, sinon = 0 !");
            break;

        case "quadruple":
            alert("Quadruple : +4 points si bonne réponse !");
            break;

        case "no_way":
            alert("No way : si tu te trompes, tout le monde gagne 1 point sauf toi !");
            break;

        case "flash":
            alert("Flash ! Seulement 30 secondes !");
            break;

        case "for_you":
            awaitingChoice = true;
            askPlayerChoice("Choisis un joueur pour répondre à ta place");
            break;

        case "call_a_friend":
            awaitingChoice = true;
            askPlayerChoice("Choisis le joueur qui répondra avec toi");
            break;

        case "its_your_choice":
            awaitingChoice = true;
            askActionChoice();
            break;
    }
});

// =========================================================
// CHOIX D'UN JOUEUR
// =========================================================
function askPlayerChoice(msg) {
    const ctn = $('choice');
    ctn.innerHTML = `<h3>${msg}</h3>`;

    lastPlayersState.forEach(p => {
        const btn = document.createElement("button");
        btn.className = "choiceBtn";
        btn.textContent = p.name;

        btn.onclick = () => {
            chosenTargetPlayer = p.id;
            socket.emit("action_choice", {
                action: currentAction,
                target: p.id
            });

            ctn.innerHTML = "";
            awaitingChoice = false;
        };

        ctn.appendChild(btn);
    });
}

// =========================================================
– CHOIX D’UNE ACTION
// =========================================================
function askActionChoice() {
    const actions = [
        "second_life",
        "double_or_quits",
        "quadruple",
        "no_way",
        "flash"
    ];

    const ctn = $('choice');
    ctn.innerHTML = `<h3>Choisis ton action</h3>`;

    actions.forEach(a => {
        const btn = document.createElement("button");
        btn.className = "choiceBtn";
        btn.textContent = a;

        btn.onclick = () => {
            chosenAction = a;
            socket.emit("action_choice", {
                action: "its_your_choice",
                chosen: a
            });

            ctn.innerHTML = "";
            awaitingChoice = false;
        };

        ctn.appendChild(btn);
    });
}
