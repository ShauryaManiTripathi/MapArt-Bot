const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const path = require('path');

class DatabaseManager {
    constructor(dbPath = path.join(process.cwd(), 'mapart.sqlite')) {
        this.dbPath = dbPath;
        this.db = null;
    }

    async init() {
        if (this.db) return;
        
        this.db = await open({
            filename: this.dbPath,
            driver: sqlite3.Database
        });

        await this.db.exec('PRAGMA journal_mode = WAL;'); // For better concurrency
        await this.db.exec('PRAGMA foreign_keys = ON;');
        
        // --- Create Tables ---
        await this.db.exec(`
            CREATE TABLE IF NOT EXISTS project (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                image_source TEXT NOT NULL,
                dithering_algorithm TEXT NOT NULL,
                is_active INTEGER NOT NULL DEFAULT 0,
                is_paused INTEGER NOT NULL DEFAULT 0,
                strip_width INTEGER NOT NULL,
                total_strips INTEGER NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );
        `);
        
        await this.db.exec(`
            CREATE TABLE IF NOT EXISTS blocks (
                x INTEGER NOT NULL,
                z INTEGER NOT NULL,
                color_name TEXT NOT NULL,
                item_id TEXT NOT NULL,
                is_placed INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY (x, z)
            );
        `);

        await this.db.exec(`
            CREATE TABLE IF NOT EXISTS strips (
                strip_index INTEGER PRIMARY KEY,
                status TEXT NOT NULL DEFAULT 'pending', -- pending, assigned, completed
                assigned_to TEXT,
                assigned_at DATETIME
            );
        `);
    }

    async clearProject() {
        await this.db.exec('DELETE FROM strips;');
        await this.db.exec('DELETE FROM blocks;');
        await this.db.exec('DELETE FROM project;');
    }
    
    async startNewMapArt(imageSource, dithering, imageData, stripWidth) {
        await this.clearProject();

        const totalStrips = Math.ceil(128 / stripWidth);

        await this.db.run(
            `INSERT INTO project (id, image_source, dithering_algorithm, is_active, is_paused, strip_width, total_strips)
             VALUES (1, ?, ?, 1, 0, ?, ?)`,
            [imageSource, dithering, stripWidth, totalStrips]
        );

        const blockInsertStmt = await this.db.prepare(
            'INSERT INTO blocks (x, z, color_name, item_id, is_placed) VALUES (?, ?, ?, ?, 0)'
        );
        for (let z = 0; z < 128; z++) {
            for (let x = 0; x < 128; x++) {
                const block = imageData[z][x];
                await blockInsertStmt.run(x, z, block.name, block.id);
            }
        }
        await blockInsertStmt.finalize();

        const stripInsertStmt = await this.db.prepare('INSERT INTO strips (strip_index) VALUES (?)');
        for (let i = 0; i < totalStrips; i++) {
            await stripInsertStmt.run(i);
        }
        await stripInsertStmt.finalize();
    }

    async getProjectState() {
        return this.db.get('SELECT * FROM project WHERE id = 1');
    }
    
    async setPaused(isPaused) {
        await this.db.run('UPDATE project SET is_paused = ? WHERE id = 1', [isPaused ? 1 : 0]);
    }

    async claimStrip(botUsername) {
        const result = await this.db.get("SELECT strip_index FROM strips WHERE status = 'pending' ORDER BY strip_index ASC LIMIT 1");
        if (!result) {
            return null; // No pending strips
        }
        
        const { strip_index } = result;
        await this.db.run(
            `UPDATE strips SET status = 'assigned', assigned_to = ?, assigned_at = CURRENT_TIMESTAMP WHERE strip_index = ? AND status = 'pending'`,
            [botUsername, strip_index]
        );
        
        // Verify we got it
        const final = await this.db.get('SELECT assigned_to FROM strips WHERE strip_index = ?', [strip_index]);
        return final.assigned_to === botUsername ? strip_index : null;
    }

    async releaseStrip(stripIndex) {
        await this.db.run(`UPDATE strips SET status = 'pending', assigned_to = NULL, assigned_at = NULL WHERE strip_index = ?`, [stripIndex]);
    }

    async completeStrip(stripIndex) {
        await this.db.run(`UPDATE strips SET status = 'completed' WHERE strip_index = ?`, [stripIndex]);
    }

    async updateBlockPlaced(x, z) {
        await this.db.run('UPDATE blocks SET is_placed = 1 WHERE x = ? AND z = ?', [x, z]);
    }
    
    async getPlacementsForStrip(stripIndex) {
        const project = await this.getProjectState();
        if (!project) return [];
        
        const startZ = stripIndex * project.strip_width;
        const endZ = Math.min(startZ + project.strip_width, 128);

        return this.db.all(
            `SELECT x, z, color_name, item_id FROM blocks 
             WHERE z >= ? AND z < ? AND is_placed = 0`,
            [startZ, endZ]
        );
    }

    async getCompletionStats() {
        const project = await this.getProjectState();
        if (!project) return { project: null };

        const counts = await this.db.get(`
            SELECT
                (SELECT COUNT(*) FROM blocks) as total_blocks,
                (SELECT COUNT(*) FROM blocks WHERE is_placed = 1) as placed_blocks,
                (SELECT COUNT(*) FROM strips WHERE status = 'pending') as pending_strips,
                (SELECT COUNT(*) FROM strips WHERE status = 'assigned') as assigned_strips,
                (SELECT COUNT(*) FROM strips WHERE status = 'completed') as completed_strips
        `);
        
        return {
            project,
            total_blocks: 128 * 128,
            placed_blocks: counts.placed_blocks,
            total_strips: project.total_strips,
            pending_strips: counts.pending_strips,
            assigned_strips: counts.assigned_strips,
            completed_strips: counts.completed_strips
        };
    }
}

module.exports = DatabaseManager;