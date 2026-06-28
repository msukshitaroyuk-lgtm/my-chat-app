const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

io.on('connection', (socket) => {
    console.log('একজন ব্যবহারকারী যুক্ত হয়েছেন');
    
    socket.on('chat message', (msg) => {
        io.emit('chat message', msg);
    });

    socket.on('disconnect', () => {
        console.log('একজন ব্যবহারকারী চলে গেছেন');
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log(`সার্ভার চলছে ${PORT} পোর্টে`);
});

