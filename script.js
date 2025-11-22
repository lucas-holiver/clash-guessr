// frontend/script.js

// -- ATENÇÃO: MUDANÇA IMPORTANTE PARA ACESSO NA REDE LOCAL --
// Para que outros dispositivos na sua rede (celulares, outros computadores) possam acessar o jogo,
// troque 'localhost' pelo IP do seu computador na sua rede Wi-Fi.
// 1. Descubra seu IP (Ex: no Windows, abra o cmd e digite `ipconfig`. Procure por "Endereço IPv4").
// 2. Substitua o IP no exemplo abaixo pelo seu.
const API_URL = ''; // <-- TROQUE ESTE IP PELO SEU!

let currentGameId = null;
let allCards = [];
let guessedCards = new Set();
let hints = [];
let isTwoPlayerMode = false;
let ws = null;


// Elementos DOM
const searchInput = document.getElementById('search-input');
const suggestionsList = document.getElementById('suggestions-list');
const guessesList = document.getElementById('guesses-list');
const searchSection = document.getElementById('search-section');
const gameOverMsg = document.getElementById('game-over-msg');
const endTitle = document.getElementById('end-title');
const hintsContainer = document.getElementById('hints-container');
const gameNotification = document.getElementById('game-notification');
const gameNotificationText = document.getElementById('game-notification-text');

// Elementos do Menu e Conteúdo
const mainMenu = document.getElementById('main-menu');
const gameContent = document.getElementById('game-content');
const onePlayerBtn = document.getElementById('one-player-btn');
const twoPlayerBtn = document.getElementById('two-player-btn');

// Elementos do Lobby 2P
const twoPlayerLobby = document.getElementById('two-player-lobby');
const backToMenuLobbyBtn = document.getElementById('back-to-menu-lobby-btn');
const showCreateGameBtn = document.getElementById('show-create-game-btn');
const showJoinGameBtn = document.getElementById('show-join-game-btn');
const createGameView = document.getElementById('create-game-view');
const joinGameView = document.getElementById('join-game-view');
const createGameBtn = document.getElementById('create-game-btn');
const gameCodeSection = document.getElementById('game-code-section');
const gameCodeDisplay = document.getElementById('game-code-display');
const copyCodeBtn = document.getElementById('copy-code-btn');
const waitingForPlayerMsg = document.getElementById('waiting-for-player-msg');
const gameSettingsSection = document.getElementById('game-settings-section');
const maxAttemptsSlider = document.getElementById('max-attempts-slider');
const maxAttemptsValue = document.getElementById('max-attempts-value');
const joinCodeInput = document.getElementById('join-code-input');
const joinByCodeBtn = document.getElementById('join-by-code-btn');
const refreshPublicGamesBtn = document.getElementById('refresh-public-games-btn');
const publicGamesList = document.getElementById('public-games-list');


// Elementos da Modal de Vitória
const victoryModal = document.getElementById('victory-modal');
const victoryContent = document.getElementById('victory-content');
const victoryCardImage = document.getElementById('victory-card-image');
const victoryCardName = document.getElementById('victory-card-name');
const victoryAttempts = document.getElementById('victory-attempts');
const victoryPlayAgainBtn = document.getElementById('victory-play-again-btn');

// Novos botões
const backToMenuInGameBtn = document.getElementById('back-to-menu-ingame-btn');
const defeatPlayAgainBtn = document.getElementById('defeat-play-again-btn');
const defeatBackToMenuBtn = document.getElementById('defeat-back-to-menu-btn');
const victoryBackToMenuBtn = document.getElementById('victory-back-to-menu-btn');

// Elementos do Toast
const toastNotification = document.getElementById('toast-notification');
const toastMessage = document.getElementById('toast-message');
let toastTimeout;

