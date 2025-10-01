const twilio = require("twilio");
const admin = require("firebase-admin");
const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");

try {
  admin.initializeApp({
    credential: admin.credential.cert({
      type: process.env.GOOGLE_ACCOUNT_TYPE,
      project_id: process.env.GOOGLE_PROJECT_ID,
      private_key_id: process.env.GOOGLE_PRIVATE_KEY_ID,
      private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
      client_email: process.env.GOOGLE_CLIENT_EMAIL,
      client_id: process.env.GOOGLE_CLIENT_ID,
      auth_uri: process.env.GOOGLE_AUTH_URI,
      token_uri: process.env.GOOGLE_TOKEN_URI,
      auth_provider_x509_cert_url:
        process.env.GOOGLE_AUTH_PROVIDER_X509_CERT_URL,
      client_x509_cert_url: process.env.GOOGLE_CLIENT_X509_CERT_URL,
    }),
  });
} catch (err) {
  console.log(`There was a problem authenticating to Firestore: ${err}`);
  return;
}

// Firestore
const firestore = admin.firestore();
const usersCollection = firestore.collection("users");
const cardsCollection = firestore.collection("cards");
const merchantsCollection = firestore.collection("merchants");

const CORS_ORIGIN = process.env.CORS_ORIGIN;
const CORS_GET = {
  origin: [CORS_ORIGIN],
  methods: ["GET"],
};
const CORS_POST = {
  origin: [CORS_ORIGIN],
  methods: ["POST"],
};

const app = express();

// HTTPS redirect
if (process.env.NODE_ENV === "production") {
  app.enable("trust proxy");
  app.use((req, res, next) => {
    req.secure ? next() : res.redirect("https://" + req.headers.host + req.url);
  });
}

app.options(["/api/cards", "/api/merchants"], cors(CORS_GET));
app.options(["/api/auth", "/api/transactions"], cors(CORS_POST));
app.use(express.json());

const verifyAuth = async (req, res, next) => {
  const authToken = req.headers.authorization.split(" ")[1];
  let user = null;
  let decodedToken = null;

  if (!authToken || authToken === "null") {
    res.sendStatus(401);
    return;
  }

  try {
    try {
      decodedToken = jwt.verify(authToken, process.env.JWT_TOKEN_SECRET);
    } catch (err) {
      console.log(err);
      res.sendStatus(401);
      return false;
    }

    const userQuery = usersCollection.doc(`${decodedToken.verificationPhone}`);
    const userQueryResults = await userQuery.get();

    if (!userQueryResults.exists) {
      throw new Error("Account Does Not Exist");
    }

    user = userQueryResults.data();
  } catch (err) {
    console.log(err);
    res.sendStatus(401);
    return;
  }

  if (authToken !== user.authToken) {
    res.sendStatus(401);
    return;
  }

  next();
};

// ***********
//  GET /auth
// ***********
app.get("/api/auth", cors(CORS_GET), async (req, res) => {
  const userQuery = usersCollection.doc(`${process.env.VERIFICATION_PHONE}`);
  let user;

  try {
    userQueryResults = await userQuery.get();

    if (!userQueryResults.exists) {
      throw new Error("Account Does Not Exist");
    }

    user = userQueryResults.data();
  } catch (err) {
    console.log(err);
    res.sendStatus(404);
    return;
  }

  try {
    if (user.failedAuthAttempts >= +process.env.LOCKOUT_THRESHOLD) {
      throw new Error("Account Locked - Skipping Twilio Request");
    }
  } catch (err) {
    console.log(err);
    res.sendStatus(403);
    return;
  }

  try {
    const client = new twilio(
      process.env.TWILIO_ACCT_SID,
      process.env.TWILIO_AUTH_TOKEN
    );

    await client.verify.v2
      .services(`${process.env.TWILIO_SERVICE_ID}`)
      .verifications.create({
        to: `+${process.env.VERIFICATION_PHONE}`,
        channel: "sms",
      })
      .catch((err) => {
        console.log(err);
        return false;
      });
  } catch (err) {
    console.log(err);
    res.sendStatus(500);
    return;
  }

  res.sendStatus(200);
});

