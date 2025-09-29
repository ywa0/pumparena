// server.js - FINAL VERSION with ROUND SYSTEM & NO PASSWORD ADMIN

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
app.use(express.static(__dirname));

// --- Game Constants ---
const WORLD_WIDTH = 1200 * 4;
const WORLD_HEIGHT = 900 * 4;
const PLAYER_MAX_HEALTH = 100;
const ATTACK_RANGE = 150;
const ATTACK_DAMAGE = 20;
const DEFAULT_ROUND_DURATION = 300; // 5 minutes
const INTERMISSION_DURATION = 10; // 10 seconds

// --- Game State Management ---
let players = {};

let gameState = {
    state: 'WAITING', // WAITING, INTERMISSION, IN_PROGRESS
    roundNumber: 1,
    roundTimeRemaining: DEFAULT_ROUND_DURATION,
    intermissionTimeRemaining: INTERMISSION_DURATION,
    nextRoundDuration: DEFAULT_ROUND_DURATION,
    topPlayers: []
};

// Create a separate namespace for admin connections
const adminNamespace = io.of('/admin');

// --- Core Game Loop (runs every second) ---
setInterval(() => {
    switch (gameState.state) {
        case 'IN_PROGRESS':
            gameState.roundTimeRemaining--;
            if (gameState.roundTimeRemaining <= 0) {
                endRound();
            }
            break;
        case 'INTERMISSION':
            gameState.intermissionTimeRemaining--;
            if (gameState.intermissionTimeRemaining <= 0) {
                startRound();
            }
            break;
    }

    // Broadcast the state to all players and admins
    const slimGameState = {
        state: gameState.state,
        timeRemaining: gameState.state === 'IN_PROGRESS' ? gameState.roundTimeRemaining : gameState.intermissionTimeRemaining,
        roundNumber: gameState.roundNumber,
        playerCount: Object.keys(players).length
    };
    
    io.emit('gameStateUpdate', slimGameState); // To players
    adminNamespace.emit('gameStateUpdate', slimGameState); // To admins

}, 1000);

// --- Round Management Functions ---

function startRound() {
    console.log(`Starting Round #${gameState.roundNumber}`);
    gameState.state = 'IN_PROGRESS';
    gameState.roundTimeRemaining = gameState.nextRoundDuration;
    gameState.topPlayers = [];

    // Reset all players
    for (const id in players) {
        const player = players[id];
        player.kills = 0;
        player.health = PLAYER_MAX_HEALTH;
        player.x = Math.floor(Math.random() * (WORLD_WIDTH - 200)) + 100;
        player.y = Math.floor(Math.random() * (WORLD_HEIGHT - 200)) + 100;
    }
    
    // Notify clients that the round is starting and send the full reset state
    io.emit('roundStart', { players });
    io.emit('playerCountUpdate', Object.keys(players).length);
}

function endRound() {
    console.log(`Round #${gameState.roundNumber} has ended.`);
    gameState.state = 'INTERMISSION';
    gameState.intermissionTimeRemaining = INTERMISSION_DURATION;

    // Calculate top players
    const sortedPlayers = Object.values(players)
        .sort((a, b) => b.kills - a.kills)
        .slice(0, 3)
        .map(p => ({ name: p.name, kills: p.kills })); // Send only necessary data

    gameState.topPlayers = sortedPlayers;
    console.log('Top Players:', sortedPlayers);
    
    gameState.roundNumber++;

    // Notify clients that the round is over with the results
    io.emit('roundOver', { topPlayers: gameState.topPlayers });
}

// --- ADMIN Connection Handling (No Password) ---
adminNamespace.on('connection', (socket) => {
    console.log(`👑 Admin connected: ${socket.id}`);

    // Send current state to the new admin immediately
    socket.emit('gameStateUpdate', {
        state: gameState.state,
        timeRemaining: gameState.state === 'IN_PROGRESS' ? gameState.roundTimeRemaining : gameState.intermissionTimeRemaining,
        roundNumber: gameState.roundNumber,
        playerCount: Object.keys(players).length
    });

    // --- Admin Event Handlers ---
    socket.on('admin:startRound', () => {
        console.log(`👑 Admin ${socket.id} is force-starting the round.`);
        if (gameState.state !== 'IN_PROGRESS') {
            gameState.intermissionTimeRemaining = INTERMISSION_DURATION; 
            startRound();
        }
    });

    socket.on('admin:endRound', () => {
        console.log(`👑 Admin ${socket.id} is force-ending the round.`);
        if (gameState.state === 'IN_PROGRESS') {
            endRound();
        }
    });

    socket.on('admin:setTime', (time) => {
        const newTime = parseInt(time, 10);
        if (!isNaN(newTime) && newTime > 0) {
            gameState.nextRoundDuration = newTime;
            console.log(`👑 Admin ${socket.id} set next round duration to ${newTime}s.`);
        }
    });
    
    socket.on('admin:setRound', (roundNum) => {
        const newRound = parseInt(roundNum, 10);
        if (!isNaN(newRound) && newRound > 0) {
            gameState.roundNumber = newRound;
            console.log(`👑 Admin ${socket.id} set round number to ${newRound}.`);
        }
    });
    
    socket.on('admin:broadcast', (message) => {
        const sanitizedMessage = String(message).substring(0, 200);
        console.log(`👑 Admin ${socket.id} broadcasted: "${sanitizedMessage}"`);
        io.emit('broadcastMessage', sanitizedMessage);
    });

    socket.on('disconnect', () => {
        console.log(`👑 Admin disconnected: ${socket.id}`);
    });
});