// Inicialização
document.addEventListener('DOMContentLoaded', () => {
    fetchCards();
    
    onePlayerBtn.addEventListener('click', () => { isTwoPlayerMode = false; startNewGame(); });
    twoPlayerBtn.addEventListener('click', showTwoPlayerLobby);
    victoryPlayAgainBtn.addEventListener('click', () => { isTwoPlayerMode ? backToLobby() : startNewGame(); });
    defeatPlayAgainBtn.addEventListener('click', () => { isTwoPlayerMode ? backToLobby() : startNewGame(); });

    backToMenuInGameBtn.addEventListener('click', () => { isTwoPlayerMode ? leaveTwoPlayerGame() : backToMenu(); });
    victoryBackToMenuBtn.addEventListener('click', () => { isTwoPlayerMode ? backToLobby() : backToMenu(); });
    defeatBackToMenuBtn.addEventListener('click', () => { isTwoPlayerMode ? backToLobby() : backToMenu(); });

    // Lobby Listeners
    backToMenuLobbyBtn.addEventListener('click', backToMenu);
    showCreateGameBtn.addEventListener('click', () => switchLobbyView('create'));
    showJoinGameBtn.addEventListener('click', () => switchLobbyView('join'));
    maxAttemptsSlider.addEventListener('input', (e) => maxAttemptsValue.textContent = e.target.value);
    createGameBtn.addEventListener('click', createTwoPlayerGame);
    copyCodeBtn.addEventListener('click', copyGameCode);
    refreshPublicGamesBtn.addEventListener('click', fetchPublicGames);
    joinByCodeBtn.addEventListener('click', () => {
        const code = joinCodeInput.value.trim().toUpperCase();
        if (code) joinTwoPlayerGame(code);
        else showToast("Por favor, insira um código.");
    });
});

// --- FUNÇÕES GERAIS ---
function getCardImageSlug(name) {
    return name
        .toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, "")
        .replace(/\./g, '')
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9-]/g, '');
}

async function fetchCards() {
    try {
        const res = await fetch(`${API_URL}/cards`);
        allCards = await res.json();
    } catch (err) { console.error("Erro ao buscar cartas", err); }
}

function showToast(message) {
    clearTimeout(toastTimeout);
    toastMessage.textContent = message;
    toastNotification.classList.remove('translate-x-[120%]');
    toastTimeout = setTimeout(() => {
        toastNotification.classList.add('translate-x-[120%]');
    }, 4000);
}

function showGameNotification(message, permanent = false) {
    gameNotificationText.textContent = message;
    gameNotification.classList.remove('hidden');
    if (message.includes('Aguardando')) {
        gameNotificationText.classList.add('animate-pulse');
    } else {
        gameNotificationText.classList.remove('animate-pulse');
    }
}

function hideGameNotification() {
    gameNotification.classList.add('hidden');
    gameNotificationText.classList.remove('animate-pulse');
}

// --- LÓGICA DE NAVEGAÇÃO E UI ---
function backToMenu() {
    if (ws) {
        ws.close();
        ws = null;
    }
    mainMenu.classList.remove('hidden');
    gameContent.classList.add('hidden');
    twoPlayerLobby.classList.add('hidden');
    victoryModal.classList.add('hidden');
    victoryContent.classList.remove('victory-modal-enter');
    resetLobbyUI();
}

function backToLobby() {
    if (ws) {
        ws.close();
        ws = null;
    }
    twoPlayerLobby.classList.remove('hidden');
    gameContent.classList.add('hidden');
    victoryModal.classList.add('hidden');
    victoryContent.classList.remove('victory-modal-enter');
    resetLobbyUI();
    fetchPublicGames();
}

function resetLobbyUI() {
    gameSettingsSection.classList.remove('hidden');
    gameCodeSection.classList.add('hidden');
    waitingForPlayerMsg.classList.add('hidden');
    createGameBtn.disabled = false;
    createGameBtn.textContent = 'Criar e Aguardar';
}


