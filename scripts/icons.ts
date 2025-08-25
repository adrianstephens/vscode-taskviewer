import * as fs from 'fs';
import * as path from 'path';
import sharp from 'sharp';
//import ttf2svg from 'ttf2svg';
//const ttf2svg = require('ttf2svg');


// Function to convert SVG to PNG
async function convertSvgToPng(svgPath: string, pngPath: string) {
	try {
		await sharp(svgPath)
			.resize(16, 16)
			.composite([{
				input: {
					create: {
						width: 16,
						height: 16,
						channels: 4,
						background: { r: 255, g: 128, b: 64 }
					}
				}, blend: 'in'
			}])
			.png() // Convert to PNG
			.toFile(pngPath); // Save the output
		console.log(`Converted ${svgPath} to ${pngPath}`);
	} catch (error) {
		console.error(`Error converting ${svgPath}:`, error);
	}
}

// Main function to process all SVGs in the input directory
async function processSvgs(inputDir: string, outputDir: string) {
	// Read all files in the input directory
	const files = fs.readdirSync(inputDir);

	// Filter for SVG files
	const svgFiles = files.filter((file) => path.extname(file).toLowerCase() === '.svg');

	if (svgFiles.length === 0) {
		console.log('No SVG files found in the input directory.');
		return;
	}

	// Convert each SVG to PNG
	for (const svgFile of svgFiles) {
		const pngFile = `${path.basename(svgFile, '.svg')}.png`; // Replace .svg with .png
		await convertSvgToPng(path.join(inputDir, svgFile), path.join(outputDir, pngFile));
	}

	console.log('All SVGs processed.');
}
/*
const font = "/Applications/Visual Studio Code.app/Contents/Resources/app/out/media/codicon.ttf"
fs.readFile(font, (err, buffer) => {
		if (err) {
				console.error('Error reading font file:', err);
				return;
		}

		const svgContent = ttf2svg(buffer);
		fs.writeFileSync('fontello.svg', svgContent);
		console.log('SVG file created successfully!');
});
*/

const inputDir	= process.argv[2];//path.join(__dirname, 'input'); // Folder containing SVGs
const outputDir	= process.argv[3];//path.join(__dirname, 'output'); // Folder to save PNGs

console.log(`${inputDir} to ${outputDir}`);

// Ensure the output directory exists
if (!fs.existsSync(outputDir))
	fs.mkdirSync(outputDir);

processSvgs(inputDir, outputDir);