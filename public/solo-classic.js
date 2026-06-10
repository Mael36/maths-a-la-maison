console.log('🟢 solo-classic.js chargé au', new Date().toLocaleString());

let questions = [];
let dailyOrder = [];
let currentLevel = 1;
let lives = 3;
let dailyScore = 0;
let dailyHighscore = 0;
let totalScore = 0;
let lastResetDate = null;

let currentUser = null;
let currentQuestion = null;

const STORAGE_KEY = 'soloClassic_';

// =====================
// Chargement utilisateur + logs + blocage strict
// =====================
function loadCurrentUser() {
  console.log('[LOAD USER] Début chargement utilisateur');

  const saved = localStorage.getItem('currentUser');
  if (!saved) {
    console.log('[LOAD USER] Pas d\'utilisateur connecté → redirection login');
    alert('Vous devez vous connecter.');
    window.location.href = '/login.html';
    return false;
  }

  const user = JSON.parse(saved);
  console.log('[LOAD USER] Utilisateur trouvé :', user.username, 'rôle :', user.role);

  if (user.role === 'prof') {
    console.log('[LOAD USER] Prof détecté → redirection prof.html');
    alert('Mode réservé aux élèves.');
    window.location.href = '/prof.html';
    return false;
  }

  currentUser = user.username;
  console.log('[LOAD USER] Username défini :', currentUser);

  // Chargement des données sauvegardées
  const key = STORAGE_KEY + currentUser;
  const savedData = localStorage.getItem(key);
  console.log('[LOAD USER] Recherche clé localStorage :', key);

  if (savedData) {
    const data = JSON.parse(savedData);
    console.log('[LOAD USER] Données chargées depuis localStorage :', data);

    currentLevel = data.level ?? 1;
    lives = data.lives ?? 3;
    dailyScore = data.dailyScore ?? 0;
    dailyHighscore = data.dailyHighscore ?? 0;
    totalScore = data.totalScore ?? 0;
    lastResetDate = data.lastResetDate ?? null;

    console.log('[LOAD USER] Valeurs appliquées :', {
      currentLevel, lives, dailyScore, dailyHighscore, totalScore, lastResetDate
    });
  } else {
    console.log('[LOAD USER] Aucune sauvegarde trouvée → valeurs par défaut');
  }

  const today = new Date().toISOString().slice(0, 10);
  console.log('[LOAD USER] Date du jour :', today);
  console.log('[LOAD USER] lastResetDate sauvegardée :', lastResetDate);
  console.log('[LOAD USER] Vies actuelles :', lives);

  if (lives <= 0 && lastResetDate === today) {
    console.log('[BLOCAGE] 0 vie détectée et même jour → REDIRECTION FORCÉE');
    alert('💀 Tu n’as plus de vies aujourd’hui ! Reviens demain pour une nouvelle tentative.');
    window.location.href = '/index.html';
    return false;
  }

  if (lastResetDate !== today) {
    console.log('[RESET] Nouveau jour détecté → reset vies et score');
    lives = 3;
    dailyScore = 0;
    currentLevel = 1;
    lastResetDate = today;
    saveAllData();
  } else {
    console.log('[RESET] Même jour → pas de reset, vies conservées :', lives);
  }

  console.log('[LOAD USER] Chargement utilisateur terminé avec succès');
  return true;
}

// =====================
// Sauvegarde avec log
// =====================
function saveAllData() {
  const key = STORAGE_KEY + currentUser;
  const dataToSave = { level: currentLevel, lives, dailyScore, dailyHighscore, totalScore, lastResetDate };
  localStorage.setItem(key, JSON.stringify(dataToSave));

  // Sauvegarde serveur
  fetch('/api/solo/score', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: currentUser,
      mode: 'classic',
      dailyScore,
      dailyHighscore,
      totalScore
    })
  }).catch(e => console.error('[SAVE SERVER] Erreur:', e));
}

// =====================
// Le reste du code (inchangé, mais avec logs si besoin)
// =====================
function getDailySeed() {
  const today = new Date().toISOString().slice(0, 10);
  let hash = 0;
  for (let i = 0; i < today.length; i++) {
    const char = today.charCodeAt(i);
    hash = (hash * 31 + char) & 0xFFFFFFFF;
  }
  const seed = hash >>> 0;
  console.log('[SEED] Seed du jour pour', today, ':', seed);
  return seed;
}

async function loadQuestions() {
  console.log('[QUESTIONS] Début chargement questions');
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

    console.log('[QUESTIONS] ' + questions.length + ' questions chargées');

    const seed = getDailySeed();
    dailyOrder = shuffleArray([...questions], seed);

    showQuestion();
    updateStats();
  } catch (e) {
    console.error('[QUESTIONS] Erreur :', e);
    alert('Erreur chargement questions');
  }
}

