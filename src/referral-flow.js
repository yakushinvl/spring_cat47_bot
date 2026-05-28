const { Keyboard } = require('@maxhub/max-bot-api');
const { pool, ...db } = require('./db');
const ui = require('./menus');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const yaml = require('js-yaml');
const config = yaml.load(fs.readFileSync(path.join(__dirname, '../config.yaml'), 'utf8'));

function getNextWorkDay(date, daysOffset) {
    let d = new Date(date);
    d.setDate(d.getDate() + daysOffset);
    const dayMap = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    while (!config.organization.working_hours[dayMap[d.getDay()]]) {
        d.setDate(d.getDate() + 1);
    }
    return d;
}

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

const referralFlow = {
    async start(ctx, refCode = null) {
        const userId = ctx.user.user_id;
        const currentState = await db.getState(userId);
        let existingData = (currentState && currentState.data) ? { ...currentState.data } : {};
        let code = refCode || existingData.code;

        if (refCode) {
            const res = await pool.query('SELECT * FROM referral_links WHERE code = $1', [refCode]);
            const ref = res.rows[0];
            if (ref) {
                existingData = {
                    ...existingData,
                    comment: ref.comment,
                    visit_date: ref.visit_date ? formatDate(ref.visit_date) : null,
                    visit_time: ref.visit_time,
                    zone: ref.zone,
                    purpose: ref.purpose
                };
            }
        } else if (!code) {
            code = crypto.randomBytes(4).toString('hex');
        }
        
        await db.setState(userId, { 
            step: 'awaiting_ref_comment', 
            data: { ...existingData, code, isEditing: !!refCode } 
        });

        const promptText = (refCode || existingData.comment) ? `Настройка ссылки \`${code}\`\n(Текущий коммент: ${existingData.comment || 'нет'})\n\n${ui.settings.refStepComment}` : ui.settings.refStepComment;
        
        const buttons = [[Keyboard.button.callback('Отмена', 'referral_links')]];
        if (existingData.comment) {
            buttons.unshift(ui.application.currentValueButton(existingData.comment.substring(0, 30), 'Оставить коммент'));
        }

        await ctx.sendOrEdit(promptText, { 
            format: 'markdown',
            attachments: [Keyboard.inlineKeyboard(buttons)] 
        });
    },

    async askDate(ctx) {
        const userId = ctx.user.user_id;
        const state = await db.getState(userId);
        const today = new Date();
        const minDays = config.organization.min_days_before_visit;
        const dates = [
            getNextWorkDay(today, minDays),
            getNextWorkDay(today, minDays + 3),
            getNextWorkDay(today, minDays + 7)
        ];

        const buttons = dates.map(d => [Keyboard.button.callback(d.toLocaleDateString('ru-RU'), `ref_set_date:${formatDate(d)}`)]);
        
        if (state?.data?.visit_date) {
            const curD = parseDate(state.data.visit_date);
            buttons.unshift(ui.application.currentValueButton(curD.toLocaleDateString('ru-RU'), 'Оставить дату'));
        }

        await ctx.sendOrEdit(ui.settings.refStepDate, { attachments: [ui.application.cancelKeyboard(buttons)] });
    },

    async askTime(ctx, dateStr) {
        const userId = ctx.user.user_id;
        const state = await db.getState(userId);
        let rows = [];
        if (dateStr !== '0') {
            const dayMap = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
            const d = parseDate(dateStr);
            const hours = config.organization.working_hours[dayMap[d.getDay()]];
            
            if (hours) {
                const [hStart, mStart] = hours.start.split(':').map(Number);
                const [hEnd, mEnd] = hours.end.split(':').map(Number);
                const slots = [];
                let cur = new Date(); cur.setHours(hStart, mStart, 0, 0);
                let end = new Date(); end.setHours(hEnd, mEnd, 0, 0);

                while (cur < end) {
                    const time = cur.toTimeString().substring(0, 5);
                    slots.push(Keyboard.button.callback(time, `ref_set_time:${time}`));
                    cur.setMinutes(cur.getMinutes() + 30);
                }

                if (state?.data?.visit_time) {
                    rows.push(ui.application.currentValueButton(state.data.visit_time, 'Оставить время'));
                }

                for (let i = 0; i < slots.length; i += 4) rows.push(slots.slice(i, i + 4));
            }
        }
        
        await ctx.sendOrEdit(ui.settings.refStepTime, { attachments: [ui.application.cancelKeyboard(rows)] });
    },

    async askZone(ctx) {
        const userId = ctx.user.user_id;
        const state = await db.getState(userId);
        const zones = config.organization.access_zones;
        const buttons = zones.map(z => [Keyboard.button.callback(z, `ref_set_zone:${z.substring(0, 30)}`)]);
        
        if (state?.data?.zone) {
            buttons.unshift(ui.application.currentValueButton(state.data.zone, 'Оставить зону'));
        }

        await ctx.sendOrEdit(ui.settings.refStepZone, { attachments: [ui.application.cancelKeyboard(buttons)] });
    },

    async askPurpose(ctx) {
        const userId = ctx.user.user_id;
        const state = await db.getState(userId);
        const buttons = [];

        if (state?.data?.purpose) {
            buttons.unshift(ui.application.currentValueButton(state.data.purpose, 'Оставить цель'));
        }

        await ctx.sendOrEdit(ui.settings.refStepPurpose, { attachments: [ui.application.cancelKeyboard(buttons)] });
    },

    async showSummary(ctx, data) {
        const summary = `Параметры новой ссылки:\n\n` +
            `Комментарий: ${data.comment}\n` +
            `Код: \`${data.code}\`\n` +
            `Дата: ${data.visit_date || 'не выбрана'}\n` +
            `Время: ${data.visit_time || 'не выбрано'}\n` +
            `Зона: ${data.zone || 'не выбрана'}\n` +
            `Цель: ${data.purpose || 'не выбрана'}`;
            
        await ctx.sendOrEdit(summary, { 
            format: 'markdown',
            attachments: [ui.settings.refSummaryKeyboard] 
        });
    }
};

module.exports = referralFlow;
