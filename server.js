const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

app.use(express.json());

// ইউজার সেটিংস স্টোরেজ
let userSettings = {
    forwardingLink: '',
    gatewayName: ''
};

// সেটিংস সেভ করার এপিআই
app.post('/api/save-settings', (req, res) => {
    userSettings = req.body;
    res.json({ status: 'Success', message: 'সেটিংস সফলভাবে সেভ হয়েছে!' });
});

// মেসেজ ফরওয়ার্ডিং ফাংশন
async function forwardToWebsite(message) {
    if (userSettings.forwardingLink && message.includes(userSettings.gatewayName)) {
        try {
            await fetch(userSettings.forwardingLink, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: message, time: new Date() })
            });
            console.log("মেসেজ ফরওয়ার্ড করা হয়েছে!");
        } catch (e) {
            console.error("ফরওয়ার্ডিং ব্যর্থ:", e);
        }
    }
}

// যখনই নতুন মেসেজ আসবে (বা ডামি মেসেজ)
io.on('connection', (socket) => {
    socket.on('new_sms', (msg) => {
        forwardToWebsite(msg);
        io.emit('display_message', msg); // ইনবক্সে দেখানোর জন্য
    });
});

http.listen(process.env.PORT || 3000, () => console.log("সার্ভার রানিং!"));

