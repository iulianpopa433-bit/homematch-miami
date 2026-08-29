const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const app = express();
app.use(cors());
app.use(express.json());

// Conectare MongoDB
mongoose.connect(process.env.MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
}).then(() => console.log('MongoDB Connected'))
  .catch(err => console.log('MongoDB Connection Error:', err));

// Schematizare Bază de Date pentru Lead-uri
const leadSchema = new mongoose.Schema({
    service: String,
    clientName: String,
    contactInfo: String,
    description: String,
    address: String,
    streetAddress: String,
    zip: String,
    unlocked: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now }
});
const Lead = mongoose.model('Lead', leadSchema);

// Schematizare pentru Contor Vizite
const statsSchema = new mongoose.Schema({
    totalVisits: { type: Number, default: 0 }
});
const Stats = mongoose.model('Stats', statsSchema);

// Middleware pentru contorizarea automată a vizitelor
app.use(async (req, res, next) => {
    if (req.path.startsWith('/api')) {
        try {
            let stats = await Stats.findOne();
            if (!stats) {
                stats = new Stats({ totalVisits: 1 });
            } else {
                stats.totalVisits += 1;
            }
            await stats.save();
        } catch (err) {
            console.error('Stats error:', err);
        }
    }
    next();
});

// Rute pentru Lead-uri
app.get('/api/leads', async (req, res) => {
    try {
        const leads = await Lead.find().sort({ createdAt: -1 });
        res.json(leads);
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/leads', async (req, res) => {
    try {
        const newLead = new Lead(req.body);
        await newLead.save();
        res.status(201).json(newLead);
    } catch (err) {
        res.status(500).json({ error: 'Failed to create lead' });
    }
});

app.delete('/api/leads/:id', async (req, res) => {
    try {
        await Lead.findByIdAndDelete(req.params.id);
        res.json({ message: 'Lead deleted successfully' });
    } catch (err) {
        res.status(500).json({ error: 'Failed to delete lead' });
    }
});

app.post('/api/leads/:id/unlock', async (req, res) => {
    try {
        const lead = await Lead.findByIdAndUpdate(req.params.id, { unlocked: true }, { new: true });
        res.json(lead);
    } catch (err) {
        res.status(500).json({ error: 'Failed to unlock lead' });
    }
});

// Rută Stripe Checkout pentru deblocare Lead ($15)
app.post('/api/create-checkout-session', async (req, res) => {
    const { leadId } = req.body;
    try {
        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: [{
                price_data: {
                    currency: 'usd',
                    product_data: { name: 'Unlock Emergency Lead Contact & Address' },
                    unit_amount: 1500, // 15.00 USD
                },
                quantity: 1,
            }],
            mode: 'payment',
            success_url: `https://homematch-miami.onrender.com/?success=true&leadId=${leadId}`,
            cancel_url: `https://homematch-miami.onrender.com/?success=false`,
        });
        res.json({ url: session.url });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Rută Stripe Checkout pentru Abonamente Contractori ($10, $20, $40, $80)
app.post('/api/create-subscription-session', async (req, res) => {
    const { planType, price } = req.body;
    
    let planName = 'Pro Membership';
    if (planType === '1_month') planName = 'Starter Pro Plan (1 Month)';
    if (planType === '3_months') planName = 'Quarterly Pro Plan (3 Months)';
    if (planType === '6_months') planName = 'Semi-Annual Pro Plan (6 Months)';
    if (planType === '1_year') planName = 'Annual Pro Plan (1 Year)';

    try {
        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: [{
                price_data: {
                    currency: 'usd',
                    product_data: { name: planName },
                    unit_amount: price * 100, // transformat în cenți (ex: 10 devine 1000)
                },
                quantity: 1,
            }],
            mode: 'payment', // Poți folosi 'subscription' dacă setezi prețurile recurente direct în Stripe Dashboard
            success_url: `https://homematch-miami.onrender.com/?sub_success=true`,
            cancel_url: `https://homematch-miami.onrender.com/?sub_success=false`,
        });
        res.json({ url: session.url });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Rută pentru preluarea numărului de vizite
app.get('/api/secret-stats', async (req, res) => {
    try {
        let stats = await Stats.findOne();
        if (!stats) {
            stats = new Stats({ totalVisits: 1 });
            await stats.save();
        }
        res.json({ totalVisits: stats.totalVisits });
    } catch (err) {
        res.status(500).json({ error: 'Stats error' });
    }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));