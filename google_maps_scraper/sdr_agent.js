require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
const { GoogleGenAI } = require('@google/genai');
const { delay } = require('./utils');

chromium.use(stealth);

const apiKeys = Object.keys(process.env)
    .filter(k => k.startsWith('GEMINI_API_KEY_'))
    .map(k => process.env[k]);

let keyIndex = 0;
function getGeminiClient() {
    if (apiKeys.length === 0) {
        console.error('[ERROR] No GEMINI_API_KEY_X found in .env');
        process.exit(1);
    }
    const key = apiKeys[keyIndex];
    keyIndex = (keyIndex + 1) % apiKeys.length; 
    return new GoogleGenAI({ apiKey: key });
}

const LEADS_FILE   = path.join(__dirname, 'leads_sem_site.json');
const SENT_FILE    = path.join(__dirname, 'sdr_status.json');
const SESSION_DIR  = path.join(__dirname, 'wa_session');

const MAX_PER_SESSION = 20;
const DELAY_BETWEEN_MSGS = [480000, 900000];

const SYSTEM_PROMPT = `You are an elite SDR. Your mission is to write a short, first WhatsApp message (max 3 lines) in Portuguese for a clinic.
Use a consultative and friendly tone. Focus on how their local region (e.g. Aldeota) is a highly competitive and sophisticated health hub.
Mention that, without a professional website or Landing Page, they are losing qualified patients searching on Google to competitors who already have a strong digital presence.
End with a short and engaging question.
Do not use emojis excessively.
Do not use 'Prezados' or overly formal terms.
You will receive the clinic's data (Name, Rating, Location).`;

function readStatus() {
    if (!fs.existsSync(SENT_FILE)) return { enviados: [] };
    return JSON.parse(fs.readFileSync(SENT_FILE, 'utf8'));
}

function markAsSent(lead, status = 'enviado') {
    const data = readStatus();
    const exists = data.enviados.find(e => e.phone === lead.phone_intl);
    if (!exists) {
        data.enviados.push({
            name:     lead.name,
            phone:    lead.phone_intl,
            status,
            sentAt:   new Date().toISOString(),
        });
        fs.writeFileSync(SENT_FILE, JSON.stringify(data, null, 2));
    }
}

function alreadySent(phoneIntl) {
    const data = readStatus();
    return data.enviados.some(e => e.phone === phoneIntl);
}

async function generateMessage(lead) {
    const name = lead.name || 'Clínica';
    const rating = lead.rating || '5.0';
    const maps = lead.mapsUrl ? 'Google Maps' : 'Google';

    const inputData = `LEAD DATA:
- Clinic Name: ${name}
- Rating (Stars): ${rating}
- Location/Origin: ${maps} (Assumed district: Aldeota / Fortaleza-CE)
- Pain Point: "Does not have an official website/Landing Page in a competitive market"`;

    try {
        const client = getGeminiClient();
        const response = await client.models.generateContent({
            model: 'gemini-3.1-flash-lite-preview',
            contents: inputData,
            config: {
                systemInstruction: SYSTEM_PROMPT,
                temperature: 0.7,
            }
        });
        return response.text.trim();
    } catch (e) {
        console.error(`[AI ERROR] Fallback used. (${e.message})`);
        const shortName = name.split(' ')[0];
        return `Olá, tudo bem? 😊\nVi o perfil de vocês (*${shortName}*) super bem avaliado no Google Maps, mas notei que ainda não têm um site oficial para facilitar os agendamentos.\nTrabalho criando sites profissionais que convertem mais pacientes. Posso te enviar um exemplo do meu trabalho?`;
    }
}