function highlightMatch(text, term) {
    if (!term) return text;
    const safeTerm = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(${safeTerm})`, 'gi');
    return text.replace(regex, `<span class="text-yellow-400 font-bold">$1</span>`);
}

searchInput.addEventListener('input', (e) => {
    const term = e.target.value.toLowerCase();
    suggestionsList.innerHTML = '';
    
    if (term.length < 1) {
        suggestionsList.classList.add('hidden');
        return;
    }

    const filtered = allCards
        .filter(c => c.name.toLowerCase().includes(term) && !guessedCards.has(c.name))
        .slice(0, 5);
    
    if (filtered.length > 0) {
        suggestionsList.classList.remove('hidden');
        filtered.forEach(card => {
            const li = document.createElement('li');
            li.className = "flex items-center p-2 sm:p-3 hover:bg-slate-700 cursor-pointer transition-colors border-b border-slate-700 last:border-0 text-white";
            
            const highlightedName = highlightMatch(card.name, term);
            const slug = getCardImageSlug(card.name);
            const localImgUrl = `./img/cards/${slug}.png`;

            li.innerHTML = `<img src="${localImgUrl}" class="w-8 h-8 sm:w-10 sm:h-10 object-contain mr-2 sm:mr-3"><span class="text-sm sm:text-base">${highlightedName}</span>`;
            li.onmousedown = () => makeGuess(card.name); 
            suggestionsList.appendChild(li);
        });
    } else {
        suggestionsList.classList.add('hidden');
    }
});

// --- MODO UM JOGADOR ---

function startMainMenuCooldown() {
    let countdown = 5;
    onePlayerBtn.disabled = true;
    
    const updateButtonText = () => {
        onePlayerBtn.textContent = `Aguarde (${countdown}s)`;
    };
    
    updateButtonText();

    const interval = setInterval(() => {
        countdown--;
        if (countdown > 0) {
            updateButtonText();
        } else {
            clearInterval(interval);
            onePlayerBtn.disabled = false;
            onePlayerBtn.textContent = 'Um Jogador';
        }
    }, 1000);
}

async function startNewGame(event) {
    const clickedButton = event?.currentTarget || onePlayerBtn;
    const allStartButtons = [onePlayerBtn, defeatPlayAgainBtn, victoryPlayAgainBtn];
    const originalButtonHTML = clickedButton.innerHTML;

    allStartButtons.forEach(btn => btn.disabled = true);
    clickedButton.innerHTML = `<span class="flex items-center justify-center"><svg class="animate-spin -ml-1 mr-3 h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>Carregando...</span>`;

    try {
        const res = await fetch(`${API_URL}/game`, { method: 'POST' });
        
        if (!res.ok) {
            if (res.status === 429) {
                const { error } = await res.json();
                showToast(error || 'Você está tentando iniciar jogos muito rápido.');
            } else {
                throw new Error(`Erro do servidor: ${res.status}`);
            }
            return;
        }

        const data = await res.json();
        currentGameId = data.id;
        
        prepareGameBoard();

        if (clickedButton === onePlayerBtn) {
            startMainMenuCooldown();
        }

    } catch (err) {
        console.error("Erro ao iniciar jogo", err);
        showToast('Falha de comunicação com o servidor. Tente novamente.');
    } finally {
        allStartButtons.forEach(btn => {
            if (btn !== onePlayerBtn) {
                btn.disabled = false;
            }
        });
        if (clickedButton !== onePlayerBtn) {
            clickedButton.innerHTML = originalButtonHTML;
        }
    }
}

function prepareGameBoard() {
    mainMenu.classList.add('hidden');
    twoPlayerLobby.classList.add('hidden');
    gameContent.classList.remove('hidden');
    victoryModal.classList.add('hidden');
    victoryContent.classList.remove('victory-modal-enter');

    guessedCards.clear();
    guessesList.innerHTML = '';
    searchInput.value = '';
    searchSection.classList.remove('hidden');
    searchInput.disabled = false; // Garante que a barra de busca esteja sempre ativa
    gameOverMsg.classList.add('hidden');
    hideGameNotification();
    initializeHints();
    renderHints();
    searchInput.focus();
}

async function makeGuess(cardName) {
    if (guessedCards.has(cardName)) return;

    suggestionsList.classList.add('hidden');
    searchInput.value = '';
    guessedCards.add(cardName);
    
    if (isTwoPlayerMode) {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'guess', guessName: cardName }));
            searchInput.disabled = true;
            showGameNotification("Aguardando o palpite do oponente...");
        }
    } else {
        try {
            const res = await fetch(`${API_URL}/guess`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: currentGameId, guessName: cardName })
            });
            
            if (!res.ok) return;

            const { feedback, hints: receivedHints } = await res.json();
            
            updateHints(receivedHints);
            renderGuessRow({ feedback });

            if (feedback.isWin) {
                endGame(true, feedback.card);
            } else if (feedback.isGameOver) {
                endGame(false, feedback.secretCard);
            }

        } catch (err) { 
            console.error("Erro no palpite", err);
            guessedCards.delete(cardName); 
        }
    }
}


function initializeHints() {
    hints = [
        { steps: 3, label: 'Tipo', value: null, state: 'locked' },
        { steps: 6, label: 'Raridade', value: null, state: 'locked' },
        { steps: 10, label: 'Elixir', value: null, state: 'locked' }
    ];
}

