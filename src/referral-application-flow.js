const { Keyboard } = require('@maxhub/max-bot-api');
const db = require('./db');
const ui = require('./menus');
const fs = require('fs');
const path = require('path');

const yaml = require('js-yaml');
const config = yaml.load(fs.readFileSync(path.join(__dirname, '../config.yaml'), 'utf8'));

const formatDate = (d) => {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

const parseDate = (isoStr) => {
    if (!isoStr) return null;
    const [y, m, d] = isoStr.split('-').map(Number);
    return new Date(y, m - 1, d);
};

const formatDateRU = (isoStr) => {
    if (!isoStr) return 'не указана';
    if (isoStr.includes('.')) return isoStr;
    const [y, m, d] = isoStr.split('-').map(Number);
    return `${String(d).padStart(2, '0')}.${String(m).padStart(2, '0')}.${y}`;
};

const refAppFlow = {
    async askDate(ctx, userId) {
        const today = new Date();
        const minDays = config.organization.min_days_before_visit;
        const dates = [];
        let d = new Date(today);
        d.setDate(d.getDate() + minDays);

        const dayMap = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
        while (dates.length < 3) {
            const dayName = dayMap[d.getDay()];
            if (config.organization.working_hours[dayName]) {
                dates.push(new Date(d));
            }
            d.setDate(d.getDate() + 1);
        }

        const state = await db.getState(userId);
        const buttons = dates.map(d => [Keyboard.button.callback(d.toLocaleDateString('ru-RU'), `refapp_set_date:${formatDate(d)}`)]);
        
        if (state?.data?.ref_date) {
            const refD = parseDate(state.data.ref_date);
            buttons.unshift([Keyboard.button.callback(`Предложено: ${refD.toLocaleDateString('ru-RU')}`, `refapp_set_date:${state.data.ref_date}`)]);
        }

        if (state?.data?.visit_date) {
            const displayDate = formatDateRU(state.data.visit_date);
            buttons.unshift(ui.application.currentValueButton(displayDate, 'Оставить дату'));
        }

        await ctx.sendOrEdit(ui.application.date, { attachments: [ui.application.cancelKeyboard(buttons)] });
    },

    async askTime(ctx, dateStr) {
        const userId = ctx.user.user_id;
        const state = await db.getState(userId);
        const dayMap = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
        const d = parseDate(dateStr);
        const hours = config.organization.working_hours[dayMap[d.getDay()]];
        
        if (!hours) return ctx.reply('Организация не работает в этот день.');

        const [hStart, mStart] = hours.start.split(':').map(Number);
        const [hEnd, mEnd] = hours.end.split(':').map(Number);
        const slots = [];
        let cur = new Date(); cur.setHours(hStart, mStart, 0, 0);
        let end = new Date(); end.setHours(hEnd, mEnd, 0, 0);

        while (cur < end) {
            const time = cur.toTimeString().substring(0, 5);
            slots.push(Keyboard.button.callback(time, `refapp_set_time:${time}`));
            cur.setMinutes(cur.getMinutes() + 30);
        }
        
        const rows = [];
        if (state?.data?.ref_time) {
            rows.push([Keyboard.button.callback(`Предложено: ${state.data.ref_time}`, `refapp_set_time:${state.data.ref_time}`)]);
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
        const buttons = zones.map(z => [Keyboard.button.callback(z, `refapp_set_zone:${z.substring(0, 30)}`)]);
        
        if (state?.data?.ref_zone) {
            buttons.unshift([Keyboard.button.callback(`Предложено: ${state.data.ref_zone}`, `refapp_set_zone:${state.data.ref_zone.substring(0, 30)}`)]);
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
        
        if (state?.data?.ref_purpose) {
            buttons.push([Keyboard.button.callback(`Предложено: ${state.data.ref_purpose}`, `refapp_set_purpose:${state.data.ref_purpose.substring(0, 30)}`)]);
        }

        if (state?.data?.purpose) {
            buttons.unshift(ui.application.currentValueButton(state.data.purpose, 'Оставить цель'));
        }

        await ctx.sendOrEdit(ui.application.purpose, { attachments: [ui.application.cancelKeyboard(buttons)] });
    }
};

module.exports = refAppFlow;
