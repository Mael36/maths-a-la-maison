// =============================
// VARIABLES GLOBALES
// =============================
const socket = io();

let board = null;
let lastPlayersState = [];
let currentAction = null;
let awaitingChoice = false;
let chosenTargetPlayer = null;
let chosenAction = null;

let timer = null;
let remaining = 0;

// =============================
// RACC. POUR LE DOM
// =============================
const $ = id => document.getElementById(id);

// =============================
// CHARGEMENT DU PLATEAU
// =============================
$('plateau').addEventListener("load", () => {
    if (board && lastPlayersState.length > 0) {
        updatePawns(lastPlayersState);
    }
});

// Recalcule la position des pions en cas de resize
window.addEventListener("resize", () => {
    if (board && lastPlayersState.length > 0) {
        updatePawns(lastPlayersState);
    }
});

// =============================
// CHARGEMENT DU BOARD.JSON
// =============================
fetch('/board.json')
    .then(r => r.json())
    .then(json => {
        board = json;
        console.log("Plateau chargé:", board);
    });

// =============================
// SOCKET.IO
// =============================
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

// =============================
// AFFICHAGE DU TABLEAU DES SCORES
// =============================
function updateScoreTable(players) {
    const tab = $('scores');
    tab.innerHTML = "";

    players.forEach(p => {
        const line = document.createElement("div");
        line.className = "scoreLine";
        line.innerHTML = `<strong>${p.name}</strong> — ${p.points} pts — Position: ${p.pos}`;
        tab.appendChild(line);
    });
}

// =============================
// POSITIONNEMENT **ROBUSTE** DES PIONS
// =============================
function updatePawns(players) {
    const cont = $('pions');
    const img = $('plateau');

    if (!cont || !board) return;

    // Attente que l'image soit chargée
    if (!img.complete || img.naturalWidth === 0) {
        setTimeout(() => updatePawns(players), 50);
        return;
    }

    const w = img.offsetWidth;
    const h = img.offsetHeight;

    cont.innerHTML = "";

    players.forEach((p, i) => {
        const posIndex = Math.max(0, Math.min(board.positions.length - 1, p.pos));
        const pos = board.positions[posIndex];

        const x = (pos.x / 100) * w;
        const y = (pos.y / 100) * h;

        const pawn = document.createElement('div');
        pawn.className = "pawn";

        pawn.style.left = x + "px";
        pawn.style.top = y + "px";
        pawn.style.background = [
            '#d32f2f','#388e3c','#fbc02d','#1976d2','#f57c00','#7b1fa2'
        ][i % 6];

        pawn.textContent = (i + 1);
        cont.appendChild(pawn);
    });
}

// =============================
// AFFICHAGE DES QUESTIONS
// =============================
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

// =============================
// ENVOI DE RÉPONSE
// =============================
function sendAnswer(i) {
    socket.emit("answer", i);
}

// =============================
// TIMER
// =============================
function startTimer(t) {
    remaining = t;
    $('timer').textContent = remaining + " sec";

    if (timer) clearInterval(timer);

    timer = setInterval(() => {
        remaining--;
        $('timer').textContent = remaining + " sec";

        if (remaining <= 0) {
            clearInterval(timer);
        }
    }, 1000);
}

// =============================
// FEEDBACK
// =============================
function showFeedback(f) {
    const fb = $('feedback');
    fb.style.display = "block";
    fb.textContent = f.good ? "Bonne réponse !" : "Mauvaise réponse...";

    // Laisse 2 secondes d'affichage
    setTimeout(() => {
        fb.style.display = "none";
    }, 2000);
}

// =============================
// GESTION DES ACTIONS SPÉCIALES
// =============================
socket.on("action", data => {
    currentAction = data.type;
    chosenTargetPlayer = null;
    chosenAction = null;

    switch(data.type) {

        // ======================
        // SECOND LIFE
        // ======================
        case "second_life":
            alert("Tu as une seconde chance : 1ère erreur gratuite.");
            break;

        // ======================
        // DOUBLE OR QUITS
        // ======================
        case "double_or_quits":
            alert("Double Or Quits : si tu réponds bien, tes points doublent, sinon 0 !");
            break;

        // ======================
        // QUADRUPLE
        // ======================
        case "quadruple":
            alert("Quadruple : +4 pts si bonne réponse, 0 sinon.");
            break;

        // ======================
        // NO WAY
        // ======================
        case "no_way":
            alert("No Way : +1 si bonne réponse, mais +1 aux autres si tu te trompes !");
            break;

        // ======================
        // FLASH
        // ======================
        case "flash":
            alert("Flash : tu n'as que 30 secondes !");
            break;

        // ======================
        // FOR YOU → choisir un joueur
        // ======================
        case "for_you":
            askPlayerChoice("Choisis un joueur pour répondre à ta place");
            awaitingChoice = true;
            break;

        // ======================
        // CALL A FRIEND → choisir un joueur
        // ======================
        case "call_a_friend":
            askPlayerChoice("Choisis un joueur qui pourra t'aider");
            awaitingChoice = true;
            break;

        // ======================
        // IT'S YOUR CHOICE → choisir une action
        // ======================
        case "its_your_choice":
            askActionChoice();
            awaitingChoice = true;
            break;
    }
});

// =============================
// CHOIX D'UN JOUEUR
// =============================
function askPlayerChoice(msg) {
    const ctn = $('choice');
    ctn.innerHTML = `<h3>${msg}</h3>`;

    lastPlayersState.forEach(p => {
        const btn = document.createElement("button");
        btn.className = "choiceBtn";
        btn.textContent = p.name;
        btn.onclick = () => {
            chosenTargetPlayer = p.id;
            socket.emit("action_choice", { action: currentAction, target: p.id });
            ctn.innerHTML = "";
            awaitingChoice = false;
        };
        ctn.appendChild(btn);
    });
}

// =============================
// CHOIX D'UNE ACTION
// =============================
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
            socket.emit("action_choice", { action: "its_your_choice", chosen: a });
            ctn.innerHTML = "";
            awaitingChoice = false;
        };
        ctn.appendChild(btn);
    });
}
