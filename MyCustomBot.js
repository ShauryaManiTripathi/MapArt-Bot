// MyCustomBot.js

const { StateMachineBot, BOT_STATES } = require('./StateMachineBot.js');
const {
        pathfinder,
        goals,
        Movements,
      } = require("mineflayer-pathfinder");
const { mineflayer: mineflayerViewer } = require("prismarine-viewer");
const { vec3 } = require("vec3");

const axios = require('axios');
const API_BASE_URL = 'http://localhost:4000';

/**
 * A helper function for creating a non-blocking delay.
 * @param {number} ms - The number of milliseconds to wait.
 */
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Color Maps
 */
const COLOR_MAP = {
    white: { r: 221, g: 221, b: 221, id: 'white_carpet' },
    light_gray: { r: 170, g: 170, b: 170, id: 'light_gray_carpet' },
    gray: { r: 85, g: 85, b: 85, id: 'gray_carpet' },
    black: { r: 25, g: 25, b: 25, id: 'black_carpet' },
    brown: { r: 136, g: 85, b: 51, id: 'brown_carpet' },
    red: { r: 170, g: 51, b: 51, id: 'red_carpet' },
    orange: { r: 221, g: 119, b: 51, id: 'orange_carpet' },
    yellow: { r: 238, g: 204, b: 51, id: 'yellow_carpet' },
    lime: { r: 119, g: 187, b: 51, id: 'lime_carpet' },
    green: { r: 85, g: 119, b: 51, id: 'green_carpet' },
    cyan: { r: 51, g: 136, b: 153, id: 'cyan_carpet' },
    light_blue: { r: 85, g: 153, b: 221, id: 'light_blue_carpet' },
    blue: { r: 51, g: 68, b: 170, id: 'blue_carpet' },
    purple: { r: 119, g: 51, b: 187, id: 'purple_carpet' },
    magenta: { r: 187, g: 68, b: 187, id: 'magenta_carpet' },
    pink: { r: 238, g: 136, b: 170, id: 'pink_carpet' },
};
// color index to color name map, u can do like COLOR_NAMES[i].append("_carpet") to get the name of object too
const COLOR_NAMES = Object.keys(COLOR_MAP);


class MyCustomBot extends StateMachineBot {
    constructor(options, manager) {
        // Always call the parent constructor first!
        super(options, manager);

        this.mcData = require('minecraft-data')(this.options.version);
    }

    /**
     * Loading the plugins
     */
    _loadPlugins(){
        this.bot.loadPlugin(pathfinder);
        // mineflayerViewer(this.bot,{
        //   port: 3000,firstPerson: false});
        // return;
    }

    /**
     * This is where you define how the bot knows where it is.
     * @param {string} message - The chat message from the server.
     */
    _evaluateLocation(message) {
        // Note: It's more efficient to define mcData once in the constructor
        // if the bot version doesn't change during runtime.
        const ironBlockId = this.mcData.blocksByName.iron_block.id;
        const netherPortalId = this.mcData.blocksByName.nether_portal.id;
        console.log(`==================evaluating for ${this.bot.username} with ${message}`)
        
        // Example logic:
        if (message.toLowerCase().includes(", please login with the command: /login <password>")) {
            this.transitionTo(BOT_STATES.LOBBY);
        } else if (message.toLowerCase().includes("welcome to 6b6t.org")) {
            this.transitionTo(BOT_STATES.MAIN_SERVER);
        } else if (message.toLowerCase().includes("server is full, sending you to backup")) {
            this.transitionTo(BOT_STATES.BACKUP_SERVER);
        }
    }

