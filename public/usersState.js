console.log('🟢 usersState.js chargé');

// Users stockés dans localStorage
if (!localStorage.getItem('usersState')) {
  const defaultUsers = {
    "1": {
      id: 1,
      username: "prof",
      role: "prof",
      passwordHash: "$2b$10$QqvmMCXGGu5ur.1ZGb1zcOQXSrfKFp5XepmbcERLWehVHbECdkX6e"
    }
  };
  localStorage.setItem('usersState', JSON.stringify(defaultUsers));
}

function getUsers() {
  return JSON.parse(localStorage.getItem('usersState') || '{}');
}

function saveUsers(users) {
  localStorage.setItem('usersState', JSON.stringify(users));
}

// création utilisateur
async function createUser(username, password, role='student') {
  const users = getUsers();
  const id = Date.now();
  const hash = await dcodeIO.bcrypt.hash(password, 10);  // <-- ici
  users[id] = { id, username, role, passwordHash: hash };
  saveUsers(users);
}


async function changePassword(username, oldPassword, newPassword) {
  const users = getUsers();
  const user = Object.values(users).find(u => u.username === username);
  if (!user) return false;

  const ok = await dcodeIO.bcrypt.compare(oldPassword, user.passwordHash); // <-- ici
  if (!ok) return false;

  user.passwordHash = await dcodeIO.bcrypt.hash(newPassword, 10); // <-- ici
  saveUsers(users);
  return true;
}


const usersState = getUsers();
