const io = require('socket.io-client');
const socket = io('http://localhost:8080');

function generateRandomCoordinates() {
    // Romford, England roughly ranges between:
    // Latitude: 51.55 to 51.60
    // Longitude: 0.15 to 0.20
    const latitude = (Math.random() * (51.60 - 51.55) + 51.55).toFixed(4);
    const longitude = (Math.random() * (0.20 - 0.15) + 0.15).toFixed(4);
    return { latitude, longitude };
}

function createMessage() {
    const { latitude, longitude } = generateRandomCoordinates();
    return {
        data: {
            location: {
                latitude: parseFloat(latitude),
                longitude: parseFloat(longitude)
            },
            id: "FF45C8"
        }
    };
}

socket.on('connect', () => {
    console.log('Connected to server');

    setInterval(() => {
        const message = createMessage();
        socket.emit('gotshot', message);
        console.log(`Sent: ${JSON.stringify(message)}`);
    }, 1000); // Send a message every second
});

socket.on('disconnect', () => {
    console.log('Disconnected from server');
});
