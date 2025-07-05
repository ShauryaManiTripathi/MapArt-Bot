const MinimalBot = require("./MinimalBot.js");
const mapArtOffsets = require("./config/mapart_offsets.js");

const Restocker = require("./src/modules/Restocker");
const StripPlacer = require("./src/modules/StripPlacer");

class MapArtBot extends MinimalBot {
  /**
   * @param {object} options - Bot configuration options.
   * @param {import('./src/utils/DatabaseManager')} db - The database manager instance.
   * @param {number} botIndex - The unique index of this bot worker.
   * @param {number} totalBots - The total number of bots in the pool.
   */
  constructor(options, db, botIndex, totalBots) {
    super(options);

    this.db = db;
    this.botIndex = botIndex;
    this.totalBots = totalBots;

    this.state = "IDLE"; // IDLE, CLAIMING, BUILDING, RESTOCKING
    this.currentStripIndex = null;
    this.shouldRun = true;

    this.mcData = null;
    this.restocker = null;
    this.stripPlacer = null;
  }

  async initialize() {
    await super.initialize();
    this.mcData = require("minecraft-data")(this.bot.version);

    // Pass db instance to modules that need it
    this.restocker = new Restocker(this.bot, this.mcData, mapArtOffsets);
    this.stripPlacer = new StripPlacer(this.bot, this.mcData, mapArtOffsets, this.db);

    console.log(`[${this.bot.username}] Connected and ready for tasks.`);

    this.mainLoop(); // Start the main logic loop
  }
  
  shutdown() {
      this.shouldRun = false;
      this.stripPlacer.stop();
      if (this.currentStripIndex !== null) {
          console.log(`[${this.bot.username}] Releasing strip ${this.currentStripIndex} due to shutdown.`);
          this.db.releaseStrip(this.currentStripIndex);
      }
      this.disconnect();
  }

  // --- Main Logic Loop ---
  async mainLoop() {
    await this.bot.waitForTicks(200*(this.totalBots-this.botIndex));
    while (this.shouldRun) {
      await this.bot.waitForTicks(20); // Loop runs every second

      const projectState = await this.db.getProjectState();

      if (!projectState || !projectState.is_active || projectState.is_paused) {
        if (this.state !== "IDLE") {
          console.log(`[${this.bot.username}] Project is paused or inactive. Idling.`);
          this.state = "IDLE";
          this.stripPlacer.pause();
        }
        continue;
      }
      
      // If we were paused and are now continuing
      if (this.state === "IDLE" && this.currentStripIndex !== null) {
          this.state = "BUILDING"; // Go back to building the strip we already have
          this.stripPlacer.continue();
      }

      // --- Claiming State ---
      if (this.currentStripIndex === null) {
        this.state = "CLAIMING";
        const claimedStrip = await this.db.claimStrip(this.bot.username, this.botIndex, this.totalBots);

        if (claimedStrip !== null) {
          this.currentStripIndex = claimedStrip;
          this.state = "BUILDING";
          console.log(`[${this.bot.username}] Claimed strip ${this.currentStripIndex}. Starting work.`);
          this.stripPlacer.continue(); // Ensure placer is not paused from previous state
        } else {
          // No strips available. The map might be done or others are working.
          const stats = await this.db.getCompletionStats();
          if (stats.pending_strips === 0 && stats.assigned_strips === 0) {
              // --- CHANGE: Instead of shutting down, go idle and wait for a new project. ---
              console.log(`[${this.bot.username}] All strips are complete. Idling and awaiting new project orders.`);
              this.state = "IDLE";
              // this.shutdown(); // <-- REMOVED
          } else {
              // console.log(`[${this.bot.username}] No pending strips to claim. Waiting...`);
          }
        }
        continue;
      }
      
      // --- Building State ---
      if (this.state === "BUILDING") {
        const required = await this.getRequiredMaterialsForStrip(this.currentStripIndex);
        if (Object.keys(required).length === 0) {
          // Strip is done, complete it and go back to claiming
          console.log(`[${this.bot.username}] Finished building strip ${this.currentStripIndex}.`);
          await this.db.completeStrip(this.currentStripIndex);
          this.currentStripIndex = null;
          this.state = "CLAIMING";
          continue;
        }

        if (!this._hasMaterials(required)) {
          console.log(`[${this.bot.username}] Insufficient materials for strip ${this.currentStripIndex}. Switching to restock mode.`);
          this.state = "RESTOCKING";
        } else {
          const isComplete = await this.stripPlacer.buildCurrentStrip(this.currentStripIndex);
          if (isComplete) {
            console.log(`[${this.bot.username}] Finished building strip ${this.currentStripIndex}.`);
            await this.db.completeStrip(this.currentStripIndex);
            this.currentStripIndex = null;
            this.state = "CLAIMING";
          }
          // After buildStrip returns, the loop will re-evaluate.
        }
      }

      // --- Restocking State ---
      if (this.state === "RESTOCKING") {
        const required = await this.getRequiredMaterialsForStrip(this.currentStripIndex);
        const success = await this.restocker.restock(required);
        if (success) {
          console.log(`[${this.bot.username}] Restocking complete. Resuming building.`);
          this.state = "BUILDING";
        } else {
          console.log(`[${this.bot.username}] Failed to restock all materials. Releasing strip ${this.currentStripIndex} and pausing for 5 minutes.`);
          await this.db.releaseStrip(this.currentStripIndex);
          this.currentStripIndex = null;
          this.state = "IDLE";
          await this.bot.waitForTicks(20 * 60 * 5); // Wait 5 minutes
        }
      }
    }
  }

  async getRequiredMaterialsForStrip(stripIndex) {
      const requiredMaterials = {};
      const placements = await this.db.getPlacementsForStrip(stripIndex);

      for (const placement of placements) {
          requiredMaterials[placement.item_id] = (requiredMaterials[placement.item_id] || 0) + 1;
      }
      return requiredMaterials;
  }

  _hasMaterials(required) {
    for (const itemName in required) {
      const requiredCount = required[itemName];
      const currentCount = this.bot.inventory.count(this.mcData.itemsByName[itemName].id, null);
      if (currentCount < requiredCount) {
        return false;
      }
    }
    return true;
  }
}

module.exports = MapArtBot;