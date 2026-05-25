const { Keyboard } = require('@maxhub/max-bot-api');
const db = require('./db');
const ui = require('./menus');

const adminFlow = {
    async listApplications(ctx) {
        const apps = await db.getPendingApplications();
        
        const searchKb = Keyboard.inlineKeyboard([
            [Keyboard.button.callback(ui.admin.searchButton, 'search_app')]
        ]);

        if (apps.length === 0) {
            return ctx.sendOrEdit(ui.admin.noApps, { attachments: [searchKb] });
        }

        await ctx.sendOrEdit(ui.admin.listTitle, { format: 'markdown', attachments: [searchKb] });

        for (const app of apps) {
            await ctx.reply(ui.admin.item(app), { 
                format: 'markdown',
                attachments: [ui.admin.detailsKeyboard(app.id)] 
            });
        }
    },

    async startSearch(ctx) {
        await db.setState(ctx.user.user_id, { step: 'awaiting_search_id' });
        await ctx.sendOrEdit(ui.admin.searchPrompt);
    },

    async performSearch(ctx, appId) {
        const app = await db.getApplicationById(appId);
        await db.logAction(ctx.user.user_id, 'поиск', `Поиск заявки #${appId}`);
        if (!app) return ctx.reply(`Заявка #${appId} не найдена.`);

        await ctx.reply('Результат поиска:', { format: 'markdown' });
        await ctx.reply(ui.admin.item(app), { 
            format: 'markdown',
            attachments: [ui.admin.detailsKeyboard(app.id)] 
        });
        await db.setState(ctx.user.user_id, null);
    },

    async showApplication(ctx, appId) {
        const app = await db.getApplicationById(appId);
        if (!app) return ctx.reply('Заявка не найдена.');

        await ctx.sendOrEdit(ui.admin.item(app), { 
            format: 'markdown',
            attachments: [ui.admin.detailsKeyboard(app.id)] 
        });
    },

    async askConfirmation(ctx, appId, status) {
        await ctx.sendOrEdit(ui.admin.confirmTitle(status), {
            attachments: [ui.admin.confirmKeyboard(appId, status)]
        });
    },

    async executeAction(ctx, appId, status) {
        await db.updateApplicationStatus(appId, status);
        await ctx.sendOrEdit(`Статус заявки #${appId} изменен на: *${status}*`, { 
            format: 'markdown',
            attachments: [] 
        });
    },

    async askCorrection(ctx, appId) {
        const userId = ctx.user.user_id;
        await db.setState(userId, { step: 'awaiting_admin_comment', data: { targetAppId: appId } });
        await ctx.sendOrEdit(ui.admin.correctionPrompt, { attachments: [] });
    }
};

module.exports = adminFlow;
