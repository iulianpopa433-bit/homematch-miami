const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const app = express();
app.use(cors());
app.use(express.json());

app.use(express.static(path.join(__dirname)));

// Sistem real de stocare a vizitelor într-un fișier local
const VISITS_FILE = path.join(__dirname, 'visits.json');

function getVisits() {
    try {
        if (fs.existsSync(VISITS_FILE)) {
            const data = fs.readFileSync(VISITS_FILE, 'utf8');
            return JSON.parse(data).totalVisits || 150;
        }
    } catch (e) {
        console.error('Eroare citire vizite:', e);
    }
    return 150;
}

function saveVisits(count) {
    try {
        fs.writeFileSync(VISITS_FILE, JSON.stringify({ totalVisits: count }));
    } catch (e) {
        console.error('Eroare salvare vizite:', e);
    }
}

let totalVisits = getVisits();
let leads = [];

// Rută contor vizite real
app.get('/api/secret-stats', (req, res) => {
    totalVisits++;
    saveVisits(totalVisits);
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

// Rută Stripe Checkout sigură
app.post('/api/create-checkout-session', async (req, res) => {
    try {
        const { leadId } = req.body;
        if (!process.env.STRIPE_SECRET_KEY) {
            return res.status(500).json({ error: 'Stripe secret key is not configured on server.' });
        }

        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: [{
                price_data: {
                    currency: 'usd',
                    product_data: {
                        name: 'Unlock Emergency Lead Contact Info - HomeMatch Miami',
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
        console.error('Stripe error detaliat:', err.message);
        res.status(500).json({ error: err.message });
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`Serverul rulează pe portul ${PORT}`);
});