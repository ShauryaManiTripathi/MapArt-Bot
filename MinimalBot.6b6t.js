const mineflayer = require("mineflayer");
const minecraftData = require('minecraft-data');
const { SocksClient } = require("socks");

/**
 * @class MinimalBot
 * @description A highly configurable and robust wrapper for a Mineflayer bot.
 * It provides selective plugin loading, graceful disconnection handling, and automatic reconnection capabilities.
 * Designed to be extended for creating powerful, custom bot implementations.
 *
 * @param {object} options - Configuration options for the bot, extending Mineflayer's options.
 * @param {boolean} [options.pluginsSuccessVerbose=false] - If true, prints a detailed status table of all plugins on the first spawn.
 * @param {string} [options.proxyHost] - The hostname or IP address of the SOCKS proxy server.
 * @param {number} [options.proxyPort] - The port of the SOCKS proxy server.
 * @param {4|5} [options.proxyType=5] - The SOCKS proxy version to use (4 or 5). Defaults to 5.
 * @param {string} [options.proxyUsername] - The username for SOCKS proxy authentication (optional).
 * @param {string} [options.proxyPassword] - The password for SOCKS proxy authentication (optional).
 * @param {object} [options.plugins={}] - A configuration object to enable and configure plugins.
 * @param {boolean|object} [options.plugins.pathfinder=false] - Enable the pathfinder plugin.
 * @param {boolean|object} [options.plugins.armorManager=false] - Enable the armor-manager plugin.
 * @param {boolean|object} [options.plugins.pvp=false] - Enable the custom-pvp plugin.
 * @param {boolean|object} [options.plugins.autoCrystal=false] - Enable the autocrystal plugin.
 * @param {boolean|object} [options.plugins.tool=false] - Enable the tool plugin.
 * @param {boolean|object} [options.plugins.autoEat=false] - Enable the auto-eat plugin.
 * @param {boolean|object} [options.plugins.viewer=false] - Enable the prismarine-viewer plugin.
 * @param {boolean} [options.autoReconnect=true] - Whether the bot should automatically try to reconnect.
 * @param {number} [options.reconnectDelay=5000] - The delay in milliseconds before attempting to reconnect.
 */
class MinimalBot {
  constructor(options = {}) {
    this._options = {
      host: "localhost",
      port: 25565,
      username: "MinimalBot",
      version: false,
      auth: "mojang",
      autoReconnect: true,
      reconnectDelay: 5000,
      pluginsSuccessVerbose: false,
      proxyHost: null,
      proxyPort: null,
      proxyType: 5,
      proxyUsername: null,
      proxyPassword: null,
      plugins: {},
      ...options,
    };

    this.bot = null;
    this._goals = null;
    this._movements = null;

    this._isDisconnecting = false;
    this._isReconnecting = false;
    this._isFirstSpawn = true; // For the verbose plugin report
    this._pluginStatus = {}; // To track plugin load status

    this._createBot();
  }

  _createBot() {
    const botOptions = { ...this._options };

    if (botOptions.proxyHost && botOptions.proxyPort) {
      console.log(
        `Connecting via SOCKS${botOptions.proxyType} proxy: ${botOptions.proxyHost}:${botOptions.proxyPort}`
      );
      const serverHost = botOptions.host,
        serverPort = botOptions.port;
      delete botOptions.host;
      delete botOptions.port;

      botOptions.connect = (client) => {
        SocksClient.createConnection(
          {
            proxy: {
              host: botOptions.proxyHost,
              port: botOptions.proxyPort,
              type: botOptions.proxyType,
              userId: botOptions.proxyUsername,
              password: botOptions.proxyPassword,
            },
            command: "connect",
            destination: { host: serverHost, port: serverPort },
          },
          (err, info) => {
            if (err) {
              console.error("SOCKS proxy connection error:", err.message);
              client.emit("error", err);
              return;
            }
            client.setSocket(info.socket);
            client.emit("connect");
          }
        );
      };
    }

    this.bot = mineflayer.createBot(botOptions);
    this._loadPlugins();
    this._attachEventListeners();
  }

