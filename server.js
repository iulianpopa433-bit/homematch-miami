const express = require('express');
const cors = require('cors');
const path = require('path');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const app = express();
app.use(cors());
app.use(express.json());

// Servire fișiere statice
app.use(express.static(path.join(__dirname)));

// Baza de date în memorie (sau baza ta curentă)
let leads = [];
let totalVisits = 120; // sau pornește de la ce valoare dorești

// Rută contor vizite
app.get('/api/secret-stats', (req, res) => {
    totalVisits++;
    res.json({ totalVisits });
});

// Rute pentru Lead-uri
app.get('/api/leads', (req, res) => {
    res.json(leads);
});

app.post('/api/leads', (req, res) => {
    const newLead = {
        _id: Date.now().toString(),
        service: req.body.service,
        contactInfo: req.body.contactInfo,
        description: req.body.description,
        address: req.body.address,
        zip: req.body.zip,
        unlocked: false
    };
    leads.unshift(newLead);
    res.status(201).json(newLead);
});

app.delete('/api/leads/:id', (req, res) => {
    leads = leads.filter(l => l._id !== req.params.id);
    res.json({ success: true });
});

app.post('/api/leads/:id/unlock', (req, res) => {
    const lead = leads.find(l => l._id === req.params.id);
    if (lead) {
        lead.unlocked = true;
        res.json({ success: true });
    } else {
        res.status(404).json({ error: 'Lead not found' });
    }
});

// Rută Stripe Checkout
app.post('/api/create-checkout-session', async (req, res) => {
    try {
        const { leadId } = req.body;
        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: [{
                price_data: {
                    currency: 'usd',
                    product_data: {
                        name: 'Unlock Emergency Lead Contact Info',
                    },
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
        console.error('Stripe error:', err);
        res.status(500).json({ error: err.message });
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`Serverul rulează pe portul ${PORT}`);
});