    /**
     * This code runs once the bot enters the LOBBY state.
     * We make it async to allow for non-blocking delays.
     */
    async _onEnterLobby() {
        console.log(`[${this.options.username}] Now in LOBBY. Attempting to log in.`);

        try {
            // Automatically type login command
            if (this.options.password) {
                this.bot.chat(`/login ${this.options.password}`);
            }

            // Wait for login to process
            await sleep(10000);

            // If the server is not 6b6t, we're done here.
            if (!this.options.host.includes("6b6t")) {
                console.log("Not on 6b6t, skipping captcha.");
                return;
            }

            // === CAPTCHA SOLVER LOGIC START ===
            console.log("=== Initiating Captcha Solver ===");

            // Configure movements specifically for the captcha
            let captchaMovements = new Movements(this.bot, this.mcData);
            captchaMovements.allowSprinting = true;
            captchaMovements.allowParkour = true;
            captchaMovements.canDig = false;
            this.bot.pathfinder.setMovements(captchaMovements);

            // Start the green wool pathing process and wait for it to complete
            await this.startGreenWoolPath();

            console.log("=== Captcha Solved (or finished path) ===");

            // Stop any residual pathfinder movement
            this.bot.pathfinder.stop();

            // Reset movements to default for general use after captcha
            this.bot.pathfinder.setMovements(new Movements(this.bot, this.mcData));
            // === CAPTCHA SOLVER LOGIC END ===

        } catch (err) {
            console.error(`[${this.options.username}] Error in _onEnterLobby:`, err);
        }
    }

    /**
     * This code runs once the bot enters the MAIN_SERVER state.
     * It now uses a non-blocking async loop for its tasks.
     */
    async _onEnterMainServer() {
        console.log(`[${this.options.username}] In MAIN_SERVER. Starting map art job loop.`);
        this.currentJob = null;

        try {
            while (this.state === BOT_STATES.MAIN_SERVER) {
                if (!this.currentJob) {
                    this.currentJob = await this.requestJob();
                }

                if (this.currentJob) {
                    const success = await this.executeJob(this.currentJob);
                    if (success) {
                        await this.reportJobComplete(this.currentJob);
                    } else {
                        // The job will time out and be reassigned automatically by the server.
                        console.log(`[${this.options.username}] Failed job ${this.currentJob.jobId}. It will be re-queued after timeout.`);
                    }
                    this.currentJob = null; // Clear job to request a new one
                } else {
                    // No jobs were available, wait before trying again.
                    console.log(`[${this.options.username}] No jobs available. Waiting...`);
                    await sleep(3000); // Wait 3 seconds
                }
            }
        } catch (err) {
            console.error(`[${this.options.username}] Error in main server task loop:`, err);
        } finally {
            console.log(`[${this.options.username}] Exiting main server task loop.`);
        }
    }

    /**
     * This code runs once the bot enters the BACKUP_SERVER state.
     * This also uses the non-blocking async loop pattern.
     */
    async _onEnterBackupServer() {
        console.log(`[${this.options.username}] Connected to BACKUP_SERVER. Will periodically try to reconnect to main.`);

        try {
            // This loop will run as long as the bot is in the BACKUP_SERVER state.
            while (this.state === BOT_STATES.BACKUP_SERVER) {
                console.log(`[${this.options.username}] Trying to get back to the main server...`);
                this.bot.chat('/server main');

                // Wait for 1 minute before retrying.
                await sleep(60000);
            }
        } catch (err) {
            console.error(`[${this.options.username}] Error in backup server task loop:`, err);
        } finally {
            console.log(`[${this.options.username}] Exiting backup server task loop as state has changed.`);
        }
    }
    
    /**
     * Override disconnect. Since we are no longer using setInterval,
     * we don't need to clear anything. The async loops will stop automatically
     * when the state changes. We keep the override for potential future cleanup.
     */
    disconnect(reason) {
        console.log(`[${this.options.username}] Cleaning up custom tasks before disconnect.`);
        // Any other cleanup logic can go here.
        
        // Call the parent method to handle the actual disconnection
        super.disconnect(reason);
    }

