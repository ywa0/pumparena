// server.js - FINAL VERSION

const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);

const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const PORT = 3000;

// This correctly serves files from the main project directory
app.use(express.static(path.join(__dirname))); 
// If your server.js is in the root, change the line above to:
// app.use(express.static(__dirname));

// --- Game Constants ---
const WORLD_WIDTH = 1200 * 4;
const WORLD_HEIGHT = 900 * 4;
const PLAYER_MAX_HEALTH = 100;
const ATTACK_RANGE = 150;
const ATTACK_DAMAGE = 20;

let players = {};

// --- Main Game Logic ---
io.on('connection', (socket) => {
    console.log(`✅ Player connected: ${socket.id}`);

    players[socket.id] = { id: socket.id, x: Math.floor(Math.random() * (WORLD_WIDTH - 200)) + 100, y: Math.floor(Math.random() * (WORLD_HEIGHT - 200)) + 100, health: PLAYER_MAX_HEALTH, maxHealth: PLAYER_MAX_HEALTH, direction: 1, weaponAngle: 0, kills: 0, name: 'BONKER' };

    socket.on('setUsername', (username) => {
        const player = players[socket.id];
        if (player) {
            player.name = username.substring(0, 15);
            console.log(`Player ${socket.id} is now known as ${player.name}`);
            socket.emit('gameState', { players: players, playerCount: Object.keys(players).length });
            socket.broadcast.emit('playerUpdate', player);
            io.emit('playerCountUpdate', Object.keys(players).length);
        }
    });

    socket.on('move', (data) => {
        const player = players[socket.id];
        if (player) {
            player.x = data.x;
            player.y = data.y;
            player.direction = data.direction;
            player.weaponAngle = data.weaponAngle;
            socket.broadcast.emit('playerUpdate', player);
        }
    });

    socket.on('areaAttack', (data) => handleAttack(socket.id, data.direction));
    socket.on('mobileCollisionAttack', (data) => handleAttack(socket.id, data.direction));
    socket.on('attackAnimation', (data) => socket.broadcast.emit('attackAnimation', data));

    socket.on('respawn', () => {
        const player = players[socket.id];
        if (player && player.health <= 0) {
            player.health = PLAYER_MAX_HEALTH;
            player.x = Math.floor(Math.random() * (WORLD_WIDTH - 200)) + 100;
            player.y = Math.floor(Math.random() * (WORLD_HEIGHT - 200)) + 100;
            io.emit('playerRespawned', player);
        }
    });

    socket.on('disconnect', () => {
        console.log(`❌ Player disconnected: ${socket.id}`);
        delete players[socket.id];
        io.emit('playerLeft', socket.id);
        io.emit('playerCountUpdate', Object.keys(players).length);
    });
});

function handleAttack(attackerId, direction) {
    const attacker = players[attackerId];
    if (!attacker || attacker.health <= 0) return;
    for (const victimId in players) {
        if (victimId === attackerId) continue;
        const victim = players[victimId];
        if (!victim || victim.health <= 0) continue;
        const dx = victim.x - attacker.x;
        const dy = victim.y - attacker.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        if (distance < ATTACK_RANGE) {
            const isFacingVictim = (direction === -1 && dx > 0) || (direction === 1 && dx < 0);
            if (isFacingVictim) {
                victim.health -= ATTACK_DAMAGE;
                io.emit('playerHit', { playerId: victimId, health: victim.health, x: victim.x, y: victim.y });
                if (victim.health <= 0) {
                    attacker.kills++;
                    io.emit('playerKilled', { killer: { id: attackerId, name: attacker.name, kills: attacker.kills }, victim: { id: victimId, name: victim.name } });
                    io.emit('playerUpdate', attacker);
                }
                break;
            }
        }
    }
}

// This forces the server to listen on all network interfaces
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Bonkers game server is live and running on port ${PORT}`);
});