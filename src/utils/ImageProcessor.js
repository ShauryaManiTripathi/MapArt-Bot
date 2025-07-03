const Jimp = require('jimp');
const path = require('path');
const axios = require('axios');

// RGB values for Minecraft carpet colors (Unchanged)
const COLOR_MAP = {
    white: { r: 221, g: 221, b: 221, id: 'white_carpet' },
    light_gray: { r: 170, g: 170, b: 170, id: 'light_gray_carpet' }, // Note: light_gray_carpet
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

const COLOR_NAMES = Object.keys(COLOR_MAP);

// Function to find the closest color in our palette (Unchanged)
function findClosestColor(r, g, b) {
    let closestColor = 'white';
    let minDistance = Infinity;

    for (const colorName of COLOR_NAMES) {
        const color = COLOR_MAP[colorName];
        const distance = Math.pow(r - color.r, 2) + Math.pow(g - color.g, 2) + Math.pow(b - color.b, 2);
        if (distance < minDistance) {
            minDistance = distance;
            closestColor = colorName;
        }
    }
    return closestColor;
}

// Dithering algorithms
class DitheringAlgorithms {
    // Floyd-Steinberg dithering (default)
    static floydSteinberg(imageData, width, height) {
        const data = new Array(height);
        for (let i = 0; i < height; i++) {
            data[i] = new Array(width);
            for (let j = 0; j < width; j++) {
                const pixelColor = Jimp.intToRGBA(imageData.getPixelColor(j, i));
                data[i][j] = { r: pixelColor.r, g: pixelColor.g, b: pixelColor.b };
            }
        }

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const oldR = data[y][x].r;
                const oldG = data[y][x].g;
                const oldB = data[y][x].b;
                
                const closestColorName = findClosestColor(oldR, oldG, oldB);
                const newColor = COLOR_MAP[closestColorName];
                
                data[y][x] = { r: newColor.r, g: newColor.g, b: newColor.b, colorName: closestColorName };
                
                const errorR = oldR - newColor.r;
                const errorG = oldG - newColor.g;
                const errorB = oldB - newColor.b;
                
                // Distribute error to neighboring pixels
                if (x + 1 < width) {
                    data[y][x + 1].r = Math.max(0, Math.min(255, data[y][x + 1].r + errorR * 7 / 16));
                    data[y][x + 1].g = Math.max(0, Math.min(255, data[y][x + 1].g + errorG * 7 / 16));
                    data[y][x + 1].b = Math.max(0, Math.min(255, data[y][x + 1].b + errorB * 7 / 16));
                }
                
                if (y + 1 < height) {
                    if (x - 1 >= 0) {
                        data[y + 1][x - 1].r = Math.max(0, Math.min(255, data[y + 1][x - 1].r + errorR * 3 / 16));
                        data[y + 1][x - 1].g = Math.max(0, Math.min(255, data[y + 1][x - 1].g + errorG * 3 / 16));
                        data[y + 1][x - 1].b = Math.max(0, Math.min(255, data[y + 1][x - 1].b + errorB * 3 / 16));
                    }
                    
                    data[y + 1][x].r = Math.max(0, Math.min(255, data[y + 1][x].r + errorR * 5 / 16));
                    data[y + 1][x].g = Math.max(0, Math.min(255, data[y + 1][x].g + errorG * 5 / 16));
                    data[y + 1][x].b = Math.max(0, Math.min(255, data[y + 1][x].b + errorB * 5 / 16));
                    
                    if (x + 1 < width) {
                        data[y + 1][x + 1].r = Math.max(0, Math.min(255, data[y + 1][x + 1].r + errorR * 1 / 16));
                        data[y + 1][x + 1].g = Math.max(0, Math.min(255, data[y + 1][x + 1].g + errorG * 1 / 16));
                        data[y + 1][x + 1].b = Math.max(0, Math.min(255, data[y + 1][x + 1].b + errorB * 1 / 16));
                    }
                }
            }
        }
        
        return data;
    }

    static jarvisJudiceNinke(imageData, width, height) {
        const data = new Array(height);
        for (let i = 0; i < height; i++) {
            data[i] = new Array(width);
            for (let j = 0; j < width; j++) {
                const pixelColor = Jimp.intToRGBA(imageData.getPixelColor(j, i));
                data[i][j] = { r: pixelColor.r, g: pixelColor.g, b: pixelColor.b };
            }
        }

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const oldR = data[y][x].r;
                const oldG = data[y][x].g;
                const oldB = data[y][x].b;
                
                const closestColorName = findClosestColor(oldR, oldG, oldB);
                const newColor = COLOR_MAP[closestColorName];
                
                data[y][x] = { r: newColor.r, g: newColor.g, b: newColor.b, colorName: closestColorName };
                
                const errorR = oldR - newColor.r;
                const errorG = oldG - newColor.g;
                const errorB = oldB - newColor.b;
                
                // Jarvis-Judice-Ninke error diffusion pattern
                const diffusionPattern = [
                    { dx: 1, dy: 0, weight: 7/48 },
                    { dx: 2, dy: 0, weight: 5/48 },
                    { dx: -2, dy: 1, weight: 3/48 },
                    { dx: -1, dy: 1, weight: 5/48 },
                    { dx: 0, dy: 1, weight: 7/48 },
                    { dx: 1, dy: 1, weight: 5/48 },
                    { dx: 2, dy: 1, weight: 3/48 },
                    { dx: -2, dy: 2, weight: 1/48 },
                    { dx: -1, dy: 2, weight: 3/48 },
                    { dx: 0, dy: 2, weight: 5/48 },
                    { dx: 1, dy: 2, weight: 3/48 },
                    { dx: 2, dy: 2, weight: 1/48 }
                ];
                
                for (const { dx, dy, weight } of diffusionPattern) {
                    const newX = x + dx;
                    const newY = y + dy;
                    if (newX >= 0 && newX < width && newY >= 0 && newY < height) {
                        data[newY][newX].r = Math.max(0, Math.min(255, data[newY][newX].r + errorR * weight));
                        data[newY][newX].g = Math.max(0, Math.min(255, data[newY][newX].g + errorG * weight));
                        data[newY][newX].b = Math.max(0, Math.min(255, data[newY][newX].b + errorB * weight));
                    }
                }
            }
        }
        
        return data;
    }

    static stucki(imageData, width, height) {
        const data = new Array(height);
        for (let i = 0; i < height; i++) {
            data[i] = new Array(width);
            for (let j = 0; j < width; j++) {
                const pixelColor = Jimp.intToRGBA(imageData.getPixelColor(j, i));
                data[i][j] = { r: pixelColor.r, g: pixelColor.g, b: pixelColor.b };
            }
        }

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const oldR = data[y][x].r;
                const oldG = data[y][x].g;
                const oldB = data[y][x].b;
                
                const closestColorName = findClosestColor(oldR, oldG, oldB);
                const newColor = COLOR_MAP[closestColorName];
                
                data[y][x] = { r: newColor.r, g: newColor.g, b: newColor.b, colorName: closestColorName };
                
                const errorR = oldR - newColor.r;
                const errorG = oldG - newColor.g;
                const errorB = oldB - newColor.b;
                
                // Stucki error diffusion pattern
                const diffusionPattern = [
                    { dx: 1, dy: 0, weight: 8/42 },
                    { dx: 2, dy: 0, weight: 4/42 },
                    { dx: -2, dy: 1, weight: 2/42 },
                    { dx: -1, dy: 1, weight: 4/42 },
                    { dx: 0, dy: 1, weight: 8/42 },
                    { dx: 1, dy: 1, weight: 4/42 },
                    { dx: 2, dy: 1, weight: 2/42 },
                    { dx: -2, dy: 2, weight: 1/42 },
                    { dx: -1, dy: 2, weight: 2/42 },
                    { dx: 0, dy: 2, weight: 4/42 },
                    { dx: 1, dy: 2, weight: 2/42 },
                    { dx: 2, dy: 2, weight: 1/42 }
                ];
                
                for (const { dx, dy, weight } of diffusionPattern) {
                    const newX = x + dx;
                    const newY = y + dy;
                    if (newX >= 0 && newX < width && newY >= 0 && newY < height) {
                        data[newY][newX].r = Math.max(0, Math.min(255, data[newY][newX].r + errorR * weight));
                        data[newY][newX].g = Math.max(0, Math.min(255, data[newY][newX].g + errorG * weight));
                        data[newY][newX].b = Math.max(0, Math.min(255, data[newY][newX].b + errorB * weight));
                    }
                }
            }
        }
        
        return data;
    }

    static atkinson(imageData, width, height) {
        const data = new Array(height);
        for (let i = 0; i < height; i++) {
            data[i] = new Array(width);
            for (let j = 0; j < width; j++) {
                const pixelColor = Jimp.intToRGBA(imageData.getPixelColor(j, i));
                data[i][j] = { r: pixelColor.r, g: pixelColor.g, b: pixelColor.b };
            }
        }

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const oldR = data[y][x].r;
                const oldG = data[y][x].g;
                const oldB = data[y][x].b;
                
                const closestColorName = findClosestColor(oldR, oldG, oldB);
                const newColor = COLOR_MAP[closestColorName];
                
                data[y][x] = { r: newColor.r, g: newColor.g, b: newColor.b, colorName: closestColorName };
                
                const errorR = oldR - newColor.r;
                const errorG = oldG - newColor.g;
                const errorB = oldB - newColor.b;
                
                // Atkinson error diffusion pattern
                const diffusionPattern = [
                    { dx: 1, dy: 0, weight: 1/8 },
                    { dx: 2, dy: 0, weight: 1/8 },
                    { dx: -1, dy: 1, weight: 1/8 },
                    { dx: 0, dy: 1, weight: 1/8 },
                    { dx: 1, dy: 1, weight: 1/8 },
                    { dx: 0, dy: 2, weight: 1/8 }
                ];
                
                for (const { dx, dy, weight } of diffusionPattern) {
                    const newX = x + dx;
                    const newY = y + dy;
                    if (newX >= 0 && newX < width && newY >= 0 && newY < height) {
                        data[newY][newX].r = Math.max(0, Math.min(255, data[newY][newX].r + errorR * weight));
                        data[newY][newX].g = Math.max(0, Math.min(255, data[newY][newX].g + errorG * weight));
                        data[newY][newX].b = Math.max(0, Math.min(255, data[newY][newX].b + errorB * weight));
                    }
                }
            }
        }
        
        return data;
    }

    static sierra(imageData, width, height) {
        const data = new Array(height);
        for (let i = 0; i < height; i++) {
            data[i] = new Array(width);
            for (let j = 0; j < width; j++) {
                const pixelColor = Jimp.intToRGBA(imageData.getPixelColor(j, i));
                data[i][j] = { r: pixelColor.r, g: pixelColor.g, b: pixelColor.b };
            }
        }

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const oldR = data[y][x].r;
                const oldG = data[y][x].g;
                const oldB = data[y][x].b;
                
                const closestColorName = findClosestColor(oldR, oldG, oldB);
                const newColor = COLOR_MAP[closestColorName];
                
                data[y][x] = { r: newColor.r, g: newColor.g, b: newColor.b, colorName: closestColorName };
                
                const errorR = oldR - newColor.r;
                const errorG = oldG - newColor.g;
                const errorB = oldB - newColor.b;
                
                // Sierra error diffusion pattern
                const diffusionPattern = [
                    { dx: 1, dy: 0, weight: 5/32 },
                    { dx: 2, dy: 0, weight: 3/32 },
                    { dx: -2, dy: 1, weight: 2/32 },
                    { dx: -1, dy: 1, weight: 4/32 },
                    { dx: 0, dy: 1, weight: 5/32 },
                    { dx: 1, dy: 1, weight: 4/32 },
                    { dx: 2, dy: 1, weight: 2/32 },
                    { dx: -1, dy: 2, weight: 2/32 },
                    { dx: 0, dy: 2, weight: 3/32 },
                    { dx: 1, dy: 2, weight: 2/32 }
                ];
                
                for (const { dx, dy, weight } of diffusionPattern) {
                    const newX = x + dx;
                    const newY = y + dy;
                    if (newX >= 0 && newX < width && newY >= 0 && newY < height) {
                        data[newY][newX].r = Math.max(0, Math.min(255, data[newY][newX].r + errorR * weight));
                        data[newY][newX].g = Math.max(0, Math.min(255, data[newY][newX].g + errorG * weight));
                        data[newY][newX].b = Math.max(0, Math.min(255, data[newY][newX].b + errorB * weight));
                    }
                }
            }
        }
        
        return data;
    }

    static burkes(imageData, width, height) {
        const data = new Array(height);
        for (let i = 0; i < height; i++) {
            data[i] = new Array(width);
            for (let j = 0; j < width; j++) {
                const pixelColor = Jimp.intToRGBA(imageData.getPixelColor(j, i));
                data[i][j] = { r: pixelColor.r, g: pixelColor.g, b: pixelColor.b };
            }
        }

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const oldR = data[y][x].r;
                const oldG = data[y][x].g;
                const oldB = data[y][x].b;
                
                const closestColorName = findClosestColor(oldR, oldG, oldB);
                const newColor = COLOR_MAP[closestColorName];
                
                data[y][x] = { r: newColor.r, g: newColor.g, b: newColor.b, colorName: closestColorName };
                
                const errorR = oldR - newColor.r;
                const errorG = oldG - newColor.g;
                const errorB = oldB - newColor.b;
                
                // Burkes error diffusion pattern
                const diffusionPattern = [
                    { dx: 1, dy: 0, weight: 8/32 },
                    { dx: 2, dy: 0, weight: 4/32 },
                    { dx: -2, dy: 1, weight: 2/32 },
                    { dx: -1, dy: 1, weight: 4/32 },
                    { dx: 0, dy: 1, weight: 8/32 },
                    { dx: 1, dy: 1, weight: 4/32 },
                    { dx: 2, dy: 1, weight: 2/32 }
                ];
                
                for (const { dx, dy, weight } of diffusionPattern) {
                    const newX = x + dx;
                    const newY = y + dy;
                    if (newX >= 0 && newX < width && newY >= 0 && newY < height) {
                        data[newY][newX].r = Math.max(0, Math.min(255, data[newY][newX].r + errorR * weight));
                        data[newY][newX].g = Math.max(0, Math.min(255, data[newY][newX].g + errorG * weight));
                        data[newY][newX].b = Math.max(0, Math.min(255, data[newY][newX].b + errorB * weight));
                    }
                }
            }
        }
        
        return data;
    }
}

