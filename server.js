require('dotenv').config(); // Allows using .env file for secrets
const express = require('express');
const path = require('path');
const axios = require('axios');
const cors = require('cors');
const nodemailer = require('nodemailer');
const mongoose = require('mongoose'); // Database tool
const yahooFinance = require('yahoo-finance2').default;

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// --- CONFIGURATION (Use Environment Variables) ---
const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI; 
const FINNHUB_API_KEY = process.env.FINNHUB_API_KEY; 
const EMAIL_USER = process.env.EMAIL_USER;
const EMAIL_PASS = process.env.EMAIL_PASS;
const YOUR_EMAIL = process.env.YOUR_EMAIL;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// --- DATABASE CONNECTION ---
mongoose.connect(MONGO_URI, {
    serverSelectionTimeoutMS: 5000 // Fail after 5 seconds if can't connect
})
.then(() => console.log('✅ Connected to MongoDB'))
.catch(err => console.error('❌ MongoDB Error:', err));

// Define the "Shape" of our data
const AlertSchema = new mongoose.Schema({
    id: Number,
    ticker: String,
    price: String,
    condition: String,
    description: String,
    triggered: { type: Boolean, default: false }
});

const Alert = mongoose.model('Alert', AlertSchema);

// --- EMAIL SETUP ---
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: EMAIL_USER, pass: EMAIL_PASS },
    tls: { rejectUnauthorized: false }
});

// --- ROUTES ---

app.post('/api/sync-alerts', async (req, res) => {
    const receivedGroups = req.body; 
    let incomingAlerts = [];
    
    // Flatten incoming data
    Object.keys(receivedGroups).forEach(group => {
        const items = receivedGroups[group];
        items.forEach(item => incomingAlerts.push(item));
    });

    // 1. Upsert incoming alerts
    for (const item of incomingAlerts) {
        const existing = await Alert.findOne({ id: item.id });
        if (!existing) {
            await Alert.create(item);
        } else {
            existing.ticker = item.ticker;
            existing.price = item.price;
            existing.description = item.description;
            await existing.save();
        }
    }
    
    // 2. CLEANUP: Remove manual alerts from the database if you deleted them in the UI.
    const incomingIds = incomingAlerts.map(a => a.id);
    await Alert.deleteMany({ 
        id: { $nin: incomingIds }, 
        description: { $ne: 'Altucher 9.5% Drop' } // Protects Altucher alerts from accidental deletion
    });

    res.json({ success: true });
});

// --- ALTUCHER STRATEGY AUTOMATION ---
const NDQ_100 = [
    'ADBE','AMD','ABNB','ALNY','GOOGL','GOOG','AMZN','AEP','AMGN','ADI','AAPL','AMAT','APP',
    'ARM','ASML','ADSK','ADP','AXON','BKR','BKNG','AVGO','CDNS','CHTR','CTAS','CSCO','CCEP',
    'CTSH','CMCSA','CEG','CPRT','CSGP','COST','CRWD','CSX','DDOG','DXCM','FANG','DASH','EA',
    'EXC','FAST','FER','FTNT','GEHC','GILD','HON','IDXX','INSM','INTC','INTU','ISRG','KDP',
    'KLAC','KHC','LRCX','LIN','MAR','MRVL','MELI','META','MCHP','MU','MSFT','MSTR','MDLZ',
    'MPWR','MNST','NFLX','NVDA','NXPI','ORLY','ODFL','PCAR','PLTR','PANW','PAYX','PYPL',
    'PDD','PEP','QCOM','REGN','ROP','ROST','SNDK','STX','SHOP','SBUX','SNPS','TMUS','TTWO',
    'TSLA','TXN','TRI','VRSK','VRTX','WMT','WBD','WDC','WDAY','XEL','ZS'
];

// New route to let the frontend load alerts directly from MongoDB
app.get('/api/alerts', async (req, res) => {
    try {
        const alerts = await Alert.find();
        res.json(alerts);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// New route to generate the Altucher alerts
// --- HELPER FUNCTION WITH AUTO-RETRY ON 429 ---
async function fetchQuoteWithRetry(ticker, apiKey, maxRetries = 3) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const response = await axios.get(`https://finnhub.io/api/v1/quote?symbol=${ticker}&token=${apiKey}`);
            return response.data;
        } catch (err) {
            if (err.response && err.response.status === 429) {
                console.warn(`⚠️ Rate limited (429) on ${ticker}. Pausing 10s for credits to replenish (Attempt ${attempt}/${maxRetries})...`);
                await new Promise(resolve => setTimeout(resolve, 10000)); // Wait 10 seconds on 429
            } else {
                console.error(`Error fetching ${ticker}:`, err.message);
                break; // Non-429 error (invalid symbol, network down), stop retrying this ticker
            }
        }
    }
    return null;
}

