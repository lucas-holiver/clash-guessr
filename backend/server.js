// backend/server.js
const express = require('express');
const cors = require('cors');
const path = require('path'); // Importa o módulo 'path'
const { v4: uuidv4 } = require('uuid');
const CARDS = require('./cards');

const app = express();
app.use(cors()); // Permite que o HTML acesse o servidor
app.use(express.json());
app.set('trust proxy', 1); // Confia no proxy para obter o IP correto do usuário

// --- ADIÇÃO IMPORTANTE ---
// Serve os arquivos estáticos (HTML, CSS, JS, imagens) da pasta raiz do projeto.
// O '__dirname' aponta para a pasta /backend, então '..' sobe um nível.
app.use(express.static(path.join(__dirname, '..')));


// Armazenamento em memória dos jogos ativos
const sessions = {}; 
const rarityOrder = { 'Comum': 0, 'Rara': 1, 'Épica': 2, 'Lendária': 3, 'Campeão': 4 };
const gameStartTimestamps = new Map();
const RATE_LIMIT_SECONDS = 5; // Tempo de espera em segundos

// 1. Rota para entregar lista básica (para o autocomplete do frontend)
app.get('/cards', (req, res) => {
    const list = CARDS.map(c => ({ name: c.name, imageUrl: c.imageUrl }));
    res.json(list);
});

// 2. Iniciar Jogo
app.post('/game', (req, res) => {
    const userIp = req.ip;
    const now = Date.now();
    const lastRequestTime = gameStartTimestamps.get(userIp);

    if (lastRequestTime && (now - lastRequestTime) < RATE_LIMIT_SECONDS * 1000) {
        const timeLeft = Math.ceil((lastRequestTime + (RATE_LIMIT_SECONDS * 1000) - now) / 1000);
        return res.status(429).json({ 
            error: `Você está criando jogos muito rápido! Por favor, aguarde ${timeLeft} segundo(s).` 
        });
    }
    
    gameStartTimestamps.set(userIp, now);

    const id = uuidv4();
    const secret = CARDS[Math.floor(Math.random() * CARDS.length)];
    sessions[id] = { secret, attempts: 0 };
    console.log(`Jogo ${id} iniciado para o IP ${userIp}. Segredo: ${secret.name}`);
    res.json({ id });
});

// 3. Processar Palpite
app.post('/guess', (req, res) => {
    const { id, guessName } = req.body;
    const session = sessions[id];

    if (!session) return res.status(404).json({ error: 'Jogo não encontrado' });

    const guessCard = CARDS.find(c => c.name === guessName);
    if (!guessCard) return res.status(400).json({ error: 'Carta inválida' });

    session.attempts++;
    const secret = session.secret;
    const isWin = guessCard.name === secret.name;
    const isGameOver = isWin || session.attempts >= 15;

    // Função auxiliar de comparação
    const compare = (val1, val2, isRarity = false) => {
        if (val1 === val2) return 'correct';
        let v1 = val1, v2 = val2;
        if (isRarity) { v1 = rarityOrder[val1]; v2 = rarityOrder[val2]; }
        return v1 < v2 ? 'higher' : 'lower'; // Se meu palpite é menor, a seta deve apontar pra CIMA (higher)
    };

    const feedback = {
        card: guessCard,
        comparisons: {
            elixir: compare(guessCard.elixir, secret.elixir),
            rarity: compare(guessCard.rarity, secret.rarity, true),
            arena: compare(guessCard.arena, secret.arena),
            type: guessCard.type === secret.type ? 'correct' : 'incorrect',
            evolution: guessCard.evolution === secret.evolution ? 'correct' : 'incorrect'
        },
        isWin,
        isGameOver
    };

    // Se o jogo acabou e foi derrota, envia a carta secreta na resposta
    if (isGameOver && !isWin) {
        feedback.secretCard = secret;
    }

    // Gerar Dicas - Agora envia todas as disponíveis
    const hints = [];
    if (session.attempts >= 3) hints.push({ label: 'Tipo', value: secret.type });
    if (session.attempts >= 6) hints.push({ label: 'Raridade', value: secret.rarity });
    if (session.attempts >= 10) hints.push({ label: 'Elixir', value: secret.elixir });

    res.json({ feedback, hints });

    if (isGameOver) {
        delete sessions[id]; // Limpa memória
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`API rodando na porta ${PORT}`));