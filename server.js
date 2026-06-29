const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const cors = require('cors');

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// User Settings Storage
let userSettings = {
    forwardingLink: '',
    gatewayName: '',
    isActive: false
};

// User Messages Storage
let chatMessages = [];
const MAX_MESSAGES = 100;

// ==================== API Endpoints ====================

// Get all settings
app.get('/api/settings', (req, res) => {
    res.json(userSettings);
});

// Save settings
app.post('/api/save-settings', (req, res) => {
    try {
        const { forwardingLink, gatewayName, isActive } = req.body;
        
        if (!forwardingLink || !gatewayName) {
            return res.status(400).json({ 
                status: 'Error', 
                message: 'Forwarding link and gateway name are required' 
            });
        }
        
        userSettings = {
            forwardingLink,
            gatewayName,
            isActive: isActive || false
        };
        
        console.log('Settings updated:', userSettings);
        res.json({ 
            status: 'Success', 
            message: 'Settings saved successfully!' 
        });
    } catch (error) {
        console.error('Error saving settings:', error);
        res.status(500).json({ 
            status: 'Error', 
            message: 'Failed to save settings' 
        });
    }
});

// Get chat messages
app.get('/api/messages', (req, res) => {
    res.json(chatMessages);
});

// Clear chat messages
app.delete('/api/messages', (req, res) => {
    chatMessages = [];
    io.emit('messages_cleared');
    res.json({ status: 'Success', message: 'Messages cleared' });
});

// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'Server is running', timestamp: new Date() });
});

// ==================== Message Forwarding ====================

/**
 * Forward message to external website
 * @param {string} message - The message to forward
 * @returns {Promise<void>}
 */
async function forwardToWebsite(message) {
    if (!userSettings.isActive || !userSettings.forwardingLink) {
        return;
    }

    if (!message.includes(userSettings.gatewayName)) {
        return;
    }

    try {
        const payload = {
            message: message,
            timestamp: new Date().toISOString(),
            gateway: userSettings.gatewayName
        };

        const response = await fetch(userSettings.forwardingLink, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'User-Agent': 'ChatApp/1.0'
            },
            body: JSON.stringify(payload),
            timeout: 5000
        });

        if (!response.ok) {
            console.warn(`Forwarding response status: ${response.status}`);
        } else {
            console.log('Message forwarded successfully to:', userSettings.forwardingLink);
        }
    } catch (error) {
        console.error('Forwarding failed:', {
            message: error.message,
            gateway: userSettings.gatewayName,
            link: userSettings.forwardingLink,
            timestamp: new Date().toISOString()
        });
    }
}

// ==================== Socket.IO Events ====================

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    // Send existing messages to new user
    socket.emit('load_messages', chatMessages);

    // Handle incoming SMS/messages
    socket.on('new_sms', async (msg) => {
        if (!msg || msg.trim() === '') {
            return;
        }

        const messageObj = {
            id: Date.now(),
            content: msg,
            timestamp: new Date().toISOString(),
            sender: 'SMS Gateway'
        };

        // Store message
        chatMessages.push(messageObj);
        if (chatMessages.length > MAX_MESSAGES) {
            chatMessages.shift();
        }

        // Broadcast to all users
        io.emit('display_message', messageObj);

        // Attempt forwarding
        forwardToWebsite(msg);
    });

    // Handle user disconnect
    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
    });

    // Handle errors
    socket.on('error', (error) => {
        console.error('Socket error:', error);
    });
});

// ==================== Error Handling ====================

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    process.exit(1);
});

// ==================== Server Start ====================

const PORT = process.env.PORT || 3000;

http.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});

module.exports = app;
