import * as path from 'path';
import * as fs from 'fs';

/*
export class GlobStarFixer {
	wildcard: string;

	constructor(glob: string, match: string) {
		const parts = glob.split('*');
		this.wildcard = match.slice(parts[0].length, match.length - parts[1].length);
	}
	fix(match: string, input: string) {
		return input.replaceAll('*', this.wildcard);
	}
}
*/

export class GlobFixer {
	constructor(public matches: Record<string, string>) {}
	fix(input: string) {
		for (const [key, value] of Object.entries(this.matches))
			input = input.replaceAll(key, value);
		return input;
	}
}

export function fix<T>(fixer: GlobFixer, input: T): T {
	if (typeof input === 'string')
		return fixer.fix(input) as T;

 	if (typeof input === 'object' && input !== null) {
		if (Array.isArray(input))
			return input.map(value => fix(fixer, value)) as T;

		return Object.entries(input).reduce((acc, [key, value]) => {
			acc[key] = fix(fixer, value);
			return acc;
		}, Object.create(Object.getPrototypeOf(input)));// as T;
	}
	return input;
}

export class Glob {
	re: RegExp;
	constructor(public glob: string) {
		const regex = glob
		.replace(/[.+^${}()|[\]\\]/g, '\\$&') // Escape regex chars except * and ?
		.replace(/\*/g, '.*') // * matches any chars
		.replace(/\?/g, '.'); // ? matches single char

		this.re = new RegExp(`^${regex}$`);
	}
	test(match: string) {
		return this.re.test(match);
	}
	fixer(match: string) {
		const parsed_glob	= path.parse(this.glob);
		const parsed_match	= path.parse(match);
		const parts			= this.glob.split('*');

		return new GlobFixer({
			'${*}':		match.slice(parts[0].length, match.length - parts[1].length),
			'${file}':	match,

			...(parsed_glob.dir === '*'			? {'${fileDirname}':				parsed_match.dir} : undefined),
			...(parsed_glob.dir.endsWith('/*')	? {'${fileDirnameBasename}':		path.basename(parsed_match.dir)} : undefined),
			...(parsed_glob.base === '*.*'		? {'${fileBasename}':				parsed_match.base} : undefined),
			...(parsed_glob.name === '*'		? {'${fileBasenameNoExtension}':	parsed_match.name} : undefined),
			...(parsed_glob.ext === '*'			? {'${fileExtname}':				parsed_match.ext} : undefined),
		});
	}
//	star_fixer(match: string) {
//		return new GlobStarFixer(this.glob, match);
//	}
}

export function isWild(glob: string) {
	return glob.includes('*') || glob.includes('?');
}

export async function expandFilePatterns(patterns: string[], cwd: string, output: (message: string) => void): Promise<string[]> {
	const files: string[] = [];
	
	for (const i of patterns) {
		const pattern = path.resolve(cwd, i);
		if (isWild(i)) {
			const dir	= path.dirname(pattern);
			const glob	= new Glob(path.basename(pattern));
			try {
				const entries = fs.readdirSync(dir, { withFileTypes: true });
				files.push(...entries
					.filter(dirent => !dirent.isDirectory() && glob.test(dirent.name))
					.map(dirent => path.join(dirent.parentPath, dirent.name))
				);
			} catch (error) {
				output(`Warning: Cannot read directory ${dir}: ${error}\r\n`);
			}
		} else {
			files.push(pattern);
		}
	}

	return [...new Set(files)]; // Remove duplicates
}