// ************
//  POST /auth
// ************
app.post("/api/auth", cors(CORS_POST), async (req, res) => {
  const userQuery = usersCollection.doc(`${process.env.VERIFICATION_PHONE}`);
  let user;

  try {
    userQueryResults = await userQuery.get();

    if (!userQueryResults.exists) {
      throw new Error("Account Does Not Exist");
    }

    user = userQueryResults.data();
  } catch (err) {
    console.log(err);
    res.sendStatus(404);
    return;
  }

  try {
    if (user.failedAuthAttempts >= +process.env.LOCKOUT_THRESHOLD) {
      throw new Error("Account Locked");
    }
  } catch (err) {
    console.log(err);
    res.sendStatus(403);
    return;
  }

  try {
    const client = new twilio(
      process.env.TWILIO_ACCT_SID,
      process.env.TWILIO_AUTH_TOKEN
    );

    await client.verify.v2
      .services(`${process.env.TWILIO_SERVICE_ID}`)
      .verificationChecks.create({
        to: `+${process.env.VERIFICATION_PHONE}`,
        code: `${req.body.verificationCode}`,
      })
      .then((verification_check) => {
        if (verification_check.status !== "approved") {
          throw new Error("Authentication Failed");
        }
        // TO-DO: RESET FAILED AUTH ATTEMPTS
        //userQuery.update((user.failedAuthAttempts = 0));
      })
      .catch((err) => {
        console.log(err);
        throw new Error("Authentication Failed");
      });
  } catch (err) {
    console.log(err);
    await userQuery.update({
      failedAuthAttempts: (user.failedAuthAttempts += 1),
    });
    res.sendStatus(403);
    return;
  }

  const authToken = jwt.sign(
    {
      verificationPhone: process.env.VERIFICATION_PHONE,
    },
    `${process.env.JWT_TOKEN_SECRET}`,
    {
      expiresIn: 600,
    }
  );

  try {
    await userQuery.update({ authToken: authToken });
  } catch (err) {
    console.log(err);
    res.sendStatus(500);
    return;
  }

  res.send({ authToken: authToken });
});

// ************
//  GET /cards
// ************
app.get("/api/cards", [cors(CORS_GET), verifyAuth], async (req, res) => {
  const cards = [];

  try {
    const cardsQueryResults = await cardsCollection
      .where("active", "==", true)
      .get();

    cardsQueryResults.forEach((card) => {
      cards.push({
        id: card.id,
        cardholder: card.data().cardholder,
        cardholderInitials: card.data().cardholderInitials,
      });
    });
  } catch (err) {
    res.status(500).send({ error: err.message });
    return;
  }

  res.status(200).json(cards);
});

// ****************
//  GET /merchants
// ****************
app.get("/api/merchants", [cors(CORS_GET), verifyAuth], async (req, res) => {
  const merchants = [];

  try {
    const merchantsQueryResults = await merchantsCollection.get();

    merchantsQueryResults.forEach((merchant) => {
      merchants.push({ id: merchant.id, name: merchant.data().name });
    });
  } catch (err) {
    res.status(500).send({ error: err.message });
    return;
  }

  res.status(200).json(merchants);
});

// *******************
//  GET /transactions
// *******************
app.get("/api/transactions", [cors(CORS_GET), verifyAuth], async (req, res) => {
  const transactions = [];

  // First, add all cards to transactions
  try {
    const cardsQueryResults = await cardsCollection.get();

    cardsQueryResults.forEach((card) => {
      transactions.push({
        cardId: card.id,
        cardholder: card.data().cardholder,
        transactions: [],
      });
    });
  } catch (err) {
    res.status(500).send({ error: err.message });
    return;
  }

  // Second, add all transactions to each card in transactions
  try {
    for (const card of transactions) {
      const cardTransactionsQuery = cardsCollection
        .doc(card.cardId)
        .collection("transactions")
        .where("archived", "==", false);

      const transactionsQueryResults = await cardTransactionsQuery.get();

      transactionsQueryResults.forEach((transaction) => {
        card.transactions.push({
          id: transaction.id,
          merchantName: transaction.data().merchantName,
          amount: transaction.data().amount,
          enteredDate: transaction.data().enteredDate.toDate(),
          archived: transaction.data().archived,
        });
      });
    }
  } catch (err) {
    res.status(500).send({ error: err.message });
    return;
  }

  res.status(200).json(transactions);
});