function updateHints(receivedHints) {
    if (receivedHints && receivedHints.length > 0) {
        receivedHints.forEach(receivedHint => {
            const hintToUpdate = hints.find(h => h.label === receivedHint.label);
            if (hintToUpdate && hintToUpdate.state === 'locked') {
                hintToUpdate.state = 'ready';
                hintToUpdate.value = receivedHint.value;
            }
        });
        renderHints();
    }
}

// --- RENDERIZAÇÃO ---
function getRarityColor(r) {
    if(r === 'Comum') return 'text-slate-300';
    if(r === 'Rara') return 'text-orange-400';
    if(r === 'Épica') return 'text-purple-400';
    if(r === 'Lendária') return 'text-legendary font-bold';
    if(r === 'Campeão') return 'text-yellow-400';
    return 'text-white';
}

function renderGuessRow({ feedback, playerLabel }) {
    const card = feedback.card;
    const comp = feedback.comparisons;
    const slug = getCardImageSlug(card.name);
    const localCardImage = `./img/cards/${slug}.png`;
    const localEvoImage = card.evolution ? `./img/cards/${slug}-evo.png` : null;
    const arenaUrl = `./img/arenas/arena${card.arena}.png`;
    const arenaName = `Arena ${card.arena}`;

    const row = document.createElement('div');
    row.className = `guess-row bg-slate-900/75 rounded-lg p-1 sm:p-2 grid grid-cols-6 gap-1 sm:gap-2 text-center text-white transition-all duration-500 mb-2 border border-slate-700/50 relative`;

    if (playerLabel) {
        row.innerHTML += `<div class="player-label">${playerLabel}</div>`;
    }

    const getArrowIcon = (direction) => {
        if (!direction) return '';
        const d = direction === 'higher' ? 'M12 4l8 8h-6v8h-4v-8H4l8-8z' : 'M12 20l-8-8h6V4h4v8h6l-8 8z';
        return `<svg xmlns="http://www.w3.org/2000/svg" class="w-8 h-8 sm:w-16 sm:h-16 filter drop-shadow-lg" viewBox="0 0 24 24" fill="currentColor"><path d="${d}"/></svg>`;
    };

    const getStatusClasses = (status) => {
        if (status === 'correct') return 'shadow-[0_0_15px_rgba(34,197,94,0.6)] bg-green-500/20 border-green-500/50';
        if (status === 'incorrect') return 'shadow-[0_0_15px_rgba(239,68,68,0.6)] bg-red-500/20 border-red-500/50';
        return 'shadow-[0_0_15px_rgba(234,179,8,0.6)] bg-orange-500/20 border-orange-500/50';
    };

    const getTypeIcon = (type) => {
        switch (type) {
            case 'Tropa': return 'https://api.iconify.design/game-icons:sword-clash.svg?color=%23ffffff';
            case 'Construção': return 'https://api.iconify.design/game-icons:castle-ruins.svg?color=%23ffffff';
            case 'Feitiço': return 'https://api.iconify.design/game-icons:magic-swirl.svg?color=%23ffffff';
            default: return '';
        }
    };

    const rarityClass = getRarityColor(card.rarity);

    row.innerHTML += `
        <div class="col-span-1 flex flex-col items-center justify-center h-24 sm:h-36 p-1 sm:p-2">
            <img src="${localCardImage}" alt="${card.name}" class="w-10 h-14 sm:w-16 sm:h-20 object-contain drop-shadow-[0_5px_5px_rgba(0,0,0,0.5)]"/>
            <span class="mt-1 text-[10px] sm:text-base font-clash font-bold text-white drop-shadow-md leading-tight ${rarityClass}">
                ${card.name}
            </span>
        </div>
        <div class="group relative h-24 sm:h-36 flex flex-col items-center justify-center p-1 sm:p-2 rounded-md font-bold text-lg sm:text-3xl border-2 transition-all duration-300 overflow-hidden ${getStatusClasses(comp.elixir)}">
            ${comp.elixir !== 'correct' ? 
                `<div class="absolute inset-0 flex items-center justify-center text-white opacity-0 group-hover:opacity-100 transition-opacity duration-300 bg-black/40 backdrop-blur-sm">
                    ${getArrowIcon(comp.elixir)}
                 </div>` : ''
            }
            <div class="flex flex-col items-center justify-center transition-opacity duration-300 ${comp.elixir !== 'correct' ? 'group-hover:opacity-0' : ''}">
                <img src="https://cdn.royaleapi.com/static/img/ui/elixir.png" class="w-5 h-5 sm:w-8 sm:h-8 mb-1"/>
                <span>${card.elixir}</span>
            </div>
        </div>
        <div class="group relative h-24 sm:h-36 flex flex-col items-center justify-center p-1 sm:p-2 rounded-md border-2 transition-all duration-300 overflow-hidden ${getStatusClasses(comp.rarity)}">
             ${comp.rarity !== 'correct' ? 
                `<div class="absolute inset-0 flex items-center justify-center text-white opacity-0 group-hover:opacity-100 transition-opacity duration-300 bg-black/40 backdrop-blur-sm">
                    ${getArrowIcon(comp.rarity)}
                 </div>` : ''
            }
            <span class="text-xs sm:text-lg font-bold transition-opacity duration-300 ${comp.rarity !== 'correct' ? 'group-hover:opacity-0' : ''} ${rarityClass}">
                ${card.rarity}
            </span>
        </div>
        <div class="group relative h-24 sm:h-36 flex flex-col items-center justify-center p-1 sm:p-2 rounded-md border-2 font-bold text-lg overflow-hidden ${getStatusClasses(comp.type)}">
            <img src="${getTypeIcon(card.type)}" class="w-10 h-10 sm:w-16 sm:h-16 object-contain transition-opacity duration-300 group-hover:opacity-0">
            <span class="absolute drop-shadow-md opacity-0 group-hover:opacity-100 transition-opacity duration-300 font-clash text-sm sm:text-xl">
                ${card.type}
            </span>
        </div>
        <div class="group relative h-24 sm:h-36 flex flex-col items-center justify-center p-1 rounded-md border-2 overflow-hidden ${getStatusClasses(comp.arena)}">
            <img src="${arenaUrl}" class="w-full h-full object-cover rounded opacity-80 group-hover:opacity-20 transition-all duration-300">
            <div class="absolute inset-0 flex flex-col items-center justify-center z-10 opacity-0 group-hover:opacity-100 transition-opacity duration-300 bg-black/60 backdrop-blur-[2px]">
                ${comp.arena !== 'correct' ? getArrowIcon(comp.arena) : ''}
                <span class="text-xs sm:text-sm font-bold text-white drop-shadow-[0_2px_2px_rgba(0,0,0,1)] mt-1 px-1 leading-tight">
                    ${arenaName}
                </span>
            </div>
        </div>
        <div class="h-24 sm:h-36 flex flex-col items-center justify-center p-1 sm:p-2 rounded-md border-2 ${getStatusClasses(comp.evolution)}">
            ${card.evolution ? 
                `<img src="${localEvoImage}" class="h-16 sm:h-24 w-auto object-contain drop-shadow-lg" alt="Evo">` 
                : 
                '<svg xmlns="http://www.w3.org/2000/svg" class="w-8 h-8 sm:w-12 sm:h-12 text-red-500/80" fill="none" viewBox="0 0 24 24" stroke="currentColor"><circle cx="12" cy="12" r="10" stroke-width="2"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M6 18L18 6M6 6l12 12" /></svg>'
            }
        </div>
    `;

    guessesList.prepend(row);
}