class ImageProcessor {
    /**
     * Processes an image from a local file path or a URL.
     * @param {string} imageSource - The local file name (in ./assets) or a public URL to the image.
     * @param {string} ditheringMethod - The dithering method to use ('floydSteinberg' by default)
     * @returns {Promise<Array<Array<object>>|null>} A 128x128 2D array representing the map art plan, or null on failure.
     */
    static async processImage(imageSource, ditheringMethod = 'floydSteinberg') {
        let image;
        try {
            // Check if the source is a URL
            if (imageSource.startsWith('http://') || imageSource.startsWith('https://')) {
                console.log(`Fetching image from URL: ${imageSource}`);
                const response = await axios.get(imageSource, {
                    responseType: 'arraybuffer' // Get image as a buffer
                });
                image = await Jimp.read(response.data);
            } else {
                // Assume it's a local file path
                const localPath = path.join('assets', imageSource);
                console.log(`Reading image from local path: ${localPath}`);
                image = await Jimp.read(localPath);
            }
            
            // Resize and rotate by 180 degrees BEFORE processing
            image.resize(128, 128);
            image.rotate(180);
            
            // Apply dithering
            let ditheredData;
            switch (ditheringMethod) {
                case 'floydSteinberg':
                    ditheredData = DitheringAlgorithms.floydSteinberg(image, 128, 128);
                    break;
                case 'jarvisJudiceNinke':
                    ditheredData = DitheringAlgorithms.jarvisJudiceNinke(image, 128, 128);
                    break;
                case 'stucki':
                    ditheredData = DitheringAlgorithms.stucki(image, 128, 128);
                    break;
                case 'atkinson':
                    ditheredData = DitheringAlgorithms.atkinson(image, 128, 128);
                    break;
                case 'sierra':
                    ditheredData = DitheringAlgorithms.sierra(image, 128, 128);
                    break;
                case 'burkes':
                    ditheredData = DitheringAlgorithms.burkes(image, 128, 128);
                    break;
                default:
                    console.log(`Unknown dithering method: ${ditheringMethod}. Using Floyd-Steinberg.`);
                    ditheredData = DitheringAlgorithms.floydSteinberg(image, 128, 128);
            }

            // Create image from dithered data for saving
            const ditheredImage = new Jimp(128, 128);
            for (let y = 0; y < 128; y++) {
                for (let x = 0; x < 128; x++) {
                    const pixel = ditheredData[y][x];
                    const color = Jimp.rgbaToInt(pixel.r, pixel.g, pixel.b, 255);
                    ditheredImage.setPixelColor(color, x, y);
                }
            }
            await ditheredImage.writeAsync(`assets/debug_dithered.png`);

            // Convert dithered data to the expected format
            const imageData = Array.from({ length: 128 }, () => Array(128).fill(null));

            for (let z = 0; z < 128; z++) {
                for (let x = 0; x < 128; x++) {
                    const colorName = ditheredData[z][x].colorName;
                    imageData[z][x] = {
                        name: colorName,
                        id: COLOR_MAP[colorName].id,
                        placed_correctly: false // Default to false
                    };
                }
            }

            // Create image from final color mapped data
            const finalImage = new Jimp(128, 128);
            for (let z = 0; z < 128; z++) {
                for (let x = 0; x < 128; x++) {
                    const colorName = imageData[z][x].name;
                    const color = COLOR_MAP[colorName];
                    const pixelColor = Jimp.rgbaToInt(color.r, color.g, color.b, 255);
                    finalImage.setPixelColor(pixelColor, x, z);
                }
            }
            await finalImage.writeAsync(`assets/debug_final.png`);

            console.log(`Image "${imageSource}" processed successfully with ${ditheringMethod} dithering.`);
            return imageData;
        } catch (error) {
            console.error(`Failed to process image: ${error.message}`);
            return null;
        }
    }
}

ImageProcessor.COLOR_MAP = COLOR_MAP;

module.exports = ImageProcessor;