// ********************
//  POST /transactions
// ********************
app.post(
  "/api/transactions",
  [cors(CORS_POST), verifyAuth],
  async (req, res) => {
    // TODO: Figure out how to deal with toFixed rounding
    const transaction = {
      merchantName: req.body.merchantName.replace(/\s+/g, " ").trim(),
      amount: +req.body.amount.toFixed(2),
      cardId: req.body.cardId.trim(),
    };

    // Input validation
    try {
      if (!transaction.merchantName) {
        throw new Error("Missing Merchant");
      }
      if (!transaction.amount) {
        throw new Error("Missing Amount");
      }
      if (!transaction.amount > 0) {
        throw new Error("Amount Must Be More Than $0");
      }
      if (isNaN(transaction.amount)) {
        throw new Error("Amount Is Not A Number");
      }
      if (!transaction.cardId) {
        throw new Error("Missing Card ID");
      }
    } catch (err) {
      res.status(500).send({ error: err.message });
      return;
    }

    // Save the transaction
    try {
      await firestore.runTransaction(async (t) => {
        // Verify card exists
        const cardRef = cardsCollection.doc(transaction.cardId);

        const cardQueryResults = await t.get(cardRef);

        if (!cardQueryResults.exists) {
          throw new Error(`Card ${transaction.cardId} does not exist`);
        }

        // Check merchant-table for merchant
        // If necessary, add merchant to merchant-table
        const merchantQueryResults = await t.get(
          merchantsCollection.where("name", "==", transaction.merchantName)
        );

        if (merchantQueryResults.empty) {
          await t.set(merchantsCollection.doc(), {
            name: transaction.merchantName,
          });
        }

        // Save transaction
        await t.set(cardRef.collection("transactions").doc(), {
          merchantName: transaction.merchantName,
          amount: transaction.amount,
          enteredDate: admin.firestore.Timestamp.now(),
          archived: false,
        });
      });
    } catch (err) {
      res.status(500).send({ error: err.message });
      return;
    }

    // Check to see if transactions can be archived
    try {
      await firestore.runTransaction(async (t) => {
        const tally = new Map();

        // For each card, add the cardholder (and card ID) to the map
        const cardsQueryResults = await t.get(cardsCollection);

        cardsQueryResults.forEach((card) => {
          if (!tally.has(card.data().cardholder)) {
            tally.set(card.data().cardholder, {
              cardIds: [],
              transactionTotal: 0,
            });
          }

          tally.get(card.data().cardholder).cardIds.push(card.id);
        });

        // For each cardholder's card, in the tally...
        // ...get each non-archived transaction...
        // ...tally it to their entry in the map
        for (const cardholder of tally) {
          for (const cardId of cardholder[1].cardIds) {
            const activeTransactionsQuery = cardsCollection
              .doc(cardId)
              .collection("transactions")
              .where("archived", "==", false);

            const transactionsQueryResults = await t.get(
              activeTransactionsQuery
            );

            transactionsQueryResults.forEach((transaction) => {
              cardholder[1].transactionTotal += transaction.data().amount;
            });
          }
        }

        // Check for even transaction totals
        const allTransactionTotals = [];

        tally.forEach((cardholder) => {
          allTransactionTotals.push(cardholder.transactionTotal);
        });

        // TODO: If the difference is also < or > 0.01, archive all transactions
        // If all transactions are even...
        if (allTransactionTotals.every((val, i, arr) => val === arr[0])) {
          // Collect an array of active transactions [{ transactionId: 'ABC123XYZ', cardId: 1234 }]
          activeTransactions = [];

          for (const cardholder of tally) {
            for (const cardId of cardholder[1].cardIds) {
              const activeTransactionsQuery = cardsCollection
                .doc(cardId)
                .collection("transactions")
                .where("archived", "==", false);

              const transactionsQueryResults = await t.get(
                activeTransactionsQuery
              );

              transactionsQueryResults.forEach((transaction) => {
                activeTransactions.push({
                  transactionId: transaction.id,
                  cardId: cardId,
                });
              });
            }
          }

          // Update the DB for each transaction in activeTransactions array
          for (const transaction of activeTransactions) {
            const transactionRef = cardsCollection
              .doc(transaction.cardId)
              .collection("transactions")
              .doc(transaction.transactionId);

            await t.update(transactionRef, { archived: true });
          }
        }
      });
    } catch (err) {
      res.status(500).send({ error: err.message });
      return;
    }

    res.sendStatus(201);
  }
);

app.listen(process.env.PORT, () => {
  console.log(`Listening on port ${process.env.PORT}`);
});
