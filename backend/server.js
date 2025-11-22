// backend/server.js
const express = require('express');
const cors = require('cors');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const http = require('http');
const { WebSocketServer } = require('ws');

const CARDS = require('./cards');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(cors());
app.use(express.json());
app.set('trust proxy', 1);

app.use(express.static(path.join(__dirname, '..')));


// Armazenamento em memória dos jogos
const singlePlayerSessions = {}; 
const twoPlayerGames = {};
const rarityOrder = { 'Comum': 0, 'Rara': 1, 'Épica': 2, 'Lendária': 3, 'Campeão': 4 };

// Rate limit para jogos single-player
const gameStartTimestamps = new Map();
const rateLimitStrikes = new Map();
const BASE_COOLDOWN_S = 5;
const PENALTY_COOLDOWN_S = 15;
const STRIKE_WINDOW_MS = 60 * 1000;
const SINGLE_PLAYER_MAX_ATTEMPTS = 15;


// --- ROTA DE CARTAS (COMPARTILHADA) ---
app.get('/cards', (req, res) => {
    const list = CARDS.map(c => ({ name: c.name }));
    res.json(list);
});

// --- MODO UM JOGADOR ---
app.post('/game', (req, res) => {
    const userIp = req.ip;
    const now = Date.now();
    const lastRequestTime = gameStartTimestamps.get(userIp);
    const userStrikes = rateLimitStrikes.get(userIp);

    if (userStrikes && now > userStrikes.expiry) {
        rateLimitStrikes.delete(userIp);
    }

    const currentCooldown = (userStrikes?.count > 1) ? PENALTY_COOLDOWN_S : BASE_COOLDOWN_S;

    if (lastRequestTime && (now - lastRequestTime) < currentCooldown * 1000) {
        const newStrikeCount = (userStrikes?.count || 0) + 1;
        rateLimitStrikes.set(userIp, { count: newStrikeCount, expiry: now + STRIKE_WINDOW_MS });
        
        const isPenalty = newStrikeCount > 2;
        const cooldown = isPenalty ? PENALTY_COOLDOWN_S : BASE_COOLDOWN_S;
        const timeLeft = Math.ceil((lastRequestTime + (cooldown * 1000) - now) / 1000);

        let message = `Você está criando jogos muito rápido! Por favor, aguarde ${timeLeft} segundo(s).`;
        if (isPenalty) {
            message = `Muitas tentativas! A espera aumentou para ${cooldown} segundos. Aguarde.`;
        }
        return res.status(429).json({ error: message });
    }
    
    gameStartTimestamps.set(userIp, now);

    const id = uuidv4();
    const secret = CARDS[Math.floor(Math.random() * CARDS.length)];
    singlePlayerSessions[id] = { 
        secret, 
        attempts: 0,
        maxAttempts: SINGLE_PLAYER_MAX_ATTEMPTS
    };
    console.log(`Jogo 1P ${id} iniciado. Segredo: ${secret.name}`);
    res.json({ id, maxAttempts: SINGLE_PLAYER_MAX_ATTEMPTS });
});

app.post('/guess', (req, res) => {
    const { id, guessName } = req.body;
    const session = singlePlayerSessions[id];
    if (!session) return res.status(404).json({ error: 'Jogo não encontrado' });
    
    const feedback = processGuess(guessName, session.secret);
    session.attempts++;
    feedback.isGameOver = feedback.isWin || session.attempts >= session.maxAttempts;

    if (feedback.isGameOver && !feedback.isWin) {
        feedback.secretCard = session.secret;
    }

    const hints = [];
    if (session.attempts >= 3) hints.push({ label: 'Tipo', value: session.secret.type });
    if (session.attempts >= 6) hints.push({ label: 'Raridade', value: session.secret.rarity });
    if (session.attempts >= 10) hints.push({ label: 'Elixir', value: session.secret.elixir });

    const attemptsPayload = { current: session.attempts, max: session.maxAttempts };

    res.json({ feedback, hints, attempts: attemptsPayload });
    if (feedback.isGameOver) delete singlePlayerSessions[id];
});


// --- MODO DOIS JOGADORES ---
app.post('/game/create-two-player', (req, res) => {
    const { maxAttempts, hints, isPublic } = req.body;
    const gameId = uuidv4().substring(0, 6).toUpperCase();
    
    twoPlayerGames[gameId] = {
        id: gameId,
        secretCard: CARDS[Math.floor(Math.random() * CARDS.length)],
        players: [],
        settings: { maxAttempts, hints, isPublic },
        state: 'waiting',
        currentTurn: 1,
        turnGuesses: {},
    };
    console.log(`Jogo 2P ${gameId} criado. Segredo: ${twoPlayerGames[gameId].secretCard.name}`);
    res.status(201).json({ gameId });
});

app.get('/public-games', (req, res) => {
    const games = Object.values(twoPlayerGames)
        .filter(g => g.settings.isPublic && g.state === 'waiting' && g.players.length < 2)
        .map(g => ({ id: g.id, settings: g.settings }));
    res.json(games);
});


// --- LÓGICA WEBSOCKET ---
wss.on('connection', ws => {
    ws.on('message', message => {
        try {
            const data = JSON.parse(message);
            
            if (data.type === 'join') {
                handleJoin(ws, data.gameId);
            } else if (data.type === 'guess') {
                handleGuess(ws, data.guessName);
            }

        } catch (e) { console.error('Mensagem WS inválida:', e); }
    });

    ws.on('close', () => {
        handleDisconnect(ws);
    });
});

