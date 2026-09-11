const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const PORT = process.env.PORT || 3000;
const JWT_SECRET = 'live_calling_secret_key_2026_production';

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ডাটাবেস ইনিশিয়ালাইজেশন
const db = new sqlite3.Database('./database.sqlite', (err) => {
    if (err) console.error('Database Connection Error:', err);
    else console.log('Connected to SQLite Database.');
});

// ডাটাবেস স্কিমা তৈরি
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE,
        phone TEXT UNIQUE,
        password TEXT,
        coins INTEGER DEFAULT 0,
        total_call_seconds INTEGER DEFAULT 0,
        ref_code TEXT UNIQUE,
        referred_by TEXT,
        agency_id INTEGER,
        is_ref_completed INTEGER DEFAULT 0,
        role TEXT DEFAULT 'user',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS calls (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        caller_id INTEGER,
        receiver_id INTEGER,
        start_time INTEGER,
        end_time INTEGER,
        duration_seconds INTEGER,
        coins_awarded INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS withdrawals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        coins_spent INTEGER,
        amount_bdt INTEGER,
        payment_method TEXT,
        account_number TEXT,
        status TEXT DEFAULT 'PENDING',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sender_id INTEGER,
        receiver_id INTEGER,
        message TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // ডিফল্ট সাপোর্ট এডমিন একাউন্ট
    const adminPass = bcrypt.hashSync('admin123', 10);
    db.run(`INSERT OR IGNORE INTO users (id, username, phone, password, role, ref_code) 
            VALUES (1, 'AdminSupport', '01700000000', ?, 'admin', 'ADMIN01')`, [adminPass]);
});

// অথ মিডলওয়্যার
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'লগইন করুন' });

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ error: 'টোকেন মেয়াদোত্তীর্ণ' });
        req.user = user;
        next();
    });
}

// সাইনআপ API
app.post('/api/signup', (req, res) => {
    const { username, phone, password, ref_code } = req.body;
    if (!username || !phone || !password) {
        return res.status(400).json({ error: 'সবগুলো ঘর পূরণ করুন' });
    }

    const hashedPassword = bcrypt.hashSync(password, 10);
    const userRefCode = 'REF' + Math.floor(100000 + Math.random() * 900000);

    db.run(`INSERT INTO users (username, phone, password, ref_code, referred_by) VALUES (?, ?, ?, ?, ?)`,
        [username, phone, hashedPassword, userRefCode, ref_code || null],
        function (err) {
            if (err) {
                return res.status(400).json({ error: 'ইউজারনেম বা ফোন নম্বর ইতিমধ্যে ব্যবহৃত হয়েছে' });
            }
            const token = jwt.sign({ id: this.lastID, username, role: 'user' }, JWT_SECRET);
            res.json({ token, user: { id: this.lastID, username, phone, coins: 0, ref_code: userRefCode } });
        }
    );
});

// লগইন API
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    db.get(`SELECT * FROM users WHERE username = ?`, [username], (err, user) => {
        if (err || !user) return res.status(400).json({ error: 'ভুল ইউজারনেম বা পাসওয়ার্ড' });

        const validPass = bcrypt.compareSync(password, user.password);
        if (!validPass) return res.status(400).json({ error: 'ভুল ইউজারনেম বা পাসওয়ার্ড' });

        const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET);
        res.json({
            token,
            user: {
                id: user.id,
                username: user.username,
                phone: user.phone,
                coins: user.coins,
                ref_code: user.ref_code,
                total_call_seconds: user.total_call_seconds,
                agency_id: user.agency_id
            }
        });
    });
});

// বর্তমান ইউজারের প্রোফাইল
app.get('/api/me', authenticateToken, (req, res) => {
    db.get(`SELECT id, username, phone, coins, total_call_seconds, ref_code, referred_by, agency_id, role FROM users WHERE id = ?`, [req.user.id], (err, user) => {
        if (err || !user) return res.status(404).json({ error: 'ইউজার পাওয়া যায়নি' });
        res.json(user);
    });
});