  /**
   * @private
   * Loads plugins and records their status for the verbose report.
   */
  _loadPlugins() {
    const plugins = this._options.plugins || {};
    this._pluginStatus = {};

    const loadPlugin = (name, loader) => {
      const isRequested = !!plugins[name];
      this._pluginStatus[name] = {
        "Plugin Name": name,
        Requested: isRequested ? "Yes" : "No",
        Loaded: "---",
      };

      if (isRequested) {
        try {
          loader();
          this._pluginStatus[name].Loaded = "Success";
        } catch (e) {
          console.error(`Could not load ${name} plugin:`, e.message);
          this._pluginStatus[name].Loaded = "Failed";
        }
      }
    };

    loadPlugin("pathfinder", () => {
      const {
        pathfinder,
        goals,
        Movements,
      } = require("mineflayer-pathfinder-antilagback");
      this.bot.loadPlugin(pathfinder);
      this._goals = goals;
      this._movements = Movements;
    });

    loadPlugin("armorManager", () => {
      this.bot.loadPlugin(require("mineflayer-armor-manager"));
    });

    loadPlugin("pvp", () => {
      this.bot.loadPlugin(require("@nxg-org/mineflayer-custom-pvp").plugin);
    });

    loadPlugin("autoCrystal", () => {
      this.bot.loadPlugin(require("mineflayer-autocrystal").autoCrystal);
    });

    loadPlugin("tool", () => {
      this.bot.loadPlugin(require("mineflayer-tool").plugin);
    });

    loadPlugin("autoEat", () => {
      this.bot.loadPlugin(require("mineflayer-auto-eat").loader);
    });

    loadPlugin("viewer", () => {
      const { mineflayer: mineflayerViewer } = require("prismarine-viewer");
      this.bot.once("spawn", () => {
        const viewerOptions = {
          port: plugins.viewer.port || 3000,
          firstPerson: plugins.viewer.firstPerson !== false,
        };
        mineflayerViewer(this.bot, viewerOptions);
        console.log(`Prismarine viewer started on port ${viewerOptions.port}`);
      });
    });
  }

  _attachEventListeners() {
    this.bot.once("spawn", async () => {
      if (this._options.pluginsSuccessVerbose && this._isFirstSpawn) {
        this.printPluginStatus();
        this._isFirstSpawn = false;
      }

      if (this._options.auth == "offline" && this._options.host == "6b6t.org") {
        this.bot.chat(`/login ${this.options.password}`);
        console.log("=== initiating Captcha Bypass ===");
        setTimeout(() => {
          //const goal = new this.goals.GoalBlock(-1000, 102, -988); // Spawn point coordinates
          //this.pathfinder.setGoal(goal, true);
          let movements = new this.movements(this.bot);
          movements.allowSprinting = true;
          movements.allowParkour = true;
          movements.canDig = false; // Safer for servers
          movements.digCost = 100; // Avoid digging
          movements.placeCost = 100;
          movements.allowEntityDetection = true;
          movements.liquidCost = 2; // Avoid water when possible
          this.bot.pathfinder.setMovements(movements);
          this.startGreenWoolPath();
          console.log("CAPTCHA STARTED! !!!!!!!!!!!!!!!!!!!!");
        }, 3000);
      }
      await new Promise((resolve) => setTimeout(resolve, 30000));
      this.bot.pathfinder.setMovements(new this.movements(this.bot));


      // REMOVED: this._isReconnecting = false; // This was the cause of the bug.

      console.log(`${this.bot.username} has spawned.`);
      try {
        // ADDED: Safety wrapper for custom initialization logic.
        await this.initialize();
      } catch (err) {
        console.error("Error during custom initialization:", err);
      }
    });

    this.bot.on("kicked", (reason) => {
      // ADDED: Better logging for JSON kick reasons.
      const reasonText =
        typeof reason === "string" ? reason : JSON.stringify(reason);
      console.log(`Bot was kicked for: ${reasonText}`);
      this.handleDisconnect("kicked");
    });

    this.bot.on("end", (reason) => {
      // Only handle 'end' if it wasn't preceded by a kick, as kick also causes an 'end' event.
      if (!this._isReconnecting) {
        console.log(`Bot has disconnected. Reason: ${reason || "N/A"}`);
        this.handleDisconnect("end");
      }
    });

    this.bot.on("error", (err) => {
      console.error("Bot encountered an error:", err.message);
      // An error can often lead to a disconnect, so we trigger the handler here too.
      this.handleDisconnect("error");
    });
  }

