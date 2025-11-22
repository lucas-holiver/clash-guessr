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
const HOST_ADJECTIVES = ['Rápido', 'Astuto', 'Poderoso', 'Sombrio', 'Dourado', 'Gélido', 'Elétrico'];
const HOST_NOUNS = ['Cavaleiro', 'Goblin', 'Dragão', 'Príncipe', 'Mago', 'Gigante', 'Bárbaro', 'Corredor', 'Executor'];

app.post('/game/create-two-player', (req, res) => {
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

    const { maxAttempts, hints, isPublic } = req.body;
    const gameId = uuidv4().substring(0, 6).toUpperCase();
    
    const randomAdj = HOST_ADJECTIVES[Math.floor(Math.random() * HOST_ADJECTIVES.length)];
    const randomNoun = HOST_NOUNS[Math.floor(Math.random() * HOST_NOUNS.length)];
    const hostName = `Anfitrião ${randomAdj} ${randomNoun}`;

    twoPlayerGames[gameId] = {
        id: gameId,
        hostName,
        secretCard: CARDS[Math.floor(Math.random() * CARDS.length)],
        players: [],
        settings: { maxAttempts, hints, isPublic },
        state: 'waiting', // 'waiting', 'playing', 'finished'
        currentTurn: 1,
        turnGuesses: {},
        turnTimer: null,
    };
    console.log(`Jogo 2P ${gameId} criado por ${hostName}. Segredo: ${twoPlayerGames[gameId].secretCard.name}`);
    res.status(201).json({ gameId });
});

app.get('/public-games', (req, res) => {
    const games = Object.values(twoPlayerGames)
        .filter(g => g.settings.isPublic && g.state === 'waiting' && g.players.length < 2)
        .map(g => ({ id: g.id, settings: g.settings, hostName: g.hostName }));
    res.json(games);
});


// --- LÓGICA WEBSOCKET ---
wss.on('connection', ws => {
    ws.on('message', message => {
        try {
            const data = JSON.parse(message);
            
            switch(data.type) {
                case 'join':
                    handleJoin(ws, data.gameId);
                    break;
                case 'toggleReady':
                    handleToggleReady(ws);
                    break;
                case 'guess':
                    handleGuess(ws, data.guessName);
                    break;
            }

        } catch (e) { console.error('Mensagem WS inválida:', e); }
    });

    ws.on('close', () => {
        handleDisconnect(ws);
    });
});

function broadcastLobbyUpdate(game) {
    const playersData = game.players.map(p => ({ id: p.id, name: p.name, isReady: p.isReady }));
    game.players.forEach(p => {
        p.ws.send(JSON.stringify({
            type: 'lobbyUpdate',
            gameId: game.id,
            players: playersData,
            myId: p.id,
        }));
    });
}

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
    
    const playerName = game.players.length === 0 ? 'Anfitrião' : 'Oponente';
    game.players.push({ ws, id: playerId, name: playerName, isReady: false });

    console.log(`Jogador ${playerId} (${playerName}) entrou na sala ${gameId}.`);
    broadcastLobbyUpdate(game);
}

function handleToggleReady(ws) {
    const game = twoPlayerGames[ws.gameId];
    if (!game || game.state !== 'waiting') return;

    const player = game.players.find(p => p.id === ws.playerId);
    if (player) {
        player.isReady = !player.isReady;
        console.log(`Jogador ${player.id} na sala ${game.id} mudou status para: ${player.isReady}`);
        broadcastLobbyUpdate(game);

        if (game.players.length === 2 && game.players.every(p => p.isReady)) {
            console.log(`Jogo ${game.id} iniciando!`);
            game.state = 'playing';
            const gameStartPayload = {
                type: 'gameStart',
                gameId: game.id,
                settings: game.settings,
            };
            game.players.forEach(p => p.ws.send(JSON.stringify(gameStartPayload)));
        }
    }
}