    // ! ////////////////////////// onLobby Helpers //////////////////////////
    getGreenWoolPositions() {
        const range = 50;
        const greenWoolPositions = [];

        for (const entityId in this.bot.entities) {
            const entity = this.bot.entities[entityId];
            if (entity.type === "block_display" || entity.name === "block_display") {
                const translation = entity.metadata ?.[11] || { x: 0, y: 0, z: 0 };
                const scale = entity.metadata ?.[12] || { x: 1, y: 1, z: 1 };

                const visualPos = {
                    x: entity.position.x + (translation.x || 0) + 0.5 * (scale.x || 1),
                    y: entity.position.y + (translation.y || 0) + 0.5 * (scale.y || 1),
                    z: entity.position.z + (translation.z || 0) + 0.5 * (scale.z || 1),
                };

                const blockStateId = entity.metadata ?.[15] || entity.metadata ?.[23];
                let isGreenWool = false;

                if (blockStateId) {
                    try {
                        const blockState = this.mcData.blocksByStateId[blockStateId];
                        const blockName = blockState ? blockState.name : "";
                        isGreenWool = blockName.includes("green_wool");
                    } catch (e) { /* ignore */ }
                }

                if (isGreenWool) {
                    const playerPos = this.bot.entity.position;
                    if (
                        Math.abs(visualPos.x - playerPos.x) <= range &&
                        Math.abs(visualPos.z - playerPos.z) <= range
                    ) {
                        greenWoolPositions.push(visualPos);
                    }
                }
            }
        }

        return greenWoolPositions;
    }

    findNextGreenWool(currentPos, greenWoolPositions, visitedCoords) {
        let closestPos = null;
        let closestDistance = Infinity;
        for (const pos of greenWoolPositions) {
            const coordKey = `${Math.floor(pos.x)},${Math.floor(pos.z)}`;

            if (visitedCoords.has(coordKey)) continue;

            const distance = Math.sqrt(
                Math.pow(pos.x - currentPos.x, 2) + Math.pow(pos.z - currentPos.z, 2)
            );

            if (distance <= 2.5 && distance < closestDistance) {
                closestDistance = distance;
                closestPos = pos;
            }
        }
        return closestPos;
    }

    async moveToPositionEnhanced(targetPos, description = "target") {
        this.bot.swingArm("right");
        try {
            const goal = new goals.GoalBlock(
                Math.floor(targetPos.x),
                Math.floor(targetPos.y + 1), // Aim for head height to avoid getting stuck
                Math.floor(targetPos.z)
            );

            await this.bot.pathfinder.goto(goal);
            this.bot.swingArm("right");
        } catch (error) {
            console.log(`⚠️  Pathfinding to ${description} failed:`, error.message);
        }
    }

    async followGreenWoolPath() {
        let stepNumber = 1;
        let visitedCoords = new Set();
        const greenWoolPositions = this.getGreenWoolPositions();

        console.log(`Found ${greenWoolPositions.length} potential green wool blocks.`);

        while (stepNumber <= 50) { // Safety break after 50 steps
            const currentPos = this.bot.entity.position;
            const currentCoordKey = `${Math.floor(currentPos.x)},${Math.floor(currentPos.z)}`;
            visitedCoords.add(currentCoordKey);

            const nextPos = this.findNextGreenWool(currentPos, greenWoolPositions, visitedCoords);

            if (!nextPos) {
                console.log("No more green wool blocks found in range.");
                break;
            }
            
            console.log(`Step ${stepNumber}: Moving to next green wool.`);
            await this.moveToPositionEnhanced(nextPos, "green wool");
            stepNumber++;
        }

        console.log("Finished following wool path. Moving to final portal position.");
        const portalPos = { x: -1001, y: 101, z: -988 };
        try {
            const goal = new goals.GoalBlock(portalPos.x, portalPos.y, portalPos.z);
            await this.bot.pathfinder.goto(goal);
        } catch (error) {
            console.error("Failed to pathfind to the final portal:", error.message);
        }
    }

    async startGreenWoolPath() {
        // Initial movement to align with the path
        const currentPos = this.bot.entity.position.clone();
        const initialTarget = currentPos.offset(0, 0, 1.5);
        await this.moveToPositionEnhanced(initialTarget, "initial position");
        
        // Follow the main path
        await this.followGreenWoolPath();
    }
    // ! /////////////////////////////////////////////////////////////////////

