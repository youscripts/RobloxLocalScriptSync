const express = require('express');
const WebSocket = require('ws');
const http = require('http');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Хранилище комнат: код -> { clients: Set, created: timestamp }
const rooms = new Map();

// Генератор 5-значного кода (латиница + цифры)
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
    } while (rooms.has(code) && attempts < 100);
    return code;
}

app.get('/', (req, res) => {
    res.send('Сервер синхронизации скриптов Roblox работает! Используйте WebSocket.');
});

wss.on('connection', (ws) => {
    console.log('Новое подключение');
    let currentRoom = null; // код комнаты, в которой находится клиент

    ws.on('message', (message) => {
        const text = message.toString().trim();
        console.log('Получено:', text);

        // Разбор команды: первое слово - команда, остальное - аргументы
        const parts = text.split(' ');
        const cmd = parts[0].toLowerCase();

        if (cmd === '!create') {
            // Создаём новую комнату
            const code = generateCode();
            rooms.set(code, { clients: new Set(), created: Date.now() });
            // Добавляем текущего клиента в комнату
            rooms.get(code).clients.add(ws);
            currentRoom = code;
            ws.send(`Создана комната ${code}. Вы подключены.`);
            console.log(`Комната ${code} создана`);
        }
        else if (cmd === '!join') {
            if (parts.length < 2) {
                ws.send('Используйте: !join КОД');
                return;
            }
            const code = parts[1].toUpperCase();
            if (!rooms.has(code)) {
                ws.send(`Комната с кодом ${code} не найдена.`);
                return;
            }
            // Если уже в другой комнате, удаляем из старой
            if (currentRoom && rooms.has(currentRoom)) {
                rooms.get(currentRoom).clients.delete(ws);
            }
            // Добавляем в новую
            rooms.get(code).clients.add(ws);
            currentRoom = code;
            ws.send(`Вы подключены к комнате ${code}`);
            console.log(`Клиент подключился к ${code}`);
        }
        else if (cmd === '!exec') {
            if (!currentRoom) {
                ws.send('Вы не в комнате. Сначала создайте или подключитесь: !create или !join КОД');
                return;
            }
            // Команда для выполнения: всё, что после !exec
            const command = parts.slice(1).join(' ');
            if (!command) {
                ws.send('Укажите команду для выполнения');
                return;
            }
            const room = rooms.get(currentRoom);
            if (!room) {
                ws.send('Комната больше не существует');
                return;
            }
            // Отправляем команду всем в комнате, кроме отправителя
            let sent = 0;
            room.clients.forEach(client => {
                if (client !== ws && client.readyState === WebSocket.OPEN) {
                    client.send(command);
                    sent++;
                }
            });
            ws.send(`Команда отправлена ${sent} клиентам в комнате ${currentRoom}`);
            console.log(`Команда "${command}" выполнена в ${currentRoom} (${sent} получателей)`);
        }
        else if (cmd === '!leave') {
            if (currentRoom && rooms.has(currentRoom)) {
                rooms.get(currentRoom).clients.delete(ws);
                ws.send('Вы покинули комнату');
                // Если комната пуста, можно удалить (опционально)
                if (rooms.get(currentRoom).clients.size === 0) {
                    rooms.delete(currentRoom);
                    console.log(`Комната ${currentRoom} удалена (пуста)`);
                }
                currentRoom = null;
            } else {
                ws.send('Вы не в комнате');
            }
        }
        else if (cmd === '!list') {
            // Показываем список активных комнат (коды и количество клиентов)
            if (rooms.size === 0) {
                ws.send('Нет активных комнат');
            } else {
                let list = 'Активные комнаты:\n';
                rooms.forEach((room, code) => {
                    list += `${code}: ${room.clients.size} клиентов\n`;
                });
                ws.send(list);
            }
        }
        else {
            ws.send('Неизвестная команда. Доступно: !create, !join КОД, !exec КОМАНДА, !leave, !list');
        }
    });

    ws.on('close', () => {
        // Удаляем клиента из комнаты при отключении
        if (currentRoom && rooms.has(currentRoom)) {
            rooms.get(currentRoom).clients.delete(ws);
            if (rooms.get(currentRoom).clients.size === 0) {
                rooms.delete(currentRoom);
                console.log(`Комната ${currentRoom} удалена (пуста)`);
            }
        }
        console.log('Клиент отключился');
    });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
    console.log(`Сервер запущен на порту ${PORT}`);
    console.log('Доступные команды: !create, !join КОД, !exec КОМАНДА, !leave, !list');
});
