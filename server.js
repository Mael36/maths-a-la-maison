import express from "express";
import http from "http";
import { Server } from "socket.io";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, "public")));

// ---------------------------------------------------------
// 1. Chargement sécurisé des questions
// ---------------------------------------------------------

let questions = [];

try {
  const dataPath = path.join(__dirname, "public/data.json");
  const raw = fs.readFileSync(dataPath, "utf8");
  const json = JSON.parse(raw);

  // Le JSON reçu est un OBJET avec des catégories
  // => on l'aplatit en un tableau unique
  questions = Object.values(json).flat();

  console.log("Questions chargées :", questions.length);

} catch (e) {
  console.error("❌ Erreur chargement data.json :", e);
}

// ---------------------------------------------------------
// 2. Chargement du board
// ---------------------------------------------------------

let board = null;

try {
  const boardPath = path.join(__dirname, "public/data/board.json");
  const raw = fs.readFileSync(boardPath, "utf8");
  board = JSON.parse(raw);
  console.log("Board chargé :", board.totalCases, "cases");
} catch (e) {
  console.error("❌ Erreur chargement board.json :", e);
}


// ---------------------------------------------------------
// 3. SOCKET.IO
// ---------------------------------------------------------

io.on("connection", (socket) => {
  console.log("🔌 Nouveau joueur connecté");

  socket.on("joinRoom", (roomId) => {
    socket.join(roomId);
    console.log("➡️ Joueur rejoint la room", roomId);

    // Envoi du plateau
    socket.emit("boardData", board);
  });

  socket.on("requestQuestion", (roomId) => {
    const q = questions[Math.floor(Math.random() * questions.length)];
    io.to(roomId).emit("newQuestion", q);
  });
});


// ---------------------------------------------------------
// 4. Lancement serveur (Railway-friendly)
// ---------------------------------------------------------

const port = process.env.PORT || 8080;
server.listen(port, () => {
  console.log("Serveur lancé sur le port", port);
});