// --- ALTUCHER STRATEGY VIA YAHOO FINANCE (BULK FETCH) ---
app.post('/api/generate-altucher', async (req, res) => {
    // Respond immediately to the frontend
    res.json({ message: "Generating alerts from Yahoo Finance..." });

    console.log("⚡ Starting Altucher 9.5% Alert Generation via Yahoo Finance...");
    
    try {
        // Clear old Altucher alerts
        await Alert.deleteMany({ description: 'Altucher 9.5% Drop' });

        // Fetch all 100 quotes in ONE batch request
        const results = await yahooFinance.quote(NDQ_100);

        let count = 0;
        for (const stock of results) {
            // regularMarketPreviousClose gives yesterday's official close
            const prevClose = stock.regularMarketPreviousClose || stock.regularMarketPrice;

            if (prevClose && prevClose > 0) {
                const targetPrice = (prevClose * 0.905).toFixed(2);
                await Alert.create({
                    id: Date.now() + count,
                    ticker: stock.symbol,
                    price: targetPrice,
                    condition: 'below',
                    description: 'Altucher 9.5% Drop',
                    triggered: false
                });
                count++;
            }
        }

        console.log(`✅ Successfully generated ${count}/${NDQ_100.length} Altucher alerts in 2 seconds!`);

    } catch (err) {
        console.error("❌ Error fetching bulk quotes from Yahoo Finance:", err.message);
    }
});

// --- RETRY MISSING ALERTS ONLY ---
app.post('/api/retry-altucher', async (req, res) => {
    const { tickers } = req.body;
    if (!tickers || !Array.isArray(tickers)) {
        return res.status(400).json({ error: "No tickers provided" });
    }

    const estimatedTime = Math.ceil((tickers.length * 1.5) / 60);
    res.json({ message: `Retry started for ${tickers.length} stocks. Will take ~${estimatedTime} minute(s).` });
    
    console.log(`🔄 Retrying ${tickers.length} missing Altucher alerts...`);

    for (let i = 0; i < tickers.length; i++) {
        const ticker = tickers[i];
        const quoteData = await fetchQuoteWithRetry(ticker, FINNHUB_API_KEY);

        if (quoteData && quoteData.pc && quoteData.pc > 0) {
            const targetPrice = (quoteData.pc * 0.905).toFixed(2);
            await Alert.create({
                id: Date.now() + i,
                ticker: ticker,
                price: targetPrice,
                condition: 'below',
                description: 'Altucher 9.5% Drop',
                triggered: false
            });
        }
        
        await new Promise(resolve => setTimeout(resolve, 1500));
    }
    console.log("✅ Finished retrying missing alerts.");
});

// --- MONITORING LOOP ---

async function checkPrices() {
    try {
        // 1. Get Untriggered Alerts
        const pendingAlerts = await Alert.find({ triggered: false });
        if (pendingAlerts.length === 0) return;

        console.log(`--- Checking ${pendingAlerts.length} pending alerts ---`);

        for (const alert of pendingAlerts) {
            // Fetch Price
            let currentPrice = 0;
            try {
                const response = await axios.get(`https://finnhub.io/api/v1/quote?symbol=${alert.ticker}&token=${FINNHUB_API_KEY}`);
                currentPrice = response.data.c;
            } catch (err) {
                console.error(`API Error for ${alert.ticker}: ${err.message}`);
                continue; 
            }

            // Check Condition
            let shouldTrigger = false;
            if (alert.condition === 'above' && currentPrice > parseFloat(alert.price)) shouldTrigger = true;
            else if (alert.condition === 'below' && currentPrice < parseFloat(alert.price)) shouldTrigger = true;

            if (shouldTrigger) {
                console.log(`⚡ Condition met for ${alert.ticker}. Attempting to lock...`);

                // --- ATOMIC LOCK (The Fix) ---
                // We try to find the alert AND flip it to true in one split-second operation.
                // MongoDB guarantees only one request can do this.
                const result = await Alert.updateOne(
                    { id: alert.id, triggered: false }, // Only update if still false
                    { triggered: true }
                );

                if (result.modifiedCount === 1) {
                    // We won the race! We are the only one sending the alert.
                    console.log(`🚨 TRIGGERED & LOCKED: ${alert.ticker} (Price: ${currentPrice})`);
                    
                    try { await sendEmail(alert.ticker, currentPrice, alert.price, alert.condition); } catch(e) { console.error("Email failed", e); }
                    try { await sendTelegram(alert.ticker, currentPrice, alert.price, alert.condition); } catch(e) { console.error("Telegram failed", e); }
                    
                } else {
                    // Someone else (another loop) beat us to it. Do nothing.
                    console.log(`⚠️ ${alert.ticker} was already handled by another loop. Skipping.`);
                }
            }
        }
    } catch (error) {
        console.error("Critical Loop Error:", error);
    }
}

async function sendEmail(ticker, current, target, condition) {
    const mailOptions = {
        from: EMAIL_USER,
        to: YOUR_EMAIL,
        subject: `🚨 Price Alert: ${ticker}`,
        text: `The price of ${ticker} is now $${current}.\nTarget: ${condition} $${target}`
    };
    try { await transporter.sendMail(mailOptions); } catch (e) {}
}

async function sendTelegram(ticker, current, target, condition) {
    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;
    const message = `🚨 <b>${ticker} ALERT</b>\n\nPrice is now: <b>$${current}</b>\nTarget: ${condition} $${target}`;
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    try { await axios.post(url, { chat_id: TELEGRAM_CHAT_ID, text: message, parse_mode: 'HTML' }); } catch (e) {}
}

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Start Server
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    setInterval(checkPrices, 60000); // Check every minute
});