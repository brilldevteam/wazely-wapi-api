import cron from 'node-cron';
import { syncCurrencyTableRates } from '../utils/currency.service.js';

// Keep the exchange rates in Super Admin -> Currencies up to date automatically.
const runSync = async (reason) => {
    try {
        const { updated, missing, skipped } = await syncCurrencyTableRates();
        if (skipped) {
            console.log(`[CurrencyRates] ${reason}: skipped (${skipped})`);
        } else {
            console.log(`[CurrencyRates] ${reason}: ${updated} rate(s) updated${missing.length ? `; no live rate for ${missing.join(', ')}` : ''}`);
        }
    } catch (error) {
        console.error(`[CurrencyRates] ${reason} failed:`, error?.message || error);
    }
};

async function currencyRatesCronService() {
    // Once shortly after start-up, then every day at 03:00 server time.
    setTimeout(() => runSync('startup'), 30 * 1000);
    cron.schedule('0 3 * * *', () => runSync('daily'));
    console.log('Currency exchange rate sync cron job scheduled.');
}

export default currencyRatesCronService;