    // ! ////////////////////////// onMainServer Helpers ////////////////////////////////
    /**
     * Requests a job from the central API server.
     */
    async requestJob() {
        try {
            console.log(`[${this.options.username}] Requesting a job...`);
            const response = await axios.post(`${API_BASE_URL}/api/jobs/request`, {
                botId: this.bot.username
            });

            if (response.data && response.data.jobId) {
                console.log(`[${this.options.username}] Received job: ${response.data.type}`);
                return response.data;
            }
            return null;
        } catch (error) {
            console.error(`[${this.options.username}] Could not request job:`, error.message);
            return null;
        }
    }
     /**
     * Executes the logic for the received job.
     * @param {object} job The job object from the server.
     * @returns {boolean} True if successful, false otherwise.
     */
    async executeJob(job) {
        console.log(`[${this.options.username}] Executing job ${job.jobId} of type ${job.type}`);
        if (job.type === 'BUILD_SEGMENT') {
            // TODO: Implement the logic to build the 16x32 area.
            // You have `job.colorData` (a 2D array of color indexes)
            // and `job.segmentCoords` (the relative position within the 128x128 chunk).
            // You will need to calculate the absolute world coordinates.

            this.bot.chat(`Building segment ${job.segmentCoords.x}, ${job.segmentCoords.y}`);


            await sleep(1000); // Placeholder for actual building time

            return true; // Assume success for now
        } else if (job.type === 'SAVE_MAP') {
            // Implement the map saving algorithm
            this.bot.chat(`I am now saving the map for chunk ${job.chunkCoords.x}, ${job.chunkCoords.y}`);
            
            try {
                // Step 1: Search for a diamond block anywhere and go stand on top of it
                const diamondBlock = await this.findAndGoToDiamondBlock();
                if (!diamondBlock) {
                    console.log(`[${this.options.username}] No diamond block found!`);
                    return false;
                }

                // Step 2: Search for a barrel, take out map and glass pane
                const mapAndPane = await this.getMapAndGlassPaneFromBarrel();
                if (!mapAndPane) {
                    console.log(`[${this.options.username}] Could not get map and glass pane from barrel!`);
                    return false;
                }

                // Step 3: Hold map in hotbar and right click it
                await this.activateMap();

                // Step 4: Search for cartography table and lock the map
                const lockingSuccess = await this.lockMapAtCartographyTable();
                if (!lockingSuccess) {
                    console.log(`[${this.options.username}] Failed to lock map at cartography table!`);
                    return false;
                }

                // Step 5: Search for nearest chest and put the locked map into it
                const chestSuccess = await this.putMapInChest();
                if (!chestSuccess) {
                    console.log(`[${this.options.username}] Failed to put map in chest!`);
                    return false;
                }

                // Step 6: Flush Old Map
                const buttonSuccess = await this.flushOldMap();
                if (!buttonSuccess) {
                    console.log(`[${this.options.username}] Failed to press the completion button!`);
                    return false; // Fail the entire job if the button press fails.
                }

                console.log(`[${this.options.username}] Successfully completed map saving algorithm!`);
                return true;

            } catch (error) {
                console.error(`[${this.options.username}] Error in map saving algorithm:`, error);
                return false;
            }
        }
        return false;
    }

    /**
     * Reports a job as successfully completed to the API server.
     * @param {object} job The job object.
     */
    async reportJobComplete(job) {
        try {
            await axios.post(`${API_BASE_URL}/api/jobs/complete`, {
                jobId: job.jobId,
                jobType: job.type
            });
            console.log(`[${this.options.username}] Successfully reported completion for job ${job.jobId}.`);
        } catch (error) {
            console.error(`[${this.options.username}] Could not report job completion:`, error.message);
        }
    }
    // ! ////////////////////////////////////////////////////////////////////////////////

