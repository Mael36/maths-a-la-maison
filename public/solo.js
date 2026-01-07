// public/solo.js
console.log('🟢 solo.js chargé');

let playerState = {
  level: 1,
  lives: 3
};

let questions = [];
let currentQuestion = null;

// =====================
// Chargement des questions (MÊME LOGIQUE QUE PYTHON)
// =====================
async function loadQuestions() {
  try {
    const res = await fetch('./data.json');
    const data = await res.json();

    questions = [];

    // équivalent exact de :
    // for category in data.values(): questions.extend(category)
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
// Choix question (ordre progressif comme Python)
// =====================
function pickQuestion() {
  if (playerState.level - 1 >= questions.length) return null;
  return questions[playerState.level - 1];
}

// =====================
// Affichage question
// =====================
function showNextQuestion() {
  if (playerState.lives <= 0) {
    alert('💀 Tu n’as plus de vies. Reviens demain.');
    resetGame();
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

  updateStats();
}

// =====================
// Vérification réponse → BACKEND (MISTRAL)
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
// Résultat
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
// Reset
// =====================
function resetGame() {
  playerState = { level: 1, lives: 3 };
  updateStats();
  showNextQuestion();
}

// =====================
// Init
// =====================
document.addEventListener('DOMContentLoaded', () => {
  console.log('🟢 DOM prêt');
  updateStats();
  loadQuestions();
});





