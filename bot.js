require('dotenv').config();
const { Bot, Keyboard } = require('@maxhub/max-bot-api');
const fs = require('fs');
const path = require('path');
const db = require('./src/db');
const ui = require('./src/menus');
const flow = require('./src/application-flow');
const adminFlow = require('./src/admin-flow');
const statsFlow = require('./src/stats-flow');
const historyFlow = require('./src/history-flow');
const referralFlow = require('./src/referral-flow');
const refAppFlow = require('./src/referral-application-flow');

const yaml = require('js-yaml');
const config = yaml.load(fs.readFileSync(path.join(__dirname, 'config.yaml'), 'utf8'));
const bot = new Bot(process.env.BOT_TOKEN);
const DEBUG = false;

const processedActions = new Map();
bot.use(async (ctx, next) => {
    ctx.sendOrEdit = async (text, options = {}) => {
        if (ctx.updateType === 'message_callback') {
            try {
                return await ctx.editMessage({ text, ...options });
            } catch (e) {
                if (DEBUG) console.error('[ERROR] editMessage failed:', e.message);
                return await ctx.reply(text, options);
            }
        }
        return await ctx.reply(text, options);
    };

    if (ctx.updateType === 'message_callback') {
        const userId = ctx.user?.user_id;
        const payload = ctx.update.callback?.payload;
        const now = Date.now();
        const lastAction = processedActions.get(userId);
        if (lastAction && lastAction.payload === payload && (now - lastAction.timestamp) < 800) {
            return;
        }
        processedActions.set(userId, { payload, timestamp: now });
    }
    return next();
});

function getFileVersion() {
    try {
        const files = fs.readdirSync(path.join(__dirname, 'docs'));
        const fileName = files.find(f => f.includes('от ') && /\d{2}\.\d{2}\.\d{4}/.test(f));
        if (!fileName) return 'unknown';
        const match = fileName.match(/от (\d{2})\.(\d{2})\.(\d{4})/);
        return match ? `${match[3]}.${match[2]}.${match[1]}` : 'unknown';
    } catch (e) { return 'unknown'; }
}

async function notifySecurityEngineers(message, attachments = []) {
    const engineerIds = await db.getSecurityEngineers();
    for (const id of engineerIds) {
        try {
            await bot.api.sendMessageToUser(id, message, { attachments, format: 'markdown' });
        } catch (e) {
            if (DEBUG) console.error(`Failed to notify security engineer ${id}:`, e.message);
        }
    }
}

async function handleStartWithPayload(ctx, payload) {
    const userId = ctx.user.user_id;
    const refLink = await db.getReferralLink(payload);
    
    if (refLink) {
        const templates = await db.getTemplates(userId);
        const buttons = templates.map(t => [Keyboard.button.callback(t.full_name, `set_guest:${t.full_name.substring(0, 30)}`)]);
        
        await db.setState(userId, { 
            step: 'awaiting_refapp_name', 
            data: { 
                userId,
                ref_date: refLink.visit_date ? refLink.visit_date.toISOString().split('T')[0] : null,
                ref_time: refLink.visit_time,
                ref_zone: refLink.zone,
                ref_purpose: refLink.purpose
            } 
        });
        
        const welcomeText = `${ui.consent.disclaimer}\n\nВы перешли по специальной ссылке.\n\n${ui.application.guestName}`;
        await ctx.reply(welcomeText, { 
            attachments: [ui.application.cancelKeyboard(buttons)] 
        });
        return true;
    }
    return false;
}

