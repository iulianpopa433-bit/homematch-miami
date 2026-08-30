const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const nodemailer = require('nodemailer');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY || 'cheia_ta_secreta_stripe_aici');

const app = express();
app.use(express.json());
app.use(cors());

app.use(express.static(__dirname));

// Conectare la MongoDB folosind string-ul standard (fără query SRV, pentru a evita orice blocaj DNS)
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

// Schema pentru Lead-uri cu stări complete
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

// Funcție automată de Business Matching
async function matchLeadWithContractors(lead) {
    try {
        const matchingPros = await Contractor.find({
            category: lead.service,
            neighborhood: lead.neighborhood,
            expiresAt: { $gt: new Date() }
        });
        console.log(`[MATCHING] S-au găsit ${matchingPros.length} firme eligibile pentru lead-ul ${lead._id} în ${lead.neighborhood}`);
        return matchingPros;
    } catch (err) {
        console.error('Erore la business matching:', err);
    }
}

// Funcție automată: trimite reminder și șterge firmele expirate
async function checkSubscriptionsAndNotify() {
    try {
        const now = new Date();
        const threeDaysFromNow = new Date();
        threeDaysFromNow.setDate(now.getDate() + 3);

        const expiringSoon = await Contractor.find({
            expiresAt: { $lte: threeDaysFromNow, $gt: now },
            reminderSent: false
        });

        for (const pro of expiringSoon) {
            if (pro.email) {
                await transporter.sendMail({
                    from: '"MiamiMarket.ai" <noreply@miamimarket.ai>',
                    to: pro.email,
                    subject: 'Abonamentul tău MiamiMarket.ai expiră în curând!',
                    text: `Salut ${pro.name}, abonamentul tău pentru categoria ${pro.category} expiră pe ${pro.expiresAt.toLocaleDateString()}. Reînnoiește-l pentru a nu pierde vizibilitatea în Miami!`
                });
                pro.reminderSent = true;
                await pro.save();
            }
        }

        const expiredPros = await Contractor.find({ expiresAt: { $lt: now } });
        for (const pro of expiredPros) {
            if (pro.email) {
                await transporter.sendMail({
                    from: '"MiamiMarket.ai" <noreply@miamimarket.ai>',
                    to: pro.email,
                    subject: 'Abonamentul tău MiamiMarket.ai a expirat',
                    text: `Salut ${pro.name}, perioada plătită a expirat și reclama ta a fost eliminată din director.`
                });
            }
            await Contractor.findByIdAndDelete(pro._id);
        }
    } catch (err) {
        console.error('Erore la verificarea abonamentelor:', err);
    }
}

setInterval(checkSubscriptionsAndNotify, 12 * 60 * 60 * 1000);

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

app.post('/api/create-subscription-session', async (req, res) => {
    try {
        const { name, category, neighborhood, description, phone, email, plan, amount } = req.body;

        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: [
                {
                    price_data: {
                        currency: 'usd',
                        product_data: {
                            name: `MiamiMarket.ai - Plan ${plan}`,
                            description: `${category} listing for ${name} in ${neighborhood}`,
                        },
                        unit_amount: amount * 100,
                    },
                    quantity: 1,
                },
            ],
            mode: 'payment',
            success_url: `https://homematch-miami.onrender.com/register.html?success=true`,
            cancel_url: `https://homematch-miami.onrender.com/register.html?canceled=true`,
            metadata: {
                name,
                category,
                neighborhood,
                description,
                phone,
                email,
                planType: plan,
                pricePaid: amount
            }
        });

        res.json({ url: session.url });
    } catch (err) {
        console.error('Erore Stripe Checkout:', err);
        res.status(500).json({ error: 'Erore la generarea sesiunii de plată Stripe.' });
    }
});

app.post('/api/save-contractor-subscription', async (req, res) => {
    try {
        const { name, category, neighborhood, description, phone, email, planType, price } = req.body;
        const expiresAt = calculateExpirationDate(planType);

        const newContractor = new Contractor({
            name,
            category,
            neighborhood,
            description,
            phone,
            email,
            planType,
            pricePaid: price,
            expiresAt,
            reminderSent: false
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

        res.status(201).json({ 
            success: true, 
            leadId: newLead._id, 
            message: 'Lead creat cu succes.' 
        });
    } catch (err) {
        console.error('Erore salvare lead:', err);
        res.status(500).json({ success: false, error: 'Error creating lead' });
    }
});

app.delete('/api/leads/:id', async (req, res) => {
    try {
        await Lead.findByIdAndDelete(req.params.id);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Error deleting lead' });
    }
});

app.post('/create-checkout-session', async (req, res) => {
    try {
        const { leadId, productType } = req.body;
        let unitAmount = 0;
        let productName = '';
        let productDescription = '';
        let metadata = {};

        if (leadId) {
            const lead = await Lead.findById(leadId);
            if (!lead) {
                return res.status(404).json({ error: 'Lead-ul nu a fost găsit.' });
            }

            unitAmount = 1500;
            productName = `MiamiMarket.ai - Unlock Lead (${lead.service})`;
            productDescription = `Deblocare adresă și contact pentru cererea din ${lead.neighborhood || lead.address}`;
            metadata = { leadId: lead._id.toString(), type: 'lead_unlock' };
        } 
        else if (productType === 'featured') {
            unitAmount = 3900;
            productName = 'MiamiMarket.ai - Featured Listing';
            productDescription = 'Vizibilitate sporită în directorul local.';
            metadata = { type: 'subscription_featured' };
        } else if (productType === 'pro') {
            unitAmount = 14900;
            productName = 'MiamiMarket.ai - Pro Agency Plan';
            productDescription = 'Lead-uri constante și prioritate maximă.';
            metadata = { type: 'subscription_pro' };
        } else {
            return res.status(400).json({ error: 'Parametri insuficienți sau tip de produs invalid.' });
        }

        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: [
                {
                    price_data: {
                        currency: 'usd',
                        product_data: {
                            name: productName,
                            description: productDescription,
                        },
                        unit_amount: unitAmount,
                    },
                    quantity: 1,
                },
            ],
            mode: 'payment',
            success_url: `https://homematch-miami.onrender.com/index.html?success=true${leadId ? '&leadId=' + leadId : ''}`,
            cancel_url: `https://homematch-miami.onrender.com/index.html?canceled=true`,
            metadata: metadata
        });

        res.json({ id: session.id, url: session.url });
    } catch (err) {
        console.error('Erore Stripe Checkout:', err);
        res.status(500).json({ error: 'Erore la generarea sesiunii de plată.' });
    }
});

app.post('/api/leads/:id/unlock', async (req, res) => {
    try {
        const lead = await Lead.findByIdAndUpdate(
            req.params.id, 
            { status: 'UNLOCKED', unlocked: true }, 
            { new: true }
        );
        res.json({ success: true, lead });
    } catch (err) {
        res.status(500).json({ error: 'Erore la deblocarea lead-ului' });
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