function handleGuess(ws, guessName) {
    const game = twoPlayerGames[ws.gameId];
    if (!game || game.state !== 'playing' || game.turnGuesses[ws.playerId]) return;

    game.turnGuesses[ws.playerId] = guessName;

    const guessCount = Object.keys(game.turnGuesses).length;

    if (guessCount === 1) {
        const feedback = processGuess(guessName, game.secretCard);
        
        ws.send(JSON.stringify({
            type: 'turnUpdate',
            turn: game.currentTurn,
            myFeedback: feedback,
            opponentFeedback: { waiting: true } 
        }));
        
        const opponent = game.players.find(p => p.id !== ws.playerId);
        if (opponent) {
            opponent.ws.send(JSON.stringify({
                type: 'turnUpdate',
                turn: game.currentTurn,
                myFeedback: null,
                opponentFeedback: { hasGuessed: true }
            }));
        }

        game.turnTimer = setTimeout(() => {
            const idlePlayer = game.players.find(p => !game.turnGuesses[p.id]);
            if (idlePlayer) {
                console.log(`Jogador ${idlePlayer.id} no jogo ${game.id} esgotou o tempo. Auto-chute.`);
                const randomCard = CARDS[Math.floor(Math.random() * CARDS.length)];
                game.turnGuesses[idlePlayer.id] = randomCard.name;
                idlePlayer.ws.send(JSON.stringify({ type: 'autoGuessed', cardName: randomCard.name }));
                processTurn(game);
            }
        }, 30000); // 30 segundos

        const timerStartPayload = { type: 'timerStarted', duration: 30 };
        game.players.forEach(p => p.ws.send(JSON.stringify(timerStartPayload)));

    } else if (guessCount === 2) {
        if (game.turnTimer) {
            clearTimeout(game.turnTimer);
            game.turnTimer = null;
        }
        processTurn(game);
    }
}

function handleDisconnect(ws) {
    const game = twoPlayerGames[ws.gameId];
    if (!game) return;

    if (game.turnTimer) {
        clearTimeout(game.turnTimer);
        game.turnTimer = null;
    }

    const disconnectedPlayer = game.players.find(p => p.id === ws.playerId);
    if (!disconnectedPlayer) return;

    const isHost = disconnectedPlayer.name === 'Anfitrião';
    console.log(`${disconnectedPlayer.name} desconectado do jogo ${ws.gameId}.`);

    if (isHost) {
        console.log(`Anfitrião desconectou. Encerrando jogo ${ws.gameId} para todos os jogadores.`);
        // Notifica todos os outros jogadores
        game.players.forEach(player => {
            if (player.id !== ws.playerId) {
                player.ws.send(JSON.stringify({
                    type: 'hostDisconnected',
                    message: 'O anfitrião encerrou a partida.'
                }));
                player.ws.close();
            }
        });
        delete twoPlayerGames[ws.gameId];
    } else {
        // Um oponente desconectou
        game.players = game.players.filter(p => p.id !== ws.playerId);

        if (game.state === 'playing') {
            // Se o jogo estava em andamento, notifica o host e encerra o jogo
            const host = game.players[0];
            if (host) {
                host.ws.send(JSON.stringify({ type: 'opponentDisconnected' }));
                console.log(`Oponente desconectou durante a partida. Deletando jogo ${ws.gameId}.`);
            }
            delete twoPlayerGames[ws.gameId];
        } else { // state is 'waiting'
            // Se estava no lobby, apenas atualiza
            const host = game.players[0];
            if (host) {
                host.isReady = false; // Garante que o host não fique "pronto" sozinho
                console.log(`Atualizando lobby do jogo ${ws.gameId} para o anfitrião.`);
                broadcastLobbyUpdate(game);
            } else {
                // Se o host também saiu por algum motivo e só sobrou o oponente, o jogo deve ser deletado
                 console.log(`Jogo ${ws.gameId} está vazio. Deletando.`);
                 delete twoPlayerGames[ws.gameId];
            }
        }
    }
}


// --- LÓGICA DE JOGO COMPARTILHADA ---
function processGuess(guessName, secretCard) {
    const guessCard = CARDS.find(c => c.name === guessName);
    if (!guessCard) return { card: { name: 'Inválido' }, comparisons: {}, isWin: false };

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
    if (Object.keys(game.turnGuesses).length !== 2) return;

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

    const turnUpdatePayload = { 
        type: 'turnUpdate', 
        turn: game.currentTurn, 
        hints 
    };

    p1.ws.send(JSON.stringify({ ...turnUpdatePayload, myFeedback: p1Feedback, opponentFeedback: p2Feedback }));
    p2.ws.send(JSON.stringify({ ...turnUpdatePayload, myFeedback: p2Feedback, opponentFeedback: p1Feedback }));

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
        const newTurnPayload = { type: 'newTurn', turn: game.currentTurn };
        setTimeout(() => {
            game.players.forEach(p => p.ws.send(JSON.stringify(newTurnPayload)));
        }, 1500); // Pequeno delay antes do próximo turno
    }
}


const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`API e WebSocket rodando na porta ${PORT}`));