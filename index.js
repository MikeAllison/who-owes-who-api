const admin = require('firebase-admin');
const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());

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
    auth_provider_x509_cert_url: process.env.GOOGLE_AUTH_PROVIDER_X509_CERT_URL,
    client_x509_cert_url: process.env.GOOGLE_CLIENT_X509_CERT_URL
  })
});
const db = admin.firestore();

// Collection - Cards
//// Docs - Each Card
////// Collection - Transactions
//////// Doc - Each Transaction

const cardsRef = db.collection('cards');

app.get('/cards', async (req, res) => {
  try {
    const cardQuerySnapshot = await cardsRef.get();
    const cards = [];

    cardQuerySnapshot.forEach(card => {
      cards.push({ id: card.id, data: card.data() });
    });

    res.status(200).json({ cards });
  } catch (err) {
    console.log(err);
    req.status(500).send({ error: 'There was a problem with the request' });
  }
});

app.get('/cards/:cardId/transactions', async (req, res) => {
  try {
    const transactionsRef = cardsRef
      .doc(req.params.cardId)
      .collection('transactions');

    const transactionsQuerySnapshot = await transactionsRef.get();
    const transactions = [];

    transactionsQuerySnapshot.forEach(transaction => {
      transactions.push({ id: transaction.id, data: transaction.data() });
    });

    res.status(200).json({ transactions });
  } catch (err) {
    console.log(err);
    req.status(500).send({ error: 'There was a problem with the request' });
  }
});

app.listen(process.env.PORT, () => {
  console.log(`Listening on port ${process.env.PORT}`);
});