async function handleConsentRequest(ctx) {
    const userId = ctx.user?.user_id;
    if (!userId) return;
    const currentVersion = getFileVersion();
    const user = await db.getUser(userId);
    const payload = ctx.update?.payload;

    if (user && user.file_version === currentVersion) {
        if (payload && await handleStartWithPayload(ctx, payload)) return;
        const menu = ui.menus[user.role] || ui.menus['Инициатор'];
        return ctx.reply(`Меню:`, { attachments: [menu] });
    }

    const docsDir = path.join(__dirname, 'docs');
    const fileName = fs.readdirSync(docsDir).find(f => f.includes('Согласие на обработку персональных данных от'));
    const uploadUrlInfo = await ctx.api.raw.uploads.getUploadUrl({ type: 'file' });
    const formData = new FormData();
    formData.append('data', new Blob([fs.readFileSync(path.join(docsDir, fileName))]), fileName);
    const uploadRes = await fetch(uploadUrlInfo.url, { method: 'POST', body: formData });
    const { token: fileToken, retval } = await uploadRes.json();
    const finalToken = fileToken || retval;

    if (!finalToken) return ctx.reply('Ошибка подготовки документа.');
    if (payload) await db.setState(userId, { step: 'pending_consent', payload });

    const consentText = `${ui.consent.disclaimer}\n\n${user ? ui.consent.updateText : ui.consent.text}`;
    await ctx.reply(consentText, {
        attachments: [{ type: 'file', payload: { token: finalToken } }, ui.consent.keyboard]
    });
}

bot.on('bot_started', handleConsentRequest);
bot.command('start', handleConsentRequest);
bot.command('menu', handleConsentRequest);
bot.command('начать', handleConsentRequest);
bot.command('меню', handleConsentRequest);

// Глобальный дебаг
bot.on('update', (ctx) => {
    if (ctx.updateType === 'message_callback') {
        console.log(`[DEBUG] Action: ${ctx.update.callback.payload}, User: ${ctx.user?.user_id}`);
    } else if (ctx.update?.message) {
        console.log(`[DEBUG] Message from ${ctx.user?.user_id}: ${ctx.update.message.body?.text}`);
    }
});

bot.action('consent_accepted', async (ctx) => {
    const userId = ctx.user.user_id;
    const version = getFileVersion();
    const existing = await db.getUser(userId);
    const state = await db.getState(userId);
    
    if (existing && existing.file_version === version) return ctx.reply('Уже подтверждено.');

    let role = (Number(userId) === Number(config.initial_tech_admin_id)) ? 'Технический администратор' : 'Инициатор';
    await db.saveConsent(userId, version, role);
    await db.logAction(userId, 'регистрация', `Пользователь зарегистрирован с ролью: ${role}`, null);

    try {
        const text = ctx.message?.body?.text || 'Согласие получено.';
        const file = (ctx.message?.body?.attachments || []).find(a => a.type === 'file');
        await ctx.editMessage({ text, attachments: file ? [{ type: 'file', payload: { token: file.payload.token } }] : [] });
    } catch (e) {}

    await ctx.reply(`Добро пожаловать! Ваша роль: ${role}.`, { attachments: [ui.menus[role]] });

    if (state && state.step === 'pending_consent' && state.payload) {
        await handleStartWithPayload(ctx, state.payload);
    }
});

