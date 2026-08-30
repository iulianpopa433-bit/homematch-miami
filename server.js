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

// Conectare la MongoDB (folosind string-ul standard direct)
const MONGO_URI = process.env.MONGO_URI || 'mongodb://iulianpopa433_db_user:asP2WUlGA60i95AU@cluster0-shard-00-00.sfkeudx.mongodb.net:27017,cluster0-shard-00-01.sfkeudx.mongodb.net:27017,cluster0-shard-00-02.sfkeudx.mongodb.net:27017/homematch-miami?ssl=true&replicaSet=atlas-13o681-shard-0&authSource=admin&retryWrites=true&w=majority';

mongoose.connect(MONGO_URI)
    .then(() => console.log('Conectat la MongoDB cu succes!'))
    .catch(err => console.error('Erore la conectarea MongoDB:', err));

// Configurare transportator email (Nodemailer)
const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.mailtrap.io',
    port: process.env.SMTP_PORT || 2525,
    auth: {
        user: process.env.SMTP_USER || 'user',
        pass: process.env.SMTP_PASS || 'pass'
    }
});

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
    contactInfo: String,
    description: String,
    address: String,
    neighborhood: String,
    zip: String,
    status: { 
        type: String, 
        enum: ['NEW', 'PAID', 'UNLOCKED', 'CONTACTED', 'CONVERTED'], 
        default: 'NEW' 
    },
    unlockedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Contractor', default: null }
}, { timestamps: true });

const Lead = mongoose.model('Lead', leadSchema);

// Schema pentru Contor Vizite
const statsSchema = new mongoose.Schema({ pageViews: { type: Number, default: 1240 } });
const Stats = mongoose.model('Stats', statsSchema);

// Funcție pentru calcularea datei de expirare
function calculateExpirationDate(planType) {
    const date = new Date();
    if (planType === '1_month') date.setMonth(date.getMonth() + 1);
    else if (planType === '3_months') date.setMonth(date.getMonth() + 3);
    else if (planType === '6_months') date.setMonth(date.getMonth() + 6);
    else if (planType === '1_year') date.setFullYear(date.getFullYear() + 1);
    else date.setDate(date.getDate() + 30);
    return date;
}

// Funcție de Business Matching
async function matchLeadWithContractors(lead) {
    try {
        const matchingPros = await Contractor.find({
            category: lead.service,
            neighborhood: lead.neighborhood,
            expiresAt: { $gt: new Date() }
        });
        return matchingPros;
    } catch (err) {
        console.error('Erore la business matching:', err);
    }
}

// --- ENDPOINT-URI API ---

app.get('/api/contractors', async (req, res) => {
    try {
        const { category } = req.query;
        const now = new Date();
        await Contractor.deleteMany({ expiresAt: { $lt: now } });

        let query = {};
        if (category) query.category = category;

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
            name, category, neighborhood, description, phone, email, planType, pricePaid: price, expiresAt, reminderSent: false
        });

        await newContractor.save();
        res.json({ success: true, message: 'Abonament activat cu succes!', expiresAt });
    } catch (err) {
        res.status(500).json({ error: 'Erore la salvarea abonamentului' });
    }
});

app.get('/api/leads', async (req, res) => {
    try {
        const leads = await Lead.find();
        res.json(leads);
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
        matchLeadWithContractors(newLead);

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

const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => console.log(`Serverul rulează pe portul ${PORT} 🚀`));