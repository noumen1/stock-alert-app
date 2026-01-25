require('dotenv').config(); // Allows using .env file for secrets
const express = require('express');
const path = require('path');
const axios = require('axios');
const cors = require('cors');
const nodemailer = require('nodemailer');
const mongoose = require('mongoose'); // Database tool

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

    console.log(`Received ${incomingAlerts.length} alerts from frontend.`);

    // SYNC LOGIC:
    // We loop through incoming alerts. If one exists in DB, we keep its 'triggered' status.
    // If it's new, we add it. 
    // (Note: For a simple app, we will just upsert based on ID)
    
    for (const item of incomingAlerts) {
        // Try to find it
        const existing = await Alert.findOne({ id: item.id });
        
        if (!existing) {
            // Create new
            await Alert.create(item);
        } else {
            // Update details (description/price) but DON'T overwrite 'triggered' if it's true
            // If the user changed the target price, maybe we should reset triggered? 
            // For now, let's keep it simple: Only update text fields.
            existing.ticker = item.ticker;
            existing.price = item.price;
            existing.description = item.description;
            await existing.save();
        }
    }
    
    // Optional: Remove alerts from DB that are no longer in the frontend list
    // (Skipping for complexity, but good to know)

    res.json({ success: true });
});

// --- MONITORING LOOP ---

async function checkPrices() {
    try {
        // 1. Get Untriggered Alerts
        const pendingAlerts = await Alert.find({ triggered: false });
        if (pendingAlerts.length === 0) return;

        console.log(`--- Checking ${pendingAlerts.length} pending alerts ---`);

        for (const alert of pendingAlerts) {
            console.log(`Checking ${alert.ticker}...`);
            
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
                console.log(`🚨 TRIGGERED: ${alert.ticker} (Price: ${currentPrice})`);
                
                // Send Notifications (don't let these crash the loop)
                try { await sendEmail(alert.ticker, currentPrice, alert.price, alert.condition); } catch(e) { console.error("Email failed", e); }
                try { await sendTelegram(alert.ticker, currentPrice, alert.price, alert.condition); } catch(e) { console.error("Telegram failed", e); }
                
                // UPDATE DB
                console.log(`Saving state for ${alert.ticker}...`);
                alert.triggered = true;
                await alert.save(); 
                console.log(`✅ Save successful for ${alert.ticker}`);
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