// database.js
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs').promises;

const DB_PATH = './mapart.db';
const BUILD_SEGMENT_TIMEOUT_MS = 5 * 60 * 1000;
const SAVE_JOB_TIMEOUT_MS = 10 * 60 * 1000;

class MapArtDatabase {
    constructor() {
        this.db = new Database(DB_PATH);
        this.initSchema();
    }

    initSchema() {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS map_arts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                status TEXT NOT NULL DEFAULT 'pending'
            );

            CREATE TABLE IF NOT EXISTS map_chunks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                map_art_id INTEGER NOT NULL,
                chunk_x INTEGER NOT NULL,
                chunk_y INTEGER NOT NULL,
                json_path TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'locked', /* locked, pending, in-progress, saving, completed */
                assigned_to TEXT,
                assigned_at INTEGER,
                FOREIGN KEY (map_art_id) REFERENCES map_arts (id)
            );

            CREATE TABLE IF NOT EXISTS work_segments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                chunk_id INTEGER NOT NULL,
                segment_x INTEGER NOT NULL,
                segment_y INTEGER NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending', /* pending, assigned, completed */
                assigned_to TEXT,
                assigned_at INTEGER,
                FOREIGN KEY (chunk_id) REFERENCES map_chunks (id)
            );
        `);
    }

    async addMapArt(name, jsonDirectory) {
        const addArt = this.db.prepare('INSERT OR IGNORE INTO map_arts (name) VALUES (?)');
        const artResult = addArt.run(name);
        const mapArtId = artResult.lastInsertRowid || this.db.prepare('SELECT id FROM map_arts WHERE name = ?').get(name).id;

        const files = (await fs.readdir(jsonDirectory))
            .filter(f => f.match(/^\d+_\d+\.json$/))
            .sort((a, b) => {
                const [ay, ax] = a.replace('.json', '').split('_').map(Number);
                const [by, bx] = b.replace('.json', '').split('_').map(Number);
                if (ay !== by) return ay - by;
                return ax - bx;
            });

        const insertChunk = this.db.prepare('INSERT INTO map_chunks (map_art_id, chunk_x, chunk_y, json_path, status) VALUES (?, ?, ?, ?, ?)');
        const insertSegment = this.db.prepare('INSERT INTO work_segments (chunk_id, segment_x, segment_y) VALUES (?, ?, ?)');

        this.db.transaction(() => {
            let isFirstChunk = true;
            for (const file of files) {
                const [y, x] = file.replace('.json', '').split('_').map(Number);
                const fullPath = path.join(jsonDirectory, file);
                const initialStatus = isFirstChunk ? 'pending' : 'locked';
                const chunkResult = insertChunk.run(mapArtId, x, y, fullPath, initialStatus);
                isFirstChunk = false;

                const chunkId = chunkResult.lastInsertRowid;
                // Create a 4x8 grid of 32x16 segments
                for (let sy = 0; sy < 8; sy++) { // New: 128 / 16 = 8
                    for (let sx = 0; sx < 4; sx++) { // New: 128 / 32 = 4
                        insertSegment.run(chunkId, sx, sy);
                    }
                }
            }
        })();
        console.log(`Successfully added and locked map art '${name}' with ${files.length} chunks.`);
    }

    getAvailableJob(botId) {
        return this.db.transaction(() => {
            const now = Date.now();

            // --- THE NEW RECOVERY LOGIC ---
            // PRIORITY 0: Does this specific bot have an abandoned job? If so, re-issue it.
            // Check for an abandoned BUILD job.
            let myAbandonedJob = this.db.prepare(`
                SELECT ws.id, ws.chunk_id, ws.segment_x, ws.segment_y, mc.json_path
                FROM work_segments ws JOIN map_chunks mc ON ws.chunk_id = mc.id
                WHERE ws.status = 'assigned' AND ws.assigned_to = ?
            `).get(botId);

            if (myAbandonedJob) {
                console.log(`Bot ${botId} reconnected. Re-issuing its abandoned BUILD job (ID: ${myAbandonedJob.id}).`);
                this.db.prepare('UPDATE work_segments SET assigned_at = ? WHERE id = ?').run(now, myAbandonedJob.id); // Refresh timestamp
                const segmentData = this.getSegmentData(myAbandonedJob.json_path, myAbandonedJob.segment_x, myAbandonedJob.segment_y);
                return {
                    type: 'BUILD_SEGMENT',
                    jobId: myAbandonedJob.id,
                    chunkId: myAbandonedJob.chunk_id,
                    segmentCoords: { x: myAbandonedJob.segment_x, y: myAbandonedJob.segment_y },
                    colorData: segmentData
                };
            }

            // Check for an abandoned SAVE job.
            myAbandonedJob = this.db.prepare(`SELECT id, chunk_x, chunk_y FROM map_chunks WHERE status = 'saving' AND assigned_to = ?`).get(botId);
            if (myAbandonedJob) {
                console.log(`Bot ${botId} reconnected. Re-issuing its abandoned SAVE job (ID: ${myAbandonedJob.id}).`);
                this.db.prepare('UPDATE map_chunks SET assigned_at = ? WHERE id = ?').run(now, myAbandonedJob.id); // Refresh timestamp
                return {
                    type: 'SAVE_MAP',
                    jobId: myAbandonedJob.id,
                    chunkCoords: { x: myAbandonedJob.chunk_x, y: myAbandonedJob.chunk_y }
                };
            }
            // --- END OF NEW RECOVERY LOGIC ---


            // If we get here, this bot has no pending work. Assign a job from the general queue.
            
            // Priority 1: Assign a chunk that is ready to be saved.
            const readyToSaveChunk = this.db.prepare(`SELECT id, chunk_x, chunk_y FROM map_chunks WHERE status = 'in-progress' LIMIT 1`).get();
            if (readyToSaveChunk) {
                this.db.prepare(`UPDATE map_chunks SET status = 'saving', assigned_to = ?, assigned_at = ? WHERE id = ?`).run(botId, now, readyToSaveChunk.id);
                return { type: 'SAVE_MAP', jobId: readyToSaveChunk.id, chunkCoords: { x: readyToSaveChunk.chunk_x, y: readyToSaveChunk.chunk_y } };
            }

            // Priority 2 (Failsafe): Find a timed-out BUILD job from a DIFFERENT bot.
            const timedOutBuildJob = this.db.prepare(`
                SELECT ws.id, ws.chunk_id, ws.segment_x, ws.segment_y, mc.json_path
                FROM work_segments ws JOIN map_chunks mc ON ws.chunk_id = mc.id
                WHERE ws.status = 'assigned' AND (? - ws.assigned_at > ?)
                ORDER BY ws.assigned_at ASC LIMIT 1
            `).get(now, BUILD_SEGMENT_TIMEOUT_MS);

            if (timedOutBuildJob) {
                const previousOwner = this.db.prepare('SELECT assigned_to FROM work_segments WHERE id = ?').get(timedOutBuildJob.id).assigned_to;
                console.log(`Re-assigning timed out job ${timedOutBuildJob.id} from bot ${previousOwner} to ${botId}.`);
                this.db.prepare(`UPDATE work_segments SET assigned_to = ?, assigned_at = ? WHERE id = ?`).run(botId, now, timedOutBuildJob.id);
                const segmentData = this.getSegmentData(timedOutBuildJob.json_path, timedOutBuildJob.segment_x, timedOutBuildJob.segment_y);
                return {
                    type: 'BUILD_SEGMENT',
                    jobId: timedOutBuildJob.id,
                    chunkId: timedOutBuildJob.chunk_id,
                    segmentCoords: { x: timedOutBuildJob.segment_x, y: timedOutBuildJob.segment_y },
                    colorData: segmentData
                };
            }

            // Priority 3: Assign a brand new BUILD segment.
            const newBuildJob = this.db.prepare(`
                SELECT ws.id, ws.chunk_id, ws.segment_x, ws.segment_y, mc.json_path
                FROM work_segments ws JOIN map_chunks mc ON ws.chunk_id = mc.id
                WHERE mc.status = 'pending' AND ws.status = 'pending'
                ORDER BY ws.segment_y, ws.segment_x LIMIT 1
            `).get();

            if (newBuildJob) {
                this.db.prepare(`UPDATE work_segments SET status = 'assigned', assigned_to = ?, assigned_at = ? WHERE id = ?`).run(botId, now, newBuildJob.id);
                const segmentData = this.getSegmentData(newBuildJob.json_path, newBuildJob.segment_x, newBuildJob.segment_y);
                return {
                    type: 'BUILD_SEGMENT',
                    jobId: newBuildJob.id,
                    chunkId: newBuildJob.chunk_id,
                    segmentCoords: { x: newBuildJob.segment_x, y: newBuildJob.segment_y },
                    colorData: segmentData
                };
            }

            return null; // No jobs available.
        })();
    }


    completeJob(jobId, jobType) {
        this.db.transaction(() => {
            if (jobType === 'BUILD_SEGMENT') {
                const updateResult = this.db.prepare(`UPDATE work_segments SET status = 'completed', assigned_to = NULL, assigned_at = NULL WHERE id = ? AND status = 'assigned'`).run(jobId);
                if (updateResult.changes > 0) {
                     const { chunk_id } = this.db.prepare('SELECT chunk_id FROM work_segments WHERE id = ?').get(jobId);
                     const { count } = this.db.prepare('SELECT COUNT(*) as count FROM work_segments WHERE chunk_id = ? AND status != ?').get(chunk_id, 'completed');
                     if (count === 0) {
                         this.db.prepare(`UPDATE map_chunks SET status = 'in-progress' WHERE id = ? AND status = 'pending'`).run(chunk_id);
                     }
                }
            } else if (jobType === 'SAVE_MAP') {
                const updateResult = this.db.prepare(`UPDATE map_chunks SET status = 'completed', assigned_to = NULL, assigned_at = NULL WHERE id = ? AND status = 'saving'`).run(jobId);
                if (updateResult.changes > 0) {
                    const { map_art_id } = this.db.prepare(`SELECT map_art_id FROM map_chunks WHERE id = ?`).get(jobId);
                    const nextChunkToUnlock = this.db.prepare(`
                        SELECT id FROM map_chunks
                        WHERE map_art_id = ? AND status = 'locked'
                        ORDER BY chunk_y ASC, chunk_x ASC
                        LIMIT 1
                    `).get(map_art_id);

                    if (nextChunkToUnlock) {
                        this.db.prepare(`UPDATE map_chunks SET status = 'pending' WHERE id = ?`).run(nextChunkToUnlock.id);
                        console.log(`CHUNK UNLOCKED: Chunk ${nextChunkToUnlock.id} is now available for building.`);
                    } else {
                        this.db.prepare(`UPDATE map_arts SET status = 'completed' WHERE id = ?`).run(map_art_id);
                        console.log(`PROJECT COMPLETE: All chunks for map art ${map_art_id} are finished.`);
                    }
                }
            }
        })();
    }

    getSegmentData(jsonPath, segmentX, segmentY) {
        const fullData = require(path.resolve(jsonPath));
        const segmentData = [];
        // Extract a slice that is 32 wide and 16 high
        const startY = segmentY * 16;
        const startX = segmentX * 32;
        for(let i = 0; i < 16; i++){
            segmentData.push(fullData[startY + i].slice(startX, startX + 32));
        }
        return segmentData;
    }
}

module.exports = { MapArtDatabase };