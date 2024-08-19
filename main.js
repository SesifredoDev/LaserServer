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


const ngrok = require('ngrok');



const rooms = {};

let liveLeaderboardSubscription;

app = admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
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
    liveLeaderboardSubscription = db.collection('games').where('active', '==', true).onSnapshot((snapshot) => {
        snapshot.docChanges().forEach((change) => {
            if (change.type === 'modified') {
                const updatedDocument = change.doc.data();

                // Retrieve gameCode and leaderboard from the document
                const { gameCode, leaderboard, players } = updatedDocument;

                if (leaderboard && gameCode) {
                    console.log(`Leaderboard updated for gameCode ${gameCode}:`);
                    // console.log(rooms[gameCode])
                    if (rooms[gameCode]) {
                        rooms[gameCode].leaderboard = leaderboard;
                        // Emit the leaderboard update to the specific room associated with gameCode
                        io.to(gameCode).emit('leadUpdate', { leaderboard: leaderboard });
                    }

                }
            }
        });
    });
};

async function loadGamesIntoRooms() {
    try {
        const gamesSnapshot = await admin.firestore().collection('games').where('active', '==', true).get();

        gamesSnapshot.forEach(gameDoc => {
            const gameData = gameDoc.data();

            // Add game data to rooms object, keyed by gameId
            rooms[gameData.gameCode] = {
                gameCode: gameData.gameCode,
                name: gameData.name,
                gameRules: gameData.gameRules,
                leaderboard: gameData.leaderboard,
                players: gameData.players,
                gameRequirements: gameData.gameRequirements,

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
        gameObj = {
            gameCode: data.gameCode,
            name: data.name,
            active: data.active,
            players: [],
            leaderboard: [],
            owner: data.owner,
        }

        if (data.gameRules) gameObj.gameRules = data.gameRules;
        if (data.gameRequirements) gameObj.gameRequirements = data.gameRequirements;
        admin.firestore().collection('games').add(gameObj);
        gameObj.points = [];
        gameObj.heatValues = [];

        if (data.active == true) {
            rooms[data.gameCode] = gameObj;
            listenToLeaderboardChanges();
        }


        console.log(`Game created: ${data.gameCode}`);
    })

    client.on("activateGame", async (data) => {
        var query = await admin.firestore().collection('games')
            .where('gameCode', '==', data.gameCode)
            .get().then(async result => {
                if (!result.empty) {
                    let snapshot = result.docs[0];
                    const documentRef = snapshot.ref;
                    let gameData = snapshot.data();
                    if (gameData.active !== true) {
                        documentRef.update({ 'active': true })
                        gameData.points = [];
                        gameData.heatValues = []
                        rooms[gameCode] = gameData;
                        console.log(rooms[gameCode])
                        listenToLeaderboardChanges(gameCode);
                    }
                }
            });
        // if(game.active == false){
        //     game.active = true
        //     admin.firestore().collection('games').doc(data.gameCode).update(game)
        //     game.points = [];
        //     game.heatValues = [];

        //     rooms[gameCode] = game;
        //     listenToLeaderboardChanges(data.gameCode);


        // }
        // })

    })

    client.on('joinGame', async (data) => {
        gameCode = data.gameCode;
        if (gameCode) {
            playerInfo = data.playerInfo;
            if (!rooms[gameCode]) {
                io.to(id).emit("noGame", { errorMsg: `No Game Running for ${gameCode}`, data });
                return;
            }
            // Check if player is already in the game or meets requirements
            const found = rooms[gameCode].players.find((item) => item.uid == playerInfo.uid);
            let requirements = rooms[gameCode].gameRequirements;
    
            if (!requirements || found || rooms[gameCode].owner == playerInfo.uid) {
                confirmedJoin(data);
            } else {
                // Handle game requirements
                if (playerInfo.confirmedRequirements !== true && !found) {
                    io.to(id).emit("gameRequirements", { gameCode, requirements });
                } else {
                    confirmedJoin(data);
                }
            }
        }
    });
    



    client.on('gotShot', async function (data) {
        let shotGameCode = gameCode;
        let newShot = [data.data.location.latitude, data.data.location.longitude, new Date().getMilliseconds()];
        console.log(newShot);
    
        var query = await admin.firestore().collection('games')
            .where('gameCode', '==', shotGameCode)
            .get().then(async result => {
                if (!result.empty) {
                    let snapshot = result.docs[0];
                    const documentRef = snapshot.ref;
                    let leaderboard = snapshot.data().leaderboard;
                    let playerIndex = leaderboard.findIndex(player => player.gunCode == data.data.id);
                    if (playerIndex >= 0) {
                        let playerDataIndex = rooms[shotGameCode].players.findIndex(player => player.gunCode == data.data.id);
    
                        let newScore = 100;
                        let playerInfo = leaderboard[playerIndex];
                        if (playerInfo) playerInfo.changeScore = newScore;
    
                        if (leaderboard[playerIndex]?.currentScore !== undefined) {
                            newScore += leaderboard[playerIndex].currentScore;
                        }
                        leaderboard[playerIndex].currentScore = newScore;
    
                        documentRef.update({ 'leaderboard': leaderboard });
    
                        // Emit leaderboard update to all clients in the specific room
                        io.to(shotGameCode).emit("leadUpdate", { leaderboard: leaderboard });
    
                        // Send playerInfo update to the specific client connected to this player
                        const connectedId = rooms[shotGameCode].players[playerDataIndex].connectedId;
                        if (connectedId) {
                            io.to(connectedId).emit("playerUpdate", playerInfo);
                        }
    
                        // Handle heatmap generation and updates
                        setTimeout(() => {
                            rooms[shotGameCode].heatValues.push(newShot);
    
                            let newPoints = generateHeatMap(rooms[shotGameCode].heatValues);
    
                            if (!compareArrays(rooms[shotGameCode].points, newPoints)) {
                                rooms[shotGameCode].points = newPoints;
                                io.to(shotGameCode).emit("heatUpdate", rooms[shotGameCode].points);
                            }
    
                            setTimeout(() => {
                                rooms[shotGameCode].heatValues = rooms[shotGameCode].heatValues.filter(item => item !== newShot);
                                newPoints = generateHeatMap(rooms[shotGameCode].heatValues);
                                if (!compareArrays(rooms[shotGameCode].points, newPoints)) {
                                    rooms[shotGameCode].points = newPoints;
                                    io.to(shotGameCode).emit("heatUpdate", rooms[shotGameCode].points);
                                }
                            }, 10000);
                        }, 10000);
                    }
                }
            });
    });
    

    client.on('getHeat', (data) => {
        io.to(id).emit("heatUpdate", rooms[gameCode]?.points)

    })
    client.on('disconnectGame', () => {


        // let playerDataIndex = rooms[gameCode].players.findIndex(player => player.uid == uid)
        // rooms[gameCode].players[playerDataIndex].connectedId = "";
        client.leave(gameCode);
        gameCode = "";

    })
    client.on('getLead', (data) => {
        io.to(id).emit("leadUpdate", { leaderboard: rooms[gameCode]?.leaderboard })

    })

    client.on('disconnect', () => {
        console.log("client disconnected");
    })



    async function confirmedJoin(data) {
        let playerInfo = data.playerInfo;
        let gameCode = data.gameCode;
    
        if (!rooms[gameCode]) return;
    
        const found = rooms[gameCode].players.find((item) => item.uid == playerInfo.uid);
        if (!found) {
            let newHex = generateUniqueHex(rooms[gameCode].leaderboard, 2);
            playerInfo.gunCode = newHex;
            playerInfo.currentScore = 0;
    
            let leaderboardInfo = {
                name: playerInfo.name,
                gunCode: playerInfo.gunCode,
                currentScore: playerInfo.currentScore
            };
            if (playerInfo.customName) leaderboardInfo.name = playerInfo.customName;
    
            rooms[gameCode].leaderboard.push(leaderboardInfo);
            rooms[gameCode].players.push(playerInfo);

            // query for game with gameCode == gameCode then push the leaderboard and players
            admin.firestore().collection('games').where('gameCode', '==', gameCode).get().then(async result => {
                if (!result.empty) {
                    
                    let snapshot = result.docs[0];
                    const documentRef = snapshot.ref;
                    
                    documentRef.update({ 'leaderboard': rooms[gameCode].leaderboard, 'players': rooms[gameCode].players });
                    
                }
                });

    
            io.to(client.id).emit('playerUpdate', playerInfo);
            io.to(client.id).emit("gunCodeUpdate", newHex);
        } else {
            // Existing player update logic
            let playerLeaderboardData = rooms[gameCode].leaderboard.find((item) => item.gunCode == found.gunCode);
            playerLeaderboardData.changeScore = 0;
    
            io.to(client.id).emit('playerUpdate', playerLeaderboardData);
            io.to(client.id).emit("gunCodeUpdate", found.gunCode);
        }
    
        // Update connectedId for the player
        let foundIndex = rooms[gameCode].players.findIndex((item) => item.uid == playerInfo.uid);
        if (foundIndex !== -1) {
            rooms[gameCode].players[foundIndex].connectedId = client.id;
        }
    
        io.to(client.id).emit("connectGame", {
            gameCode,
            name: rooms[gameCode].name,
            leaderboard: rooms[gameCode].leaderboard,
            playerCount: rooms[gameCode].leaderboard.length,
            gameRules: rooms[gameCode].gameRules,
            isConnected: true
        });
        client.join(gameCode);
    }
    
    





})

ngRun = async () => {
    const listener = await ngrok.connect({
        addr: 8080,
        authtoken: "1c8Qa8iHaf6oxkQUWrzzq4WZuYk_7P8v5SJoBtzXBn4kTLKmk"
    });

    console.log(`Ingress established at: ${listener}`);
}
// NGROK tunnel setup



server.listen(8080, () => {
    // ngRun();
    console.log("nodejs server starts at port 8080");
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
