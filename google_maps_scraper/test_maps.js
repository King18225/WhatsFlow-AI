const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
chromium.use(stealth);

(async () => {
    console.log("Starting...");
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ locale: 'pt-BR' });
    const page = await context.newPage();
    
    try {
        await page.goto('https://www.google.com/maps/search/Dentistas+em+Aldeota,+Fortaleza,+CE', { waitUntil: 'load' });
        await page.waitForTimeout(5000);
        
        const feedSelector = 'div[role="feed"]';
        const feedOk = await page.$(feedSelector);
        console.log("Feed Selector ('div[role=feed]') exists?", !!feedOk);

        const items = await page.$$('a[href*="/maps/place/"]');
        console.log(`Found ${items.length} links.`);

        if (items.length > 0) {
            const href = await items[0].getAttribute('href');
            console.log("\n-> Accessing deep card:", href);
            await page.goto(href, { waitUntil: 'load' });
            await page.waitForTimeout(5000);
            
            const name = await page.$eval('h1', el => el.innerText.trim()).catch(() => 'Could not find h1');
            console.log("Clinic name:", name);
            
            const phoneOptions = [
                'button[data-item-id^="phone:"] div.AOCiG',
                'button[data-item-id^="phone:"] div[class*="fontBodyMedium"]',
                'button[data-item-id^="phone:"]',
                '[data-tooltip="Copiar número de telefone"]'
            ];
            let phone = null;
            for (let sel of phoneOptions) {
                try {
                    phone = await page.$eval(sel, el => el.innerText.trim());
                    if (phone) {
                        console.log(`Phone found with selector "${sel}": ${phone}`);
                        break;
                    }
                } catch (e) {}
            }
            if (!phone) console.log("No phone found for selectors.");
        } else {
            console.log("Could not find /maps/place/ buttons in DOM.");
        }
    } catch (e) {
        console.log("FATAL ERROR:", e.message);
    } finally {
        await browser.close();
        console.log("Ending.");
    }
})();
