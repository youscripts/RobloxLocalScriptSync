const express = require('express');
const WebSocket = require('ws');
const http = require('http');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Хранилище сессий: код -> { clients: Set, createdBy: ws }
const sessions = new Map();
// Для каждого клиента храним его текущий код сессии (или null)
const clientSession = new Map();

// Генерация случайного 5-значного кода (латиница + цифры)
function generateCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code;
    let attempts = 0;
    do {
        code = '';
        for (let i = 0; i < 5; i++) {
            code += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        attempts++;
    } while (sessions.has(code) && attempts < 100);
    return code;
}

// Отправить сообщение клиенту
function send(ws, data) {
    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(data));
    }
}

// Рассылка всем в сессии (кроме отправителя)
function broadcastToSession(code, sender, data) {
    if (!sessions.has(code)) return;
    const { clients } = sessions.get(code);
    clients.forEach(client => {
        if (client !== sender && client.readyState === WebSocket.OPEN) {
            send(client, data);
        }
    });
}

// Обработка WebSocket соединений
wss.on('connection', (ws) => {
    console.log('New client connected');
    clientSession.set(ws, null); // пока не в сессии

    ws.on('message', (message) => {
        let msg;
        try {
            msg = JSON.parse(message);
        } catch (e) {
            console.log('Invalid JSON:', message);
            send(ws, { type: 'error', message: 'Invalid JSON' });
            return;
        }

        const currentCode = clientSession.get(ws);

        switch (msg.type) {
            case 'create': {
                // Проверяем, не в сессии ли уже
                if (currentCode) {
                    send(ws, { type: 'error', message: 'Session already exists', code: 'ERROR_3' });
                    return;
                }
                const code = generateCode();
                if (!code) {
                    send(ws, { type: 'error', message: 'Could not generate unique code' });
                    return;
                }
                // Создаем сессию
                sessions.set(code, { clients: new Set([ws]), createdBy: ws });
                clientSession.set(ws, code);
                send(ws, { type: 'created', code: code });
                console.log(`Session ${code} created`);
                break;
            }
            case 'join': {
                const code = msg.code;
                if (!code) {
                    send(ws, { type: 'error', message: 'Code required' });
                    return;
                }
                if (currentCode) {
                    send(ws, { type: 'error', message: 'Already in a session' });
                    return;
                }
                if (!sessions.has(code)) {
                    send(ws, { type: 'error', message: 'Session not found' });
                    return;
                }
                // Добавляем клиента в сессию
                const session = sessions.get(code);
                session.clients.add(ws);
                clientSession.set(ws, code);
                send(ws, { type: 'joined', code: code });
                console.log(`Client joined ${code}`);
                break;
            }
            case 'exec': {
                const script = msg.script;
                if (!script) {
                    send(ws, { type: 'error', message: 'Script required' });
                    return;
                }
                if (!currentCode) {
                    send(ws, { type: 'error', message: 'Not in a session' });
                    return;
                }
                // Рассылаем скрипт всем в сессии (кроме отправителя)
                broadcastToSession(currentCode, ws, { type: 'exec', script: script });
                // Также отправим подтверждение отправителю
                send(ws, { type: 'exec_sent', message: 'Script sent to others' });
                break;
            }
            case 'output': {
                // Клиент отправляет результат выполнения скрипта
                const output = msg.message;
                if (!output) return;
                if (!currentCode) return;
                // Рассылаем вывод всем в сессии (включая отправителя? Обычно да, чтобы все видели)
                // Но отправитель уже знает, поэтому можно рассылать всем, включая себя.
                // Чтобы не дублировать, можно отправить всем, кроме себя, но тогда отправитель не увидит свой вывод.
                // По условию: "если принт то он выводит им в окно" - значит, вывод должен быть у всех, включая отправителя.
                // Поэтому рассылаем всем, включая отправителя.
                const session = sessions.get(currentCode);
                if (!session) return;
                session.clients.forEach(client => {
                    if (client.readyState === WebSocket.OPEN) {
                        send(client, { type: 'output', message: output });
                    }
                });
                break;
            }
            case 'leave': {
                // Выход из сессии
                if (currentCode) {
                    const session = sessions.get(currentCode);
                    if (session) {
                        session.clients.delete(ws);
                        // Если клиентов не осталось, удаляем сессию
                        if (session.clients.size === 0) {
                            sessions.delete(currentCode);
                            console.log(`Session ${currentCode} closed`);
                        }
                    }
                    clientSession.set(ws, null);
                    send(ws, { type: 'left', message: 'You left the session' });
                }
                break;
            }
            case 'list': {
                // Отправить список сессий с количеством участников
                const list = [];
                sessions.forEach((session, code) => {
                    list.push({ code: code, count: session.clients.size });
                });
                send(ws, { type: 'list', sessions: list });
                break;
            }
            default:
                send(ws, { type: 'error', message: 'Unknown command' });
        }
    });

    ws.on('close', () => {
        // Удаляем клиента из сессии при разрыве
        const code = clientSession.get(ws);
        if (code) {
            const session = sessions.get(code);
            if (session) {
                session.clients.delete(ws);
                if (session.clients.size === 0) {
                    sessions.delete(code);
                    console.log(`Session ${code} closed due to client disconnect`);
                }
            }
            clientSession.delete(ws);
        }
    });
});

app.get('/', (req, res) => {
    res.send('Roblox Session Sync Server is running');
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