function renderHints() {
    hintsContainer.innerHTML = '';
    const chestImg = "https://cdn.royaleapi.com/static/img/chests/chest-wooden.png";

    hints.forEach(h => {
        const div = document.createElement('div');
        div.className = `flex flex-col items-center mx-2 hint-chest hint-${h.state}`;

        const sparkleHTML = `<div class="sparkle-container"><div class="sparkle"></div><div class="sparkle"></div><div class="sparkle"></div></div>`;

        div.innerHTML = `
            <div class="relative w-20 h-16 sm:w-24 sm:h-20 flex items-center justify-center hint-chest-wrapper">
                ${sparkleHTML}
                <img src="${chestImg}" class="chest-image w-16 sm:w-20 h-auto object-contain" alt="Baú de Dica">
                ${h.state === 'revealed' ? 
                    `<div class="absolute -bottom-2 left-1/2 -translate-x-1/2 bg-black/80 border border-yellow-500/50 text-yellow-300 text-xs px-2 py-1 rounded-full whitespace-nowrap z-10">
                        ${h.label}: <span class="text-white font-bold">${h.value}</span>
                     </div>` 
                : ''}
            </div>
            <span class="text-slate-400 text-xs mt-2 font-semibold">Após ${h.steps}</span>
        `;

        if (h.state === 'ready') {
            const wrapper = div.querySelector('.hint-chest-wrapper');
            wrapper.addEventListener('click', () => {
                h.state = 'revealed';
                renderHints();
            }, { once: true });
        }
        hintsContainer.appendChild(div);
    });
}

