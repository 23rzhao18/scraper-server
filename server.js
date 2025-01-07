const express = require('express');
const puppeteer = require('puppeteer');
const cors = require('cors');
const { Pool } = require('pg');
require('dotenv').config();

// Initialize Express app
const app = express();
const port = 3001;

// Enable CORS
app.use(cors());

// PostgreSQL Database Configuration
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
});

// Ensure the table exists
const ensureTableExists = async () => {
    const createTableQuery = `
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
        await client.query(createTableQuery);
        client.release();
        console.log('Table ensured/created successfully.');
    } catch (error) {
        console.error('Error ensuring table exists:', error);
    }
};

ensureTableExists();

// Fetch data from the database
app.get('/data', async (req, res) => {
    try {
        const client = await pool.connect();
        const result = await client.query('SELECT * FROM brawl_data ORDER BY id ASC');
        client.release();
        res.json(result.rows); // Send the data as JSON
    } catch (error) {
        console.error('Error fetching data:', error);
        res.status(500).json({ error: 'Failed to fetch data' });
    }
});

// Function to save data to PostgreSQL
const saveToDatabase = async (data) => {
    try {
        const client = await pool.connect();
        for (const row of data) {
            await client.query(
                'INSERT INTO brawl_data (rank, brawler, wins, use_rate) VALUES ($1, $2, $3, $4)',
                [row.rank, row.brawler, row.wins, row.useRate]
            );
        }
        client.release();
        console.log('Data successfully saved to PostgreSQL database.');
    } catch (error) {
        console.error('Error saving data to PostgreSQL:', error);
    }
};

// Scrape data from the website
const scrapeData = async () => {
    const url = 'https://brawltime.ninja/dashboard?filter[season]=2025-01-06&filter[trophyRangeGte]=18&filter[powerplay]=true&cube=map&dimension=brawler&metric=wins&metric=useRate&sort=wins';
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();

    await page.goto(url, { waitUntil: 'networkidle2' });

    const allData = [];

    const scrapePage = async () => {
        await page.waitForSelector('table.w-full');
        const data = await page.evaluate(() => {
            const rows = Array.from(document.querySelectorAll('table.w-full tbody tr'));
            return rows.map(row => {
                const rank = row.querySelector('td:nth-child(1)')?.textContent?.trim() || '';
                const brawler = row.querySelector('th[scope="row"] figcaption')?.textContent?.trim() || '';
                const wins = row.querySelector('td:nth-child(3)')?.textContent?.trim() || '';
                const useRate = row.querySelector('td:nth-child(4)')?.textContent?.trim() || '';
                return { rank, brawler, wins, useRate };
            });
        });
        allData.push(...data);
    };

    await scrapePage();

    let hasNextPage = true;
    while (hasNextPage) {
        try {
            const nextButton = await page.$('button[aria-label="next"]');
            if (nextButton) {
                await nextButton.click();
                await page.waitForSelector('table.w-full', { timeout: 5000 });
                await new Promise(resolve => setTimeout(resolve, 1000));
                await scrapePage();
            } else {
                hasNextPage = false;
            }
        } catch (error) {
            console.error('Error navigating to next page:', error);
            hasNextPage = false;
        }
    }

    await browser.close();
    return allData;
};

// Define the scrape endpoint
app.get('/scrape', async (req, res) => {
    try {
        const data = await scrapeData();
        await saveToDatabase(data);
        res.json({ message: 'Data scraped and saved successfully.', data });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Failed to scrape data.' });
    }
});

// Start the server
app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
});
