const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const nodemailer = require('nodemailer');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY || 'cheia_ta_secreta_stripe_aici');

const app = express();
app.use(express.json());
app.use(cors());

app.use(express.static(__dirname));

// Conectare la MongoDB Atlas
const MONGO_URI = process.env.MONGO_URI || 'mongodb+srv://iulianpopa433_db_user:asP2WUlGA60i95AU@cluster0.sfkeudx.mongodb.net/homematch-miami?retryWrites=true&w=majority&appName=Cluster0';

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
    streetAddress: String,
    zip: String,
    unlocked: { type: Boolean, default: false }
});

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
                    from: '"HomeMatch Miami" <noreply@homematchmiami.com>',
                    to: pro.email,
                    subject: 'Abonamentul tău HomeMatch Miami expiră în curând!',
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
                    from: '"HomeMatch Miami" <noreply@homematchmiami.com>',
                    to: pro.email,
                    subject: 'Abonamentul tău HomeMatch Miami a expirat',
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
                            name: `HomeMatch Miami - Plan ${plan}`,
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
        const newLead = new Lead(req.body);
        await newLead.save();
        res.status(201).json(newLead);
    } catch (err) {
        res.status(500).json({ error: 'Error creating lead' });
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

// Endpoint Stripe pentru deblocarea unui lead contra sumei de $15
app.post('/api/create-checkout-session', async (req, res) => {
    try {
        const { leadId } = req.body;
        const lead = await Lead.findById(leadId);
        
        if (!lead) {
            return res.status(404).json({ error: 'Lead-ul nu a fost găsit.' });
        }

        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: [
                {
                    price_data: {
                        currency: 'usd',
                        product_data: {
                            name: `HomeMatch Miami - Unlock Lead (${lead.service})`,
                            description: `Deblocare adresă și contact pentru cererea din ${lead.address}`,
                        },
                        unit_amount: 1500, // $15.00
                    },
                    quantity: 1,
                },
            ],
            mode: 'payment',
            success_url: `https://homematch-miami.onrender.com/index.html?success=true&leadId=${leadId}`,
            cancel_url: `https://homematch-miami.onrender.com/index.html?canceled=true`,
        });

        res.json({ url: session.url });
    } catch (err) {
        console.error('Erore Stripe Checkout Lead:', err);
        res.status(500).json({ error: 'Erore la generarea sesiunii de plată.' });
    }
});

// Endpoint pentru deblocarea efectivă a datelor după plata Stripe
app.post('/api/leads/:id/unlock', async (req, res) => {
    try {
        const lead = await Lead.findByIdAndUpdate(req.params.id, { unlocked: true }, { new: true });
        res.json({ success: true, lead });
    } catch (err) {
        res.status(500).json({ error: 'Erore la deblocarea lead-ului' });
    }
});

// Endpoint pentru contorul de vizite
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Serverul rulează pe portul, ${PORT}`));