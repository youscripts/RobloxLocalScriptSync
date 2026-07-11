const express = require('express');
const WebSocket = require('ws');
const http = require('http');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Хранилище
const sessions = new Map();          // code -> { clients: Set, createdBy: ws, persist: boolean }
const clientSession = new Map();      // ws -> code
const clientName = new Map();         // ws -> name

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

function send(ws, data) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(data));
    }
}

function broadcastMembers(code) {
    const session = sessions.get(code);
    if (!session) return;
    const members = [];
    session.clients.forEach(client => {
        members.push({
            name: clientName.get(client) || 'Unknown',
            isCreator: client === session.createdBy
        });
    });
    session.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            send(client, { type: 'members', members: members });
        }
    });
}

function broadcastPersist(code) {
    const session = sessions.get(code);
    if (!session) return;
    session.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            send(client, { type: 'persist_update', value: session.persist || false });
        }
    });
}

wss.on('connection', (ws) => {
    console.log('New client connected');
    clientSession.set(ws, null);

    ws.on('message', (message) => {
        let msg;
        try {
            msg = JSON.parse(message);
        } catch (e) {
            send(ws, { type: 'error', message: 'Invalid JSON' });
            return;
        }

        const currentCode = clientSession.get(ws);

        switch (msg.type) {
            case 'identify': {
                const name = msg.name || 'Player';
                clientName.set(ws, name);
                console.log(`Client identified as ${name}`);
                break;
            }
            case 'create': {
                if (currentCode) {
                    send(ws, { type: 'error', message: 'Session already exists', code: 'ERROR_3' });
                    return;
                }
                const code = generateCode();
                if (!code) {
                    send(ws, { type: 'error', message: 'Could not generate unique code' });
                    return;
                }
                sessions.set(code, { clients: new Set([ws]), createdBy: ws, persist: false });
                clientSession.set(ws, code);
                send(ws, { type: 'created', code: code });
                console.log(`Session ${code} created by ${clientName.get(ws) || 'Unknown'}`);
                broadcastMembers(code);
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
                const session = sessions.get(code);
                session.clients.add(ws);
                clientSession.set(ws, code);
                send(ws, { type: 'joined', code: code });
                console.log(`${clientName.get(ws) || 'Unknown'} joined ${code}`);
                broadcastMembers(code);
                // Отправить текущий статус persist
                send(ws, { type: 'persist_update', value: session.persist || false });
                break;
            }
            case 'set_persist': {
                if (!currentCode) {
                    send(ws, { type: 'error', message: 'Not in a session' });
                    return;
                }
                const session = sessions.get(currentCode);
                if (!session) {
                    send(ws, { type: 'error', message: 'Session not found' });
                    return;
                }
                if (session.createdBy !== ws) {
                    send(ws, { type: 'error', message: 'Only creator can change persist mode' });
                    return;
                }
                const value = msg.value === true; // приводим к булевому
                session.persist = value;
                console.log(`Session ${currentCode} persist mode set to ${value}`);
                broadcastPersist(currentCode);
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
                const session = sessions.get(currentCode);
                if (session) {
                    session.clients.forEach(client => {
                        if (client.readyState === WebSocket.OPEN) {
                            send(client, { type: 'exec', script: script });
                        }
                    });
                }
                send(ws, { type: 'exec_sent', message: 'Script sent to everyone' });
                break;
            }
            case 'output': {
                const output = msg.message;
                if (!output || !currentCode) return;
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
                if (currentCode) {
                    const session = sessions.get(currentCode);
                    if (session) {
                        session.clients.delete(ws);
                        if (session.clients.size === 0) {
                            sessions.delete(currentCode);
                            console.log(`Session ${currentCode} closed (empty)`);
                        } else {
                            broadcastMembers(currentCode);
                        }
                    }
                    clientSession.set(ws, null);
                    send(ws, { type: 'left', message: 'You left the session' });
                }
                break;
            }
            case 'close': {
                if (!currentCode) {
                    send(ws, { type: 'error', message: 'Not in a session' });
                    return;
                }
                const session = sessions.get(currentCode);
                if (!session) {
                    send(ws, { type: 'error', message: 'Session not found' });
                    return;
                }
                if (session.createdBy !== ws) {
                    send(ws, { type: 'error', message: 'Only creator can close session' });
                    return;
                }
                session.clients.forEach(client => {
                    if (client.readyState === WebSocket.OPEN) {
                        send(client, { type: 'session_closed', message: 'Session closed by creator' });
                    }
                    clientSession.delete(client);
                });
                sessions.delete(currentCode);
                console.log(`Session ${currentCode} closed by creator`);
                break;
            }
            case 'list': {
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
        const code = clientSession.get(ws);
        if (code) {
            const session = sessions.get(code);
            if (session) {
                session.clients.delete(ws);
                if (session.clients.size === 0) {
                    sessions.delete(code);
                    console.log(`Session ${code} closed (client disconnect)`);
                } else {
                    broadcastMembers(code);
                }
            }
            clientSession.delete(ws);
        }
        clientName.delete(ws);
    });
});

app.get('/', (req, res) => {
    res.send('Roblox Session Sync Server is running');
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