    // ! /////////////////////////////////  executeJob Helper - SAVEMAP  ////////////////////////////////////////

/**
 * Step 1: Find a diamond block and go stand on top of it
 */
async findAndGoToDiamondBlock() {
    console.log(`[${this.options.username}] Searching for diamond block...`);
    
    const diamondBlockId = this.mcData.blocksByName.diamond_block.id;

    // The old, inefficient loop is replaced by this single, efficient line:
    const diamondBlock = this.bot.findBlock({
        matching: diamondBlockId,
        maxDistance: 100 // Search radius
    });
    
    if (!diamondBlock) {
        console.error(`[${this.options.username}] Could not find a diamond block within range.`);
        return null;
    }
    
    // The rest of the logic remains the same.
    const targetPos = diamondBlock.position.offset(0, 1, 0);
    const goal = new goals.GoalBlock(targetPos.x, targetPos.y, targetPos.z);
    
    try {
        await this.bot.pathfinder.goto(goal);
        console.log(`[${this.options.username}] Standing on diamond block at ${diamondBlock.position}`);
        return diamondBlock;
    } catch (error) {
        console.error(`[${this.options.username}] Failed to reach diamond block:`, error);
        return null;
    }
}

/**
 * Step 2: Find a barrel and take out map and glass pane
 */
async getMapAndGlassPaneFromBarrel() {
    console.log(`[${this.options.username}] Searching for barrel...`);
    
    const barrelId = this.mcData.blocksByName.barrel.id;

    const barrel = this.bot.findBlock({
        matching: barrelId,
        maxDistance: 50
    });
    
    if (!barrel) {
        console.log(`[${this.options.username}] No barrel found!`);
        return null;
    }
    
    try {
        // Open the barrel
        const barrelContainer = await this.bot.openContainer(barrel);
        await sleep(500); // Wait for container to open
        
        // Look for map and glass pane
        const mapItem = this.mcData.itemsByName.map || this.mcData.itemsByName.empty_map;
        const glassPaneItem = this.mcData.itemsByName.glass_pane;
        
        let foundMap = false;
        let foundGlassPane = false;
        
        // Take map from barrel
        const mapSlot = barrelContainer.containerItems().find(item => 
            item && (item.type === mapItem.id)
        );
        
        if (mapSlot) {
            await barrelContainer.withdraw(mapSlot.type, null, 1);
            foundMap = true;
            console.log(`[${this.options.username}] Took map from barrel`);
        }
        
        // Take glass pane from barrel
        const glassPaneSlot = barrelContainer.containerItems().find(item => 
            item && item.type === glassPaneItem.id
        );
        
        if (glassPaneSlot) {
            await barrelContainer.withdraw(glassPaneSlot.type, null, 1);
            foundGlassPane = true;
            console.log(`[${this.options.username}] Took glass pane from barrel`);
        }
        
        // Close the barrel
        await barrelContainer.close();
        
        return foundMap && foundGlassPane;
        
    } catch (error) {
        console.error(`[${this.options.username}] Error accessing barrel:`, error);
        return null;
    }
}

/**
 * Step 3: Hold map in hotbar and right click it
 */
async activateMap() {
    console.log(`[${this.options.username}] Activating map...`);
    
    const mapItem = this.mcData.itemsByName.map || this.mcData.itemsByName.empty_map;
    
    // Find map in inventory
    const mapSlot = this.bot.inventory.findInventoryItem(mapItem.id);
    
    if (!mapSlot) {
        console.log(`[${this.options.username}] Map not found in inventory!`);
        return false;
    }
    
    try {
        // Equip the map to hotbar
        await this.bot.equip(mapItem.id, 'hand');
        await sleep(500);
        
        // Right click (activate) the map
        this.bot.activateItem();
        await sleep(1000);
        
        console.log(`[${this.options.username}] Map activated successfully`);
        return true;
        
    } catch (error) {
        console.error(`[${this.options.username}] Error activating map:`, error);
        return false;
    }
}

/**
 * Step 4: Find cartography table and lock the map
 */
async lockMapAtCartographyTable() {
    console.log(`[${this.options.username}] Searching for cartography table...`);
    
    const cartographyTableId = this.mcData.blocksByName.cartography_table.id;
    
    // Find cartography table
    const cartographyTable = this.bot.findBlock({
        matching: cartographyTableId,
        maxDistance: 50
    });
    
    if (!cartographyTable) {
        console.log(`[${this.options.username}] No cartography table found!`);
        return false;
    }
    
    try {
        // Change 1: Use openBlock for reliability, as it directly returns the window.
        const window = await this.bot.openBlock(cartographyTable);
        
        // Get item IDs
        const filledMapId = this.mcData.itemsByName.filled_map.id;
        const glassPaneId = this.mcData.itemsByName.glass_pane.id;
        
        // Change 2: Use the simpler deposit method. This is the main fix for your error.
        // It tells Mineflayer "find a filled_map and deposit it", which is more robust.
        await window.deposit(filledMapId, null, 1);
        await sleep(1000); // Wait after depositing
        
        await window.deposit(glassPaneId, null, 1);
        await sleep(1000);
        
        // Change 3: Add a longer, crucial delay here.
        // We must wait for the server to process the recipe and send us the "set slot" packet
        // for the output slot. 3 seconds is a safe bet for most servers.
        console.log(`[${this.options.username}] Items deposited. Waiting for server to craft locked map...`);
        await sleep(3000);
        
        // Change 4: Add a safety check, just like the example code.
        // Before we try to take the item, make SURE it's there. The output is slot 2.
        const outputSlot = window.slots[2];
        if (outputSlot?.type !== filledMapId) {
            console.error(`[${this.options.username}] Error: Locked map did not appear in the output slot!`);
            await window.close();
            return false;
        }

        console.log(`[${this.options.username}] Locked map appeared. Taking it now.`);
        
        // Now it's safe to take the result.
        await window.withdraw(outputSlot.type, null, outputSlot.count,outputSlot.nbt);
        
        
        await window.close();
        console.log(`[${this.options.username}] Successfully locked map and closed window.`);
        return true;
        
    } catch (error) {
        // The catch block is more robust now.
        console.error(`[${this.options.username}] A critical error occurred using the cartography table:`, error.message);
        if (this.bot.currentWindow) {
            await this.bot.closeWindow(this.bot.currentWindow);
        }
        return false;
    }
}

/**
 * Step 5: Find nearest chest and put the locked map into it
 */
async putMapInChest() {
    console.log(`[${this.options.username}] Searching for nearest chest...`);
    
    const chestId = this.mcData.blocksByName.chest.id;

    const nearestChest = this.bot.findBlock({
        matching: chestId,
        maxDistance: 50
    });
    
    if (!nearestChest) {
        console.log(`[${this.options.username}] No chest found!`);
        return false;
    }
    
    try {
        // Move to chest
        const chestPos = nearestChest.position;
        // const goal = new goals.GoalBlock(chestPos.x, chestPos.y, chestPos.z);
        // await this.bot.pathfinder.goto(goal);
        
        // Open the chest
        const chestContainer = await this.bot.openContainer(nearestChest);
        await sleep(500);
        
        // Put the locked map into the chest
        const mapItem = this.mcData.itemsByName.filled_map || this.mcData.itemsByName.map;
        
        // Find the map in inventory (should be the locked one now)
        const lockedMap = this.bot.inventory.findInventoryItem(mapItem.id);
        
        if (lockedMap) {
            await chestContainer.deposit(mapItem.id, null, 1);
            console.log(`[${this.options.username}] Locked map deposited in chest`);
        }
        
        // Close the chest
        await chestContainer.close();
        
        return true;
        
    } catch (error) {
        console.error(`[${this.options.username}] Error accessing chest:`, error);
        return false;
    }
}

/**
 * Step 6: Find and press a nearby oak button to signal completion.
 */
async flushOldMap() {
    console.log(`[${this.options.username}] Searching for a nearby oak button...`);

    const oakButtonId = this.mcData.blocksByName.oak_button.id;
    const searchRadius = 10; // The button should be close.

    // Use the efficient findBlock method.
    const button = this.bot.findBlock({
        matching: oakButtonId,
        maxDistance: searchRadius
    });

    if (!button) {
        console.error(`[${this.options.username}] No oak button found within ${searchRadius} blocks.`);
        return false; // Indicate failure
    }

    try {
        console.log(`[${this.options.username}] Found oak button at ${button.position}. Pressing it.`);
        // Activating the block is all that's needed to press it.
        await this.bot.activateBlock(button);
        await sleep(50000); // Let it flush
        console.log(`[${this.options.username}] Successfully pressed the oak button.`);
        return true; // Indicate success
    } catch (error) {
        console.error(`[${this.options.username}] Failed to press the oak button:`, error.message);
        return false;
    }
}


    // ! ////////////////////////////////////////////////////////////////////////////////


}

module.exports = MyCustomBot;