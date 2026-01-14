// public/solo-infinite.js
console.log('🟢 solo-infinite.js chargé');

let questions = [];
let currentOrder = [];
let currentIndex = 0;
let score = 0;

let currentUser = null;
let currentQuestion = null;

const STORAGE_KEY = 'soloInfinite_';

// =====================
// Chargement utilisateur
// =====================
function loadCurrentUser() {
  const saved = localStorage.getItem('currentUser');
  if (!saved) {
    alert('Connexion requise.');
    window.location.href = '/login.html';
    return false;
  }
  const user = JSON.parse(saved);
  if (user.role === 'prof') {
    alert('Mode réservé aux élèves.');
    window.location.href = '/prof.html';
    return false;
  }
  currentUser = user.username;
  loadSaveData();
  return true;
}

// =====================
// Sauvegarde
// =====================
function loadSaveData() {
  const key = STORAGE_KEY + currentUser;
  const saved = localStorage.getItem(key);
  if (saved) {
    const data = JSON.parse(saved);
    score = data.score || 0;
    currentIndex = data.currentIndex || 0;
  }
}

function saveAllData() {
  const key = STORAGE_KEY + currentUser;
  localStorage.setItem(key, JSON.stringify({ score, currentIndex }));
}

// =====================
// Chargement questions + premier mélange
// =====================
async function loadQuestions() {
  try {
    const res = await fetch('/data.json');
    if (!res.ok) throw new Error('Fichier non trouvé');
    const data = await res.json();

    questions = [];
    Object.values(data).forEach(category => {
      if (Array.isArray(category)) {
        category.forEach(q => {
          questions.push({
            id: q.id,
            q: q.q?.trim() || '',
            a: q.a?.trim() || '',
            d: (q.d || q.a)?.trim() || '',
            img: q.img || null
          });
        });
      }
    });

    console.log('[INFINI] Questions chargées :', questions.length);

    newLoop();
    showQuestion();
    updateStats();
  } catch (e) {
    console.error(e);
    alert('Erreur chargement');
  }
}

// Nouveau mélange aléatoire pour la boucle
function newLoop() {
  currentOrder = [...questions];
  for (let i = currentOrder.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [currentOrder[i], currentOrder[j]] = [currentOrder[j], currentOrder[i]];
  }
  if (currentIndex >= currentOrder.length) {
    currentIndex = 0;
  }
}

// =====================
// Affichage
// =====================
function showQuestion() {
  if (currentIndex >= currentOrder.length) {
    newLoop();
    currentIndex = 0;
  }

  currentQuestion = currentOrder[currentIndex];
  document.getElementById('themeTitle').textContent = `Score : ${score}`;
  document.getElementById('questionText').textContent = currentQuestion.q;

  const imgEl = document.getElementById('questionImg');
  if (currentQuestion.img) {
    imgEl.src = currentQuestion.img;
    imgEl.style.display = 'block';
  } else {
    imgEl.style.display = 'none';
  }

  document.getElementById('questionBox').style.display = 'block';
}

// =====================
// Vérification avec Mistral
// =====================
async function checkAnswerWithBackend(userAnswer, expectedAnswer) {
  try {
    const res = await fetch('/api/solo/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        answer: userAnswer.trim(),
        expected: expectedAnswer.trim()
      })
    });

    if (!res.ok) {
      console.error('Erreur HTTP Mistral:', res.status);
      return false;
    }

    const data = await res.json();
    return data.correct === true;
  } catch (e) {
    console.error('Erreur réseau Mistral:', e);
    return false;
  }
}

// =====================
// Réponse
// =====================
async function handleAnswer(userAnswer) {
  const isCorrect = await checkAnswerWithBackend(userAnswer, currentQuestion.a);

  if (isCorrect) {
    score++;
  }
  // Mauvaise réponse → rien, on continue

  currentIndex++;
  saveAllData();
  showQuestion();
  showResult(isCorrect);
  updateStats();
}

function showResult(correct) {
  const box = document.getElementById('resultBox');
  const text = document.getElementById('resultText');
  text.textContent = correct ? '✅ Bonne réponse' : '❌ Mauvaise réponse';
  text.style.color = correct ? '#2e7d32' : '#c62828';
  box.style.display = 'block';
  setTimeout(() => box.style.display = 'none', 1200);
}

function updateStats() {
  document.getElementById('levelDisplay').textContent = currentIndex + 1;
  document.getElementById('livesDisplay').textContent = '∞';
  document.getElementById('extraStats').innerHTML = `Score total : ${score}`;
}

// =====================
// Envoi
// =====================
document.getElementById('sendAnswerBtn')?.addEventListener('click', async () => {
  const input = document.getElementById('answerInput');
  if (!input || !currentQuestion) return;
  const userAnswer = input.value.trim();
  if (!userAnswer) return;
  input.value = '';
  await handleAnswer(userAnswer);
});

// =====================
// Init
// =====================
document.addEventListener('DOMContentLoaded', () => {
  if (!loadCurrentUser()) return;
  loadQuestions();
});