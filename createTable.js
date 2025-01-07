const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
});

const createTable = async () => {
    const query = `
        CREATE TABLE IF NOT EXISTS brawl_data (
            id SERIAL PRIMARY KEY,
            rank VARCHAR(10),
            brawler VARCHAR(50),
            wins VARCHAR(10),
            use_rate VARCHAR(10)
        );
    `;

    try {
        const client = await pool.connect();
        await client.query(query);
        client.release();
        console.log('Table created successfully.');
    } catch (error) {
        console.error('Error creating table:', error);
    }
};

createTable();