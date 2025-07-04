const MinimalBot = require("./MinimalBot.js");
const botConfig = require("./config/bot_config.json");
const mapArtOffsets = require("./config/mapart_offsets.js");

const ProgressManager = require("./src/utils/ProgressManager");
const ImageProcessor = require("./src/utils/ImageProcessor");
const Restocker = require("./src/modules/Restocker");
const StripPlacer = require("./src/modules/StripPlacer");

class MapArtBot extends MinimalBot {
  constructor(options) {
    super(options);

    this.state = "IDLE"; // IDLE, BUILDING, RESTOCKING, PAUSED
    this.master = options.master_username;
    this.mcData = null; // FIX: Initialize mcData as a class property

    this.progressManager = new ProgressManager();
    this.restocker = null; // Initialized on spawn
    this.stripPlacer = null; // Initialized on spawn
  }

  async initialize() {
    await super.initialize();
    // FIX: Assign to the class property `this.mcData`
    this.mcData = require("minecraft-data")(this.bot.version);

    // Now pass `this.mcData` to the other modules
    this.restocker = new Restocker(this.bot, this.mcData, mapArtOffsets);
    this.stripPlacer = new StripPlacer(
      this.bot,
      this.mcData,
      mapArtOffsets,
      this.progressManager
    );

    await this.progressManager.load();

    this.bot.on("chat", (username, message) => {
      if (username !== this.master) return;
      this.handleCommand(message.trim());
    });

    this.bot.chat(
      `/msg ${this.master} MapArtBot connected and ready for commands.`
    );
    console.log(`Listening for commands from: ${this.master}`);

    // Check if we need to resume work on connect
    const progress = this.progressManager.get();
    if (progress.isActive && !progress.isPaused) {
      this.state = "BUILDING";
      this.bot.chat(`/msg ${this.master} Resuming previous map art project.`);
    }

    this.mainLoop(); // Start the main logic loop
  }

  // --- Command Handlers ---
  async handleCommand(message) {
    const [command, ...args] = message.split(" ");

    switch (command.toLowerCase()) {
      case "start":
        this.handleStart(args.join(" "));
        break;
      case "pause":
        this.handlePause();
        break;
      case "continue":
        this.handleContinue();
        break;
      case "clear":
        this.handleClear();
        break;
      case "status":
        this.handleStatus();
        break;
      default:
        this.bot.chat(
          `/msg ${this.master} Unknown command. Try: start, pause, continue, clear, status.`
        );
    }
  }

    async handleStart(imageSource, ditheringAlgorithm) {
        if (this.state !== 'IDLE') {
            return this.bot.chat(
                `/msg ${this.master} A project is already active. Use 'clear' first.`
            );
        }
        if (!imageSource) {
            return this.bot.chat(
                `/msg ${this.master} Usage: start <url_or_file> [dithering_algorithm], Valid options are: ${validAlgorithms.join(', ')}`
            );
        }

        const validAlgorithms = [
            'floydSteinberg', 'jarvisJudiceNinke', 'stucki',
            'atkinson', 'sierra', 'burkes'
        ];


        // If an algorithm is provided, validate it.
        if (ditheringAlgorithm && !validAlgorithms.includes(ditheringAlgorithm)) {
            this.bot.chat(`/msg ${this.master} Invalid dithering algorithm: "${ditheringAlgorithm}".`);
            this.bot.chat(`/msg ${this.master} Valid options are: ${validAlgorithms.join(', ')}`);
            return;
        }
        
        // Use the provided algorithm, or the default if none is given.
        const algoToUse = ditheringAlgorithm || 'floydSteinberg';
        this.bot.chat(
            `/msg ${this.master} Processing image: ${imageSource} with ${algoToUse} dithering. Valid options are: ${validAlgorithms.join(', ')}`
        );

        const imageData = await ImageProcessor.processImage(imageSource, algoToUse);

        if (!imageData) {
            return this.bot.chat(`/msg ${this.master} Failed to process the image.`);
        }
        
        await this.progressManager.startNewMapArt(imageSource, imageData);
        this.bot.chat(
            `/msg ${this.master} New map art started. Beginning construction.`
        );
        this.state = 'BUILDING';
    }


