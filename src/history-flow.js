const { Keyboard } = require('@maxhub/max-bot-api');
const db = require('./db');
const ui = require('./menus');
const fs = require('fs');
const path = require('path');

const historyFlow = {
    async start(ctx) {
        const today = new Date();
        const formatDate = (d) => {
            const day = String(d.getDate()).padStart(2, '0');
            const month = String(d.getMonth() + 1).padStart(2, '0');
            const year = d.getFullYear();
            return `${day}.${month}.${year}`;
        };

        const todayStr = formatDate(today);
        const last7Days = new Date(); last7Days.setDate(today.getDate() - 6);
        const last7DaysStr = `${formatDate(last7Days)} - ${todayStr}`;
        const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
        const monthStartStr = `${formatDate(monthStart)} - ${todayStr}`;

        await db.setState(ctx.user.user_id, { step: 'awaiting_history_period' });
        await ctx.sendOrEdit(ui.settings.historyPrompt, { 
            attachments: [ui.settings.historyKeyboard(todayStr, last7DaysStr, monthStartStr)],
            format: 'markdown'
        });
    },

    async generateFile(ctx, periodStr) {
        try {
            let start, end;
            const parts = periodStr.split('-').map(s => s.trim());
            if (parts.length === 2) { start = parseDate(parts[0]); end = parseDate(parts[1]); }
            else if (parts.length === 1) { start = end = parseDate(parts[0]); }

            if (!start || !end) return ctx.reply('Неверный формат даты.');

            const user = await db.getUser(ctx.user.user_id);
            const isTechAdmin = user?.role === 'Технический администратор';
            const logs = await db.getHistory(start, end, isTechAdmin);

            if (logs.length === 0) return ctx.reply(`За период ${start} - ${end} действий не найдено.`);

            const fileName = `история_${start}_${end}.txt`;
            const tempDir = path.join(__dirname, '../temp');
            if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);
            const filePath = path.join(tempDir, fileName);

            const content = `ОТЧЕТ ПО ИСТОРИИ ДЕЙСТВИЙ БОТА\n` +
                `Период: ${start} — ${end}\n` +
                `Всего действий за период: ${logs.length}\n` +
                `Тип доступа: ${isTechAdmin ? 'Ограниченный (Тех.админ)' : 'Полный (Администратор)'}\n` +
                `Сформировано: ${new Date().toLocaleString('ru-RU')}\n\n` + 
                logs.map(l => {
                    const dt = l.created_at.toLocaleString('ru-RU');
                    const appPart = l.application_id ? ` | Заявка:#${l.application_id}` : '';
                    return `[${dt}] Пользователь ID:${l.user_id}${appPart} | Действие:${l.action_type} | Детали:${l.details}`;
                }).join('\n');
            
            fs.writeFileSync(filePath, content);

            const uploadUrlInfo = await ctx.api.raw.uploads.getUploadUrl({ type: 'file' });
            const formData = new FormData();
            formData.append('data', new Blob([content]), fileName);
            const uploadRes = await fetch(uploadUrlInfo.url, { method: 'POST', body: formData });
            const { token: fileToken, retval } = await uploadRes.json();

            await ctx.reply(`История действий за период ${start} — ${end}:`, {
                attachments: [{ type: 'file', payload: { token: fileToken || retval } }]
            });
            if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        } catch (e) {
            if (process.env.DEBUG === 'true') console.error('History error:', e);
            await ctx.reply('Ошибка при формировании файла.');
        }
    }
};

module.exports = historyFlow;
