// server/soloManager.js
const players = {};

function getPlayer(id) {
  if (!players[id]) {
    players[id] = { id, level: 1, lives: 3, score: 0 };
  }
  return players[id];
}

function winLevel(id) {
  if (!players[id]) players[id] = { id, level: 1, lives: 3, score: 0 };
  players[id].level++;
  players[id].score += 10; // par ex.
}

function loseLife(id) {
  if (!players[id]) players[id] = { id, level: 1, lives: 3, score: 0 };
  players[id].lives--;
  if (players[id].lives < 0) players[id].lives = 0;
}

module.exports = { getPlayer, winLevel, loseLife };
