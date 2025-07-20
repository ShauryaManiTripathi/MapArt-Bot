// add_mapart.js
const { MapArtDatabase } = require('./database.js');

const db = new MapArtDatabase();

// Usage: node add_mapart.js "My First Art" ./processed
const mapName = process.argv[2];
const jsonDir = process.argv[3];

if (!mapName || !jsonDir) {
    console.error('Usage: node add_mapart.js "<Map Name>" <path/to/json/dir>');
    process.exit(1);
}

db.addMapArt(mapName, jsonDir).catch(console.error);