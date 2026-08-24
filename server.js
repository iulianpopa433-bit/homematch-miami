const express = require('express');
const cors = require('cors');
const stripe = require('stripe')('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');

const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static(__dirname));

let leadsDatabase = [];

// Rute API pentru Lead-uri
app.get('/api/leads', (req, res) => {
    // Curățăm automat lead-urile deblocate acum mai mult de 10 minute (10 * 60 * 1000 ms)
    const now = Date.now();
    leadsDatabase = leadsDatabase.filter(lead => {
        if (lead.unlocked && lead.unlockedAt) {
            return (now - lead.unlockedAt) < 10 * 60 * 1000;
        }
        return true;
    });
    res.json(leadsDatabase);
});

app.post('/api/leads', (req, res) => {
    const newLead = {
        _id: Date.now().toString(),
        ...req.body,
        unlocked: false,
        unlockedAt: null
    };
    leadsDatabase.unshift(newLead);
    res.status(201).json({ message: 'Cerere înregistrată cu succes!', lead: newLead });
});

// Rută de ștergere manuală a unei cereri
app.delete('/api/leads/:id', (req, res) => {
    const leadId = req.params.id;
    const initialLength = leadsDatabase.length;
    leadsDatabase = leadsDatabase.filter(l => l._id !== leadId);
    
    if (leadsDatabase.length < initialLength) {
        res.json({ message: 'Cererea a fost ștersă cu succes!' });
    } else {
        res.status(404).json({ error: 'Cererea nu a fost găsită.' });
    }
});

// Rută Stripe Checkout oficială (LIVE - forțată în limba engleză)
app.post('/api/create-checkout-session', async (req, res) => {
    const { leadId } = req.body;
    const lead = leadsDatabase.find(l => l._id === leadId);

    if (!lead) {
        return res.status(404).json({ error: 'Lead negăsit' });
    }

    try {
        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            locale: 'en',
            line_items: [{
                price_data: {
                    currency: 'usd',
                    product_data: {
                        name: `HomeMatch Miami Lead: ${lead.service}`,
                        description: `Contact & issue details for job in ${lead.address}, ZIP: ${lead.zip}`,
                    },
                    unit_amount: 1500, // 15.00 USD
                },
                quantity: 1,
            }],
            mode: 'payment',
            success_url: `http://localhost:3000?success=true&leadId=${leadId}`,
            cancel_url: `http://localhost:3000?canceled=true`,
        });

        res.json({ url: session.url });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Deblocare lead după plată cu succes și marcare timestamp
app.post('/api/leads/:id/unlock', (req, res) => {
    const leadId = req.params.id;
    let found = null;
    leadsDatabase = leadsDatabase.map(lead => {
        if (lead._id === leadId) {
            lead.unlocked = true;
            lead.unlockedAt = Date.now();
            found = lead;
        }
        return lead;
    });
    
    if (found) {
        res.json({ message: 'Lead deblocat cu succes!', lead: found });
    } else {
        res.status(404).json({ error: 'Lead negăsit' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Serverul rulează în mod LIVE pe http://localhost:${PORT}`);
});