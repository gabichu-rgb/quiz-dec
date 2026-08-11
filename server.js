const express = require('express');
const { WebSocketServer } = require('ws');
const http = require('http');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.static(path.join(__dirname, 'public')));

// Estado del juego
let gameState = {
  phase: 'waiting', // waiting | question | between | results
  currentQ: 0,
  players: {}       // { id: { name, score, answers[] } }
};

let clients = {};  // { id: ws }
let clientId = 0;

function broadcast(msg) {
  const data = JSON.stringify(msg);
  Object.values(clients).forEach(ws => {
    if (ws.readyState === 1) ws.send(data);
  });
}

function sendTo(id, msg) {
  const ws = clients[id];
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
}

function getLeaderboard() {
  return Object.values(gameState.players)
    .sort((a, b) => b.score - a.score)
    .map(p => ({ name: p.name, score: p.score }));
}

wss.on('connection', (ws) => {
  const id = ++clientId;
  clients[id] = ws;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === 'join') {
      gameState.players[id] = { name: msg.name, score: 0, answers: [] };
      ws.send(JSON.stringify({
        type: 'joined',
        phase: gameState.phase,
        currentQ: gameState.currentQ,
        playerCount: Object.keys(gameState.players).length
      }));
      broadcast({ type: 'player_count', count: Object.keys(gameState.players).length });
    }

    if (msg.type === 'presenter_start') {
      gameState.phase = 'question';
      gameState.currentQ = 0;
      broadcast({ type: 'question_start', questionIdx: 0 });
    }

    if (msg.type === 'presenter_next') {
      const next = gameState.currentQ + 1;
      if (next < 8) {
        gameState.currentQ = next;
        gameState.phase = 'question';
        broadcast({ type: 'question_start', questionIdx: next });
      } else {
        gameState.phase = 'results';
        broadcast({ type: 'show_results', leaderboard: getLeaderboard() });
      }
    }

    if (msg.type === 'answer') {
      if (!gameState.players[id]) return;
      const player = gameState.players[id];
      if (player.answers.length > gameState.currentQ) return; // ya respondió
      const isCorrect = msg.answer === CORRECT_ANSWERS[gameState.currentQ];
      const pts = isCorrect ? 100 + msg.timeLeft * 5 : 0;
      player.score += pts;
      player.answers.push({ answer: msg.answer, correct: isCorrect, points: pts });

      // Notificar al presenter cuántos respondieron
      const responded = Object.values(gameState.players).filter(p => p.answers.length > gameState.currentQ).length;
      broadcast({ type: 'response_count', count: responded, total: Object.keys(gameState.players).length });
    }

    if (msg.type === 'presenter_reset') {
      gameState = { phase: 'waiting', currentQ: 0, players: {} };
      broadcast({ type: 'reset' });
    }
  });

  ws.on('close', () => {
    delete clients[id];
    delete gameState.players[id];
    broadcast({ type: 'player_count', count: Object.keys(gameState.players).length });
  });
});

const CORRECT_ANSWERS = [2, 1, 2, 2, 2, 2, 2, 2];

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Quiz server running on port ${PORT}`));