bot.on('message_created', async (ctx) => {
    const userId = ctx.user?.user_id;
    const text = ctx.message?.body?.text;
    if (!userId || !text) return;

    const triggerWords = ['начать', 'меню', 'menu', 'start'];
    if (triggerWords.includes(text.toLowerCase().trim())) {
        return handleConsentRequest(ctx);
    }

    if (text.startsWith('/')) return;

    const state = await db.getState(userId);
    if (!state) return;

    // --- подача заявки ---
    if (state.step === 'awaiting_name') {
        state.data.guest_name = text;
        state.step = 'awaiting_date';
        await db.setState(userId, state);
        await flow.askDate(ctx, userId);
    } else if (state.step === 'awaiting_date') {
        if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
            state.data.visit_date = text;
            state.step = 'awaiting_time';
            await db.setState(userId, state);
            await flow.askTime(ctx, text);
        } else await ctx.reply('Используйте ГГГГ-ММ-ДД.');
    } else if (state.step === 'awaiting_purpose') {
        state.data.purpose = text;
        state.step = 'summary';
        await db.setState(userId, state);
        await flow.showSummary(ctx, state.data);

    // --- подача заявки с рефкой ---
    } else if (state.step === 'awaiting_refapp_name') {
        state.data.guest_name = text;
        state.step = 'awaiting_refapp_date';
        await db.setState(userId, state);
        await refAppFlow.askDate(ctx, userId);
    } else if (state.step === 'awaiting_refapp_date') {
        if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
            state.data.visit_date = text;
            state.step = 'awaiting_refapp_time';
            await db.setState(userId, state);
            await refAppFlow.askTime(ctx, text);
        } else await ctx.reply('Используйте ГГГГ-ММ-ДД.');
    } else if (state.step === 'awaiting_refapp_purpose') {
        state.data.purpose = text;
        state.step = 'summary';
        await db.setState(userId, state);
        await flow.showSummary(ctx, state.data);

    // --- создание рефки ---
    } else if (state.step === 'awaiting_ref_comment') {
        state.data.comment = text.trim();
        state.step = 'awaiting_ref_date_input';
        await db.setState(userId, state);
        await referralFlow.askDate(ctx);
    } else if (state.step === 'awaiting_ref_date_input') {
        if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
            state.data.visit_date = text;
            state.step = 'awaiting_ref_time_input';
            await db.setState(userId, state);
            await referralFlow.askTime(ctx, text);
        } else await ctx.reply('Используйте ГГГГ-ММ-ДД.');
    } else if (state.step === 'awaiting_ref_time_input') {
        if (/^\d{2}:\d{2}$/.test(text)) {
            state.data.visit_time = text;
            state.step = 'awaiting_ref_zone_input';
            await db.setState(userId, state);
            await referralFlow.askZone(ctx);
        } else await ctx.reply('Используйте ЧЧ:ММ.');
    } else if (state.step === 'awaiting_ref_zone_input') {
        state.data.zone = text;
        state.step = 'awaiting_ref_purpose_input';
        await db.setState(userId, state);
        await referralFlow.askPurpose(ctx);
    } else if (state.step === 'awaiting_ref_purpose_input') {
        state.data.purpose = text;
        state.step = 'ref_summary';
        await db.setState(userId, state);
        await referralFlow.showSummary(ctx, state.data);

    } else if (state.step === 'awaiting_admin_comment') {
        const appId = state.data.targetAppId;
        await db.updateApplicationStatus(appId, 'требует корректировки', text);
        await db.logAction(userId, 'корректировка', `Заявка #${appId} отправлена на доработку (коммент: ${text})`, appId);
        await db.setState(userId, null);
        const app = await db.getApplicationById(appId);
        try {
            await bot.api.sendMessageToUser(
                app.initiator_id,
                ui.myApplications.statusNotification(appId, 'требует корректировки', text),
                { format: 'markdown', attachments: [ui.myApplications.refillKeyboard(appId)] }
            );
        } catch (e) {}
        await ctx.reply(`Заявка #${appId} отправлена на корректировку.`);
        await adminFlow.listApplications(ctx);
    } else if (state.step === 'awaiting_history_period') {
        await db.setState(userId, null);
        await historyFlow.generateFile(ctx, text);
    } else if (state.step === 'awaiting_role_user_id') {
        const targetId = text.trim();
        const targetUser = await db.getUser(targetId);
        await ctx.reply(ui.settings.changeRoleTitle(targetId, targetUser?.role || 'не зарегистрирован'), { format: 'markdown', attachments: [ui.settings.changeRoleKeyboard(targetId)] });
    } else if (state.step === 'awaiting_search_id') {
        await adminFlow.performSearch(ctx, text.trim());
    }
});