// হোমপেজের ইউজার তালিকা
app.get('/api/users', authenticateToken, (req, res) => {
    db.all(`SELECT id, username, phone, coins, total_call_seconds FROM users WHERE id != ? AND role != 'admin'`, [req.user.id], (err, rows) => {
        if (err) return res.status(500).json({ error: 'ডাটা লোড করা যায়নি' });
        res.json(rows);
    });
});

// নির্দিষ্ট ইউজারের প্রোফাইল
app.get('/api/users/:id', authenticateToken, (req, res) => {
    db.get(`SELECT id, username, coins, total_call_seconds, ref_code, agency_id FROM users WHERE id = ?`, [req.params.id], (err, user) => {
        if (err || !user) return res.status(404).json({ error: 'ইউজার পাওয়া যায়নি' });
        res.json(user);
    });
});

// কয়েন রিচার্জ
app.post('/api/recharge', authenticateToken, (req, res) => {
    const { coins } = req.body;
    const amount = parseInt(coins);
    if (!amount || amount <= 0) return res.status(400).json({ error: 'সঠিক সংখ্যা দিন' });

    db.run(`UPDATE users SET coins = coins + ? WHERE id = ?`, [amount, req.user.id], (err) => {
        if (err) return res.status(500).json({ error: 'রিচার্জ ব্যর্থ হয়েছে' });
        res.json({ message: 'কয়েন সফলভাবে রিচার্জ হয়েছে' });
    });
});

// উইথড্রল API (শর্ত: ৫০,০০০ কয়েন = ৫,০০০ টাকা, ৫০ মিনিট কল সম্পূর্ণ হতে হবে)
app.post('/api/withdraw', authenticateToken, (req, res) => {
    const { payment_method, account_number } = req.body;

    db.get(`SELECT coins, total_call_seconds FROM users WHERE id = ?`, [req.user.id], (err, user) => {
        if (err || !user) return res.status(500).json({ error: 'ডাটা পাওয়া যায়নি' });

        const minCoins = 50000;
        const minSeconds = 50 * 60; // ৩০০০ সেকেন্ড

        if (user.coins < minCoins) {
            return res.status(400).json({ error: 'উইথড্রর জন্য ন্যূনতম ৫০,০০০ কয়েন প্রয়োজন।' });
        }
        if (user.total_call_seconds < minSeconds) {
            return res.status(400).json({
                error: `কল শর্ত পূরণ হয়নি! ৫০ মিনিট থাকা আবশ্যক। বর্তমান কল: ${Math.floor(user.total_call_seconds / 60)} মিনিট।`
            });
        }

        db.serialize(() => {
            db.run(`UPDATE users SET coins = coins - ? WHERE id = ?`, [minCoins, req.user.id]);
            db.run(`INSERT INTO withdrawals (user_id, coins_spent, amount_bdt, payment_method, account_number) VALUES (?, ?, ?, ?, ?)`,
                [req.user.id, minCoins, 5000, payment_method, account_number],
                (err) => {
                    if (err) return res.status(500).json({ error: 'উইথড্র প্রসেস ব্যর্থ হয়েছে' });
                    res.json({ message: 'উইথড্র রিকোয়েস্ট সফল হয়েছে। এডমিন দ্রুত টাকা পাঠাবে।' });
                }
            );
        });
    });
});

// এজেন্সি মেম্বারদের তালিকা ও কমিশন আয়
app.get('/api/agency', authenticateToken, (req, res) => {
    db.all(`SELECT id, username, phone, coins, total_call_seconds FROM users WHERE agency_id = ?`, [req.user.id], (err, members) => {
        if (err) return res.status(500).json({ error: 'তথ্য পাওয়া যায়নি' });
        res.json({ members });
    });
});

