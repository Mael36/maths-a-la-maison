// public/solo.js
console.log('🟢 solo.js chargé');
let playerState = {
  level: 1,
  lives: 3,
  lastResetDate: null
};
let questions = [];
let currentQuestion = null;
let currentUser = null;
let STORAGE_KEY = null;

async function loadCurrentUser() {
  const res = await fetch('/api/me');
  if (!res.ok) {
    alert('Non connecté');
    window.location.href = '/login.html';
    return;
  }
  const data = await res.json();
  currentUser = data.username;
  STORAGE_KEY = `soloState_${currentUser}`;
  console.log('[SOLO] Utilisateur:', currentUser);
}


// =====================
// Chargement de l'état du joueur depuis localStorage
// =====================
function loadPlayerState() {
  if (!STORAGE_KEY) return;

  const savedState = localStorage.getItem(STORAGE_KEY);
  if (savedState) {
    playerState = JSON.parse(savedState);
    console.log('[SOLO] État chargé pour', currentUser, playerState);
  }
}


// =====================
// Sauvegarde de l'état du joueur dans localStorage
// =====================
function savePlayerState() {
  if (!STORAGE_KEY) return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(playerState));
  console.log('[SOLO] État sauvegardé pour', currentUser, playerState);
}

// =====================
// Vérification et reset des vies quotidiennes
// =====================
function checkDailyReset() {
  const today = new Date().toISOString().slice(0, 10);

  if (playerState.lastResetDate !== today) {
    playerState.lives = 3;
    playerState.lastResetDate = today;
    savePlayerState();
    console.log('[SOLO] Reset quotidien pour', currentUser);
  }
}


// =====================
// Chargement des questions (comme Python)
// =====================
async function loadQuestions() {
  try {
    const res = await fetch('./data.json');
    const data = await res.json();
    questions = [];
    // pour chaque catégorie, ajoute toutes les questions
    Object.values(data).forEach(category => {
      if (Array.isArray(category)) {
        category.forEach(q => {
          questions.push({
            id: q.id,
            q: q.q,
            a: q.a,
            d: q.d || q.a,
            img: q.img || null
          });
        });
      }
    });
    console.log('[SOLO] Questions chargées :', questions.length);
    if (questions.length === 0) {
      alert('Aucune question disponible');
      return;
    }
    showNextQuestion();
  } catch (e) {
    console.error('[SOLO] Erreur chargement questions:', e);
    alert('Erreur de chargement des questions');
  }
}

// =====================
// Choix question (ordre progressif)
// =====================
function pickQuestion() {
  if (playerState.level - 1 >= questions.length) return null;
  return questions[playerState.level - 1];
}

// =====================
// Affichage question
// =====================
function showNextQuestion() {
  checkAndResetDailyLives(); // Vérifier reset à chaque affichage
  if (playerState.lives <= 0) {
    alert('💀 Tu n’as plus de vies. Reviens demain.');
    const questionBoxEl = document.getElementById('questionBox');
    if (questionBoxEl) {
      questionBoxEl.style.display = 'none';
    }
    return;
  }
  const q = pickQuestion();
  console.log('[SOLO] Affichage question', q);
  if (!q) {
    alert('🎉 Félicitations, tu as terminé toutes les questions !');
    return;
  }
  currentQuestion = q;
  const themeEl = document.getElementById('themeTitle');
  const questionEl = document.getElementById('questionText');
  const imgEl = document.getElementById('questionImg');
  if (themeEl) {
    themeEl.textContent = `📘 Question ${playerState.level} / ${questions.length}`;
  }
  if (questionEl) {
    questionEl.textContent = q.q;
  }
  if (imgEl) {
    if (q.img) {
      imgEl.src = q.img;
      imgEl.style.display = 'block';
    } else {
      imgEl.style.display = 'none';
    }
  }
  const questionBoxEl = document.getElementById('questionBox');
  if (questionBoxEl) {
    questionBoxEl.style.display = 'block';
  }
  updateStats();
}

// =====================
// Vérification réponse via backend (Mistral)
// =====================
async function checkAnswerWithBackend(userAnswer, expectedAnswer) {
  try {
    const res = await fetch('/api/solo/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        answer: userAnswer,
        expected: expectedAnswer
      })
    });
    const data = await res.json();
    return data.correct === true;
  } catch (e) {
    console.error('[SOLO] Erreur backend:', e);
    return false;
  }
}

// =====================
// Affichage résultat
// =====================
function showResult(correct) {
  const resultBox = document.getElementById('resultBox');
  const resultText = document.getElementById('resultText');
  if (!resultBox || !resultText) return;
  resultText.textContent = correct ? '✅ Bonne réponse' : '❌ Mauvaise réponse';
  resultText.style.color = correct ? '#2e7d32' : '#c62828';
  resultBox.style.display = 'block';
  setTimeout(() => {
    resultBox.style.display = 'none';
    if (correct) {
      playerState.level++;
    } else {
      playerState.lives--;
      alert(`📌 Correction : ${currentQuestion.d}`);
    }
    savePlayerState(); // Sauvegarde après changement
    showNextQuestion();
  }, 1200);
}

// =====================
// Stats
// =====================
function updateStats() {
  const levelEl = document.getElementById('levelDisplay');
  const livesEl = document.getElementById('livesDisplay');
  if (levelEl) levelEl.textContent = playerState.level;
  if (livesEl) livesEl.textContent = `❤️ ${playerState.lives}`;
}

// =====================
// Bouton envoyer
// =====================
const sendBtn = document.getElementById('sendAnswerBtn');
if (sendBtn) {
  sendBtn.onclick = async () => {
    const input = document.getElementById('answerInput');
    if (!input || !currentQuestion) return;
    const userAnswer = input.value.trim();
    if (!userAnswer) return;
    input.value = '';
    const isCorrect = await checkAnswerWithBackend(
      userAnswer,
      currentQuestion.a
    );
    showResult(isCorrect);
  };
}

// =====================
// Reset complet (optionnel, par exemple via un bouton)
// =====================
function resetGame() {
  playerState = { level: 1, lives: 3, lastResetDate: new Date().toISOString().split('T')[0] };
  savePlayerState();
  updateStats();
  showNextQuestion();
}

// =====================
// Init
// =====================
document.addEventListener('DOMContentLoaded', async () => {
  console.log('🟢 DOM prêt');

  await loadCurrentUser();   
  loadPlayerState();         
  checkDailyReset();        

  updateStats();
  loadQuestions();
});


