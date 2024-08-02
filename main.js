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

const turf = require('@turf/turf');
const geocluster = require('geocluster');
const admin = require('firebase-admin');
const serviceAccount = require('./serviceKey.json');

var points = [];
var heatValues = []
var leaderboard = [];

defaultHp = 100;




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

getData = async () =>{
    const query = await db.collection("scores").get().then(res =>{
        console.log(res)
    })
}

const query = db.collection('scores').orderBy('score', 'desc').limit(10)

const observer = query.onSnapshot( async querySnapshot => {
    let resultArray = []
    querySnap =  querySnapshot.docs.map( async (d)=> {
        const mainObj = d.data()
        if(mainObj.userId.path){
            const userRef = db.doc(mainObj.userId?.path)
            const userDoc = await userRef.get()
            userName = userDoc.data().name
            let result= {
                name: userName ,
                score: mainObj.score
            }
            resultArray.push(result)
        }
  }, err => {
    console.log(`Encountered error: ${err}`);
  });
  Promise.all(querySnap).then(function() {
    leaderboard = resultArray
    io.emit("leadUpdate", {leaderboard: leaderboard})
    console.log(leaderboard)
  })
})


io.on('connection', client => {
    const id = client.id;
    let uid = null;
    // console.log(client)3
    client.emit("connectedNewUser", {})
    client.on("userData", (data) => {
        uid = data;
    })
    client.on("setUpGun", (data)=>{

    })




    client.on('gotshot', async function (data) {
        let newShot = [data.data.location.latitude, data.data.location.longitude, new Date().getMilliseconds()]
        
        var query = await admin.firestore().collection('scores')
            .where('gunCode', '==', data.data.id)
            .get().then(async result => {
                let snapshot = result.docs[0];
                const documentRef = snapshot.ref
                let currentScore = snapshot.data().score
                let newScore = 100
                if(currentScore !== undefined){  
                     newScore += currentScore;
                }
                documentRef.update({ 'score': newScore })
                // var userDoc = (await admin.firestore().collection('users').doc(id).get()).data()
                // let damage = Math.floor(Math.random() * (4 - 2 + 1) + 2);
                // if(userDoc.hp !== undefined){
                //     damage =  userDoc.hp - damage;
                // }else{
                //     damage = defaultHp - damage;
                // }
                // userDoc.update({ 'hp': damage })
                // io.to(id).emit("takeDamage", {damage: damage})
                // Heat Map Fun
        setTimeout(() => {

            heatValues.push(newShot)


            newPoints = generateHeatMap(heatValues);

            if (!compareArrays(points, newPoints)) {
                points = newPoints;
                io.emit("heatUpdate", points);
            }

            setTimeout(() => {
                heatValues = heatValues.filter(item => item != newShot)
                newPoints = generateHeatMap(heatValues);
                if (!compareArrays(points, newPoints)) {
                    points = newPoints;
                    io.emit("heatUpdate", points);
                }

            }, 10000)
        }, 10000)

            });
        
        

    })
    client.on('getHeat', (data) => {
        io.to(id).emit("heatUpdate", points)

    })
    client.on('getLead', (data) => {
        io.to(id).emit("leadUpdate", {leaderboard: leaderboard})

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