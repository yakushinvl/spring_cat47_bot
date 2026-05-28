const { Keyboard } = require('@maxhub/max-bot-api');

const formatDateRU = (d) => {
    if (!d) return 'не задана';
    if (d instanceof Date) return d.toLocaleDateString('ru-RU');
    if (typeof d === 'string' && d.includes('-')) {
        const [y, m, day] = d.split('-').map(Number);
        return `${String(day).padStart(2, '0')}.${String(m).padStart(2, '0')}.${y}`;
    }
    return String(d);
};

const ui = {
    // --- ГЛАВНЫЕ МЕНЮ ПО РОЛЯМ ---
    menus: {
        'Инициатор': Keyboard.inlineKeyboard([
            [Keyboard.button.callback('Подать заявку', 'apply')],
            [Keyboard.button.callback('Мои заявки', 'user_list:0')],
            [Keyboard.button.callback('Мои данные', 'my_data')]
        ]),
        'Администратор': Keyboard.inlineKeyboard([
            [Keyboard.button.callback('Полученные заявки', 'admin_list:0')]
        ]),
        'Технический администратор': Keyboard.inlineKeyboard([
            [Keyboard.button.callback('Статистика', 'stats')],
            [Keyboard.button.callback('История действий', 'history')],
            [Keyboard.button.callback('Настройки', 'settings')]
        ])
    },

    // --- СОГЛАСИЕ ОПД ---
    consent: {
        disclaimer: '*Дисклеймер*: Данный сервис разработан командой «Вобла» в рамках университетского хакатона. Он не является официальной функцией платформы MAX.',
        text: 'Чтобы пользоваться сервисом «Электронное бюро пропусков», необходимо ваше согласие на обработку ID профиля и имени для формирования списка заявок и обратной связи.',
        updateText: 'Мы обновили условия использования или версию документов. Пожалуйста, подтвердите согласие повторно для продолжения работы:',
        keyboard: Keyboard.inlineKeyboard([
            [Keyboard.button.callback('Даю согласие', 'consent_accepted')]
        ])
    },

    // --- ФОРМА ПОДАЧИ ЗАЯВКИ ---
    application: {
        guestName: 'Введите ФИО или выберите из сохраненных:',
        date: 'Введите дату визита в формате ДД.ММ.ГГГГ (или ДД.ММ / ДД.ММ.ГГ) или выберите из предложенных:',
        time: 'Выберите время визита:',
        zone: 'Выберите зону доступа:',
        purpose: 'Введите цель визита:',
        limitExceeded: 'Вы не можете подать новую заявку. У вас уже есть 3 активные заявки (на рассмотрении или требующие корректировки).',
        
        currentValueButton: (val, label = 'Текущее значение') => [Keyboard.button.callback(`${label}: ${val}`, `keep_value`)],

        // Кнопки отмены (общие для шагов)
        cancelKeyboard: (buttons = []) => Keyboard.inlineKeyboard([
            ...buttons,
            [Keyboard.button.callback('Отмена', 'cancel_form')]
        ]),

        // Финальный итог
        summaryText: (data) => `Итог заявки:\n\n` +
            `ФИО: ${data.guest_name}\n` +
            `Дата: ${data.visit_date}\n` +
            `Время: ${data.visit_time}\n` +
            `Зона: ${data.zone}\n` +
            `Цель: ${data.purpose}`,
        
        summaryKeyboard: Keyboard.inlineKeyboard([
            [Keyboard.button.callback('Отправить заявку', 'submit_form')],
            [Keyboard.button.callback('Изменить данные', 'apply')],
            [Keyboard.button.callback('Сохранить в черновик', 'save_draft')],
            [Keyboard.button.callback('Отменить', 'cancel_form')]
        ]),

        saveTemplatePrompt: (name) => `Сохранить ФИО "${name}" для будущих заявок?`,
        saveTemplateKeyboard: (name) => Keyboard.inlineKeyboard([
            [Keyboard.button.callback('Да', `save_tpl:${name.substring(0, 30)}`)],
            [Keyboard.button.callback('Нет', 'main_menu')]
        ])
    },

    // --- АДМИН-ПАНЕЛЬ (Инженер ИБ) ---
    admin: {
        listTitle: (from, to, total) => `Показаны заявки ${from}-${to} из ${total}:`,
        noApps: 'Новых заявок пока нет.',
        item: (app) => `Заявка #${app.id}\nФИО: ${app.guest_name}\nДата: ${formatDateRU(app.visit_date)}\nСтатус: ${app.status}` + (app.comment ? `\nКомментарий: ${app.comment}` : ''),
        searchPrompt: 'Введите номер заявки для поиска:',
        searchButton: 'Найти по номеру',
        
        detailsKeyboard: (appId) => Keyboard.inlineKeyboard([
            [Keyboard.button.callback('Одобрить', `confirm_action:${appId}:одобрена`)],
            [Keyboard.button.callback('Отклонить', `confirm_action:${appId}:отклонена`)],
            [Keyboard.button.callback('На корректировку', `need_correction:${appId}`)]
        ]),

        confirmTitle: (status) => `Вы уверены, что хотите ${status.toUpperCase()} эту заявку?`,
        confirmKeyboard: (appId, status) => Keyboard.inlineKeyboard([
            [Keyboard.button.callback('Подтвердить', `execute_action:${appId}:${status}`)],
            [Keyboard.button.callback('Отмена', `view_app:${appId}`)]
        ]),

        correctionPrompt: 'Что именно нужно уточнить? Введите текст сообщения для пользователя:',
        
        newAppNotification: (app) => `Новая заявка #${app.id}!\nФИО: ${app.guest_name}\nДата: ${formatDateRU(app.visit_date)}\nЗона: ${app.zone}\nЦель: ${app.purpose || 'не указана'}`,
        notificationKeyboard: (appId) => Keyboard.inlineKeyboard([[Keyboard.button.callback('Изменить статус', `view_app:${appId}`)]]),

        paginationKeyboard: (offset, total, role = 'admin') => {
            const btns = [];
            const row = [];
            if (offset > 0) row.push(Keyboard.button.callback('Показать предыдущие 5', `${role}_list:${offset - 5}`));
            if (offset + 5 < total) row.push(Keyboard.button.callback('Показать следующие 5', `${role}_list:${offset + 5}`));
            if (row.length > 0) btns.push(row);
            btns.push([Keyboard.button.callback('Найти по номеру', 'search_app')]);
            btns.push([Keyboard.button.callback('В меню', 'main_menu')]);
            return Keyboard.inlineKeyboard(btns);
        }
    },

    // --- СТАТИСТИКА ---
    stats: {
        menuTitle: 'Выберите период для формирования статистики:',
        menuKeyboard: Keyboard.inlineKeyboard([
            [Keyboard.button.callback('За неделю', 'get_stats:week')],
            [Keyboard.button.callback('За месяц', 'get_stats:month')],
            [Keyboard.button.callback('За год', 'get_stats:year')],
            [Keyboard.button.callback('В меню', 'main_menu')]
        ]),
        noData: (period) => `Данные для статистики за ${period} отсутствуют.`
    },

    // --- НАСТРОЙКИ И ИСТОРИЯ ---
    settings: {
        mainTitle: 'Раздел настроек:',
        mainKeyboard: Keyboard.inlineKeyboard([
            [Keyboard.button.callback('Управление ролями', 'manage_roles')],
            [Keyboard.button.callback('Referral-ссылки', 'referral_links')],
            [Keyboard.button.callback('Назад', 'main_menu')]
        ]),

        rolesTitle: 'Список администраторов:',
        rolesEmpty: 'Список пуст.',
        rolesPrompt: '\n\nВведите ID пользователя в чат, чтобы изменить его роль:',
        rolesBackKeyboard: Keyboard.inlineKeyboard([[Keyboard.button.callback('Назад', 'settings')]]),

        changeRoleTitle: (id, role) => `Пользователь: \`${id}\`\nТекущая роль: *${role}*\n\nВыберите новую роль:`,
        changeRoleKeyboard: (targetId) => Keyboard.inlineKeyboard([
            [Keyboard.button.callback('Сделать Инициатором', `change_role:${targetId}:Инициатор`)],
            [Keyboard.button.callback('Сделать Администратором', `change_role:${targetId}:Администратор`)],
            [Keyboard.button.callback('Сделать Тех. администратором', `change_role:${targetId}:Технический администратор`)],
            [Keyboard.button.callback('Назад', 'manage_roles')]
        ]),

        historyPrompt: 'Введите период для выгрузки истории в формате:\n`ДД.ММ.ГГГГ - ДД.ММ.ГГГГ`\n\nИли выберите готовый вариант:',
        historyKeyboard: (today, last7, month) => Keyboard.inlineKeyboard([
            [Keyboard.button.callback(`Сегодня (${today})`, `history_preset:${today}`)],
            [Keyboard.button.callback(`7 дней (${last7})`, `history_preset:${last7}`)],
            [Keyboard.button.callback(`С начала месяца (${month})`, `history_preset:${month}`)],
            [Keyboard.button.callback('Назад', 'main_menu')]
        ]),
        referralTitle: 'Управление Referral-ссылками:',
        referralEmpty: 'Ссылок пока нет.',
        referralItem: (link) => `Комментарий: *${link.comment || 'нет'}*\nКод: \`${link.code}\` (https://max.ru/spring_cat47_bot?start=\`${link.code}\`)\nДата: ${formatDateRU(link.visit_date)}\nВремя: ${link.visit_time || 'не задано'}\nЗона: ${link.zone || 'не задана'}\nЦель: ${link.purpose || 'не задана'}\nСтатус: *${link.status}*`,
        deleteReferralCallback: (code) => `del_ref:${code}`,
        editReferralCallback: (code) => `edit_ref:${code}`,
        createReferralButton: 'Создать ссылку',
        finishDraftButton: 'Продолжить настройку',

        // Шаги создания ссылки
        refStepComment: 'Введите описание/комментарий для этой ссылки (чтобы знать, для чего она):',
        refStepDate: 'Выберите дату или введите ДД.ММ.ГГГГ:',
        refStepTime: 'Выберите время:',
        refStepZone: 'Выберите зону доступа:',
        refStepPurpose: 'Введите цель визита:',
        refSkipButton: 'Пропустить (не заполнять)',
        refSummaryTitle: 'Ссылка готова к созданию:',
        refSummaryKeyboard: Keyboard.inlineKeyboard([
            [Keyboard.button.callback('Сгенерировать ссылку', 'ref_save_final')],
            [Keyboard.button.callback('Сохранить в черновик', 'ref_save_draft')],
            [Keyboard.button.callback('Отмена', 'referral_links')]
        ])
    },

    // --- МОИ ЗАЯВКИ (Инициатор) ---
    myApplications: {
        title: (from, to, total) => `Показаны ваши заявки ${from}-${to} из ${total}:`,
        empty: 'У вас пока нет поданных заявок.',
        item: (app) => `Заявка #${app.id}\nГость: ${app.guest_name}\nДата: ${formatDateRU(app.visit_date)}\nСтатус: *${app.status}*` + (app.comment ? `\nКомментарий: ${app.comment}` : ''),
        cancelButton: (id) => `Отменить #${id}`,
        refillButton: (id) => `Перезаполнить #${id}`,
        cancelCallback: (id) => `cancel_app:${id}`,
        refillCallback: (id) => `refill_app:${id}`,
        backButton: 'Назад',

        paginationKeyboard: (offset, total) => {
            const btns = [];
            const row = [];
            if (offset > 0) row.push(Keyboard.button.callback('Показать предыдущие 5', `user_list:${offset - 5}`));
            if (offset + 5 < total) row.push(Keyboard.button.callback('Показать следующие 5', `user_list:${offset + 5}`));
            if (row.length > 0) btns.push(row);
            btns.push([Keyboard.button.callback('Найти по номеру', 'user_search_app')]);
            btns.push([Keyboard.button.callback('В меню', 'main_menu')]);
            return Keyboard.inlineKeyboard(btns);
        },
        
        // Уведомления
        statusNotification: (appId, status, comment) => `Статус вашей заявки #${appId} изменен!\nНовый статус: ${status.toUpperCase()}` + (comment ? `\nКомментарий: ${comment}` : ''),
        refillKeyboard: (appId) => Keyboard.inlineKeyboard([[Keyboard.button.callback(`Перезаполнить #${appId}`, `refill_app:${appId}`)]])
    },

    // --- МОИ ДАННЫЕ ---
    myData: {
        info: (userId, role) => {
            let text = `Ваш ID: \`${userId}\``;
            if (role !== 'Инициатор') {
                text += `\nРоль: *${role}*`;
            }
            return text;
        },
        templatesTitle: '\n\nСохраненные ФИО:',
        templatesEmpty: '\nСписок сохраненных ФИО пуст.',
        deleteTemplateCallback: (id) => `del_tpl:${id}`,
        deleteButton: (name) => `Удалить "${name}"`,
        deleteDataButton: 'Удалить все мои данные',
        deleteDataConfirmTitle: 'ВНИМАНИЕ!\n\nЭто действие полностью удалит ваш профиль, все ваши заявки и шаблоны. Восстановление невозможно.\n\nВы уверены?',
        deleteDataConfirmKeyboard: Keyboard.inlineKeyboard([
            [Keyboard.button.callback('Да, удалить всё', 'execute_delete_data')],
            [Keyboard.button.callback('Нет, отмена', 'my_data')]
        ])
    },

    // --- ОБЩЕЕ ---
    common: {
        backToMenu: 'В меню',
        cancel: 'Отмена',
        success: 'Успешно выполнено!'
    }
};

module.exports = ui;
