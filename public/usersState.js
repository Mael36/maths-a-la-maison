console.log('🟢 usersState.js chargé');

// Objet qui contiendra les comptes côté client
let usersState = {};

// =====================
// Chargement des users depuis localStorage
// =====================
function loadUsersState() {
  const saved = localStorage.getItem('usersState');
  if (saved) {
    usersState = JSON.parse(saved);
    console.log('[USERS] État chargé depuis localStorage:', usersState);
  } else {
    // Initialisation avec le prof par défaut
    usersState = {
      1: {
        id: 1,
        username: "prof",
        role: "prof",
        passwordHash: "$2b$10$QqvmMCXGGu5ur.1ZGb1zcOQXSrfKFp5XepmbcERLWehVHbECdkX6e"
      }
    };
    console.log('[USERS] Aucun état trouvé, création du prof par défaut.');
    saveUsersState();
  }
}

// =====================
// Sauvegarde des users dans localStorage
// =====================
function saveUsersState() {
  localStorage.setItem('usersState', JSON.stringify(usersState));
  console.log('[USERS] État sauvegardé dans localStorage:', usersState);
}

// =====================
// Ajouter un utilisateur côté client
// =====================
async function createUser(username, password, role = 'student') {
  // hash simple côté client pour éviter stockage clair (optionnel)
  const hash = await bcrypt.hash(password, 10);
  const id = Date.now();
  usersState[id] = { id, username, role, passwordHash: hash };
  saveUsersState();
  console.log(`[USERS] Utilisateur créé: ${username} (${role})`);
}

// =====================
// Modifier le mot de passe côté client
// =====================
async function changePassword(username, oldPassword, newPassword) {
  const user = Object.values(usersState).find(u => u.username === username);
  if (!user) return false;
  const ok = await bcrypt.compare(oldPassword, user.passwordHash);
  if (!ok) return false;
  user.passwordHash = await bcrypt.hash(newPassword, 10);
  saveUsersState();
  return true;
}

// =====================
// Initialisation automatique
// =====================
loadUsersState();