// এজেন্সির পক্ষ থেকে মেম্বারকে কয়েন গিফট
app.post('/api/agency/gift', authenticateToken, (req, res) => {
    const { member_id, amount } = req.body;
    const giftAmount = parseInt(amount);

    if (!giftAmount || giftAmount <= 0) return res.status(400).json({ error: 'সঠিক কয়েন এমাউন্ট দিন' });

    db.get(`SELECT coins FROM users WHERE id = ?`, [req.user.id], (err, owner) => {
        if (owner.coins < giftAmount) {
            return res.status(400).json({ error: 'আপনার ব্যালেন্সে পর্যাপ্ত কয়েন নেই' });
        }

        db.serialize(() => {
            db.run(`UPDATE users SET coins = coins - ? WHERE id = ?`, [giftAmount, req.user.id]);
            db.run(`UPDATE users SET coins = coins + ? WHERE id = ? AND agency_id = ?`, [giftAmount, member_id, req.user.id], function (err) {
                if (err || this.changes === 0) {
                    return res.status(400).json({ error: 'মেম্বার আপনার এজেন্সির অন্তর্ভুক্ত নয়' });
                }
                res.json({ message: 'কয়েন সফলভাবে গিফট করা হয়েছে' });
            });
        });
    });
});

// সাপোর্ট চ্যাট হিস্টোরি
app.get('/api/support/messages', authenticateToken, (req, res) => {
    const adminId = 1;
    db.all(`SELECT * FROM messages WHERE (sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?) ORDER BY id ASC`,
        [req.user.id, adminId, adminId, req.user.id], (err, rows) => {
            if (err) return res.status(500).json({ error: 'মেসেজ লোড করা যায়নি' });
            res.json(rows);
        }
    );
});

// সাপোর্ট মেসেজ সেন্ড
app.post('/api/support/send', authenticateToken, (req, res) => {
    const { message } = req.body;
    const adminId = 1;
    db.run(`INSERT INTO messages (sender_id, receiver_id, message) VALUES (?, ?, ?)`, [req.user.id, adminId, message], function (err) {
        if (err) return res.status(500).json({ error: 'মেসেজ পাঠানো ব্যর্থ হয়েছে' });
        res.json({ success: true, id: this.lastID });
    });
});

// রিয়েল-টাইম WebRTC ও কল ভ্যালিডেশন ইঞ্জিন
const activeCallSessions = {};
const userSocketMap = {};

