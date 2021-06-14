const admin = require('firebase-admin');
const express = require('express');
const cors = require('cors');

const CORS_ORIGINS = [
  'http://127.0.0.1:8080',
  'https://who-owes-who.5apps.com'
];
const CORS_GET = {
  origin: CORS_ORIGINS,
  methods: ['GET']
};
const CORS_POST = {
  origin: CORS_ORIGINS,
  methods: ['POST']
};

const app = express();
app.options('/transactions', cors(CORS_POST));
app.use(express.json());

try {
  admin.initializeApp({
    credential: admin.credential.cert({
      type: process.env.GOOGLE_ACCOUNT_TYPE,
      project_id: process.env.GOOGLE_PROJECT_ID,
      private_key_id: process.env.GOOGLE_PRIVATE_KEY_ID,
      private_key: process.env.GOOGLE_PRIVATE_KEY,
      client_email: process.env.GOOGLE_CLIENT_EMAIL,
      client_id: process.env.GOOGLE_CLIENT_ID,
      auth_uri: process.env.GOOGLE_AUTH_URI,
      token_uri: process.env.GOOGLE_TOKEN_URI,
      auth_provider_x509_cert_url:
        process.env.GOOGLE_AUTH_PROVIDER_X509_CERT_URL,
      client_x509_cert_url: process.env.GOOGLE_CLIENT_X509_CERT_URL
    })
  });
} catch (err) {
  console.log('There was a problem authenticating to Firestore');
  console.log(err);
}

// Firestore
const db = admin.firestore();
const cardsRef = db.collection('cards');
const merchantsRef = db.collection('merchants');

// ************
//  GET /cards
// ************
app.get('/cards', cors(CORS_GET), async (req, res, next) => {
  const cards = [];

  try {
    const cardQuerySnapshot = await cardsRef.get();

    cardQuerySnapshot.forEach(card => {
      cards.push({ id: card.id, cardholder: card.data().cardholder });
    });
  } catch (err) {
    res.status(500).send({ error: err.message });
  }

  res.status(200).json(cards);
});

// ****************
//  GET /merchants
// ****************
app.get('/merchants', cors(CORS_GET), async (req, res, next) => {
  const merchants = [];

  try {
    const merchantQuerySnapshot = await merchantsRef.get();

    merchantQuerySnapshot.forEach(merchant => {
      merchants.push({ id: merchant.id, name: merchant.data().name });
    });
  } catch (err) {
    res.status(500).send({ error: err.message });
  }

  res.status(200).json(merchants);
});

// *******************
//  GET /transactions
// *******************
app.get('/transactions', cors(CORS_GET), async (req, res, next) => {
  const transactions = [];

  // First, add all cards to transactions
  try {
    const cardQuerySnapshot = await cardsRef.get();
    cardQuerySnapshot.forEach(card => {
      transactions.push({
        cardId: card.id,
        cardholder: card.data().cardholder,
        transactions: []
      });
    });
  } catch (err) {
    res.status(500).send({ error: err.message });
  }

  // Second, add all transactions to each card in transactions
  const now = new Date();
  const [month, day, year] = [now.getMonth(), now.getDate(), now.getFullYear()];
  // Workaround for 0-based months in JS
  if (month === 0) {
    month = 12;
    year -= 1;
  }
  const queryDate = new Date(year, month - 1, day);

  try {
    for (const card of transactions) {
      const transactionsRef = cardsRef
        .doc(card.cardId)
        .collection('transactions')
        .where('enteredDate', '>=', queryDate);
      const transactionsQuerySnapshot = await transactionsRef.get();

      transactionsQuerySnapshot.forEach(transaction => {
        card.transactions.push({
          id: transaction.id,
          merchantName: transaction.data().merchantName,
          amount: transaction.data().amount,
          enteredDate: transaction.data().enteredDate.toDate(),
          archived: transaction.data().archived
        });
      });
    }
  } catch (err) {
    res.status(500).send({ error: err.message });
  }

  res.status(200).json(transactions);
});

// ********************
//  POST /transactions
// ********************
app.post('/transactions', cors(CORS_POST), async (req, res, next) => {
  // TODO: Figure out how to deal with toFixed rounding
  const transaction = {
    merchantName: req.body.merchantName.replace(/\s+/g, ' ').trim(),
    amount: +req.body.amount.toFixed(2),
    cardId: req.body.cardId.trim()
  };

  // Input validation
  try {
    if (!transaction.merchantName) {
      throw new Error('Missing Merchant');
    }

    if (!transaction.amount) {
      throw new Error('Missing Amount');
    }

    if (isNaN(transaction.amount)) {
      throw new Error('Amount Is Not A Number');
    }

    if (!transaction.cardId) {
      throw new Error('Missing Card ID');
    }
  } catch (err) {
    res.status(500).send({ error: err.message });
  }

  try {
    await db.runTransaction(async t => {
      // Check merchant-table for merchant
      const snapshot = await t.get(
        merchantsRef.where('name', '==', transaction.merchantName)
      );

      // Verify card exists
      const cardRef = db.collection('cards').doc(transaction.cardId);
      const card = await t.get(cardRef);
      if (!card.exists) {
        throw new Error(`Card ${transaction.cardId} doesn't exist`);
      }

      // If necessary, add merchant to merchant-table
      // Firestore transaction requires reads first, then writes
      if (snapshot.empty) {
        await t.set(db.collection('merchants').doc(), {
          name: transaction.merchantName
        });
      }

      // Save transaction
      await t.set(cardRef.collection('transactions').doc(), {
        merchantName: transaction.merchantName,
        amount: transaction.amount,
        enteredDate: admin.firestore.Timestamp.now(),
        archived: false
      });
    });
  } catch (err) {
    res.status(500).send({ error: err.message });
  }

  res.status(200).send();
});

app.listen(process.env.PORT, () => {
  console.log(`Listening on port ${process.env.PORT}`);
});
