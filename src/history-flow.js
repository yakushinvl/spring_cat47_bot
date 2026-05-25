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
        const DEBUG = process.env.DEBUG === 'true';
        const parseDate = (str) => {
            str = str.trim();
            let day, month, year;
            let match = str.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
            if (match) {
                [_, day, month, year] = match;
            } else {
                match = str.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2})$/);
                if (match) { [_, day, month, year] = match; year = '20' + year; }
                else {
                    match = str.match(/^(\d{1,2})\.(\d{1,2})$/);
                    if (match) { [_, day, month] = match; year = new Date().getFullYear(); }
                }
            }
            if (!day) return null;
            return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        };

        try {
            if (DEBUG) console.log(`[ИСТОРИЯ] попытка создать файл для: ${periodStr}`);
            let start, end;
            const parts = periodStr.split('-').map(s => s.trim());
            if (parts.length === 2) { start = parseDate(parts[0]); end = parseDate(parts[1]); }
            else if (parts.length === 1) { start = end = parseDate(parts[0]); }

            if (!start || !end) {
                if (DEBUG) console.error(`[ИСТОРИЯ] неверный формат даыт: ${periodStr}`);
                return ctx.reply('Неверный формат даты.');
            }

            const user = await db.getUser(ctx.user.user_id);
            const isTechAdmin = user?.role === 'Технический администратор';
            
            if (DEBUG) console.log(`[ИСТОРИЯ] формирование запросов к бд в даты ${start} - ${end}. техадмин?: ${isTechAdmin}`);
            const logs = await db.getHistory(start, end, isTechAdmin);

            if (logs.length === 0) {
                if (DEBUG) console.log(`[ИСТОРИЯ] за указанный период действий не найдено.`);
                return ctx.reply(`За период ${start} - ${end} действий не найдено.`);
            }

            const fileName = `история_${start}_${end}.txt`;
            const tempDir = path.join(__dirname, '../temp');
            if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);
            const filePath = path.join(tempDir, fileName);

            const content = `ОТЧЕТ ПО ИСТОРИИ ДЕЙСТВИЙ БОТА\n` +
                `Период: ${start} — ${end}\n` +
                `Всего действий за период: ${logs.length}\n` +
                `Сформировано: ${new Date().toLocaleString('ru-RU')}\n\n` + 
                logs.map(l => {
                    const dt = l.created_at.toLocaleString('ru-RU');
                    const appPart = l.application_id ? ` | Заявка:#${l.application_id}` : '';
                    return `[${dt}] Пользователь ID: ${l.user_id}${appPart} | Действие: ${l.action_type} | Детали: ${l.details}`;
                }).join('\n');
            
            if (DEBUG) console.log(`[ИСТОРИЯ] запись инфы в ${filePath}`);
            fs.writeFileSync(filePath, content);

            const uploadUrlInfo = await ctx.api.raw.uploads.getUploadUrl({ type: 'file' });
            if (DEBUG) console.log(`[ИСТОРИЯ] загрузка файла действий на ${uploadUrlInfo.url}`);

            const formData = new FormData();
            formData.append('data', new Blob([content]), fileName);
            const uploadRes = await fetch(uploadUrlInfo.url, { method: 'POST', body: formData });
            const uploadResult = await uploadRes.json();
            const fileToken = uploadResult.token || uploadResult.retval;

            if (DEBUG) console.log(`[ИСТОРИЯ] файл загружен. токен: ${fileToken}`);

            await ctx.reply(`История действий за период ${start} — ${end}:`, {
                attachments: [{ type: 'file', payload: { token: fileToken } }]
            });
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
                if (DEBUG) console.log(`[ИСТОРИЯ] временный файл удалён.`);
            }
        } catch (e) {
            if (DEBUG) console.error('[ИСТОРИЯ] ошибка:', e);
            await ctx.reply('Ошибка при формировании файла.');
        }
    }
};

module.exports = historyFlow;