// --- PLAYER Connection Handling ---
io.on('connection', (socket) => {
    console.log(`🔌 Player connected: ${socket.id}`);

    // Initialize a new player
    players[socket.id] = { 
        id: socket.id, 
        x: Math.floor(Math.random() * (WORLD_WIDTH - 200)) + 100, 
        y: Math.floor(Math.random() * (WORLD_HEIGHT - 200)) + 100, 
        health: PLAYER_MAX_HEALTH, 
        maxHealth: PLAYER_MAX_HEALTH, 
        direction: 1, 
        weaponAngle: 0, 
        kills: 0, 
        name: 'PUMPER' 
    };

    // Send initial game state to the new player
    socket.emit('gameState', { 
        players: players, 
        playerCount: Object.keys(players).length,
        ...gameState 
    });
    
    io.emit('playerCountUpdate', Object.keys(players).length);

    // --- Player Event Handlers ---
    socket.on('setUsername', (username) => {
        const player = players[socket.id];
        if (player) {
            player.name = username.substring(0, 15);
            console.log(`Player ${socket.id} is now known as ${player.name}`);
            socket.broadcast.emit('playerUpdate', player);
        }
    });

    socket.on('move', (data) => {
        if (gameState.state !== 'IN_PROGRESS') return; 
        const player = players[socket.id];
        if (player && player.health > 0) {
            player.x = data.x;
            player.y = data.y;
            player.direction = data.direction;
            player.weaponAngle = data.weaponAngle;
            socket.broadcast.emit('playerUpdate', player);
        }
    });
    
    const handleAttack = (attackerId) => {
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
                const attackDirection = attacker.direction || 1;
                const isFacingVictim = (attackDirection === -1 && dx > 0) || (attackDirection === 1 && dx < 0);
                
                if (isFacingVictim) {
                    victim.health -= ATTACK_DAMAGE;
                    io.emit('playerHit', { playerId: victimId, health: victim.health, x: victim.x, y: victim.y });
                    
                    if (victim.health <= 0) {
                        attacker.kills++;
                        io.emit('playerKilled', { 
                            killer: { id: attackerId, name: attacker.name, kills: attacker.kills }, 
                            victim: { id: victimId, name: victim.name } 
                        });
                        io.emit('playerUpdate', attacker);
                    }
                    break;
                }
            }
        }
    }

    socket.on('areaAttack', () => {
        if (gameState.state !== 'IN_PROGRESS') return;
        handleAttack(socket.id);
    });

    socket.on('mobileCollisionAttack', () => {
        if (gameState.state !== 'IN_PROGRESS') return;
        handleAttack(socket.id);
    });
    
    socket.on('attackAnimation', (data) => {
        if (gameState.state !== 'IN_PROGRESS') return;
        socket.broadcast.emit('attackAnimation', data);
    });

    socket.on('respawn', () => {
        if (gameState.state !== 'IN_PROGRESS') return;
        const player = players[socket.id];
        if (player && player.health <= 0) {
            player.health = PLAYER_MAX_HEALTH;
            player.x = Math.floor(Math.random() * (WORLD_WIDTH - 200)) + 100;
            player.y = Math.floor(Math.random() * (WORLD_HEIGHT - 200)) + 100;
            io.emit('playerRespawned', player);
        }
    });

    socket.on('disconnect', () => {
        console.log(`👋 Player disconnected: ${socket.id}`);
        delete players[socket.id];
        io.emit('playerLeft', socket.id);
        io.emit('playerCountUpdate', Object.keys(players).length);
    });
});

// --- Server Start ---
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 PUMP ROYALE server is live on port ${PORT}`);
});