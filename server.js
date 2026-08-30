const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const nodemailer = require('nodemailer');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY || 'cheia_ta_secreta_stripe_aici');

const app = express();
app.use(express.json());
app.use(cors());

// Servire fișiere statice din folderul curent
app.use(express.static(__dirname));

// Ruta explicită pentru a afișa corect index.html în browser
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

// Conectare la MongoDB
const MONGO_URI = process.env.MONGO_URI || 'mongodb://iulianpopa433_db_user:asP2WUlGA60i95AU@cluster0-shard-00-00.sfkeudx.mongodb.net:27017,cluster0-shard-00-01.sfkeudx.mongodb.net:27017,cluster0-shard-00-02.sfkeudx.mongodb.net:27017/homematch-miami?ssl=true&replicaSet=atlas-13o681-shard-0&authSource=admin&retryWrites=true&w=majority';

mongoose.connect(MONGO_URI)
    .then(() => console.log('Conectat la MongoDB cu succes!'))
    .catch(err => console.error('Erore la conectarea MongoDB:', err));

// Schema pentru Contractor / Firme
const contractorSchema = new mongoose.Schema({
    name: String,
    category: String,
    neighborhood: String,
    description: String,
    phone: String,
    email: String,
    planType: String,
    pricePaid: Number,
    expiresAt: { type: Date, required: true },
    reminderSent: { type: Boolean, default: false }
});
const Contractor = mongoose.model('Contractor', contractorSchema);

// Schema pentru Lead-uri
const leadSchema = new mongoose.Schema({
    service: String,
    clientName: String,
    contactInfo: String, // Telefon/Email ascuns până la plată/abonament
    description: String,
    address: String,
    neighborhood: String,
    zip: String,
    status: { type: String, default: 'NEW' },
    unlockedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Contractor' }]
}, { timestamps: true });
const Lead = mongoose.model('Lead', leadSchema);

// Schema pentru Contor Vizite
const statsSchema = new mongoose.Schema({ pageViews: { type: Number, default: 1240 } });
const Stats = mongoose.model('Stats', statsSchema);

// Funcție calcul expirare abonament
function calculateExpirationDate(planType) {
    const date = new Date();
    if (planType === '1_month') date.setMonth(date.getMonth() + 1);
    else if (planType === '3_months') date.setMonth(date.getMonth() + 3);
    else if (planType === '6_months') date.setMonth(date.getMonth() + 6);
    else if (planType === '1_year') date.setFullYear(date.getFullYear() + 1);
    else date.setDate(date.getDate() + 30);
    return date;
}

// --- ENDPOINT-URI API ---

app.get('/api/contractors', async (req, res) => {
    try {
        const { category } = req.query;
        const now = new Date();
        await Contractor.deleteMany({ expiresAt: { $lt: now } });
        let query = category ? { category } : {};
        const contractors = await Contractor.find(query);
        res.json(contractors);
    } catch (err) {
        res.status(500).json({ error: 'Erore la preluarea contractorilor' });
    }
});

app.post('/api/save-contractor-subscription', async (req, res) => {
    try {
        const { name, category, neighborhood, description, phone, email, planType, price } = req.body;
        const expiresAt = calculateExpirationDate(planType);
        const newContractor = new Contractor({
            name, category, neighborhood, description, phone, email, planType, pricePaid: price, expiresAt
        });
        await newContractor.save();
        res.json({ success: true, message: 'Abonament activat cu succes!', expiresAt });
    } catch (err) {
        res.status(500).json({ error: 'Erore la salvarea abonamentului' });
    }
});

// Preluare lead-uri pentru site (ascundem contactInfo dacă vizitatorul nu este logat/abonat)
app.get('/api/leads', async (req, res) => {
    try {
        const leads = await Lead.find().sort({ createdAt: -1 });
        // Ascundem datele de contact directe pentru afișarea publică
        const sanitizedLeads = leads.map(l => ({
            _id: l._id,
            service: l.service,
            clientName: l.clientName.charAt(0) + '***', // Ex: I***
            contactInfo: '🔒 Ascuns (Necesită Pro Plan sau $15 deblocare)',
            description: l.description,
            neighborhood: l.neighborhood,
            createdAt: l.createdAt
        }));
        res.json(sanitizedLeads);
    } catch (err) {
        res.status(500).json({ error: 'Error fetching leads' });
    }
});

app.post('/api/leads', async (req, res) => {
    try {
        const { service, name, contact, description, address, neighborhood, zip } = req.body;
        const newLead = new Lead({
            service: service || 'General',
            clientName: name,
            contactInfo: contact,
            description: description || '',
            address: address || 'Miami, FL',
            neighborhood: neighborhood || 'Brickell',
            zip: zip || '',
            status: 'NEW'
        });
        await newLead.save();
        res.status(201).json({ success: true, leadId: newLead._id, message: 'Lead creat cu succes.' });
    } catch (err) {
        res.status(500).json({ success: false, error: 'Error creating lead' });
    }
});

app.get('/api/stats', async (req, res) => {
    try {
        let stats = await Stats.findOne();
        if (!stats) {
            stats = new Stats({ pageViews: 1240 });
            await stats.save();
        } else {
            stats.pageViews += 1;
            await stats.save();
        }
        res.json({ visits: stats.pageViews });
    } catch (err) {
        res.status(500).json({ error: 'Erore la statistici' });
    }
});

// Stripe Checkout pentru Abonamente și pentru Deblocare Lead ($15)
app.post('/create-checkout-session', async (req, res) => {
    try {
        const { productType, leadId } = req.body;
        let unitAmount = 3900;
        let productName = 'MiamiMarket.ai - Featured Listing';

        if (productType === 'pro') {
            unitAmount = 14900;
            productName = 'MiamiMarket.ai - Pro Agency Plan';
        } else if (productType === 'unlock_lead') {
            unitAmount = 1500; // $15 pentru deblocare lead unicat
            productName = `MiamiMarket.ai - Unlock Lead #${leadId}`;
        }

        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: [
                {
                    price_data: {
                        currency: 'usd',
                        product_data: { name: productName },
                        unit_amount: unitAmount,
                    },
                    quantity: 1,
                },
            ],
            mode: 'payment',
            success_url: `https://homematch-miami.onrender.com/index.html?success=true`,
            cancel_url: `https://homematch-miami.onrender.com/index.html?canceled=true`,
        });

        res.json({ id: session.id, url: session.url });
    } catch (err) {
        console.error('Erore Stripe:', err);
        res.status(500).json({ error: 'Erore la generarea sesiunii de plată.' });
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => console.log(`Serverul rulează pe portul ${PORT} 🚀`));