// --- FIM DE JOGO ---
function endGame(win, card) {
    searchSection.classList.add('hidden');
    
    if (win) {
        const slug = getCardImageSlug(card.name);
        const localCardImage = `./img/cards/${slug}.png`;
        const attemptsCount = guessedCards.size;
        const attemptText = attemptsCount === 1 ? 'tentativa' : 'tentativas';

        victoryCardImage.src = localCardImage;
        victoryCardName.textContent = card.name;
        victoryCardName.className = `mt-4 text-xl sm:text-2xl font-clash font-bold ${getRarityColor(card.rarity)}`;
        victoryAttempts.innerHTML = `Você acertou em <span class="font-bold text-white">${attemptsCount}</span> ${attemptText}!`;

        victoryModal.classList.remove('hidden');
        victoryContent.classList.add('victory-modal-enter');
    } else {
        gameOverMsg.classList.remove('hidden');
        endTitle.innerHTML = `<div class="text-4xl mb-2">💀</div><span class="text-red-500 text-3xl font-clash-title">Derrota!</span><br><span class="text-slate-300 text-lg">A carta era <span class="text-yellow-400 font-bold">${card ? card.name : '???'}</span></span>`;
    }
}

document.addEventListener('click', (e) => {
    if (!searchSection.contains(e.target)) {
        suggestionsList.classList.add('hidden');
    }
});


// --- MODO DOIS JOGADORES (WEBSOCKET) ---

function showTwoPlayerLobby() {
    mainMenu.classList.add('hidden');
    twoPlayerLobby.classList.remove('hidden');
    fetchPublicGames();
}

function switchLobbyView(view) {
    if (view === 'create') {
        createGameView.classList.remove('hidden');
        joinGameView.classList.add('hidden');
        showCreateGameBtn.classList.add('active');
        showJoinGameBtn.classList.remove('active');
    } else {
        createGameView.classList.add('hidden');
        joinGameView.classList.remove('hidden');
        showCreateGameBtn.classList.remove('active');
        showJoinGameBtn.classList.add('active');
    }
}

async function createTwoPlayerGame() {
    createGameBtn.disabled = true;
    createGameBtn.textContent = 'Criando...';
    
    const settings = {
        maxAttempts: parseInt(maxAttemptsSlider.value, 10),
        hints: document.getElementById('hints-enabled-toggle').checked,
        isPublic: document.getElementById('is-public-toggle').checked,
    };

    try {
        const res = await fetch(`${API_URL}/game/create-two-player`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(settings),
        });
        const data = await res.json();
        if (data.gameId) {
            gameSettingsSection.classList.add('hidden');
            gameCodeDisplay.textContent = data.gameId;
            gameCodeSection.classList.remove('hidden');
            waitingForPlayerMsg.classList.remove('hidden');
            joinTwoPlayerGame(data.gameId, true);
        }
    } catch (err) {
        showToast('Erro ao criar o jogo. Tente novamente.');
        createGameBtn.disabled = false;
        createGameBtn.textContent = 'Criar e Aguardar';
    }
}

