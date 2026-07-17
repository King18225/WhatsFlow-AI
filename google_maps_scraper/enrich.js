const fs = require('fs');
const path = require('path');

const LEADS_FILE = path.join(__dirname, 'leads_maps.json');
const OUT_WITH_SITE  = path.join(__dirname, 'leads_com_site.json');
const OUT_WITHOUT_SITE  = path.join(__dirname, 'leads_sem_site.json');

const AGGREGATORS = ['linktree', 'linktr.ee', 'bio.link', 'beacons.ai', 'allmylinks', 'onelink'];
const SOCIAL = ['instagram.com', 'facebook.com', 'wa.me', 'whatsapp', 'twitter', 'tiktok'];

function normalizePhone(phone) {
    if (!phone) return null;
    let digits = phone.replace(/\D/g, '');

    if (digits.startsWith('55') && (digits.length === 12 || digits.length === 13)) {
        return digits;
    }

    if (digits.length === 10 || digits.length === 11) {
        return '55' + digits;
    }

    return digits || null;
}

function classifySite(url) {
    if (!url) return null;
    const lower = url.toLowerCase();
    if (AGGREGATORS.some(a => lower.includes(a))) return 'aggregator';
    if (SOCIAL.some(s => lower.includes(s))) return 'social_network';
    return 'own_website';
}

function enrich() {
    if (!fs.existsSync(LEADS_FILE)) {
        console.error('[ERROR] leads_maps.json not found!');
        process.exit(1);
    }

    const raw = JSON.parse(fs.readFileSync(LEADS_FILE, 'utf8'));
    const withSite  = [];
    const withoutSite  = [];
    let noPhone = 0;

    for (const lead of raw) {
        const phoneNorm = normalizePhone(lead.phone);
        const siteType = classifySite(lead.website);

        const enriched = {
            ...lead,
            phone_raw: lead.phone,
            phone_intl: phoneNorm,
            phone_wa: phoneNorm,
            site_tipo: siteType, // kept for schema compatibility
            tem_site: !!lead.website,
        };

        if (!phoneNorm) noPhone++;

        if (lead.website) {
            withSite.push(enriched);
        } else {
            withoutSite.push(enriched);
        }
    }

    fs.writeFileSync(OUT_WITH_SITE, JSON.stringify(withSite, null, 2));
    fs.writeFileSync(OUT_WITHOUT_SITE, JSON.stringify(withoutSite, null, 2));

    console.log(`[ENRICH] Processed: ${raw.length} | With site: ${withSite.length} | Without site: ${withoutSite.length} | No phone: ${noPhone}`);
}

enrich();
