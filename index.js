const admin = require('firebase-admin');
const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
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

app.get('/cards', async (req, res) => {
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

app.get('/merchants', async (req, res) => {
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

app.post('/transactions', async (req, res) => {
  // Input validation
  try {
    if (!req.body.merchantName) {
      throw new Error('Missing Merchant');
    }

    if (!req.body.amount) {
      throw new Error('Missing Amount');
    }

    req.body.amount = +req.body.amount;
    if (isNaN(req.body.amount)) {
      throw new Error('Amount Is Not A Number');
    }

    if (!req.body.cardId) {
      throw new Error('Missing Card ID');
    }
  } catch (err) {
    res.status(500).send({ error: err.message });
  }

  // TODO: Should be a transaction that can be rolled back
  try {
    // Add new merchant to merchant-table if it doesn't exist
    const snapshot = await merchantsRef
      .where('name', '==', req.body.merchantName)
      .get();
    if (snapshot.empty) {
      await db.collection('merchants').add({ name: req.body.merchantName });
    }

    // Check for card
    const cardRef = db.collection('cards').doc(req.body.cardId);
    const card = await cardRef.get();
    if (!card.exists) {
      throw new Error(`Card ${req.body.cardId} doesn't exist`);
    }

    // Save transaction
    await cardRef.collection('transactions').add({
      amount: req.body.amount,
      archived: false,
      enteredDate: admin.firestore.Timestamp.now(),
      merchantName: req.body.merchantName
    });
  } catch (err) {
    res.status(500).send({ error: err.message });
  }

  res.status(200).json(req.body);
});

app.get('/transactions/active', async (req, res) => {
  const activeTransactions = [];

  // First, add all cards to activeTransactions
  try {
    const cardQuerySnapshot = await cardsRef.get();
    cardQuerySnapshot.forEach(card => {
      activeTransactions.push({
        cardId: card.id,
        cardholder: card.data().cardholder,
        transactions: []
      });
    });
  } catch (err) {
    res.status(500).send({ error: err.message });
  }

  // Second, add all transactions to each card in activeTransactions
  try {
    for (const card of activeTransactions) {
      const transactionsRef = cardsRef
        .doc(card.cardId)
        .collection('transactions')
        .where('archived', '==', false);
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

  res.status(200).json(activeTransactions);
});

app.listen(process.env.PORT, () => {
  console.log(`Listening on port ${process.env.PORT}`);
});
