const fs = require('fs');
const path = require('path');

const delay = (min, max) => new Promise(resolve => setTimeout(resolve, Math.random() * (max - min) + min));

const ADJACENT_KEYS = {
    'a': ['q','w','s','z'], 'b': ['v','g','h','n'], 'c': ['x','d','f','v'],
    'd': ['s','e','r','f','c','x'], 'e': ['w','s','d','r'], 'f': ['d','r','t','g','v','c'],
    'g': ['f','t','y','h','b','v'], 'h': ['g','y','u','j','n','b'], 'i': ['u','j','k','o'],
    'j': ['h','u','i','k','m','n'], 'k': ['j','i','o','l','m'], 'l': ['k','o','p'],
    'm': ['n','j','k'], 'n': ['b','h','j','m'], 'o': ['i','k','l','p'],
    'p': ['o','l'], 'q': ['w','a'], 'r': ['e','d','f','t'], 's': ['a','w','e','d','x','z'],
    't': ['r','f','g','y'], 'u': ['y','h','j','i'], 'v': ['c','f','g','b'],
    'w': ['q','a','s','e'], 'x': ['z','s','d','c'], 'y': ['t','g','h','u'], 'z': ['a','s','x']
};

const getRandomAdjacent = (char) => {
    const lower = char.toLowerCase();
    const adjs = ADJACENT_KEYS[lower];
    if (adjs && adjs.length > 0) {
        const randAdj = adjs[Math.floor(Math.random() * adjs.length)];
        return char === lower ? randAdj : randAdj.toUpperCase();
    }
    return 'x';
};

const humanType = async (page, selector, text) => {
    await page.click(selector, { delay: Math.random() * 100 + 100 });
    await delay(200, 500);

    let burstCount = 0;
    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        
        if (char === ' ' || !/[a-zA-Z0-9]/.test(char)) {
            await delay(500, 1000);
        }

        if (/[a-zA-Z]/.test(char) && Math.random() < 0.03) {
            const wrongChar = getRandomAdjacent(char);
            await page.keyboard.type(wrongChar, { delay: Math.random() * 50 + 50 });
            await delay(350, 450);
            await page.keyboard.press('Backspace');
            await delay(100, 250);
        }

        await page.keyboard.type(char, { delay: Math.random() * 50 + 30 });
        burstCount++;

        if (burstCount >= Math.floor(Math.random() * 2) + 3) {
            await delay(100, 300);
            burstCount = 0;
        }
    }
    await delay(400, 800);
};

const sanitizePhone = (phone) => {
    if (!phone) return null;
    const digits = phone.replace(/\D/g, ''); 
    if (digits.startsWith('55') && digits.length >= 12) {
        return digits.slice(2);
    }
    return digits;
};

const LEADS_FILE = path.join(__dirname, 'leads_maps.json');
const STATUS_FILE = path.join(__dirname, 'status_bairros.json');

if (!fs.existsSync(LEADS_FILE)) fs.writeFileSync(LEADS_FILE, JSON.stringify([], null, 2));
if (!fs.existsSync(STATUS_FILE)) fs.writeFileSync(STATUS_FILE, JSON.stringify({ completed: [] }, null, 2));

const getCompletedNeighborhoods = () => JSON.parse(fs.readFileSync(STATUS_FILE)).completed;

const saveStatus = (neighborhood) => {
    try {
        const data = JSON.parse(fs.readFileSync(STATUS_FILE));
        if (!data.completed.includes(neighborhood)) {
            data.completed.push(neighborhood);
            fs.writeFileSync(STATUS_FILE, JSON.stringify(data, null, 2));
            console.log(`[STATUS] Neighborhood ${neighborhood} completed.`);
        }
    } catch (err) {
        console.error(`Error saving neighborhood status:`, err);
    }
};

const saveLead = (lead) => {
    try {
        const leads = JSON.parse(fs.readFileSync(LEADS_FILE));
        const exists = leads.find(l => 
            (l.phone && lead.phone && l.phone === lead.phone) || 
            (l.name === lead.name)
        );

        if (!exists) {
            leads.push(lead);
            fs.writeFileSync(LEADS_FILE, JSON.stringify(leads, null, 2));
            console.log(`[+] Lead saved: ${lead.name}`);
        }
    } catch (err) {
        console.error(`Error saving lead:`, err);
    }
};

module.exports = {
    delay,
    humanType,
    sanitizePhone,
    saveLead,
    saveStatus,
    getCompletedNeighborhoods
};
