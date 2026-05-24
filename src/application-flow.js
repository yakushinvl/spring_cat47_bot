const { Keyboard } = require('@maxhub/max-bot-api');
const db = require('./db');
const ui = require('./menus');
const fs = require('fs');
const path = require('path');

const config = JSON.parse(fs.readFileSync(path.join(__dirname, '../config.json'), 'utf8'));

function getNextWorkDay(date, daysOffset) {
    let d = new Date(date);
    d.setDate(d.getDate() + daysOffset);
    const dayMap = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    while (!config.organization.working_hours[dayMap[d.getDay()]]) {
        d.setDate(d.getDate() + 1);
    }
    return d;
}

const flow = {
    async start(ctx, appId = null) {
        const userId = ctx.user.user_id;
        const templates = await db.getTemplates(userId);
        const buttons = templates.map(t => [Keyboard.button.callback(t.full_name, `set_guest:${t.full_name.substring(0, 30)}`)]);
        
        let existingData = {};
        if (appId) {
            const app = await db.getApplicationById(appId);
            if (app) {
                existingData = {
                    guest_name: app.guest_name,
                    visit_date: app.visit_date.toISOString().split('T')[0],
                    visit_time: app.visit_time,
                    zone: app.zone,
                    purpose: app.purpose
                };
            }
        }

        await db.setState(userId, { 
            step: 'awaiting_name', 
            data: { ...existingData, userId, editingId: appId } 
        });
        
        const promptText = appId ? `Исправление заявки #${appId}\n(Текущее ФИО: ${existingData.guest_name || 'не указано'})\n\n${ui.application.guestName}` : ui.application.guestName;
        await ctx.sendOrEdit(promptText, { attachments: [ui.application.cancelKeyboard(buttons)] });
    },

    async askDate(ctx, userId) {
        const today = new Date();
        const minDays = config.organization.min_days_before_visit;
        const dates = [
            getNextWorkDay(today, minDays),
            getNextWorkDay(today, minDays + 3),
            getNextWorkDay(today, minDays + 7)
        ];

        const state = await db.getState(userId);
        const buttons = dates.map(d => [Keyboard.button.callback(d.toLocaleDateString('ru-RU'), `set_date:${d.toISOString().split('T')[0]}`)]);
        
        if (state && state.data && state.data.ref_date) {
            const refD = new Date(state.data.ref_date);
            buttons.unshift([Keyboard.button.callback(`🔹 Предложено: ${refD.toLocaleDateString('ru-RU')}`, `set_date:${state.data.ref_date}`)]);
        }

        await ctx.sendOrEdit(ui.application.date, { attachments: [ui.application.cancelKeyboard(buttons)] });
    },

    async askTime(ctx, dateStr) {
        const userId = ctx.user.user_id;
        const state = await db.getState(userId);
        const dayMap = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
        const d = new Date(dateStr);
        const hours = config.organization.working_hours[dayMap[d.getDay()]];
        if (!hours) return ctx.reply('Организация не работает в этот день. Выберите другую дату.');

        const [hStart, mStart] = hours.start.split(':').map(Number);
        const [hEnd, mEnd] = hours.end.split(':').map(Number);
        const slots = [];
        let cur = new Date(); cur.setHours(hStart, mStart, 0, 0);
        let end = new Date(); end.setHours(hEnd, mEnd, 0, 0);

        while (cur < end) {
            const time = cur.toTimeString().substring(0, 5);
            slots.push(Keyboard.button.callback(time, `set_time:${time}`));
            cur.setMinutes(cur.getMinutes() + 30);
        }
        
        const rows = [];
        if (state && state.data && state.data.ref_time) {
            rows.push([Keyboard.button.callback(`🔹 Предложено: ${state.data.ref_time}`, `set_time:${state.data.ref_time}`)]);
        }
        
        for (let i = 0; i < slots.length; i += 4) rows.push(slots.slice(i, i + 4));

        await ctx.sendOrEdit(ui.application.time, { attachments: [ui.application.cancelKeyboard(rows)] });
    },

    async askZone(ctx) {
        const userId = ctx.user.user_id;
        const state = await db.getState(userId);
        const zones = config.organization.access_zones;
        const buttons = zones.map(z => [Keyboard.button.callback(z, `set_zone:${z.substring(0, 30)}`)]);
        
        if (state && state.data && state.data.ref_zone) {
            buttons.unshift([Keyboard.button.callback(`🔹 Предложено: ${state.data.ref_zone}`, `set_zone:${state.data.ref_zone.substring(0, 30)}`)]);
        }

        await ctx.sendOrEdit(ui.application.zone, { attachments: [ui.application.cancelKeyboard(buttons)] });
    },

    async showSummary(ctx, data) {
        await ctx.sendOrEdit(ui.application.summaryText(data), {
            format: 'markdown',
            attachments: [ui.application.summaryKeyboard] 
        });
    }
};

module.exports = flow;