function shuffleArray(array, seed) {
  const arr = [...array];
  let s = seed >>> 0; // force en entier non signé

  function nextRand() {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0; // LCG standard
    return s / 0x100000000; // valeur entre 0 et 1
  }

  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(nextRand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }

  return arr;
}

function showQuestion() {
  console.log('[SHOW] Affichage question, vies :', lives, 'level :', currentLevel);
  const questionBox = document.getElementById('questionBox');

  if (lives <= 0) {
    console.log('[SHOW] Plus de vies → masquage question');
    alert('💀 Tu n’as plus de vies aujourd’hui. Reviens demain !');
    questionBox.style.display = 'none';
  } else {
    if (currentLevel > questions.length) {
      console.log('[SHOW] Toutes les questions terminées');
      alert('🎉 Bravo ! Tu as terminé toutes les questions du jour !');
      questionBox.style.display = 'none';
    } else {
      currentQuestion = dailyOrder[currentLevel - 1];
      document.getElementById('themeTitle').textContent = `📘 Question ${currentLevel} / ${questions.length}`;
      document.getElementById('questionText').textContent = currentQuestion.q;

      const imgEl = document.getElementById('questionImg');
      if (currentQuestion.img) {
        imgEl.src = currentQuestion.img;
        imgEl.style.display = 'block';
      } else {
        imgEl.style.display = 'none';
      }

      questionBox.style.display = 'block';
    }
  }

  updateStats();
}

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
      console.error('[MISTRAL] Erreur HTTP :', res.status);
      return false;
    }
    const data = await res.json();
    console.log('[MISTRAL] Réponse correct :', data.correct);
    return data.correct === true;
  } catch (e) {
    console.error('[MISTRAL] Erreur réseau :', e);
    return false;
  }
}

// =====================
// Gestion réponse (corrigée)
// =====================
async function handleAnswer(userAnswer) {
  const isCorrect = await checkAnswerWithBackend(userAnswer, currentQuestion.a);

  if (isCorrect) {
    currentLevel++;
    dailyScore = Math.min(dailyScore + 1, 560);
    totalScore++;

    // Mise à jour du highscore quotidien
    if (dailyScore > dailyHighscore) {
      dailyHighscore = dailyScore;
      console.log('[HIGHSCORE] Nouveau record quotidien :', dailyHighscore);
    }
  } else {
    lives--;
  }

  saveAllData();
  showQuestion();
  showResult(isCorrect,currentQuestion.a);
}

function showResult(correct, correction = '', detail = '') {
  const popup = document.createElement('div');
  popup.style.cssText = `
    position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
    background: white; padding: 30px; border-radius: 12px;
    box-shadow: 0 8px 30px rgba(0,0,0,0.4); z-index: 1000;
    max-width: 500px; text-align: center;
  `;

  popup.innerHTML = `
    <h2 style="color: ${correct ? '#2e7d32' : '#c62828'};">${correct ? 'Bonne réponse !' : 'Mauvaise réponse'}</h2>
    <p style="font-size: 1.2em; margin: 15px 0;">${correct ? 'Bravo !' : ''}</p>
  `;

  if (!correct) {
    if (correction) {
      popup.innerHTML += `
        <div style="background: #f5f5f5; padding: 15px; border-radius: 8px; text-align: left; margin: 20px 0;">
          <strong>Bonne réponse :</strong> ${correction}<br><br>
          ${detail ? `<strong>Détail :</strong> ${detail}` : ''}
        </div>
      `;
    }
  }

  document.body.appendChild(popup);

  setTimeout(() => popup.remove(), correct ? 2000 : 5000);
}

function updateStats() {
  console.log('[STATS] Mise à jour avec :', {
    currentLevel, lives, dailyScore, dailyHighscore, totalScore
  });

  const levelEl = document.getElementById('levelDisplay');
  const livesEl = document.getElementById('livesDisplay');
  const extraEl = document.getElementById('extraStats');

  if (levelEl) levelEl.textContent = currentLevel;
  if (livesEl) livesEl.textContent = `❤️ ${lives}`;
  if (extraEl) {
    extraEl.innerHTML = `
      Score du jour : ${dailyScore}/560<br>
      Meilleur du jour : ${dailyHighscore}<br>
      Score total : ${totalScore}
    `;
  }
}

document.getElementById('sendAnswerBtn')?.addEventListener('click', async () => {
  const input = document.getElementById('answerInput');
  if (!input || !currentQuestion) return;
  const userAnswer = input.value.trim();
  if (!userAnswer) return;
  input.value = '';
  await handleAnswer(userAnswer);
});

document.addEventListener('DOMContentLoaded', () => {
  console.log('[INIT] DOM chargé, début initialisation');
  if (!loadCurrentUser()) {
    console.log('[INIT] loadCurrentUser a retourné false → arrêt');
    return;
  }
  loadQuestions();

});


