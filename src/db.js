const { Pool } = require('pg');

const pool = new Pool({
    user: process.env.PGUSER || 'postgres',
    host: process.env.PGHOST || 'localhost',
    database: process.env.PGDATABASE || 'bot_db',
    password: process.env.PGPASSWORD || 'postgres',
    port: process.env.PGPORT || 5432,
});

async function initDb() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                user_id BIGINT PRIMARY KEY,
                role TEXT DEFAULT 'Инициатор',
                agreement_time TIMESTAMP,
                file_version TEXT,
                current_state JSONB DEFAULT NULL
            );
            CREATE TABLE IF NOT EXISTS guest_templates (
                id SERIAL PRIMARY KEY,
                user_id BIGINT REFERENCES users(user_id),
                full_name TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS applications (
                id SERIAL PRIMARY KEY,
                initiator_id BIGINT REFERENCES users(user_id),
                guest_name TEXT,
                visit_date DATE,
                visit_time TIME,
                zone TEXT,
                purpose TEXT,
                status TEXT DEFAULT 'черновик',
                comment TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS action_history (
                id SERIAL PRIMARY KEY,
                user_id BIGINT,
                application_id INTEGER,
                action_type TEXT,
                details TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS referral_links (
                code TEXT PRIMARY KEY,
                visit_date DATE,
                visit_time TIME,
                zone TEXT,
                purpose TEXT,
                comment TEXT,
                status TEXT DEFAULT 'активна',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        if (process.env.DEBUG === 'true') console.log('База данных готова.');
    } catch (err) {
        if (process.env.DEBUG === 'true') console.error('Ошибка БД:', err.message);
    }
}

module.exports = {
    pool,
    initDb,
    async getUser(userId) {
        const res = await pool.query('SELECT * FROM users WHERE user_id = $1', [userId]);
        return res.rows[0];
    },
    async getSecurityEngineers() {
        const res = await pool.query('SELECT user_id FROM users WHERE role = \'Администратор\'');
        return res.rows.map(r => r.user_id);
    },
    async getAllAdmins() {
        const res = await pool.query('SELECT user_id FROM users WHERE role IN (\'Администратор\', \'Технический администратор\')');
        return res.rows.map(r => r.user_id);
    },
    async saveConsent(userId, version, role) {
        await pool.query(`
            INSERT INTO users (user_id, agreement_time, file_version, role)
            VALUES ($1, CURRENT_TIMESTAMP, $2, $3)
            ON CONFLICT (user_id) DO UPDATE SET 
                agreement_time = EXCLUDED.agreement_time, 
                file_version = EXCLUDED.file_version,
                role = CASE WHEN users.role = 'Инициатор' THEN EXCLUDED.role ELSE users.role END
        `, [userId, version, role]);
    },
    async setState(userId, state) {
        await pool.query('UPDATE users SET current_state = $1 WHERE user_id = $2', [state ? JSON.stringify(state) : null, userId]);
    },
    async getState(userId) {
        const res = await pool.query('SELECT current_state FROM users WHERE user_id = $1', [userId]);
        return res.rows.length > 0 ? res.rows[0].current_state : null;
    },
    async getTemplates(userId) {
        const res = await pool.query('SELECT id, full_name FROM guest_templates WHERE user_id = $1 ORDER BY full_name ASC', [userId]);
        return res.rows;
    },
    async isTemplateExists(userId, fullName) {
        const res = await pool.query('SELECT id FROM guest_templates WHERE user_id = $1 AND LOWER(full_name) = LOWER($2)', [userId, fullName.trim()]);
        return res.rows.length > 0;
    },
    async deleteTemplate(id, userId) {
        await pool.query('DELETE FROM guest_templates WHERE id = $1 AND user_id = $2', [id, userId]);
    },
    async saveTemplate(userId, fullName) {
        await pool.query('INSERT INTO guest_templates (user_id, full_name) VALUES ($1, $2)', [userId, fullName]);
    },
    async createApplication(data, status = 'на рассмотрении') {
        const res = await pool.query(
            'INSERT INTO applications (initiator_id, guest_name, visit_date, visit_time, zone, purpose, status) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id',
            [data.userId, data.guest_name, data.visit_date, data.visit_time, data.zone, data.purpose, status]
        );
        return res.rows[0].id;
    },
    async updateApplicationData(id, data, status = 'на рассмотрении') {
        await pool.query(
            'UPDATE applications SET guest_name = $1, visit_date = $2, visit_time = $3, zone = $4, purpose = $5, status = $6 WHERE id = $7',
            [data.guest_name, data.visit_date, data.visit_time, data.zone, data.purpose, status, id]
        );
    },
    async getActiveApplicationsCount(userId) {
        const res = await pool.query(
            'SELECT COUNT(*) FROM applications WHERE initiator_id = $1 AND status IN (\'на рассмотрении\', \'требует корректировки\')',
            [userId]
        );
        return parseInt(res.rows[0].count);
    },
    async getPendingApplications() {
        const res = await pool.query('SELECT * FROM applications WHERE status = \'на рассмотрении\' ORDER BY created_at ASC');
        return res.rows;
    },
    async getApplicationById(id) {
        const res = await pool.query('SELECT * FROM applications WHERE id = $1', [id]);
        return res.rows[0];
    },
    async updateApplicationStatus(id, status, comment = null) {
        await pool.query('UPDATE applications SET status = $1, comment = $2 WHERE id = $3', [status, comment, id]);
    },
    async getStats(period = 'week') {
        let query = '';
        if (period === 'week') {
            query = `
                WITH periods AS (
                    SELECT generate_series(CURRENT_DATE - INTERVAL '6 days', CURRENT_DATE, '1 day')::date AS p_start
                )
                SELECT p.p_start as label, COUNT(a.id) as total, 
                       COUNT(a.id) FILTER (WHERE a.status = 'одобрена') as approved,
                       COUNT(a.id) FILTER (WHERE a.status = 'отклонена') as rejected
                FROM periods p
                LEFT JOIN applications a ON a.created_at >= p.p_start AND a.created_at < (p.p_start + INTERVAL '1 day')
                GROUP BY p.p_start ORDER BY p.p_start ASC`;
        } else if (period === 'month') {
            query = `
                WITH month_days AS (
                    SELECT generate_series(
                        date_trunc('month', CURRENT_DATE)::date, 
                        (date_trunc('month', CURRENT_DATE) + INTERVAL '1 month' - INTERVAL '1 day')::date, 
                        '1 day'
                    )::date AS day
                ),
                periods AS (
                    SELECT DISTINCT date_trunc('week', day)::date AS p_start
                    FROM month_days
                )
                SELECT 
                    p.p_start as label,
                    (p.p_start + INTERVAL '6 days')::date as p_end,
                    COUNT(a.id) as total,
                    COUNT(a.id) FILTER (WHERE a.status = 'одобрена') as approved,
                    COUNT(a.id) FILTER (WHERE a.status = 'отклонена') as rejected
                FROM periods p
                LEFT JOIN applications a ON a.created_at >= p.p_start AND a.created_at < (p.p_start + INTERVAL '7 days')
                GROUP BY p.p_start
                ORDER BY p.p_start ASC`;
        } else if (period === 'year') {
            query = `
                WITH periods AS (
                    SELECT generate_series(
                        date_trunc('month', CURRENT_DATE - INTERVAL '11 months')::date, 
                        date_trunc('month', CURRENT_DATE)::date, 
                        '1 month'
                    )::date AS p_start
                )
                SELECT p.p_start as label, COUNT(a.id) as total,
                       COUNT(a.id) FILTER (WHERE a.status = 'одобрена') as approved,
                       COUNT(a.id) FILTER (WHERE a.status = 'отклонена') as rejected
                FROM periods p
                LEFT JOIN applications a ON a.created_at >= p.p_start AND a.created_at < (p.p_start + INTERVAL '1 month')
                GROUP BY p.p_start ORDER BY p.p_start ASC`;
        }
        const res = await pool.query(query);
        return res.rows;
    },
    async logAction(userId, type, details, appId = null) {
        await pool.query('INSERT INTO action_history (user_id, action_type, details, application_id) VALUES ($1, $2, $3, $4)', [userId, type, details, appId]);
    },
    async getHistory(dateStart, dateEnd, isTechAdmin = false) {
        const res = await pool.query(
            'SELECT * FROM action_history WHERE created_at >= $1 AND created_at < ($2::date + INTERVAL \'1 day\') ORDER BY created_at ASC',
            [dateStart, dateEnd]
        );
        if (isTechAdmin) {
            return res.rows.map(l => ({
                ...l,
                details: l.details.replace(/\(Гость: .*\)/g, '(данные скрыты)')
            }));
        }
        return res.rows;
    },
    async getAllAdminsList() {
        const res = await pool.query('SELECT user_id, role FROM users WHERE role != \'Инициатор\' ORDER BY role DESC');
        return res.rows;
    },
    async updateUserRole(userId, newRole) {
        await pool.query('UPDATE users SET role = $1 WHERE user_id = $2', [newRole, userId]);
    },
    async getUserApplications(userId) {
        const res = await pool.query(
            'SELECT * FROM applications WHERE initiator_id = $1 ORDER BY created_at DESC LIMIT 10',
            [userId]
        );
        return res.rows;
    },
    async getReferralLink(code) {
        const res = await pool.query('SELECT * FROM referral_links WHERE code = $1 AND status = \'активна\'', [code]);
        return res.rows[0];
    },
    async createReferralLink(code, data, status = 'активна') {
        await pool.query(
            'INSERT INTO referral_links (code, visit_date, visit_time, zone, purpose, comment, status) VALUES ($1, $2, $3, $4, $5, $6, $7)',
            [code, data.visit_date, data.visit_time, data.zone, data.purpose, data.comment, status]
        );
    },
    async updateReferralLinkData(code, data, status = 'активна') {
        await pool.query(
            'UPDATE referral_links SET visit_date = $1, visit_time = $2, zone = $3, purpose = $4, comment = $5, status = $6 WHERE code = $7',
            [data.visit_date, data.visit_time, data.zone, data.purpose, data.comment, status, code]
        );
    },
    async deleteReferralLink(code) {
        await pool.query('DELETE FROM referral_links WHERE code = $1', [code]);
    },
    async getAllReferralLinks() {
        const res = await pool.query('SELECT * FROM referral_links ORDER BY created_at DESC');
        return res.rows;
    },
    async deleteUserCompletely(userId) {
        await pool.query('DELETE FROM action_history WHERE user_id = $1', [userId]);
        await pool.query('DELETE FROM guest_templates WHERE user_id = $1', [userId]);
        await pool.query('DELETE FROM applications WHERE initiator_id = $1', [userId]);
        await pool.query('DELETE FROM users WHERE user_id = $1', [userId]);
    }
    };
