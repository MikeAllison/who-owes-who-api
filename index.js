const admin = require('firebase-admin');
//const serviceAccount = require('./creds/who-owes-who-314822-d8d337365ea0.json');
const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;
app.use(cors());

admin.initializeApp({
  credential: admin.credential.cert(
    JSON.parse(
      Buffer.from(process.env.FIRESTORE_CONFIG, 'base64').toString('ascii')
    )
  )
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

app.listen(PORT, () => {
  console.log(`Listening at http://localhost:3000`);
});
