const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.json());
app.use(express.static('public'));

// Хранилище сессий: { sessionCode: { players: [ws, ...], host: "name", maxPlayers: 5 } }
const sessions = {};

// --- HTTP: создание сессии ---
app.post('/create-session', (req, res) => {
    const { playerName } = req.body;
    if (!playerName) {
        return res.status(400).json({ error: 'Не указано имя игрока' });
    }
    const sessionCode = uuidv4().slice(0, 6).toUpperCase();
    sessions[sessionCode] = {
        players: [],
        host: playerName,
        maxPlayers: 5
    };
    console.log(`✅ Сессия ${sessionCode} создана (хост: ${playerName})`);
    res.json({ sessionCode, maxPlayers: 5 });
});

// --- HTTP: проверка существования сессии ---
app.get('/session/:code', (req, res) => {
    const code = req.params.code.toUpperCase();
    const session = sessions[code];
    if (session) {
        res.json({
            exists: true,
            playersCount: session.players.length,
            maxPlayers: session.maxPlayers,
            host: session.host
        });
    } else {
        res.json({ exists: false });
    }
});

// --- HTTP: получение списка активных сессий (для отладки) ---
app.get('/sessions', (req, res) => {
    const list = Object.keys(sessions).map(code => ({
        code,
        playersCount: sessions[code].players.length,
        maxPlayers: sessions[code].maxPlayers,
        host: sessions[code].host
    }));
    res.json(list);
});

// --- WebSocket: управление подключениями ---
wss.on('connection', (ws) => {
    let sessionCode = null;
    let playerName = null;

    ws.on('message', (rawMessage) => {
        try {
            const data = JSON.parse(rawMessage);
            if (data.type === 'join') {
                const code = data.sessionCode.toUpperCase();
                const name = data.playerName || 'Игрок';
                const session = sessions[code];

                if (!session) {
                    ws.send(JSON.stringify({ error: 'Сессия не найдена' }));
                    return;
                }

                if (session.players.length >= session.maxPlayers) {
                    ws.send(JSON.stringify({ error: 'Сессия заполнена' }));
                    return;
                }

                // Сохраняем данные клиента
                sessionCode = code;
                playerName = name;
                session.players.push(ws);

                // Подтверждение подключения
                ws.send(JSON.stringify({
                    type: 'joined',
                    sessionCode: code,
                    playersCount: session.players.length
                }));

                // Уведомляем всех в комнате о новом игроке
                broadcastToSession(code, {
                    type: 'player_joined',
                    playerName: name,
                    playersCount: session.players.length
                });

                console.log(`👤 ${name} подключился к ${code} (${session.players.length}/${session.maxPlayers})`);

            } else if (data.type === 'command') {
                // Получена команда от клиента → ретранслируем всем в сессии
                if (sessionCode && sessions[sessionCode]) {
                    broadcastToSession(sessionCode, {
                        type: 'execute',
                        command: data.command,
                        sender: playerName || 'Аноним'
                    });
                    console.log(`📤 Команда от ${playerName} в ${sessionCode}`);
                } else {
                    ws.send(JSON.stringify({ error: 'Вы не в сессии' }));
                }
            }
        } catch (err) {
            console.error('Ошибка обработки сообщения:', err);
            ws.send(JSON.stringify({ error: 'Неверный формат сообщения' }));
        }
    });

    ws.on('close', () => {
        if (sessionCode && sessions[sessionCode]) {
            const session = sessions[sessionCode];
            session.players = session.players.filter(client => client !== ws);

            broadcastToSession(sessionCode, {
                type: 'player_left',
                playerName: playerName || 'Игрок',
                playersCount: session.players.length
            });

            console.log(`👋 ${playerName} отключился от ${sessionCode} (осталось ${session.players.length})`);

            // Если комната пуста — удаляем
            if (session.players.length === 0) {
                delete sessions[sessionCode];
                console.log(`🧹 Комната ${sessionCode} удалена`);
            }
        }
    });
});

// --- Функция рассылки всем в сессии ---
function broadcastToSession(sessionCode, message) {
    const session = sessions[sessionCode];
    if (!session) return;
    const json = JSON.stringify(message);
    session.players.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(json);
        }
    });
}

// --- Запуск сервера ---
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Сервер запущен на порту ${PORT}`);
    console.log(`📊 Поддерживается до 3 комнат по 5 игроков`);
    console.log(`🌐 Адрес для подключения: ws://localhost:${PORT} (локально) или ваш публичный URL`);
});
