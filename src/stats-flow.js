const { createCanvas } = require('canvas');
const { Keyboard } = require('@maxhub/max-bot-api');
const db = require('./db');
const ui = require('./menus');

const statsFlow = {
    async showStatsMenu(ctx) {
        await ctx.sendOrEdit(ui.stats.menuTitle, { attachments: [ui.stats.menuKeyboard] });
    },

    async sendStats(ctx, period = 'week') {
        const periodNames = { week: 'неделю', month: 'месяц', year: 'год' };
        try {
            const stats = await db.getStats(period);
            if (!stats || stats.length === 0) {
                return ctx.reply(ui.stats.noData(periodNames[period]));
            }

            const width = 800;
            const height = 450;
            const canvas = createCanvas(width, height);
            const g = canvas.getContext('2d');

            g.fillStyle = '#ffffff';
            g.fillRect(0, 0, width, height);

            const padding = 60;
            const chartWidth = width - padding * 2;
            const chartHeight = height - padding * 2;
            
            const maxVal = Math.max(...stats.map(s => parseInt(s.total)), 5);
            const stepY = chartHeight / maxVal;
            const stepX = chartWidth / stats.length;

            g.strokeStyle = '#e0e0e0';
            g.fillStyle = '#666666';
            g.font = '14px Arial';
            for (let i = 0; i <= maxVal; i += Math.ceil(maxVal / 5)) {
                const y = height - padding - i * stepY;
                g.beginPath(); g.moveTo(padding, y); g.lineTo(width - padding, y); g.stroke();
                g.fillText(i.toString(), padding - 35, y + 5);
            }

            let textSummary = `Статистика за ${periodNames[period]}:\n\n`;
            let totalPeriod = 0, approvedPeriod = 0, rejectedPeriod = 0;

            stats.forEach((s, index) => {
                const x = padding + index * stepX;
                const barWidth = stepX * 0.7;
                const startX = x + (stepX - barWidth) / 2;

                const t = parseInt(s.total), a = parseInt(s.approved), r = parseInt(s.rejected);
                totalPeriod += t; approvedPeriod += a; rejectedPeriod += r;

                const totalH = t * stepY, approvedH = a * stepY, rejectedH = r * stepY;

                g.fillStyle = '#36A2EB'; g.fillRect(startX, height - padding - totalH, barWidth, totalH);
                g.fillStyle = '#4BC0C0'; g.fillRect(startX + barWidth * 0.1, height - padding - approvedH, barWidth * 0.4, approvedH);
                g.fillStyle = '#FF6384'; g.fillRect(startX + barWidth * 0.5, height - padding - rejectedH, barWidth * 0.4, rejectedH);

                const d = new Date(s.label);
                let labelStr = '';
                if (period === 'year') {
                    const months = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек'];
                    labelStr = months[d.getMonth()];
                } else if (period === 'month') {
                    const dEnd = new Date(s.p_end);
                    labelStr = `${d.getDate()}.${d.getMonth() + 1}-${dEnd.getDate()}.${dEnd.getMonth() + 1}`;
                } else {
                    labelStr = `${d.getDate()}.${d.getMonth() + 1}`;
                }
                
                g.fillStyle = '#333333';
                g.font = period === 'month' ? '10px Arial' : '14px Arial';
                g.fillText(labelStr, x + stepX / 2 - (period === 'month' ? 25 : 15), height - padding + 25);
            });

            // Легенда
            const legendY = 25;
            g.font = '14px Arial';
            g.textAlign = 'left';
            g.fillStyle = '#36A2EB'; g.fillRect(padding, legendY, 15, 15);
            g.fillStyle = '#000'; g.fillText('Всего', padding + 20, legendY + 12);
            g.fillStyle = '#4BC0C0'; g.fillRect(padding + 80, legendY, 15, 15);
            g.fillStyle = '#000'; g.fillText('Одобрено', padding + 100, legendY + 12);
            g.fillStyle = '#FF6384'; g.fillRect(padding + 180, legendY, 15, 15);
            g.fillStyle = '#000'; g.fillText('Отклонено', padding + 200, legendY + 12);

            textSummary += `Всего заявок: ${totalPeriod}\n`;
            textSummary += `Одобрено: ${approvedPeriod}\n`;
            textSummary += `Отклонено: ${rejectedPeriod}\n`;
            if (totalPeriod > 0) {
                textSummary += `Процент одобрения: ${((approvedPeriod / totalPeriod) * 100).toFixed(1)}%`;
            }

            const buffer = canvas.toBuffer('image/png');
            const uploadInfo = await ctx.api.raw.uploads.getUploadUrl({ type: 'image' });
            const formData = new FormData();
            formData.append('data', new Blob([buffer]), 'stats.png');
            const uploadRes = await fetch(uploadInfo.url, { method: 'POST', body: formData });
            const uploadResult = await uploadRes.json();

            let imageToken = uploadResult.token || uploadResult.retval;
            if (!imageToken && uploadResult.photos) {
                const keys = Object.keys(uploadResult.photos);
                if (keys.length > 0) imageToken = uploadResult.photos[keys[0]].token;
            }

            if (!imageToken) throw new Error('Не удалось получить токен изображения');

            await ctx.sendOrEdit(textSummary, {
                attachments: [
                    { type: 'image', payload: { token: imageToken } },
                    Keyboard.inlineKeyboard([[Keyboard.button.callback('Назад', 'stats')]])
                ]
            });
        } catch (error) {
            if (process.env.DEBUG === 'true') console.error('[ERROR] Stats error:', error);
            await ctx.sendOrEdit('Ошибка при формировании статистики.', { 
                attachments: [Keyboard.inlineKeyboard([[Keyboard.button.callback('Назад', 'stats')]])] 
            });
        }
    }
};

module.exports = statsFlow;