  handlePause() {
    if (this.state !== "BUILDING" && this.state !== "RESTOCKING") {
      return this.bot.chat(`/msg ${this.master} Nothing to pause.`);
    }
    this.state = "PAUSED";
    this.stripPlacer.pause();
    this.bot.chat(`/msg ${this.master} Paused the current task.`);
  }

  handleContinue() {
    if (this.state !== "PAUSED") {
      return this.bot.chat(`/msg ${this.master} Nothing is paused.`);
    }
    const progress = this.progressManager.get();
    if (progress.isActive) {
      this.state = "BUILDING"; // Always go back to building state to re-evaluate
      this.stripPlacer.continue();
      this.bot.chat(`/msg ${this.master} Resuming task.`);
    } else {
      this.bot.chat(`/msg ${this.master} Cannot continue, no active project.`);
    }
  }

  async handleClear() {
    this.state = "IDLE";
    this.stripPlacer.stop();
    await this.progressManager.clear();
    this.bot.chat(`/msg ${this.master} Project progress has been cleared.`);
  }

  handleStatus() {
    const progress = this.progressManager.get();
    if (!progress.isActive) {
      return this.bot.chat(
        `/msg ${this.master} No active project. Current state: ${this.state}.`
      );
    }
    const percentage = this.progressManager
      .getCompletionPercentage()
      .toFixed(2);
    this.bot.chat(
      `/msg ${this.master} Status: ${this.state} | Image: ${progress.imageSource} | Strip: ${progress.currentStripIndex} | Overall Progress: ${percentage}%`
    );
  }

  // --- Main Logic Loop ---
  async mainLoop() {
    while (true) {
      await this.bot.waitForTicks(20); // Loop runs every second
      if (this.state === "IDLE" || this.state === "PAUSED") continue;

      const progress = this.progressManager.get();
      if (!progress.isActive) {
        this.state = "IDLE";
        this.bot.chat(`/msg ${this.master} Map art is complete!`);
        continue;
      }

      if (this.state === "BUILDING") {
        const required =
          this.progressManager.getRequiredMaterialsForCurrentStrip();
          console.log("REQUIRED",JSON.stringify(required));
        if (Object.keys(required).length === 0) {
          // Strip is done, advance to next
          await this.progressManager.completeCurrentStrip();
          continue; // Re-run loop for the new strip
        }

        if (!this._hasMaterials(required)) {
          this.bot.chat(
            `/msg ${this.master} Insufficient materials for current strip. Switching to restock mode.`
          );
          this.state = "RESTOCKING";
        } else {
          const isComplete = await this.stripPlacer.buildCurrentStrip();
          if(isComplete) await this.progressManager.completeCurrentStrip();
          // After buildStrip returns, the loop will re-evaluate.
        }
      }

      if (this.state === "RESTOCKING") {
        const required =
          this.progressManager.getRequiredMaterialsForCurrentStrip();
        const success = await this.restocker.restock(required);
        if (success) {
          this.bot.chat(
            `/msg ${this.master} Restocking complete. Resuming building.`
          );
          this.state = "BUILDING";
        } else {
          this.bot.chat(
            `/msg ${this.master} Failed to restock all required materials. Pausing task.`
          );
          this.state = "PAUSED";
        }
      }
    }
  }

  _hasMaterials(required) {
    for (const itemName in required) {
      const requiredCount = required[itemName];
      // FIX: Now correctly accesses `this.mcData`
      const currentCount = this.bot.inventory.count(
        this.mcData.itemsByName[itemName].id,
        null
      );
      if (currentCount < requiredCount) {
        return false;
      }
    }
    return true;
  }
}

// --- Execution ---
console.log("Starting MapArtBot...");
const myBot = new MapArtBot({ ...botConfig, pluginsSuccessVerbose: true });