function handleJoin(ws, gameId) {
    const game = twoPlayerGames[gameId];
    if (!game) {
        return ws.send(JSON.stringify({ type: 'error', message: 'Jogo não encontrado.' }));
    }
    if (game.players.length >= 2) {
        return ws.send(JSON.stringify({ type: 'error', message: 'Este jogo já está cheio.' }));
    }

    const playerId = uuidv4();
    ws.playerId = playerId;
    ws.gameId = gameId;
    game.players.push({ ws, id: playerId });

    if (game.players.length === 2) {
        game.state = 'playing';
        const gameStartPayload = {
            type: 'gameStart',
            gameId: game.id,
            settings: game.settings,
        };
        game.players.forEach(p => p.ws.send(JSON.stringify(gameStartPayload)));
    }
}

function handleGuess(ws, guessName) {
    const game = twoPlayerGames[ws.gameId];
    if (!game || game.state !== 'playing') return;

    game.turnGuesses[ws.playerId] = guessName;

    if (Object.keys(game.turnGuesses).length === 2) {
        processTurn(game);
    }
}

function handleDisconnect(ws) {
    const game = twoPlayerGames[ws.gameId];
    if (!game) return;
    
    const remainingPlayer = game.players.find(p => p.id !== ws.playerId);
    if (remainingPlayer && game.state === 'playing') {
        remainingPlayer.ws.send(JSON.stringify({ type: 'opponentDisconnected' }));
    }

    console.log(`Jogador desconectado do jogo ${ws.gameId}. Encerrando.`);
    delete twoPlayerGames[ws.gameId];
}


// --- LÓGICA DE JOGO COMPARTILHADA ---
function processGuess(guessName, secretCard) {
    const guessCard = CARDS.find(c => c.name === guessName);
    if (!guessCard) return null;

    const compare = (val1, val2, isRarity = false) => {
        if (val1 === val2) return 'correct';
        let v1 = val1, v2 = val2;
        if (isRarity) { v1 = rarityOrder[val1]; v2 = rarityOrder[val2]; }
        return v1 < v2 ? 'higher' : 'lower';
    };

    return {
        card: guessCard,
        comparisons: {
            elixir: compare(guessCard.elixir, secretCard.elixir),
            rarity: compare(guessCard.rarity, secretCard.rarity, true),
            arena: compare(guessCard.arena, secretCard.arena),
            type: guessCard.type === secretCard.type ? 'correct' : 'incorrect',
            evolution: guessCard.evolution === secretCard.evolution ? 'correct' : 'incorrect'
        },
        isWin: guessCard.name === secretCard.name,
    };
}

function processTurn(game) {
    const [p1, p2] = game.players;
    const p1Guess = game.turnGuesses[p1.id];
    const p2Guess = game.turnGuesses[p2.id];

    const p1Feedback = processGuess(p1Guess, game.secretCard);
    const p2Feedback = processGuess(p2Guess, game.secretCard);

    const hints = [];
    if (game.settings.hints) {
        if (game.currentTurn >= 3) hints.push({ label: 'Tipo', value: game.secretCard.type });
        if (game.currentTurn >= 6) hints.push({ label: 'Raridade', value: game.secretCard.rarity });
        if (game.currentTurn >= 10) hints.push({ label: 'Elixir', value: game.secretCard.elixir });
    }

    const turnResultPayload = { 
        type: 'turnResult', 
        turn: game.currentTurn, 
        hints 
    };

    // Enviar resultados
    p1.ws.send(JSON.stringify({ ...turnResultPayload, myFeedback: p1Feedback, opponentFeedback: p2Feedback }));
    p2.ws.send(JSON.stringify({ ...turnResultPayload, myFeedback: p2Feedback, opponentFeedback: p1Feedback }));

    // Checar fim de jogo
    const p1Win = p1Feedback.isWin;
    const p2Win = p2Feedback.isWin;

    let gameOver = false;
    let result = {};

    if (p1Win && p2Win) {
        gameOver = true;
        result = { draw: true, myCard: p1Feedback.card, opponentCard: p2Feedback.card };
    } else if (p1Win) {
        gameOver = true;
        result = { winner: 'p1', turn: game.currentTurn, myCard: p1Feedback.card, opponentCard: p2Feedback.card };
    } else if (p2Win) {
        gameOver = true;
        result = { winner: 'p2', turn: game.currentTurn, myCard: p1Feedback.card, opponentCard: p2Feedback.card };
    } else if (game.currentTurn >= game.settings.maxAttempts) {
        gameOver = true;
        result = { loss: true };
    }

    if (gameOver) {
        const p1Result = { ...result, winner: result.winner ? (result.winner === 'p1' ? 'me' : 'opponent') : null };
        const p2Result = { ...result, winner: result.winner ? (result.winner === 'p2' ? 'me' : 'opponent') : null };
        
        p1.ws.send(JSON.stringify({ type: 'gameOver', result: p1Result, secretCard: game.secretCard }));
        p2.ws.send(JSON.stringify({ type: 'gameOver', result: p2Result, secretCard: game.secretCard }));
        
        delete twoPlayerGames[game.id];
    } else {
        game.currentTurn++;
        game.turnGuesses = {};
    }
}


const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`API e WebSocket rodando na porta ${PORT}`));