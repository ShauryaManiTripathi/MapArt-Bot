const { Vec3 } = require('vec3');
const { GoalNear, GoalBlock } = require('mineflayer-pathfinder').goals;

// A set of blocks that require sneaking to place another block on top of them.
const INTERACTABLE_BLOCKS = new Set([
    'chest', 'trapped_chest', 'ender_chest', 'barrel',
    'furnace', 'blast_furnace', 'smoker',
    'dispenser', 'dropper', 'hopper',
    'crafting_table', 'enchanting_table', 'anvil', 'chipped_anvil', 'damaged_anvil',
    'brewing_stand', 'beacon', 'note_block', 'jukebox', 'loom', 'cartography_table',
    'fletching_table', 'grindstone', 'smithing_table', 'stonecutter'
]);

// Helper function to check for interactable blocks, including shulker boxes by name.
function needsSneakToPlaceOn(block) {
    if (!block) return false;
    return INTERACTABLE_BLOCKS.has(block.name) || block.name.includes('shulker_box');
}

class StripPlacer {
    /**
     * @param {import('mineflayer').Bot} bot - The mineflayer bot instance.
     * @param {object} mcData - Minecraft data.
     * @param {object} mapArtOffsets - The map art configuration.
     * @param {import('../utils/DatabaseManager')} db - The database manager instance.
     */
    constructor(bot, mcData, mapArtOffsets, db) {
        this.bot = bot;
        this.mcData = mcData;
        this.mapArtOffsets = mapArtOffsets;
        this.db = db;
        this.mapArtOrigin = new Vec3(...mapArtOffsets.start);
        
        // World coordinates of the map art boundaries
        this.minBound = this.mapArtOrigin.plus(new Vec3(...mapArtOffsets.offsets.end));
        this.maxBound = this.mapArtOrigin;

        this.isPaused = false;
        this.isStopped = false;
    }

    pause() { this.isPaused = true; }
    continue() { this.isPaused = false; }
    stop() { 
        this.isStopped = true; 
        this.isPaused = false;
        this.bot.pathfinder.stop();
    }
    
    _groupIntoFourRowBatches(placements) {
        const rows = placements.reduce((acc, p) => {
            acc[p.x] = acc[p.x] || [];
            acc[p.x].push(p);
            return acc;
        }, {});

        const sortedRowKeys = Object.keys(rows).sort((a, b) => a - b);
        const batches = [];
        for (let i = 0; i < sortedRowKeys.length; i += 4) {
            const batch = [];
            for (let j = 0; j < 4 && i + j < sortedRowKeys.length; j++) {
                const row = rows[sortedRowKeys[i + j]].sort((a, b) => a.z - b.z);
                batch.push(...row);
            }
            batches.push(batch);
        }
        return batches;
    }
    
    findSafeStandPosForBatch(batch) {
        if (batch.length === 0) return null;

        const minX = Math.min(...batch.map(p => p.x));
        const maxX = Math.max(...batch.map(p => p.x));
        const minZ = Math.min(...batch.map(p => p.z));
        const maxZ = Math.max(...batch.map(p => p.z));

        const minWorldX = this.mapArtOrigin.x - maxX;
        const maxWorldX = this.mapArtOrigin.x - minX;
        const minWorldZ = this.mapArtOrigin.z - maxZ;
        const maxWorldZ = this.mapArtOrigin.z - minZ;

        const candidates = [];
        for (let x = minWorldX - 1; x <= maxWorldX + 1; x++) {
            candidates.push(new Vec3(x, this.mapArtOrigin.y, minWorldZ - 1));
            candidates.push(new Vec3(x, this.mapArtOrigin.y, maxWorldZ + 1));
        }
        for (let z = minWorldZ - 1; z <= maxWorldZ + 1; z++) {
            candidates.push(new Vec3(minWorldX - 1, this.mapArtOrigin.y, z));
            candidates.push(new Vec3(maxWorldX + 1, this.mapArtOrigin.y, z));
        }

        for (const candidate of candidates) {
            if (candidate.x >= this.minBound.x && candidate.x <= this.maxBound.x &&
                candidate.z >= this.minBound.z && candidate.z <= this.maxBound.z) {
                const footBlock = this.bot.blockAt(candidate);
                const headBlock = this.bot.blockAt(candidate.offset(0, 1, 0));
                
                if (footBlock && headBlock && 
                    (footBlock.boundingBox === 'empty' || footBlock.name.endsWith('_carpet')) && 
                    headBlock.boundingBox === 'empty') {
                    
                    let allReachable = batch.every(placement => {
                        const targetPos = this.mapArtOrigin.offset(-placement.x, 0, -placement.z);
                        return candidate.distanceTo(targetPos) <= 4.5;
                    });
                    
                    if (allReachable) return candidate;
                }
            }
        }
        return null;
    }
    
