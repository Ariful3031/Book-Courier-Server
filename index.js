const express = require('express')
const cors = require('cors');
const app = express();
require('dotenv').config()
const port = process.env.PORT || 3000

const crypto = require("crypto");

function generateTrackingId() {
    const prefix = "PRCL";
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, ""); // YYYYMMDD
    const random = crypto.randomBytes(3).toString("hex").toUpperCase(); // 6 random chars

    return `${prefix}-${date}-${random}`;
}
const stripe = require('stripe')(process.env.STRIPE_SECRET);

const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');


// middleware
app.use(express.json());
app.use(cors());


const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@simple-crud-server.30cfyeq.mongodb.net/?appName=simple-crud-server`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

async function run() {
    try {
        // Connect the client to the server	(optional starting in v4.7)
        await client.connect();


        const db = client.db('book_courier');
        const booksCollection = db.collection('books');
        const ordersCollection = db.collection('orders');
        const paymentCollection = db.collection('payments');
        const userCollection = db.collection('users');
        const librarianCollection = db.collection('librarian');

        // librarian related api

        app.get('/librarians', async (req, res) => {
            const query = {};
            if (req.query.status) {
                query.status = req.query.status;
            }
            const cursor = librarianCollection.find(query);
            const result = await cursor.toArray();
            res.send(result);
        })
        app.post('/librarians', async (req, res) => {
            const librarian = req.body;
            librarian.status = 'pending';
            librarian.createAt = new Date();

            const result = await librarianCollection.insertOne(librarian);
            res.send(result);
        })

        app.patch('/librarians/:id', async (req, res) => {
            const id = req.params.id
            const status = req.body.status;
            const query = { _id: new ObjectId(id) };
            const UpdateDoc = {
                $set: {
                    status: status
                }
            }
            const result = await librarianCollection.updateOne(query, UpdateDoc);
             if(status==='approved'){
                const email= req.body.email;
                const useQuery = {email};
                const updateUser={
                    $set:{
                        role: 'librarian'
                    }
                }
                const userResult = await userCollection.updateOne(useQuery,updateUser);
             }
            res.send(result);
        })


        // User Related api
        app.post('/users', async (req, res) => {
            const user = req.body;
            user.role = "user";
            user.createAt = new Date();

            const email = user.email;
            const userExists = await userCollection.findOne({ email });

            if (userExists) {
                return res.send({ message: 'user already exists' });
            }
            const result = await userCollection.insertOne(user);
            res.send(result);
        })


        // Orders Related api
        app.get('/orders', async (req, res) => {
            const query = {};
            const { email } = req.query;
            if (email) {
                query.email = email;
            }

            const cursor = ordersCollection.find(query);
            const result = await cursor.toArray();
            res.send(result)

        })

        app.get('/orders/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) }
            const result = await ordersCollection.findOne(query)
            res.send(result)
        })
        app.post('/orders', async (req, res) => {
            const order = req.body;
            const result = await ordersCollection.insertOne(order);
            res.send(result);

        })

        // books api

        app.get('/books', async (req, res) => {
            const query = {}

            const cursor = booksCollection.find(query)
            const result = await cursor.toArray();
            res.send(result)

        })

        app.get('/books/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const result = await booksCollection.findOne(query);
            res.send(result)
        })


        app.post('/books', async (req, res) => {
            const book = req.body;
            const result = await booksCollection.insertOne(book)
            res.send(result)
        })


        // payment related task
        app.post('/payment-checkout-session', async (req, res) => {
            const paymentInfo = req.body;
            const amount = parseInt(paymentInfo.price) * 100;

            const session = await stripe.checkout.sessions.create({
                line_items: [
                    {
                        price_data: {
                            currency: 'USD',
                            unit_amount: amount,
                            product_data: {
                                name: `please pay for:${paymentInfo.bookTitle}`
                            }
                        },
                        quantity: 1,
                    },
                ],
                mode: 'payment',
                metadata: {
                    orderId: paymentInfo.orderId,
                    orderName: paymentInfo.orderName,
                },
                customer_email: paymentInfo.customer_email,
                success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
                cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cancelled`,
                expand: ['payment_intent'],
            });

            console.log(session)



            res.send({ url: session.url })

        });

        app.patch('/payment-success', async (req, res) => {
            const sessionId = req.query.session_id;
            //   console.log('session id', sessionId);
            const session = await stripe.checkout.sessions.retrieve(sessionId);

            // console.log('session reterieve', session)
            const transactionId = session.payment_intent;
            const query = { transactionId: transactionId }

            const paymentExist = await paymentCollection.findOne(query);
            console.log(paymentExist)
            if (paymentExist) {
                return res.send({ message: 'already exists', transactionId, trackingId: paymentExist.trackingId })
            }

            const trackingId = generateTrackingId();
            if (session.payment_status === 'paid') {
                const id = session.metadata.orderId;
                const query = { _id: new ObjectId(id) }
                const update = {
                    $set: {
                        paymentStatus: 'paid',
                        status: 'complete',
                        // paidAt: new Date(),
                        trackingId: trackingId
                    }
                }
                const result = await ordersCollection.updateOne(query, update)

                // payment entry
                const payment = {
                    amount: session.amount_total / 100,
                    currency: session.currency,
                    customer_email: session.customer_email,
                    orderId: session.metadata.orderId,
                    orderName: session.metadata.orderName,
                    transactionId: session.payment_intent,
                    paymentStatus: session.payment_status,
                    status: session.status,
                    paidAt: new Date(),
                    trackingId: trackingId
                }

                if (session.payment_status === 'paid') {

                    const resultPayment = await paymentCollection.insertOne(payment)
                    res.send({
                        success: true,
                        modifyOrder: result,
                        trackingId: trackingId,
                        transactionId: session.payment_intent,
                        paymentInfo: resultPayment
                    })
                }
            }
            res.send({ success: false })
        })

        //Payment related api

        app.get('/payments', async (req, res) => {
            const email = req.query.email;
            const query = {}
            if (email) {
                query.customer_email = email;
            }
            const cursor = paymentCollection.find(query).sort({ paidAt: -1 })
            const result = await cursor.toArray();
            res.send(result);
        })

        // Send a ping to confirm a successful connection
        await client.db("admin").command({ ping: 1 });
        console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {
        // Ensures that the client will close when you finish/error
        // await client.close();
    }
}
run().catch(console.dir);


app.get('/', (req, res) => {
    res.send('Booking Courier is Running!')
})

app.listen(port, () => {
    console.log(`Example app listening on port ${port}`)
})


