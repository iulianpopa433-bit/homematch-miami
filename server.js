const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const app = express();
app.use(cors());
app.use(express.json());

// Permite afișarea fișierelor statice (index.html)
app.use(express.static(__dirname));

// Conectare sigură la MongoDB Atlas
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('MongoDB Connected Successfully'))
  .catch(err => console.log('MongoDB Connection Error:', err));

// ==========================================
// 1. SCHEME BAZĂ DE DATE
// ==========================================

// Schematizare Lead-uri (Clienți care cer servicii)
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

// Schematizare pentru Firme / Meseriași (Director pe categorii)
const proSchema = new mongoose.Schema({
    name: { type: String, required: true },
    category: { type: String, required: true }, // ex: 'plumbing', 'hvac', 'electrical', 'remodeling', 'roofing', 'pools'
    email: { type: String, required: true },
    phone: { type: String, required: true },
    address: { type: String, required: true },
    // Status abonament bazat pe zile plătite (30, 60, 120)
    subscriptionExpiresAt: { type: Date, default: null },
    packageDays: { type: Number, default: 30 },
    createdAt: { type: Date, default: Date.now }
});
const Pro = mongoose.model('Pro', proSchema);

// Schematizare Contor Vizite
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

// ==========================================
// 2. RUTE PENTRU FIRME / MESERIAȘI (PROS)
// ==========================================

// Obține doar firmele active dintr-o anumită categorie (ale căror abonamente nu au expirat)
app.get('/api/pros/:category', async (req, res) => {
    try {
        const category = req.params.category;
        const currentDate = new Date();

        // Găsește doar firmele care au abonamentul valabil (data de expirare > acum)
        const activePros = await Pro.find({
            category: category,
            subscriptionExpiresAt: { $gt: currentDate }
        }).sort({ createdAt: -1 });

        res.json(activePros);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch pros' });
    }
});

// Înregistrare firmă nouă (înainte de plată sau adăugată din admin)
app.post('/api/pros', async (req, res) => {
    try {
        const newPro = new Pro(req.body);
        await newPro.save();
        res.status(201).json(newPro);
    } catch (err) {
        res.status(500).json({ error: 'Failed to create pro' });
    }
});

// ==========================================
// 3. RUTE PENTRU LEAD-URI
// ==========================================

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

// ==========================================
// 4. RUTE STRIPE CHECKOUT (PREȚURI DE MIAMI)
// ==========================================

// Rută Stripe Checkout pentru deblocare Lead ($15) sau Deblocare Contact Firmă ($4)
app.post('/api/create-checkout-session', async (req, res) => {
    const { leadId, type, amount, itemName } = req.body;
    
    // Setăm valorile implicite pentru lead dacă nu sunt trimise
    const finalAmount = amount ? amount * 100 : 1500; // ex: $15 sau $4 în cenți
    const name = itemName || 'Unlock Emergency Lead Contact & Address';

    try {
        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: [{
                price_data: {
                    currency: 'usd',
                    product_data: { name: name },
                    unit_amount: finalAmount,
                },
                quantity: 1,
            }],
            mode: 'payment',
            success_url: `https://homematch-miami.onrender.com/?success=true&leadId=${leadId || ''}`,
            cancel_url: `https://homematch-miami.onrender.com/?success=false`,
        });
        res.json({ url: session.url });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Rută Stripe Checkout pentru Abonamente Firme (Pachete practice Miami: 30z-$49, 60z-$129, 120z-$229)
app.post('/api/create-subscription-session', async (req, res) => {
    const { planType, proId } = req.body;
    
    let planName = 'Pro Membership';
    let priceInCents = 4900; // $49 implicit (30 zile)
    let daysToAdd = 30;

    if (planType === '30_days') {
        planName = 'Miami Pro Plan (30 Days)';
        priceInCents = 4900; // $49
        daysToAdd = 30;
    } else if (planType === '60_days') {
        planName = 'Miami Pro Plan (60 Days)';
        priceInCents = 12900; // $129
        daysToAdd = 60;
    } else if (planType === '120_days') {
        planName = 'Miami Pro Plan (120 Days)';
        priceInCents = 22900; // $229
        daysToAdd = 120;
    }

    try {
        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: [{
                price_data: {
                    currency: 'usd',
                    product_data: { name: planName },
                    unit_amount: priceInCents,
                },
                quantity: 1,
            }],
            mode: 'payment',
            success_url: `https://homematch-miami.onrender.com/?sub_success=true&proId=${proId || ''}&days=${daysToAdd}`,
            cancel_url: `https://homematch-miami.onrender.com/?sub_success=false`,
        });
        res.json({ url: session.url });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Rută pentru prelungirea automată a abonamentului după plata cu succes
app.post('/api/pros/:id/extend-subscription', async (req, res) => {
    try {
        const days = parseInt(req.body.days) || 30;
        const expiryDate = new Date();
        expiryDate.setDate(expiryDate.getDate() + days);

        const pro = await Pro.findByIdAndUpdate(
            req.params.id, 
            { subscriptionExpiresAt: expiryDate, packageDays: days }, 
            { new: true }
        );
        res.json(pro);
    } catch (err) {
        res.status(500).json({ error: 'Failed to update subscription' });
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

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));