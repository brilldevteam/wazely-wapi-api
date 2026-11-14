import axios from 'axios';
import Currency from '../models/currency.model.js';

/**
 * Exchange rates for showing prices in the visitor's chosen currency.
 *
 * 1. Live daily rates (open.er-api.com, 166 currencies incl. QAR, AED, SAR),
 *    all fetched in one request against USD and cached for 12 hours.
 * 2. If that service is unavailable or lacks a currency: the rates set in
 *    Super Admin -> Currencies (stored as "units per 1 USD").
 * The old provider (frankfurter.app) did not support QAR and silently fell
 * back to a rate of 1, so prices only changed symbol, never value.
 *
 * Display only: plan prices are still saved and charged in their own currency.
 */
const LIVE_RATES_URL = 'https://open.er-api.com/v6/latest/USD';
const LIVE_TTL_MS = 12 * 60 * 60 * 1000;
const LIVE_RETRY_MS = 10 * 60 * 1000; // after a failed fetch, wait before trying again
const ADMIN_TTL_MS = 5 * 60 * 1000;

let liveRates = null;          // { rates: { USD: 1, QAR: 3.64, ... }, expiry }
let liveFetch = null;          // in-flight request, shared by concurrent callers
let liveRetryAfter = 0;
let adminRates = null;         // { rates: { QAR: 3.65, ... }, expiry }

const getLiveRates = async () => {
    if (liveRates && liveRates.expiry > Date.now()) return liveRates.rates;
    if (Date.now() < liveRetryAfter) return liveRates?.rates || null;
    if (!liveFetch) {
        liveFetch = axios.get(LIVE_RATES_URL, { timeout: 8000 })
            .then((response) => {
                const rates = response?.data?.result === 'success' ? response.data.rates : null;
                if (!rates || !rates.USD) throw new Error('unexpected response');
                liveRates = { rates, expiry: Date.now() + LIVE_TTL_MS };
                return rates;
            })
            .catch((error) => {
                console.error('[currency] Live exchange rates unavailable, using Admin rates:', error?.message || error);
                liveRetryAfter = Date.now() + LIVE_RETRY_MS;
                return liveRates?.rates || null; // keep using the last good rates if we have them
            })
            .finally(() => { liveFetch = null; });
    }
    return liveFetch;
};

const getAdminRates = async () => {
    if (adminRates && adminRates.expiry > Date.now()) return adminRates.rates;
    try {
        const list = await Currency.find({ deleted_at: null }).select('code exchange_rate').lean();
        const rates = {};
        for (const c of list) {
            const r = Number(c.exchange_rate);
            if (c.code && r > 0) rates[String(c.code).toUpperCase()] = r;
        }
        adminRates = { rates, expiry: Date.now() + ADMIN_TTL_MS };
        return rates;
    } catch (error) {
        console.error('[currency] Could not read Admin currency rates:', error?.message || error);
        return adminRates?.rates || {};
    }
};

// Both tables are "units per 1 USD", so from -> to = rate[to] / rate[from].
const crossRate = (rates, fromCode, toCode) => {
    const f = Number(rates?.[fromCode]);
    const t = Number(rates?.[toCode]);
    return f > 0 && t > 0 ? t / f : null;
};

export const getExchangeRate = async (from, to) => {
    if (!from || !to) return 1;

    const fromCode = String(from).toUpperCase();
    const toCode = String(to).toUpperCase();
    if (fromCode === toCode) return 1;

    const live = crossRate(await getLiveRates(), fromCode, toCode);
    if (live) return live;

    const admin = crossRate(await getAdminRates(), fromCode, toCode);
    if (admin) return admin;

    console.warn(`[currency] No exchange rate for ${fromCode} -> ${toCode} (add it in Super Admin -> Currencies). Showing the original amount.`);
    return 1;
};
export const formatAmount = (amount) => {
    if (amount === null || amount === undefined) return 0;
    const num = Number(amount);
    if (isNaN(num)) return 0;

    const parts = num.toString().split('.');
    if (parts.length > 1 && parts[1].length > 3) {
        return Number(num.toFixed(2));
    }
    return num;
};
