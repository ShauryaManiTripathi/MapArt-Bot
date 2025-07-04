const fs = require("fs").promises;
const path = require("path");
const { width: stripWidth } = require("../../config/example.mapart_offsets.js"); // Import strip width from config

const PROGRESS_FILE = path.join(process.cwd(), "progress.json");
const TOTAL_STRIPS = 128 / stripWidth;

class ProgressManager {
  constructor() {
    this.state = this.getDefaultState();
  }

  /**
   * Provides the default structure for the progress state.
   */
  getDefaultState() {
    return {
      isActive: false,
      isPaused: false,
      imageSource: null,
      currentStripIndex: 0, // Track which strip (0-31) we are on
      imageData: null, // This will hold the full 128x128 plan
    };
  }

  /**
   * Loads the progress from progress.json.
   */
  async load() {
    try {
      const data = await fs.readFile(PROGRESS_FILE, "utf8");
      this.state = JSON.parse(data);
      console.log("Progress loaded successfully.");
      return this.state;
    } catch (error) {
      if (error.code === "ENOENT") {
        console.log("No progress file found. Starting fresh.");
        await this.clear();
      } else {
        console.error("Error loading progress:", error);
      }
      return this.state;
    }
  }

  /**
   * Saves the current state to progress.json.
   */
  async save() {
    try {
      await fs.writeFile(PROGRESS_FILE, JSON.stringify(this.state, null, 2));
    } catch (error) {
      console.error("Error saving progress:", error);
    }
  }

  /**
   * Resets the progress to its default state and saves it.
   */
  async clear() {
    this.state = this.getDefaultState();
    await this.save();
    console.log("Progress file has been cleared.");
  }

  /**
   * Initializes a new map art project.
   * @param {string} imageSource - The path or URL of the image being used.
   * @param {Array<Array<object>>} imageData - The 128x128 plan from ImageProcessor.
   */
  async startNewMapArt(imageSource, imageData) {
    this.state = {
      ...this.getDefaultState(),
      isActive: true,
      imageSource: imageSource,
      imageData: imageData,
    };
    await this.save();
    console.log(`New map art started for "${imageSource}". Current strip: 0.`);
  }

  /**
   * Marks a single block as placed in the progress file.
   * @param {number} x - The x-coordinate (0-127).
   * @param {number} z - The z-coordinate (0-127).
   */
  async updateBlockPlaced(x, z) {
    if (!this.state.isActive || !this.state.imageData) return;
    if (z < 0 || z > 127 || x < 0 || x > 127) return;

    this.state.imageData[z][x].placed_correctly = true;
    // Note: Saving on every block can be slow. Consider batching saves in the main bot logic if performance is an issue.
    await this.save();
  }

  /**
   * Advances the progress to the next strip.
   * If the last strip is completed, it marks the map art as finished.
   */
  async completeCurrentStrip() {
    if (!this.state.isActive) return;

    this.state.currentStripIndex++;
    console.log(
      `Strip ${this.state.currentStripIndex - 1} completed. Moving to strip ${
        this.state.currentStripIndex
      }.`
    );

    if (this.state.currentStripIndex >= TOTAL_STRIPS) {
      console.log("Congratulations! Map art is complete.");
      this.state.isActive = false; // Mark project as done
      this.state.isPaused = false;
    }

    await this.save();
  }

  /**
   * Gets all block placements for the current strip that have not been completed.
   * @returns {Array<object>} An array of objects: { x, z, name, id }
   */
  getPlacementsForCurrentStrip() {
    if (!this.state.isActive || !this.state.imageData) {
      return [];
    }

    const placements = [];
    const startZ = this.state.currentStripIndex * stripWidth;
    const endZ = Math.min(startZ + stripWidth, 128); // Ensure we don't go past 128

    for (let z = startZ; z < endZ; z++) {
      for (let x = 0; x < 128; x++) {
        const blockData = this.state.imageData[z][x];
        if (blockData && !blockData.placed_correctly) {
          placements.push({
            x: x, // map-relative X
            z: z, // map-relative Z
            name: blockData.name,
            id: blockData.id,
          });
        }
      }
    }
    return placements;
  }

  // /**
  //  * Calculates the required materials for the remaining blocks in the current strip.
  //  * @returns {object} An object with carpet IDs as keys and required counts as values, e.g., { "white_carpet": 64, "red_carpet": 12 }
  //  */
  getRequiredMaterialsForCurrentStrip() {
    const requiredMaterials = {};
    const placements = this.getPlacementsForCurrentStrip();

    for (const placement of placements) {
      requiredMaterials[placement.id] =
        (requiredMaterials[placement.id] || 0) + 1;
    }
    let xxx = [requiredMaterials,0]
    return xxx[0];
  }
  /**
   * Calculates the required materials for multiple strips starting from current strip,
   * optimizing to fill up the 27 inventory slots (64 items per slot max).
   * @returns {object} An object with carpet IDs as keys and required counts as values, e.g., { "white_carpet": 64, "red_carpet": 12 }
   */
  getRequiredMaterialsForMultipleStrip() {
    if (!this.state.isActive || !this.state.imageData) {
      return {};
    }

    const MAX_INVENTORY_SLOTS = 27;
    const MAX_STACK_SIZE = 64;
    const requiredMaterials = {};

    // Start from current strip and go forward
    let stripIndex;
    for (
      stripIndex = this.state.currentStripIndex;
      stripIndex < TOTAL_STRIPS;
      stripIndex++
    ) {
      const startZ = stripIndex * stripWidth;
      const endZ = Math.min(startZ + stripWidth, 128);

      // Calculate materials needed for this strip
      const stripMaterials = {};
      for (let z = startZ; z < endZ; z++) {
        for (let x = 0; x < 128; x++) {
          const blockData = this.state.imageData[z][x];
          if (blockData && !blockData.placed_correctly) {
            stripMaterials[blockData.id] =
              (stripMaterials[blockData.id] || 0) + 1;
          }
        }
      }

      // Test if we can fit this strip's materials in our inventory
      const testMaterials = { ...requiredMaterials };
      for (const [itemId, count] of Object.entries(stripMaterials)) {
        testMaterials[itemId] = (testMaterials[itemId] || 0) + count;
      }

      // Calculate how many inventory slots this would require
      const requiredSlots = Object.values(testMaterials).reduce(
        (slots, count) => {
          return slots + Math.ceil(count / MAX_STACK_SIZE);
        },
        0
      );

      // If adding this strip would exceed 27 slots, stop here
      if (requiredSlots > MAX_INVENTORY_SLOTS) {
        console.log("RESTOCKER GOT ITEMS FOR ",stripIndex - this.state.currentStripIndex," indexes")
        break;
      }

      // Add this strip's materials to our total
      for (const [itemId, count] of Object.entries(stripMaterials)) {
        requiredMaterials[itemId] = (requiredMaterials[itemId] || 0) + count;
      }
    }

    let xxx =  [requiredMaterials,stripIndex-this.state.currentStripIndex-1];
    return xxx[0];
  }

  /**
   * Calculates the overall completion percentage of the map art.
   * @returns {number} The completion percentage (0-100).
   */
  getCompletionPercentage() {
    if (!this.state.imageData) return 0;

    let placedCount = 0;
    const totalBlocks = 128 * 128;

    for (let z = 0; z < 128; z++) {
      for (let x = 0; x < 128; x++) {
        if (this.state.imageData[z][x]?.placed_correctly) {
          placedCount++;
        }
      }
    }
    return (placedCount / totalBlocks) * 100;
  }

  /**
   * Returns the current state.
   */
  get() {
    return this.state;
  }
}

module.exports = ProgressManager;