// обработка рефки
bot.action(/refapp_set_date:(.+)/, async (ctx) => {
    const state = await db.getState(ctx.user.user_id);
    if (!state) return;
    state.data.visit_date = ctx.match[1];
    state.step = 'awaiting_refapp_time';
    await db.setState(ctx.user.user_id, state);
    await refAppFlow.askTime(ctx, ctx.match[1]);
});
bot.action(/refapp_set_time:(.+)/, async (ctx) => {
    const state = await db.getState(ctx.user.user_id);
    if (!state) return;
    state.data.visit_time = ctx.match[1];
    state.step = 'awaiting_refapp_zone';
    await db.setState(ctx.user.user_id, state);
    await refAppFlow.askZone(ctx);
});
bot.action(/refapp_set_zone:(.+)/, async (ctx) => {
    const state = await db.getState(ctx.user.user_id);
    if (!state) return;
    state.data.zone = ctx.match[1];
    state.step = 'awaiting_refapp_purpose';
    await db.setState(ctx.user.user_id, state);
    await refAppFlow.askPurpose(ctx);
});
bot.action(/refapp_set_purpose:(.+)/, async (ctx) => {
    const state = await db.getState(ctx.user.user_id);
    if (!state) return;
    state.data.purpose = ctx.match[1];
    state.step = 'summary';
    await db.setState(ctx.user.user_id, state);
    await flow.showSummary(ctx, state.data);
});

// создание рефки
bot.action(/ref_set_date:(.+)/, async (ctx) => {
    const state = await db.getState(ctx.user.user_id);
    if (!state) return;
    state.data.visit_date = ctx.match[1] === '0' ? null : ctx.match[1];
    state.step = 'awaiting_ref_time_input';
    await db.setState(ctx.user.user_id, state);
    await referralFlow.askTime(ctx, ctx.match[1]);
});
bot.action(/ref_set_time:(.+)/, async (ctx) => {
    const state = await db.getState(ctx.user.user_id);
    if (!state) return;
    state.data.visit_time = ctx.match[1] === '0' ? null : ctx.match[1];
    state.step = 'awaiting_ref_zone_input';
    await db.setState(ctx.user.user_id, state);
    await referralFlow.askZone(ctx);
});
bot.action(/ref_set_zone:(.+)/, async (ctx) => {
    const state = await db.getState(ctx.user.user_id);
    if (!state) return;
    state.data.zone = ctx.match[1] === '0' ? null : ctx.match[1];
    state.step = 'awaiting_ref_purpose_input';
    await db.setState(ctx.user.user_id, state);
    await referralFlow.askPurpose(ctx);
});
bot.action(/ref_set_purpose:(.+)/, async (ctx) => {
    const state = await db.getState(ctx.user.user_id);
    if (!state) return;
    state.data.purpose = ctx.match[1] === '0' ? null : ctx.match[1];
    state.step = 'ref_summary';
    await db.setState(ctx.user.user_id, state);
    await referralFlow.showSummary(ctx, state.data);
});

bot.action('ref_save_final', async (ctx) => {
    const state = await db.getState(ctx.user.user_id);
    if (!state) return;
    if (state.data.isEditing) {
        await db.updateReferralLinkData(state.data.code, state.data, 'активна');
        await db.logAction(ctx.user.user_id, 'изменение_ссылки', `Обновлена ссылка: ${state.data.code}`, null);
    } else {
        await db.createReferralLink(state.data.code, state.data, 'активна');
        await db.logAction(ctx.user.user_id, 'создание_ссылки', `Создана активная ссылка: ${state.data.code}`, null);
    }
    await db.setState(ctx.user.user_id, null);
    const botUser = await bot.api.getMyInfo();
    const link = `https://max.ru/${botUser.username || 'spring_cat47_bot'}?start=${state.data.code}`;
    await ctx.reply(`Ссылка успешно сгенерирована!\n\`${link}\``, { format: 'markdown' });
    const user = await db.getUser(ctx.user.user_id);
    await ctx.reply('Меню:', { attachments: [ui.menus[user.role]] });
});

