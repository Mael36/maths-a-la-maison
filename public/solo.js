// public/solo.js

let playerState = { level: 1, lives: 3 };
let questions = [];

// --- charger les questions depuis le JSON serveur ---
async function loadQuestions() {
  try {
    // adapte l'URL selon ton serveur
    const res = await fetch('./data.json');
    const data = await res.json();

    // aplatir toutes les catégories si data.categories existe
    if (data.categories) {
      questions = Object.entries(data.categories).flatMap(([theme, qs]) =>
        qs.map(q => ({ theme, question: q.question || q.expression || q.consigne || '', answer: q.correction || q.answer || q.reponse || '' }))
      );
    }

    if (questions.length === 0) {
      alert('Aucune question disponible !');
    } else {
      showNextQuestion();
    }
  } catch (e) {
    console.error('Impossible de charger les questions :', e);
    alert('Erreur de chargement des questions');
  }
}

// --- choisir une question au hasard ---
function pickQuestion() {
  if (!questions || questions.length === 0) return null;
  return questions[Math.floor(Math.random() * questions.length)];
}

// --- afficher question ---
function showNextQuestion() {
  const q = pickQuestion();
  if (!q) {
    alert('Aucune question disponible');
    return;
  }
  window.currentQuestion = q; // stocker pour vérifier la réponse

  const themeEl = document.getElementById('themeTitle');
  const questionEl = document.getElementById('questionText');

  if (themeEl) themeEl.textContent = q.theme || 'Général';
  if (questionEl) questionEl.textContent = q.question || '';
}

// --- afficher résultat ---
function showResult(correct) {
  const resultBox = document.getElementById('resultBox');
  const resultText = document.getElementById('resultText');

  if (!resultBox || !resultText) return;

  resultText.textContent = correct ? 'Bonne réponse ✅' : 'Mauvaise réponse ❌';
  resultText.style.color = correct ? '#2e7d32' : '#c62828';
  resultBox.style.display = 'block';

  setTimeout(() => {
    resultBox.style.display = 'none';
    updateStats();
    showNextQuestion();
  }, 1200);
}

// --- mettre à jour le compteur niveau/vies ---
function updateStats() {
  const levelEl = document.getElementById('levelDisplay');
  const livesEl = document.getElementById('livesDisplay');

  if (levelEl) levelEl.textContent = playerState.level;
  if (livesEl) livesEl.textContent = `❤️ ${playerState.lives}`;
}

// --- gestion du clic "Envoyer" ---
const sendBtn = document.getElementById('sendAnswerBtn');
if (sendBtn) {
  sendBtn.onclick = () => {
    const input = document.getElementById('answerInput');
    const q = window.currentQuestion;
    if (!q || !input) return;

    const answer = input.value.trim().toLowerCase();
    const correctAnswer = (q.answer || '').toString().trim().toLowerCase();

    if (answer === correctAnswer) {
      playerState.level++;
      showResult(true);
    } else {
      playerState.lives--;
      showResult(false);
    }

    input.value = '';

    // fin de partie si plus de vies
    if (playerState.lives <= 0) {
      alert('Game Over 😢');
      playerState = { level: 1, lives: 3 };
      updateStats();
      showNextQuestion();
    }
  };
}

// --- initialisation ---
updateStats();
loadQuestions();

