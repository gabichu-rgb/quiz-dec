const express = require('express');
const { WebSocketServer } = require('ws');
const http = require('http');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// / -> participante, /admin -> presentador
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'player.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));

const CORRECT_ANSWERS = [2, 1, 2, 2, 2, 2, 2, 2];
const TOTAL_QUESTIONS = 8;

let gameState = {
  phase: 'waiting',
  players: {}
};

let clients = {};
let clientId = 0;

function broadcast(msg) {
  const data = JSON.stringify(msg);
  Object.values(clients).forEach(ws => {
    if (ws.readyState === 1) ws.send(data);
  });
}

function getLeaderboard() {
  return Object.values(gameState.players)
    .sort((a, b) => b.score - a.score)
    .map(p => ({ name: p.name, score: p.score }));
}

function checkAllFinished() {
  const players = Object.values(gameState.players);
  if (players.length === 0) return;
  if (players.every(p => p.finished)) {
    gameState.phase = 'finished';
    broadcast({ type: 'show_results', leaderboard: getLeaderboard() });
  }
}

wss.on('connection', (ws) => {
  const id = ++clientId;
  clients[id] = ws;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === 'join') {
      gameState.players[id] = { name: msg.name, score: 0, finished: false };
      ws.send(JSON.stringify({ type: 'joined', phase: gameState.phase }));
      broadcast({ type: 'player_count', count: Object.keys(gameState.players).length });
    }

    if (msg.type === 'presenter_start') {
      gameState.phase = 'playing';
      Object.values(gameState.players).forEach(p => { p.score = 0; p.finished = false; });
      broadcast({ type: 'game_start' });
    }

    if (msg.type === 'submit_score') {
      if (!gameState.players[id]) return;
      gameState.players[id].score = msg.score;
      gameState.players[id].finished = true;
      const finished = Object.values(gameState.players).filter(p => p.finished).length;
      broadcast({ type: 'player_finished', count: finished, total: Object.keys(gameState.players).length });
      checkAllFinished();
    }

    if (msg.type === 'presenter_show_results') {
      broadcast({ type: 'show_results', leaderboard: getLeaderboard() });
    }

    if (msg.type === 'presenter_reset') {
      gameState = { phase: 'waiting', players: {} };
      broadcast({ type: 'reset' });
    }
  });

  ws.on('close', () => {
    delete clients[id];
    delete gameState.players[id];
    broadcast({ type: 'player_count', count: Object.keys(gameState.players).length });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Quiz server running on port ${PORT}`));