async function sendMessage(page, lead) {
    const phone = lead.phone_intl;
    const name  = lead.name;

    if (!phone) return 'no_phone';
    if (alreadySent(phone)) return 'duplicate';

    try {
        await page.goto('https://web.whatsapp.com', { waitUntil: 'load', timeout: 45000 });
        await page.waitForSelector('div[data-testid="chat-list"]', { timeout: 30000 });
        await delay(3000, 6000);
    } catch (e) {}

    const waUrl = `https://web.whatsapp.com/send?phone=${phone}&text=`;
    console.log(`[VALIDATING] → ${name} (${phone})`);

    try {
        await page.goto(waUrl, { waitUntil: 'load', timeout: 45000 });

        const inputSelector = 'div[contenteditable="true"][data-tab="10"]';
        const detected = await Promise.race([
            page.waitForSelector(inputSelector, { timeout: 35000 }).then(() => 'valid'),
            page.waitForSelector('text="inválido"', { timeout: 35000 }).then(() => 'invalid'),
            page.waitForSelector('text="invalid"', { timeout: 35000 }).then(() => 'invalid'),
            page.waitForSelector('text="OK"', { timeout: 35000 }).then(() => 'invalid')
        ]);

        if (detected === 'invalid') {
            console.log(`[!] Invalid number: ${name}`);
            markAsSent(lead, 'inexistente');
            return 'invalid';
        }

        const message = await generateMessage(lead);
        await page.click(inputSelector);
        await delay(800, 1500);

        const lines = message.split('\n');
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (line.trim()) {
                for (const char of line) {
                    await page.keyboard.type(char, { delay: Math.random() * 80 + 40 });
                    if ([' ', ',', '.', '?'].includes(char)) await delay(150, 400);
                }
            }
            if (i < lines.length - 1) {
                await page.keyboard.down('Shift');
                await page.keyboard.press('Enter');
                await page.keyboard.up('Shift');
                await delay(300, 600);
            }
        }

        await delay(2000, 4000);
        await page.keyboard.press('Enter');
        await delay(4000, 6000);

        const sendOk = await page.evaluate(() => {
            const msgs = document.querySelectorAll('div[class*="message-out"]');
            return msgs.length > 0;
        });

        if (sendOk) {
            console.log(`[✓] Successfully sent.`);
            markAsSent(lead, 'enviado');
            return 'ok';
        } else {
            markAsSent(lead, 'incerto');
            return 'uncertain';
        }

    } catch (e) {
        console.error(`[ERROR] Flow failed: ${e.message.split('\n')[0]}`);
        markAsSent(lead, 'erro');
        return 'error';
    }
}

async function main() {
    if (!fs.existsSync(LEADS_FILE)) {
        console.error('[ERROR] leads_sem_site.json not found. Run enrich.js first.');
        process.exit(1);
    }

    const leads = JSON.parse(fs.readFileSync(LEADS_FILE, 'utf8'));
    const pending = leads.filter(l => l.phone_intl && !alreadySent(l.phone_intl));

    console.log(`[SDR] Leads: ${leads.length} | Pending: ${pending.length} | Limit: ${MAX_PER_SESSION}`);
    if (pending.length === 0) return;

    const browser = await chromium.launchPersistentContext(SESSION_DIR, {
        headless: false,
        executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        ignoreDefaultArgs: ['--enable-automation'],
        args: ['--disable-blink-features=AutomationControlled'],
        viewport: { width: 1280, height: 800 },
        locale:   'pt-BR',
    });

    const page = browser.pages().length > 0 ? browser.pages()[0] : await browser.newPage();

    await page.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', {
            get: () => undefined,
        });
    });

    try {
        await page.goto('https://web.whatsapp.com', { waitUntil: 'load', timeout: 90000 });
    } catch (e) {}

    try {
        await page.waitForSelector('div[data-testid="chat-list"]', { timeout: 90000 });
        console.log('[✓] WhatsApp Web connected.');
    } catch (e) {
        await delay(10000, 15000);
    }

    const queue = pending.slice(0, MAX_PER_SESSION);
    let okCount = 0, errorCount = 0;

    for (let i = 0; i < queue.length; i++) {
        const lead = queue[i];
        console.log(`\n[${i + 1}/${queue.length}] ${lead.name}`);

        const result = await sendMessage(page, lead);
        if (result === 'ok')     okCount++;
        if (result === 'error')   errorCount++;

        if (i < queue.length - 1) {
            let ms = result === 'ok' ? 
                Math.floor(Math.random() * (DELAY_BETWEEN_MSGS[1] - DELAY_BETWEEN_MSGS[0])) + DELAY_BETWEEN_MSGS[0] : 
                20000;

            console.log(`[WAIT] Next send in ${(ms / 1000).toFixed(0)}s`);
            
            if (result === 'ok') {
                const totalSec = Math.floor(ms / 1000);
                for (let sec = 60; sec < totalSec; sec += 60) {
                    await delay(60000, 60000);
                }
                await delay(ms % 60000, (ms % 60000) + 5000);
            } else {
                await delay(ms, ms + 2000);
            }
        }
    }

    console.log(`\n[END] Session finished. Successes: ${okCount} | Errors: ${errorCount}`);
    await browser.close();
}

main().catch(err => {
    const errorMsg = `\n[${new Date().toLocaleString()}] FATAL ERROR: ${err.stack || err}\n`;
    console.error(err);
    fs.appendFileSync(path.join(__dirname, 'sdr_error_log.txt'), errorMsg);
    process.exit(1);
});