io.on('connection', (socket) => {
    socket.on('register_user', (userId) => {
        userSocketMap[userId] = socket.id;
        socket.userId = userId;
    });

    socket.on('call_user', ({ toUserId, signalData }) => {
        const targetSocketId = userSocketMap[toUserId];
        if (targetSocketId) {
            io.to(targetSocketId).emit('incoming_call', {
                fromUserId: socket.userId,
                signalData
            });
        } else {
            socket.emit('call_failed', { message: 'ইউজার অফলাইনে আছেন' });
        }
    });

    socket.on('accept_call', ({ toUserId, signalData }) => {
        const targetSocketId = userSocketMap[toUserId];
        const callId = `call_${Date.now()}`;
        const startTime = Math.floor(Date.now() / 1000);

        activeCallSessions[callId] = {
            callerId: toUserId,
            receiverId: socket.userId,
            startTime
        };

        socket.currentCallId = callId;
        const callerSocket = io.sockets.sockets.get(targetSocketId);
        if (callerSocket) callerSocket.currentCallId = callId;

        if (targetSocketId) {
            io.to(targetSocketId).emit('call_accepted', { signalData, callId, startTime });
        }
        socket.emit('call_started', { callId, startTime });
    });

    socket.on('ice_candidate', ({ toUserId, candidate }) => {
        const targetSocketId = userSocketMap[toUserId];
        if (targetSocketId) {
            io.to(targetSocketId).emit('ice_candidate', { candidate });
        }
    });

    const finalizeCall = (callId) => {
        const session = activeCallSessions[callId];
        if (!session || session.finalized) return;
        session.finalized = true;

        const endTime = Math.floor(Date.now() / 1000);
        const durationSeconds = endTime - session.startTime;
        const callerId = session.callerId;
        const receiverId = session.receiverId;

        let coinsAwarded = 0;

        // কঠোর শর্ত: ন্যূনতম ১০ মিনিট (৬০০ সেকেন্ড) হলে ১০,০০০ কয়েন যুক্ত হবে। অন্যথায় ০ কয়েন।
        if (durationSeconds >= 600) {
            const tenMinSlots = Math.floor(durationSeconds / 600);
            coinsAwarded = tenMinSlots * 10000;

            db.serialize(() => {
                // কয়েন ও টোটাল কল টাইম আপডেট
                db.run(`UPDATE users SET coins = coins + ?, total_call_seconds = total_call_seconds + ? WHERE id = ?`,
                    [coinsAwarded, durationSeconds, callerId]);
                db.run(`UPDATE users SET coins = coins + ?, total_call_seconds = total_call_seconds + ? WHERE id = ?`,
                    [coinsAwarded, durationSeconds, receiverId]);

                // রেফারেল চেক ও এজেন্সি অ্যাসাইন
                [callerId, receiverId].forEach(uId => {
                    db.get(`SELECT referred_by, is_ref_completed FROM users WHERE id = ?`, [uId], (err, uData) => {
                        if (uData && uData.referred_by && !uData.is_ref_completed) {
                            db.get(`SELECT id FROM users WHERE ref_code = ?`, [uData.referred_by], (err, refOwner) => {
                                if (refOwner) {
                                    db.run(`UPDATE users SET is_ref_completed = 1, agency_id = ? WHERE id = ?`, [refOwner.id, uId]);
                                }
                            });
                        }
                    });
                });

                // এজেন্সির মালিক ১০% কমিশন পাবে
                [callerId, receiverId].forEach(uId => {
                    db.get(`SELECT agency_id FROM users WHERE id = ?`, [uId], (err, uRow) => {
                        if (uRow && uRow.agency_id) {
                            const agencyCommission = Math.floor(coinsAwarded * 0.10);
                            if (agencyCommission > 0) {
                                db.run(`UPDATE users SET coins = coins + ? WHERE id = ?`, [agencyCommission, uRow.agency_id]);
                            }
                        }
                    });
                });
            });
        }

        db.run(`INSERT INTO calls (caller_id, receiver_id, start_time, end_time, duration_seconds, coins_awarded) VALUES (?, ?, ?, ?, ?, ?)`,
            [callerId, receiverId, session.startTime, endTime, durationSeconds, coinsAwarded]);

        const resultPayload = {
            durationSeconds,
            coinsAwarded,
            message: durationSeconds >= 600
                ? `অভিনন্দন! কল সময়: ${Math.floor(durationSeconds / 60)} মিনিট। আপনার আয়: ${coinsAwarded} কয়েন!`
                : `কলটি ১০ মিনিটের কম ছিল (${Math.floor(durationSeconds / 60)} মিনিট ${durationSeconds % 60} সেকেন্ড)। তাই কোনো কয়েন অর্জিত হয়নি।`
        };

        if (userSocketMap[callerId]) io.to(userSocketMap[callerId]).emit('call_ended', resultPayload);
        if (userSocketMap[receiverId]) io.to(userSocketMap[receiverId]).emit('call_ended', resultPayload);

        delete activeCallSessions[callId];
    };

    socket.on('end_call', ({ callId }) => {
        finalizeCall(callId);
    });

    socket.on('disconnect', () => {
        if (socket.userId) delete userSocketMap[socket.userId];
        if (socket.currentCallId) finalizeCall(socket.currentCallId);
    });
});

server.listen(PORT, () => {
    console.log(`সার্ভার চালু হয়েছে: http://localhost:${PORT}`);
});
