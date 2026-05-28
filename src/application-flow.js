const { Keyboard } = require('@maxhub/max-bot-api');
const db = require('./db');
const ui = require('./menus');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const config = yaml.load(fs.readFileSync(path.join(__dirname, '../config.yaml'), 'utf8'));

const getNextWorkDay = (baseDate, days) => {
    let d = new Date(baseDate);
    d.setDate(d.getDate() + days);
    while ([0].includes(d.getDay())) d.setDate(d.getDate() + 1); // Пропуск воскресенья (по умолчанию)
    return d;
};

const formatDate = (d) => {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

const parseRussianDate = (text) => {
    const today = new Date();
    let day, month, year = today.getFullYear();
    
    // Форматы: ДД.ММ.ГГГГ, ДД.ММ.ГГ, ДД.ММ
    let match = text.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
    if (match) {
        day = parseInt(match[1]); month = parseInt(match[2]); year = parseInt(match[3]);
    } else {
        match = text.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2})$/);
        if (match) {
            day = parseInt(match[1]); month = parseInt(match[2]); year = 2000 + parseInt(match[3]);
        } else {
            match = text.match(/^(\d{1,2})\.(\d{1,2})$/);
            if (match) {
                day = parseInt(match[1]); month = parseInt(match[2]);
            }
        }
    }

    if (!day || month < 1 || month > 12) return null;
    const d = new Date(year, month - 1, day);
    if (isNaN(d.getTime())) return null;
    return formatDate(d);
};

const parseDate = (isoStr) => {
    if (!isoStr) return null;
    const [y, m, d] = isoStr.split('-').map(Number);
    return new Date(y, m - 1, d);
};

const flow = {
    parseRussianDate,

    async start(ctx, appId = null) {
        const userId = ctx.user.user_id;
        const currentState = await db.getState(userId);
        let existingData = (currentState && currentState.data) ? { ...currentState.data } : { userId };

        if (appId) {
            const app = await db.getApplicationById(appId);
            if (app) existingData = { ...app, ...existingData, editingId: appId, userId };
        }

        const templates = await db.getTemplates(userId);
        const buttons = templates.map(t => [Keyboard.button.callback(t.full_name, `set_guest:${t.full_name.substring(0, 30)}`)]);
        
        if (existingData.guest_name) {
            buttons.unshift(ui.application.currentValueButton(existingData.guest_name, 'Оставить ФИО'));
        }

        await db.setState(userId, { 
            step: 'awaiting_name', 
            data: existingData
        });
        
        const promptText = (appId || existingData.guest_name) ? `Редактирование заявки\n(Текущее ФИО: ${existingData.guest_name || 'не указано'})\n\n${ui.application.guestName}` : ui.application.guestName;
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
        const buttons = dates.map(d => [Keyboard.button.callback(d.toLocaleDateString('ru-RU'), `set_date:${formatDate(d)}`)]);
        
        if (state && state.data && state.data.ref_date) {
            const refD = parseDate(state.data.ref_date);
            buttons.unshift([Keyboard.button.callback(`Предложено: ${refD.toLocaleDateString('ru-RU')}`, `set_date:${state.data.ref_date}`)]);
        }

        if (state?.data?.visit_date) {
            const curD = parseDate(state.data.visit_date);
            buttons.unshift(ui.application.currentValueButton(curD.toLocaleDateString('ru-RU'), 'Оставить дату'));
        }

        await ctx.sendOrEdit(ui.application.date, { attachments: [ui.application.cancelKeyboard(buttons)] });
    },

    async askTime(ctx, dateStr) {
        const userId = ctx.user.user_id;
        const state = await db.getState(userId);
        const dayMap = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
        const d = parseDate(dateStr);
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
            rows.push([Keyboard.button.callback(`Предложено: ${state.data.ref_time}`, `set_time:${state.data.ref_time}`)]);
        }
        
        if (state?.data?.visit_time) {
            rows.unshift(ui.application.currentValueButton(state.data.visit_time.substring(0, 5), 'Оставить время'));
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
            buttons.unshift([Keyboard.button.callback(`Предложено: ${state.data.ref_zone}`, `set_zone:${state.data.ref_zone.substring(0, 30)}`)]);
        }

        if (state?.data?.zone) {
            buttons.unshift(ui.application.currentValueButton(state.data.zone, 'Оставить зону'));
        }

        await ctx.sendOrEdit(ui.application.zone, { attachments: [ui.application.cancelKeyboard(buttons)] });
    },

    async askPurpose(ctx) {
        const userId = ctx.user.user_id;
        const state = await db.getState(userId);
        const buttons = [];

        if (state && state.data && state.data.ref_purpose) {
            buttons.push([Keyboard.button.callback(`Предложено: ${state.data.ref_purpose}`, `set_purpose:${state.data.ref_purpose.substring(0, 30)}`)]);
        }

        if (state?.data?.purpose) {
            buttons.unshift(ui.application.currentValueButton(state.data.purpose, 'Оставить цель'));
        }

        await ctx.sendOrEdit(ui.application.purpose, { attachments: [ui.application.cancelKeyboard(buttons)] });
    },

    async showSummary(ctx, data) {
        await ctx.sendOrEdit(ui.application.summaryText(data), { 
            format: 'markdown',
            attachments: [ui.application.summaryKeyboard] 
        });
    }
};

module.exports = flow;
