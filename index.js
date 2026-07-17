require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
const { delay, sanitizePhone, saveLead, saveStatus, getCompletedNeighborhoods } = require('./utils');

chromium.use(stealth);

const NICHE = "Dentists";

async function collectUrls(page, neighborhood) {
    const query = `${NICHE} in ${neighborhood}`;
    const searchUrl = `https://www.google.com/maps/search/${encodeURIComponent(query)}`;
    console.log(`[SEARCH] ${searchUrl}`);

    await page.goto(searchUrl, { waitUntil: 'load', timeout: 30000 });
    await delay(3000, 5000);

    try {
        await page.waitForSelector('a[href*="/maps/place/"]', { timeout: 15000 });
    } catch (e) {
        console.log('[!] No results loaded.');
        return [];
    }

    const links = new Set();
    let staticIterations = 0;

    while (true) {
        const hrefs = await page.$$eval('a[href*="/maps/place/"]', els =>
            els.map(el => el.href).filter(h => h && h.includes('/maps/place/'))
        );
        const prevSize = links.size;
        hrefs.forEach(h => links.add(h));

        const endOfList = await page.evaluate(() => {
            return [...document.querySelectorAll('*')]
                .some(el => el.textContent.includes('Você chegou ao final da lista') || el.textContent.includes('You\'ve reached the end of the list'));
        });
        if (endOfList) break;

        if (links.size === prevSize) {
            staticIterations++;
            if (staticIterations >= 3) break;
        } else {
            staticIterations = 0;
        }

        const hasFeed = await page.$('div[role="feed"]');
        if (hasFeed) {
            await page.$eval('div[role="feed"]', el => el.scrollBy(0, 1200));
        } else {
            await page.mouse.wheel(0, 1500);
        }
        await delay(2500, 4000);
    }

    const arr = Array.from(links);
    console.log(`[SEARCH] Collected ${arr.length} links.`);
    return arr;
}

async function extractCardData(browser, url) {
    const page = await browser.newPage();

    try {
        const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForSelector('h1', { timeout: 10000 }).catch(() => {});
        await delay(2000, 4000);

        let lead = { name: null, website: null, phone: null, rating: null, mapsUrl: url };

        try {
            lead.name = await page.$eval('h1', el => el.innerText.trim());
        } catch (e) {}

        try {
            lead.rating = await page.$eval('div.F7nice > span[aria-hidden="true"]', el => el.innerText.trim());
        } catch (e) {}

        const phoneSelectors = [
            'button[data-item-id^="phone:"] div[class*="fontBodyMedium"]',
            'button[data-item-id^="phone:"] div.Io6YTe',
            'button[data-item-id^="phone:"] div.rogA2c',
            'button[data-item-id^="phone:"]',
            '[data-tooltip*="telefone"]',
            '[aria-label*="telefone"]',
        ];
        for (const sel of phoneSelectors) {
            try {
                const raw = await page.$eval(sel, el => el.innerText.trim());
                if (raw && /\d{4,}/.test(raw)) {
                    lead.phone = sanitizePhone(raw);
                    break;
                }
            } catch (e) {}
        }

        try {
            lead.website = await page.$eval('a[data-item-id="authority:"]', el => el.href);
        } catch (e) {}

        saveLead(lead);
        return lead;

    } catch (e) {
        console.error(`[DIVE ERROR] ${e.message.split('\n')[0]}`);
        return null;
    } finally {
        await page.close();
    }
}

async function main() {
    const neighborhoodsListPath = path.join(__dirname, 'bairros.txt');
    const neighborhoodsTxt = fs.readFileSync(neighborhoodsListPath, 'utf8');
    const allNeighborhoods = neighborhoodsTxt.split('\n').map(b => b.trim()).filter(b => b);
    const completed = getCompletedNeighborhoods();
    const pending = allNeighborhoods.filter(b => !completed.includes(b));

    console.log(`[STATUS] Total: ${allNeighborhoods.length} | Completed: ${completed.length} | Pending: ${pending.length}`);
    if (pending.length === 0) return console.log('All neighborhoods already processed.');

    const USER_DATA_DIR = path.join(__dirname, 'chrome_session');
    const browser = await chromium.launchPersistentContext(USER_DATA_DIR, {
        headless: false,
        channel: 'chrome',
        viewport: { width: 1280, height: 800 },
        locale: 'pt-BR',
        args: ['--disable-blink-features=AutomationControlled'],
    });

    for (const neighborhood of pending) {
        const searchPage = browser.pages().length > 0 ? browser.pages()[0] : await browser.newPage();
        const urls = await collectUrls(searchPage, neighborhood);

        if (urls.length === 0) {
            saveStatus(neighborhood);
            continue;
        }

        for (let i = 0; i < urls.length; i++) {
            await extractCardData(browser, urls[i]);
            if (i < urls.length - 1) await delay(3000, 6000);
        }

        saveStatus(neighborhood);
    }

    await browser.close();
}

main().catch(err => {
    console.error('[FATAL]', err.message);
    process.exit(1);
});
