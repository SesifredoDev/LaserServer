const turf = require('@turf/turf');


function generateHeatMap(points){
    // Convert points to GeoJSON
    const geoJsonPoints = turf.featureCollection(points.map(point => turf.point(point)));

    // Define the clustering options
    const distance = 0.01; // Distance in kilometers
    const clustered = turf.clustersDbscan(geoJsonPoints, distance, { units: 'kilometers' });

    // Process each cluster to calculate the center and radius
    const clusters = [];
    const clusterIds = new Set(clustered.features.map(f => f.properties.cluster));
    clusterIds.forEach(clusterId => {
    const clusterPoints = clustered.features.filter(f => f.properties.cluster === clusterId);
    const clusterCoords = clusterPoints.map(p => p.geometry.coordinates);

    // Calculate centroid
    const centroid = turf.centroid(turf.featureCollection(clusterPoints)).geometry.coordinates;

    // Calculate radius (distance from centroid to the furthest point)
    let maxDistance = 0;
    clusterCoords.forEach(coord => {
        const distance = turf.distance(turf.point(centroid), turf.point(coord), { units: 'kilometers' });
        if (distance > maxDistance) {
        maxDistance = distance;
        }
    });

    clusters.push({ centroid });
    });
    return clusters
}

// Output the results
