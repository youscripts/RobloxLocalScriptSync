# RobloxLocalScriptSync

**Синхронизация Lua-скриптов между игроками в Roblox через WebSocket.**

Этот проект позволяет тебе и твоим друзьям подключаться к общей сессии и выполнять Lua-скрипты одновременно. Идеально подходит для тестирования скриптов, создания эффектов или просто для веселья в компании.

---

## 🚀 Как подключиться к друзьям (инструкция для всех)

Чтобы начать, всем участникам нужно выполнить всего **один** шаг:

1.  **Скопируйте и вставьте эту команду в ваш Executor (Delta, KRNL, Synapse и т.д.):**

```lua
loadstring(game:HttpGet("https://raw.githubusercontent.com/youscripts/RobloxLocalScriptSync/refs/heads/main/Lua%20Client%20Session%20Script"))()