  handleDisconnect(eventName) {
    if (this._isDisconnecting || this._isReconnecting) return;

    // Clean up listeners on the current bot instance to prevent memory leaks
    if (this.bot) {
      this.bot.removeAllListeners();
    }

    if (this._options.autoReconnect) {
      this._isReconnecting = true;
      console.log(
        `Attempting to reconnect in ${
          this._options.reconnectDelay / 1000
        } seconds...`
      );
      setTimeout(() => this.reconnect(), this._options.reconnectDelay);
    }
  }

  reconnect() {
    // This is now the single point of control for the reconnecting state.
    // Once this function runs, the "reconnecting" state is considered over,
    // and a new connection cycle begins.
    this._isReconnecting = false; // MOVED & CHANGED: Reset the flag here.

    console.log("Reconnecting...");
    this.disconnect(true); // Quietly disconnect old instance if it exists.
    this._createBot(); // Create a new bot instance and start connecting.
  }

  async initialize() {
    return Promise.resolve();
  }

  disconnect(quiet = false) {
    if (!this.bot) return;
    if (quiet) this._isDisconnecting = true;

    // Ensure all bot activities are stopped before quitting.
    if (this.bot.pathfinder) this.bot.pathfinder.stop();

    if (typeof this.bot.quit === "function") {
      this.bot.quit();
    }
    this.bot.removeAllListeners();

    if (quiet) {
      // Reset the flag after a short delay to prevent race conditions.
      setTimeout(() => {
        this._isDisconnecting = false;
      }, 1000);
    }
  }

  /**
   * @private
   * Prints a status table of all manageable plugins.
   */
  printPluginStatus() {
    console.log("\n--- MinimalBot Plugin Status ---");
    const statusData = Object.values(this._pluginStatus);
    if (statusData.length > 0) {
      console.table(statusData);
    } else {
      console.log("No plugins configured for status tracking.");
    }
    console.log("--------------------------------\n");
  }

  // --- Plugin and API Accessors ---
  get options() {
    return this._options;
  }
  get instance() {
    return this.bot;
  }
  get pathfinder() {
    return this.bot?.pathfinder;
  }
  get goals() {
    return this._goals;
  }
  get movements() {
    return this._movements;
  }
  get armorManager() {
    return this.bot?.armorManager;
  }
  get pvp() {
    return this.bot?.pvp;
  }
  get autoCrystal() {
    return this.bot?.autoCrystal;
  }
  get tool() {
    return this.bot?.tool;
  }
  get autoEat() {
    return this.bot?.autoEat;
  }


    // ! ////////////////////////// ////////////////////////// ////////////////////////// CAPTCHA SHITTTTTT