function joinTwoPlayerGame(gameId, isHost = false) {
    isTwoPlayerMode = true;
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const wsUrl = `${protocol}://${window.location.host}`;
    
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
        ws.send(JSON.stringify({ type: 'join', gameId }));
    };

    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        switch(data.type) {
            case 'gameStart':
                currentGameId = data.gameId;
                prepareGameBoard();
                hintsContainer.style.display = data.settings.hints ? 'flex' : 'none';
                break;
            case 'turnResult':
                hideGameNotification();
                searchInput.disabled = false;
                searchInput.focus();

                // Limpa o placeholder do turno
                const turnPlaceholder = document.getElementById(`turn-${data.turn}`);
                if (turnPlaceholder) turnPlaceholder.remove();
                
                // Adiciona o cabeçalho do turno
                const turnHeader = document.createElement('h3');
                turnHeader.className = "text-center font-bold text-yellow-400 my-2";
                turnHeader.textContent = `Turno ${data.turn}`;
                guessesList.prepend(turnHeader);
                
                renderGuessRow({ feedback: data.opponentFeedback, playerLabel: 'Oponente'});
                renderGuessRow({ feedback: data.myFeedback, playerLabel: 'Você' });

                updateHints(data.hints);
                break;
            case 'gameOver':
                endTwoPlayerGame(data.result, data.secretCard);
                break;
            case 'opponentDisconnected':
                showToast('Oponente desconectou. Retornando ao lobby...');
                searchInput.disabled = true;
                setTimeout(() => {
                    // Only navigate if the user is still on the game screen
                    if (!gameContent.classList.contains('hidden')) {
                        leaveTwoPlayerGame();
                    }
                }, 3000); // Wait 3 seconds for the user to read the message
                break;
            case 'error':
                showToast(data.message);
                if (!isHost) {
                    ws.close();
                    backToLobby();
                }
                break;
        }
    };

    ws.onclose = () => {
        if (!gameContent.classList.contains('hidden')) {
             if (!victoryModal.classList.contains('hidden') && !gameOverMsg.classList.contains('hidden')) {
                showGameNotification('Conexão perdida com o servidor.', true);
             }
        }
    };

    ws.onerror = (err) => {
        console.error('WebSocket Error:', err);
        showToast('Erro de conexão com o servidor.');
    };
}


async function fetchPublicGames() {
    try {
        const res = await fetch(`${API_URL}/public-games`);
        const games = await res.json();
        publicGamesList.innerHTML = '';

        if (games.length === 0) {
            publicGamesList.innerHTML = '<li id="no-public-games" class="text-center text-slate-400 p-4">Nenhuma partida pública encontrada.</li>';
        } else {
            games.forEach(game => {
                const li = document.createElement('li');
                li.className = 'public-game-item';
                li.innerHTML = `
                    <span>
                        Dicas: ${game.settings.hints ? '✅' : '❌'} | 
                        Tentativas: ${game.settings.maxAttempts}
                    </span>
                    <button class="join-public-btn">Entrar</button>
                `;
                li.querySelector('.join-public-btn').addEventListener('click', () => joinTwoPlayerGame(game.id));
                publicGamesList.appendChild(li);
            });
        }
    } catch(err) {
        console.error('Erro ao buscar jogos públicos', err);
        publicGamesList.innerHTML = '<li class="text-center text-red-400 p-4">Erro ao carregar partidas.</li>';
    }
}

function copyGameCode() {
    navigator.clipboard.writeText(gameCodeDisplay.textContent)
        .then(() => showToast('Código copiado!'))
        .catch(() => showToast('Falha ao copiar o código.'));
}

function leaveTwoPlayerGame() {
    if (ws) {
        ws.close();
        ws = null;
    }
    backToLobby();
}

function endTwoPlayerGame(result, secretCard) {
    searchSection.classList.add('hidden');
    hideGameNotification();

    if (result.winner) {
        const winnerCard = result.winner === 'me' ? result.myCard : result.opponentCard;
        const slug = getCardImageSlug(winnerCard.name);
        const localCardImage = `./img/cards/${slug}.png`;

        victoryCardImage.src = localCardImage;
        victoryCardName.textContent = winnerCard.name;
        victoryCardName.className = `mt-4 text-xl sm:text-2xl font-clash font-bold ${getRarityColor(winnerCard.rarity)}`;

        if (result.winner === 'me') {
            victoryAttempts.innerHTML = `Você venceu na <span class="font-bold text-white">${result.turn}ª</span> rodada!`;
        } else {
            victoryAttempts.innerHTML = `Você perdeu! O oponente acertou em <span class="font-bold text-white">${result.turn}</span> rodadas.`;
        }
        
        victoryModal.classList.remove('hidden');
        victoryContent.classList.add('victory-modal-enter');

    } else if (result.draw) {
         gameOverMsg.classList.remove('hidden');
         endTitle.innerHTML = `<div class="text-4xl mb-2">🤝</div><span class="text-yellow-400 text-3xl font-clash-title">Empate!</span><br><span class="text-slate-300 text-lg">Ambos acertaram! A carta era <span class="font-bold">${secretCard.name}</span></span>`;
    } else { // Derrota por limite de tentativas
        gameOverMsg.classList.remove('hidden');
        endTitle.innerHTML = `<div class="text-4xl mb-2">💀</div><span class="text-red-500 text-3xl font-clash-title">Derrota!</span><br><span class="text-slate-300 text-lg">A carta era <span class="text-yellow-400 font-bold">${secretCard.name}</span></span>`;
    }
}