bot.action('ref_save_draft', async (ctx) => {
    const state = await db.getState(ctx.user.user_id);
    if (!state) return;
    if (state.data.isEditing) {
        await db.updateReferralLinkData(state.data.code, state.data, 'черновик');
        await db.logAction(ctx.user.user_id, 'корректировка_ссылки', `Ссылка ${state.data.code} сохранена как черновик`, null);
    } else {
        await db.createReferralLink(state.data.code, state.data, 'черновик');
        await db.logAction(ctx.user.user_id, 'создание_ссылки', `Создан черновик ссылки: ${state.data.code}`, null);
    }
    await db.setState(ctx.user.user_id, null);
    await ctx.reply('Ссылка сохранена в черновики.');
    const user = await db.getUser(ctx.user.user_id);
    await ctx.reply('Меню:', { attachments: [ui.menus[user.role]] });
});

bot.action('apply', async (ctx) => {
    const activeCount = await db.getActiveApplicationsCount(ctx.user.user_id);
    if (activeCount >= 3) return ctx.reply(ui.application.limitExceeded);
    await flow.start(ctx);
});
bot.action(/set_guest:(.+)/, async (ctx) => {
    const state = await db.getState(ctx.user.user_id);
    if (!state) return;
    state.data.guest_name = ctx.match[1];
    state.step = 'awaiting_date';
    await db.setState(ctx.user.user_id, state);
    await flow.askDate(ctx, ctx.user.user_id);
});
bot.action(/set_date:(.+)/, async (ctx) => {
    const state = await db.getState(ctx.user.user_id);
    if (!state) return;
    state.data.visit_date = ctx.match[1];
    state.step = 'awaiting_time';
    await db.setState(ctx.user.user_id, state);
    await flow.askTime(ctx, ctx.match[1]);
});
bot.action(/set_time:(.+)/, async (ctx) => {
    const state = await db.getState(ctx.user.user_id);
    if (!state) return;
    state.data.visit_time = ctx.match[1];
    state.step = 'awaiting_zone';
    await db.setState(ctx.user.user_id, state);
    await flow.askZone(ctx);
});
bot.action(/set_zone:(.+)/, async (ctx) => {
    const state = await db.getState(ctx.user.user_id);
    if (!state) return;
    state.data.zone = ctx.match[1];
    state.step = 'awaiting_purpose';
    await db.setState(ctx.user.user_id, state);
    
    if (state.data.ref_purpose) {
        const kb = Keyboard.inlineKeyboard([[Keyboard.button.callback(`Предложено: ${state.data.ref_purpose}`, `set_purpose:${state.data.ref_purpose.substring(0, 30)}`)],[Keyboard.button.callback('Отмена', 'cancel_form')]]);
        await ctx.sendOrEdit(ui.application.purpose, { attachments: [kb] });
    } else {
        await ctx.sendOrEdit(ui.application.purpose, { attachments: [] });
    }
});
bot.action(/set_purpose:(.+)/, async (ctx) => {
    const state = await db.getState(ctx.user.user_id);
    if (!state) return;
    state.data.purpose = ctx.match[1];
    state.step = 'summary';
    await db.setState(ctx.user.user_id, state);
    await flow.showSummary(ctx, state.data);
});
bot.action('submit_form', async (ctx) => {
    const state = await db.getState(ctx.user.user_id);
    if (!state) return;
    let appId;
    if (state.data.editingId) {
        appId = state.data.editingId;
        await db.updateApplicationData(appId, state.data, 'на рассмотрении');
        await db.logAction(ctx.user.user_id, 'корректировка', `Обновлена заявка #${appId}`, appId);
    } else {
        appId = await db.createApplication(state.data);
        await db.logAction(ctx.user.user_id, 'подача_заявки', `Создана заявка #${appId} (Гость: ${state.data.guest_name})`, appId);
    }
    await db.setState(ctx.user.user_id, null);
    
    await ctx.editMessage({ text: `Заявка #${appId} отправлена!`, attachments: [] });
    
    const app = await db.getApplicationById(appId);
    await notifySecurityEngineers(ui.admin.newAppNotification(app));
    
    if (!await db.isTemplateExists(ctx.user.user_id, state.data.guest_name)) {
        await ctx.reply(ui.application.saveTemplatePrompt(state.data.guest_name), { attachments: [ui.application.saveTemplateKeyboard(state.data.guest_name)] });
    } else { 
        const u = await db.getUser(ctx.user.user_id); 
        await ctx.reply('Меню:', { attachments: [ui.menus[u.role]] }); 
    }
});
bot.action(/save_tpl:(.+)/, async (ctx) => { 
    await db.saveTemplate(ctx.user.user_id, ctx.match[1]); 
    await db.logAction(ctx.user.user_id, 'сохранение_шаблона', `Сохранен шаблон: ФИО`, null);
    const u = await db.getUser(ctx.user.user_id);
    await ctx.editMessage({ text: 'Сохранено.', attachments: [] }); 
    await ctx.reply('Меню:', { attachments: [ui.menus[u.role]] });
});
bot.action('save_draft', async (ctx) => {
    const state = await db.getState(ctx.user.user_id);
    if (!state) return;
    let appId;
    if (state.data.editingId) {
        appId = state.data.editingId;
        await db.updateApplicationData(appId, state.data, 'черновик');
        await db.logAction(ctx.user.user_id, 'корректировка', `Заявка #${appId} сохранена как черновик`, appId);
    } else {
        appId = await db.createApplication(state.data, 'черновик');
        await db.logAction(ctx.user.user_id, 'подача_заявки', `Создан черновик заявки #${appId} (Гость: ${state.data.guest_name})`, appId);
    }
    await db.setState(ctx.user.user_id, null);
    await ctx.sendOrEdit(`Заявка #${appId} в черновиках.`, { attachments: [ui.menus['Инициатор']] });
});
bot.action('main_menu', async (ctx) => { 
    const u = await db.getUser(ctx.user.user_id); 
    await ctx.sendOrEdit('Меню:', { attachments: [ui.menus[u.role]] }); 
});
bot.action('my_data', async (ctx) => {
    const u = await db.getUser(ctx.user.user_id);
    const templates = await db.getTemplates(ctx.user.user_id);
    let text = ui.myData.info(ctx.user.user_id, u.role);
    
    let buttons = [];
    if (templates.length > 0) {
        text += ui.myData.templatesTitle;
        buttons = templates.map(t => [Keyboard.button.callback(ui.myData.deleteButton(t.full_name), ui.myData.deleteTemplateCallback(t.id))]);
    } else {
        text += ui.myData.templatesEmpty;
    }

    const kb = Keyboard.inlineKeyboard([
        ...buttons,
        [Keyboard.button.callback(ui.myData.deleteDataButton, 'confirm_delete_data')],
        [Keyboard.button.callback(ui.common.backToMenu, 'main_menu')]
    ]);

    await ctx.sendOrEdit(text, { format: 'markdown', attachments: [kb] });
});
bot.action('confirm_delete_data', async (ctx) => {
    await ctx.sendOrEdit(ui.myData.deleteDataConfirmTitle, { attachments: [ui.myData.deleteDataConfirmKeyboard] });
});
bot.action('execute_delete_data', async (ctx) => {
    const userId = ctx.user.user_id;
    await db.logAction(userId, 'удаление_профиля', 'Пользователь полностью удалил свои данные');
    await db.deleteUserCompletely(userId);
    await ctx.editMessage({ text: 'Все ваши данные были успешно удалены. До свидания!', attachments: [] });
});
bot.action(/del_tpl:(\d+)/, async (ctx) => { 
    await db.deleteTemplate(ctx.match[1], ctx.user.user_id); 
    await db.logAction(ctx.user.user_id, 'удаление_шаблона', `Удален шаблон ID: ${ctx.match[1]}`, null);
    await ctx.reply('Удалено.'); 
    const u = await db.getUser(ctx.user.user_id);
    const templates = await db.getTemplates(ctx.user.user_id);
    let text = ui.myData.info(ctx.user.user_id, u.role);
    
    let buttons = [];
    if (templates.length > 0) {
        text += ui.myData.templatesTitle;
        buttons = templates.map(t => [Keyboard.button.callback(ui.myData.deleteButton(t.full_name), ui.myData.deleteTemplateCallback(t.id))]);
    } else {
        text += ui.myData.templatesEmpty;
    }

    const kb = Keyboard.inlineKeyboard([
        ...buttons,
        [Keyboard.button.callback(ui.myData.deleteDataButton, 'confirm_delete_data')],
        [Keyboard.button.callback(ui.common.backToMenu, 'main_menu')]
    ]);

    await ctx.sendOrEdit(text, { format: 'markdown', attachments: [kb] });
});
bot.action('my_applications', async (ctx) => {
    const apps = await db.getUserApplications(ctx.user.user_id);
    if (apps.length === 0) {
        return ctx.sendOrEdit(ui.myApplications.empty, { attachments: [Keyboard.inlineKeyboard([[Keyboard.button.callback(ui.common.backToMenu, 'main_menu')]])] });
    }
    for (const app of apps) {
        const buttons = [];
        if (!['одобрена', 'отклонена', 'отменена'].includes(app.status)) buttons.push(Keyboard.button.callback(ui.myApplications.cancelButton(app.id), ui.myApplications.cancelCallback(app.id)));
        if (['требует корректировки', 'черновик'].includes(app.status)) buttons.unshift(Keyboard.button.callback(ui.myApplications.refillButton(app.id), ui.myApplications.refillCallback(app.id)));
        await ctx.reply(ui.myApplications.item(app), { attachments: buttons.length > 0 ? [Keyboard.inlineKeyboard([buttons])] : [], format: 'markdown' });
    }
});
bot.action(/refill_app:(\d+)/, async (ctx) => flow.start(ctx, ctx.match[1]));
bot.action(/cancel_app:(\d+)/, async (ctx) => { 
    const app = await db.getApplicationById(ctx.match[1]);
    if (!app) return ctx.sendOrEdit('Заявка не найдена.');
    
    // по кейсу: отмена только до решения админами
    if (!['на рассмотрении', 'требует корректировки', 'черновик'].includes(app.status)) {
        return ctx.reply(`Невозможно отменить заявку в статусе "${app.status}". Решение уже принято.`);
    }

    await db.updateApplicationStatus(ctx.match[1], 'отменена'); 
    await db.logAction(ctx.user.user_id, 'отмена_заявки', `Отменена заявка #${ctx.match[1]}`, ctx.match[1]);
    await ctx.sendOrEdit(`Заявка #${ctx.match[1]} отменена.`); 
});
bot.action('all_applications', adminFlow.listApplications);
bot.action('search_app', adminFlow.startSearch);
bot.action('stats', statsFlow.showStatsMenu);
bot.action('history', historyFlow.start);
bot.action('settings', async (ctx) => {
    await ctx.sendOrEdit(ui.settings.mainTitle, { attachments: [ui.settings.mainKeyboard] });
});
bot.action('manage_roles', async (ctx) => {
    const admins = await db.getAllAdminsList();
    const text = ui.settings.rolesTitle + '\n\n' + (admins.length > 0 ? admins.map(a => `• \`${a.user_id}\` — [${a.role}]`).join('\n') : ui.settings.rolesEmpty) + ui.settings.rolesPrompt;
    await db.setState(ctx.user.user_id, { step: 'awaiting_role_user_id' });
    await ctx.sendOrEdit(text, { format: 'markdown', attachments: [ui.settings.rolesBackKeyboard] });
});
bot.action(/change_role:(\d+):(.+)/, async (ctx) => { 
    await db.updateUserRole(ctx.match[1], ctx.match[2]); 
    await db.logAction(ctx.user.user_id, 'изменение_роли', `Пользователю ${ctx.match[1]} установлена роль ${ctx.match[2]}`, null);
    await ctx.sendOrEdit('Роль изменена.', { attachments: [ui.settings.rolesBackKeyboard] }); 
    await db.setState(ctx.user.user_id, null); 
});
bot.action('referral_links', async (ctx) => {
    const links = await db.getAllReferralLinks();
    await ctx.sendOrEdit(ui.settings.referralTitle, { format: 'markdown', attachments: [Keyboard.inlineKeyboard([[Keyboard.button.callback(ui.settings.createReferralButton, 'create_ref')], [Keyboard.button.callback('Назад', 'settings')]])] });
    for (const link of links) {
        const buttons = [Keyboard.button.callback('Удалить', ui.settings.deleteReferralCallback(link.code))];
        if (link.status === 'черновик') buttons.unshift(Keyboard.button.callback(ui.settings.finishDraftButton, ui.settings.editReferralCallback(link.code)));
        await ctx.reply(ui.settings.referralItem(link), { format: 'markdown', attachments: [Keyboard.inlineKeyboard([buttons])] });
    }
});
bot.action('create_ref', async (ctx) => referralFlow.start(ctx));
bot.action(/edit_ref:(.+)/, async (ctx) => referralFlow.start(ctx, ctx.match[1]));
bot.action(/del_ref:(.+)/, async (ctx) => { 
    await db.deleteReferralLink(ctx.match[1]); 
    await db.logAction(ctx.user.user_id, 'удаление_ссылки', `Удалена ссылка: ${ctx.match[1]}`, null);
    await ctx.reply('Удалено.'); 
});
bot.action(/history_preset:(.+)/, async (ctx) => { 
    await db.setState(ctx.user.user_id, null); 
    await historyFlow.generateFile(ctx, ctx.match[1]); 
});
bot.action(/get_stats:(\w+)/, async (ctx) => statsFlow.sendStats(ctx, ctx.match[1]));
bot.action(/view_app:(\d+)/, async (ctx) => adminFlow.showApplication(ctx, ctx.match[1]));
bot.action(/confirm_action:(\d+):(.+)/, async (ctx) => adminFlow.askConfirmation(ctx, ctx.match[1], ctx.match[2]));
bot.action(/execute_action:(\d+):(.+)/, async (ctx) => {
    await adminFlow.executeAction(ctx, ctx.match[1], ctx.match[2]);
    await db.logAction(ctx.user.user_id, 'изменение_статуса', `Заявка #${ctx.match[1]} -> ${ctx.match[2]}`, ctx.match[1]);
    const app = await db.getApplicationById(ctx.match[1]);
    try {
        const kb = ctx.match[2] === 'требует корректировки' ? [ui.myApplications.refillKeyboard(ctx.match[1])] : [];
        await bot.api.sendMessageToUser(app.initiator_id, ui.myApplications.statusNotification(ctx.match[1], ctx.match[2]), { format: 'markdown', attachments: kb });
    } catch (e) {}
});
bot.action(/need_correction:(\d+)/, async (ctx) => adminFlow.askCorrection(ctx, ctx.match[1]));
bot.action('cancel_form', async (ctx) => { 
    await db.setState(ctx.user.user_id, null); 
    const u = await db.getUser(ctx.user.user_id); 
    await ctx.sendOrEdit('Отменено.', { attachments: [ui.menus[u.role]] }); 
});

db.initDb().then(() => { 
    if (DEBUG) console.log('Бот запущен...'); 
    bot.start(); 
});