    async placeBatchFromPosition(batch, standPos) {
        await this.bot.pathfinder.goto(new GoalBlock(standPos.x, standPos.y, standPos.z));
        
        for (const placement of batch) {
            while (this.isPaused && !this.isStopped) {
                await this.bot.waitForTicks(20);
            }
            if (this.isStopped) return;

            const targetPos = this.mapArtOrigin.offset(-placement.x, 0, -placement.z);
            const blockBelowPos = targetPos.offset(0, -1, 0);

            let retryCount = 0;
            const maxRetries = 3;
            
            while (retryCount < maxRetries) {
                try {
                    await this.bot.lookAt(targetPos, true);

                    const currentBlock = this.bot.blockAt(targetPos);
                    const targetItem = this.mcData.itemsByName[placement.item_id];

                    if (currentBlock && currentBlock.type === this.mcData.blocksByName[placement.item_id].id) {
                        await this.db.updateBlockPlaced(placement.x, placement.z);
                        break;
                    }
                    
                    if (currentBlock && currentBlock.name !== 'air') {
                        await this.bot.dig(currentBlock, true);
                    }

                    if (!this.bot.inventory.findInventoryItem(targetItem.id)) throw new Error(`Missing item ${placement.item_id}`);
                    await this.bot.equip(targetItem.id, 'hand');
                    if (!this.bot.heldItem || this.bot.heldItem.type !== targetItem.id) throw new Error(`Failed to equip ${placement.item_id}`);
                    
                    const referenceBlock = this.bot.blockAt(blockBelowPos);
                    if (!referenceBlock) throw new Error(`Reference block at ${blockBelowPos} is missing/unloaded.`);
                    
                    const shouldSneak = needsSneakToPlaceOn(referenceBlock);
                    if (shouldSneak) this.bot.setControlState('sneak', true);
                    
                    try {
                        await this.bot.placeBlock(referenceBlock, new Vec3(0, 1, 0));
                    } finally {
                        if (shouldSneak) this.bot.setControlState('sneak', false);
                    }

                    await this.db.updateBlockPlaced(placement.x, placement.z);
                    break;
                    
                } catch (err) {
                    retryCount++;
                    console.error(`[${this.bot.username}] Error placing block at (${placement.x}, ${placement.z}), attempt ${retryCount}/${maxRetries}: ${err.message}`);
                    if (retryCount >= maxRetries) console.error(`[${this.bot.username}] Failed to place block at (${placement.x}, ${placement.z}) after ${maxRetries} attempts. Skipping.`);
                    else await this.bot.waitForTicks(10);
                }
            }
        }
    }
    
    async buildCurrentStrip(stripIndex) {
        this.isStopped = false;
        // isPaused is controlled by the main bot loop
        
        const placements = await this.db.getPlacementsForStrip(stripIndex);
        if (placements.length === 0) {
            console.log(`[${this.bot.username}] Strip ${stripIndex} is already complete.`);
            return true;
        }

        const batches = this._groupIntoFourRowBatches(placements);
        console.log(`[${this.bot.username}] Starting strip ${stripIndex} with ${batches.length} batches (${placements.length} blocks).`);

        for (let i = 0; i < batches.length; i++) {
            const batch = batches[i];
            
            while (this.isPaused && !this.isStopped) {
                await this.bot.waitForTicks(20);
            }
            if (this.isStopped) {
                console.log(`[${this.bot.username}] Strip building stopped.`);
                return false;
            }

            const standPos = this.findSafeStandPosForBatch(batch);
            if (!standPos) {
                console.error(`[${this.bot.username}] Could not find a safe standing position for batch ${i + 1}. This batch will be skipped.`);
                continue;
            }

            await this.placeBatchFromPosition(batch, standPos);
        }

        // Final check to see if all placements are done
        const remainingPlacements = await this.db.getPlacementsForStrip(stripIndex);
        return remainingPlacements.length === 0;
    }
}

module.exports = StripPlacer;