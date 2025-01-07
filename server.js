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

// Ensure the tables exist
const ensureTablesExist = async () => {
    const createBrawlerTableQuery = `
        CREATE TABLE IF NOT EXISTS brawlers (
            id SERIAL PRIMARY KEY,
            name VARCHAR(255),
            class VARCHAR(255)
        );
    `;
    const createBrawlDataTableQuery = `
        CREATE TABLE IF NOT EXISTS brawl_data (
            id SERIAL PRIMARY KEY,
            rank VARCHAR(10),
            brawler VARCHAR(50),
            wins VARCHAR(10),
            use_rate VARCHAR(10),
            CONSTRAINT unique_brawler UNIQUE (brawler)
        );
    `;

    try {
        const client = await pool.connect();
        await client.query(createBrawlerTableQuery);
        await client.query(createBrawlDataTableQuery);
        client.release();
        console.log('Tables ensured/created successfully.');
    } catch (error) {
        console.error('Error ensuring tables exist:', error);
    }
};

ensureTablesExist();

// Fetch data from the database (brawlers)
app.get('/data/brawlers', async (req, res) => {
    try {
        const client = await pool.connect();
        const result = await client.query('SELECT * FROM brawlers ORDER BY id ASC');
        client.release();
        res.json(result.rows); // Send the data as JSON
    } catch (error) {
        console.error('Error fetching brawlers data:', error);
        res.status(500).json({ error: 'Failed to fetch brawlers data' });
    }
});

// Fetch data from the database (brawl data)
app.get('/data/brawl_data', async (req, res) => {
    try {
        const client = await pool.connect();
        const result = await client.query('SELECT * FROM brawl_data ORDER BY id ASC');
        client.release();
        res.json(result.rows); // Send the data as JSON
    } catch (error) {
        console.error('Error fetching brawl data:', error);
        res.status(500).json({ error: 'Failed to fetch brawl data' });
    }
});

// Function to save brawlers to PostgreSQL
const saveBrawlersToDatabase = async (data) => {
    try {
        const client = await pool.connect();
        for (const row of data) {
            await client.query(
                'INSERT INTO brawlers (name, class) VALUES ($1, $2)',
                [row.name, row.class]
            );
        }
        client.release();
        console.log('Brawlers data successfully saved to PostgreSQL database.');
    } catch (error) {
        console.error('Error saving brawlers data to PostgreSQL:', error);
    }
};

// Function to save brawl data to PostgreSQL
const saveBrawlDataToDatabase = async (data) => {
    try {
        const client = await pool.connect();
        for (const row of data) {
            await client.query(
                `
                INSERT INTO brawl_data (rank, brawler, wins, use_rate)
                VALUES ($1, $2, $3, $4)
                ON CONFLICT (brawler)
                DO UPDATE SET 
                    rank = EXCLUDED.rank,
                    wins = EXCLUDED.wins,
                    use_rate = EXCLUDED.use_rate
                `,
                [row.rank, row.brawler, row.wins, row.useRate]
            );
        }
        client.release();
        console.log('Brawl data successfully saved or updated in PostgreSQL database.');
    } catch (error) {
        console.error('Error saving brawl data to PostgreSQL:', error);
    }
};

// Scrape brawlers data from the website
const scrapeBrawlersData = async () => {
    const url = 'https://brawlify.com/brawlers/classes'; // URL to scrape from
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();

    await page.goto(url, { waitUntil: 'networkidle2' });

    const allData = [];

    const scrapePage = async () => {
        await page.waitForSelector('div.container-fluid.post-type1');
        const data = await page.evaluate(() => {
            const containers = Array.from(document.querySelectorAll('div.container-fluid.post-type1'));
            const data = [];

            containers.forEach(container => {
                const className = container.querySelector('h2.title-brl')?.textContent.trim() || 'Unknown';

                const brawlers = Array.from(container.querySelectorAll('a[title]')).map(a => {
                    const brawlerName = a.title.split(' is a brawler')[0];
                    return { name: brawlerName, class: className };
                });

                data.push(...brawlers);
            });

            return data;
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
                await page.waitForSelector('div.container-fluid.post-type1', { timeout: 5000 });
                await new Promise(resolve => setTimeout(resolve, 1000)); // Wait a bit to let page load
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

// Scrape brawl data from the website
const scrapeBrawlData = async () => {
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

// Define the scrape endpoint for brawlers
app.get('/scrape/brawlers', async (req, res) => {
    try {
        const data = await scrapeBrawlersData();
        await saveBrawlersToDatabase(data);
        res.json({ message: 'Brawlers data scraped and saved successfully.', data });
    } catch (error) {
        console.error('Error scraping brawlers data:', error);
        res.status(500).json({ error: 'Failed to scrape brawlers data.' });
    }
});

// Define the scrape endpoint for brawl data
app.get('/scrape/brawl_data', async (req, res) => {
    try {
        const data = await scrapeBrawlData();
        await saveBrawlDataToDatabase(data);
        res.json({ message: 'Brawl data scraped and saved successfully.', data });
    } catch (error) {
        console.error('Error scraping brawl data:', error);
        res.status(500).json({ error: 'Failed to scrape brawl data.' });
    }
});

// Start the server
app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
});
