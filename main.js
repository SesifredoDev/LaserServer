const server = require('http').createServer(
    function (req, res) {
        // Set CORS headers
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Allow-Credentials", "true");
        res.setHeader("Access-Control-Allow-Methods", "GET,HEAD,OPTIONS,POST,PUT");
        res.setHeader("Access-Control-Allow-Headers", "Access-Control-Allow-Headers, Origin,Accept, X-Requested-With, Content-Type, Access-Control-Request-Method, Access-Control-Request-Headers");
    }
);
const heatGen = require('./heatmap')
const admin = require('firebase-admin');
const serviceAccount = require('./serviceKey.json');

var leaderboard = [];

defaultHp = 100;


const rooms = {};

app = admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),

});


const db = admin.firestore()

const io = require('socket.io')(server, {

    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
})

getData = async () => {
    const query = await db.collection("scores").get().then(res => {
        console.log(res)
    })
}


const listenToLeaderboardChanges = () => {
    db.collection('games').onSnapshot((snapshot) => {
        snapshot.docChanges().forEach((change) => {
            if (change.type === 'modified') {
                const updatedDocument = change.doc.data();

                // Retrieve gameCode and leaderboard from the document
                const { gameCode, leaderboard } = updatedDocument;

                if (leaderboard && gameCode) {
                    console.log(`Leaderboard updated for gameCode ${gameCode}:`, leaderboard);
                    // console.log(rooms[gameCode])
                    rooms[gameCode].leaderboard = leaderboard;

                    // Emit the leaderboard update to the specific room associated with gameCode
                    io.to(gameCode).emit('leadUpdate', {leaderboard: leaderboard});
                }
            }
        });
    });
};

async function loadGamesIntoRooms() {
    try {
        const gamesSnapshot = await admin.firestore().collection('games').get();

        gamesSnapshot.forEach(gameDoc => {
            const gameData = gameDoc.data();

            // Add game data to rooms object, keyed by gameId
            rooms[gameData.gameCode] = {
                gameCode: gameData.gameCode,
                name: gameData.name,
                rules: gameData.rules,
                leaderboard: gameData.leaderboard,
                owner: gameData.owner,
                heatValues: [],
                points: []
            };

            console.log(`Loaded game: ${gameData.gameCode}`);
        });

        console.log('All games loaded into rooms object:', rooms);
    } catch (error) {
        console.error('Error loading games:', error);
    }
}

// Execute the function
loadGamesIntoRooms();
listenToLeaderboardChanges();




io.on('connection', client => {
    const id = client.id;
    let uid = null;
    let gameCode = null;
    // console.log(client)3
    client.emit("connectedNewUser", {})
    client.on("userData", (data) => {
        uid = data;
    })

    client.on("createGame", (data) => {
        console.log(data)
        gameObj = {
            gameCode: data.gameCode,
            name: data.name,
            rules: data.rules,
            leaderboard: [],
            owner: data.owner,
        }
        admin.firestore().collection('games').add(gameObj);
        gameObj.points = [];
        gameObj.heatValues = [];
        rooms[data.gameCode] = gameObj;

        listenToLeaderboardChanges(data.gameCode);

        console.log(`Game created: ${data.gameCode}`);
    })

    client.on('joinGame', async (data) => {
        gameCode = data.gameCode;
        client.join(gameCode);
        console.log(`User ${uid} joined game ${gameCode}`);
        let playerInfo = data.playerInfo;
        const found = rooms[gameCode].leaderboard.find((item) => item.email == playerInfo.email);
        if (!found) {
            let newHex = generateUniqueHex(rooms[gameCode].leaderboard, 2);
            playerInfo.gunCode = newHex;
            playerInfo.currentScore = 0;
            rooms[gameCode].leaderboard.push(playerInfo);
            const querySnapshot = await db.collection('games').where('gameCode', '==', gameCode).get();
            querySnapshot.forEach(async (doc) => {
                await db.collection('games').doc(doc.id)
                    .update({ 'leaderboard': rooms[gameCode].leaderboard });
            })
            
            io.to(id).emit("connectGame", {code: gameCode, leaderboard: rooms[gameCode].leaderboard });
            io.to(id).emit("gunCodeUpdate", newHex);
        } else {
            
            io.to(id).emit("connectGame", {code: gameCode, leaderboard: rooms[gameCode].leaderboard });
            io.to(id).emit("gunCodeUpdate", found.gunCode);
        }



    })



    client.on('gotshot', async function (data) {
        let newShot = [data.data.location.latitude, data.data.location.longitude, new Date().getMilliseconds()]
        console.log(newShot);
        var query = await admin.firestore().collection('games')
            .where('gameCode', '==', gameCode)
            .get().then(async result => {
                    if(!result.empty) {
                        let snapshot = result.docs[0];
                    const documentRef = snapshot.ref;
                    let leaderboard = snapshot.data().leaderboard;
                    let playerIndex = leaderboard.findIndex(player => player.gunCode == data.data.id);
                    let newScore = 100
                    if (leaderboard[playerIndex+1]?.currentScore !== undefined) {
                        newScore += leaderboard[playerIndex+1].currentScore;
                    }

                    leaderboard[playerIndex+1].currentScore = newScore;
                    documentRef.update({ 'leaderboard': leaderboard });

                    io.to(gameCode).emit("leadUpdate", {leaderboard: leaderboard});

                    setTimeout(() => {

                        rooms[gameCode].heatValues.push(newShot)

                        
                        newPoints = generateHeatMap(rooms[gameCode].heatValues);

                        if (!compareArrays(rooms[gameCode].points, newPoints)) {
                            rooms[gameCode].points = newPoints;
                            
                            console.log(rooms[gameCode].points, gameCode)
                            io.to(gameCode).emit("heatUpdate", rooms[gameCode].points);
                        }

                        setTimeout(() => {
                            rooms[gameCode].heatValues = rooms[gameCode].heatValues.filter(item => item != newShot)
                            newPoints = generateHeatMap(rooms[gameCode].heatValues);
                            if (!compareArrays(rooms[gameCode].points, newPoints)) {
                                rooms[gameCode].points = newPoints;
                                io.to(gameCode).emit("heatUpdate", rooms[gameCode].points);
                            }

                        }, 10000)
                    }, 10000)
                    }
                    
                
            });



    })
    client.on('getHeat', (data) => {
        io.to(id).emit("heatUpdate", rooms[gameCode]?.points)

    })
    client.on('getLead', (data) => {
        io.to(id).emit("leadUpdate", { leaderboard: rooms[gameCode]?.leaderboard })

    })

    client.on('disconnect', () => {
        console.log("client disconnected");
    })





})