  getGreenWoolPositions() {
    const range = 50;
    const greenWoolPositions = [];

    for (const entityId in this.bot.entities) {
      const entity = this.bot.entities[entityId];
      if (entity.type === "block_display" || entity.name === "block_display") {
        const translation = entity.metadata?.[11] || { x: 0, y: 0, z: 0 };
        const scale = entity.metadata?.[12] || { x: 1, y: 1, z: 1 };

        const visualPos = {
          x: entity.position.x + (translation.x || 0) + 0.5 * (scale.x || 1),
          y: entity.position.y + (translation.y || 0) + 0.5 * (scale.y || 1),
          z: entity.position.z + (translation.z || 0) + 0.5 * (scale.z || 1),
        };

        const blockStateId = entity.metadata?.[15] || entity.metadata?.[23];
        let isGreenWool = false;

        if (blockStateId) {
          try {
            const mcData = minecraftData(this.bot.version);
            const blockState = mcData.blocksByStateId[blockStateId];
            const blockName = blockState ? blockState.name : "";
            isGreenWool = blockName.includes("green_wool");
          } catch (e) {
            // ignore
          }
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
    console.log(
      `🔍 Finding next green wool from ${currentPos.x.toFixed(
        2
      )}, ${currentPos.z.toFixed(2)}`
    );
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
    const walkTarget = {
      x: targetPos.x,
      y: targetPos.y + 1,
      z: targetPos.z,
    };

    console.log(
      `🚶 Moving to ${description} at: ${walkTarget.x.toFixed(
        3
      )}, ${walkTarget.y.toFixed(3)}, ${walkTarget.z.toFixed(3)}`
    );

    this.bot.swingArm("right");

    try {
      const goal = new this.goals.GoalBlock(
        Math.floor(walkTarget.x),
        Math.floor(walkTarget.y),
        Math.floor(walkTarget.z)
      );

      await this.bot.pathfinder.goto(goal);
      console.log(`✅ Reached ${description}`);
      this.bot.swingArm("right");
    } catch (error) {
      console.log(`⚠️  Pathfinding to ${description} failed:`, error.message);
    }
    // No need for resolve() or to return anything.
    // The promise returned by this async function will resolve automatically when the function completes.
  }

  async followGreenWoolPath() {
    let stepNumber = 1;
    let visitedCoords = new Set();
    const greenWoolPositions = this.getGreenWoolPositions();
    console.log(`🎯 Found ${greenWoolPositions.length} green wool positions`);
    while (stepNumber <= 50) {
      console.log(`\n--- STEP ${stepNumber} ---`);
      const currentPos = this.bot.entity.position;
      const currentCoordKey = `${Math.floor(currentPos.x)},${Math.floor(
        currentPos.z
      )}`;
      console.log("currentCoordKey:", currentCoordKey);
      visitedCoords.add(currentCoordKey);

      const nextPos = this.findNextGreenWool(
        currentPos,
        greenWoolPositions,
        visitedCoords
      );
      console.log("nextPos:", nextPos);
      if (!nextPos) {
        console.log("✅ No more adjacent green wool found - path complete!");
        break;
      }

      await this.moveToPositionEnhanced(nextPos, "green wool");

      stepNumber++;
    }

    const portalPos = { x: -1001, y: 101, z: -987 };
    try {
      const goal = new this.goals.GoalBlock(portalPos.x, portalPos.y, portalPos.z);
      await this.bot.pathfinder.goto(goal);
      console.log("✅ Reached the portal area.");
    } catch (error) {
      console.log(`⚠️  Pathfinding to the portal failed:`, error.message);
    }
  }

  async startGreenWoolPath() {
    console.log("\\n🛤️  === STARTING CAPTCHA ===");

    // Initial movement
    console.log("🚶 Starting with initial 1.5 block walk...");
    const currentPos = this.bot.entity.position.clone();
    // offset it
    const initialTarget = currentPos.offset(0, 0, 1.5);
    await this.moveToPositionEnhanced(initialTarget, "initial position");
    console.log("✅ Initial movement complete!");

    await this.followGreenWoolPath();
    console.log("✅ Green wool path complete!");
  }
  // ! ////////////////////////// ////////////////////////// //////////////////////////
}

module.exports = MinimalBot;