server.listen(8080, () => {
    console.log("nodejs server starts at port 3000");
})

// Function to calculate the Haversine distance between two points in meters
function haversineDistance([lat1, lon1], [lat2, lon2]) {
    const R = 6371000; // Radius of the Earth in meters
    const toRadians = angle => (angle * Math.PI) / 180;
    const dLat = toRadians(lat2 - lat1);
    const dLon = toRadians(lon2 - lon1);
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

// Function to cluster points
function clusterPoints(points, distanceThreshold) {
    const clusters = [];
    const visited = new Array(points.length).fill(false);

    function findNeighbors(pointIndex) {
        const neighbors = [];
        for (let i = 0; i < points.length; i++) {
            if (!visited[i] && haversineDistance(points[pointIndex], points[i]) <= distanceThreshold) {
                neighbors.push(i);
            }
        }
        return neighbors;
    }

    for (let i = 0; i < points.length; i++) {
        if (!visited[i]) {
            const cluster = [];
            const queue = [i];
            while (queue.length > 0) {
                const pointIndex = queue.pop();
                if (!visited[pointIndex]) {
                    visited[pointIndex] = true;
                    cluster.push(points[pointIndex]);
                    const neighbors = findNeighbors(pointIndex);
                    queue.push(...neighbors);
                }
            }
            clusters.push(cluster);
        }
    }

    return clusters;
}

// Function to calculate the centroid of a cluster
function centroidOfCluster(cluster) {
    const numPoints = cluster.length;
    const sumCoords = cluster.reduce((sum, [lat, lon]) => [sum[0] + lat, sum[1] + lon], [0, 0]);
    return [sumCoords[0] / numPoints, sumCoords[1] / numPoints];
}

// Main function
function generateHeatMap(points, distanceThreshold = 10) {
    const clusters = clusterPoints(points, distanceThreshold);
    return clusters
        .filter(cluster => cluster.length >= 1)
        .map(cluster => {
            let centroid = centroidOfCluster(cluster);
            return ([centroid[0], centroid[1], cluster.length])
        }

        );
}

const compareArrays = (a, b) => {
    return JSON.stringify(a) === JSON.stringify(b);
};


// Function to generate a random hex value
function generateRandomHex(length) {
    let hex = '';
    const characters = '0123456789ABCDEF';
    for (let i = 0; i < length; i++) {
        hex += characters.charAt(Math.floor(Math.random() * 16));
    }
    return hex;
}

// Function to check if a hex value already exists in the array
function hexExistsInArray(array, hex) {
    return array.some(item => item.hex === hex);
}

// Function to generate a unique hex value
function generateUniqueHex(array, length) {
    let uniqueHex;
    do {
        uniqueHex = generateRandomHex(length);
    } while (hexExistsInArray(array, uniqueHex));
    return uniqueHex;
}
