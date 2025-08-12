import * as path from 'path';
import * as fs from 'fs';

export class GlobFixer {
	constructor(public matches: Record<string, string>) {}
	add(key: string, value: string) {
		this.matches[key] = value;
		return this;
	}
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

export function fileFixer(match: string) {
	const parsed_match	= path.parse(match);
	return new GlobFixer({
		'${file}':						match,
		'${fileDirname}':				parsed_match.dir,
		'${fileDirnameBasename}':		path.basename(parsed_match.dir),
		'${fileBasename}':				parsed_match.base,
		'${fileBasenameNoExtension}':	parsed_match.name,
		'${fileExtname}':				parsed_match.ext,
	});
}

function globRe(glob: string) {
	const regex = glob
		.replace(/[.+^${}()|[\]\\]/g, '\\$&') // Escape regex chars except * and ?
		.replace(/\*/g, '[^/]*')	// * matches any chars except dir separator
		.replace(/\*\*/g, '.*')		// ** matches any chars
		.replace(/\?/g, '.');		// ? matches single char

	return new RegExp(`^${regex}$`);
}


export class Glob {
	re: RegExp;
	constructor(public glob: string) {
		this.re = globRe(glob);
	}
	test(match: string) {
		return this.re.test(match);
	}
	star(match: string) {
		const parts			= this.glob.split('*');
		return match.slice(parts[0].length, match.length - parts[1].length);
	}
}

export function isWild(glob: string) {
	return glob.includes('*') || glob.includes('?');
}

async function getDirs(dir: string, glob: RegExp): Promise<string[]> {
	const star	= dir.indexOf('*');

	if (star >= 0) {
		const startDir 	= dir.lastIndexOf(path.sep, star);
		const endDir	= dir.indexOf(path.sep, star);
		const dirDone	= dir.substring(0, startDir);
		const dirWild	= dir.substring(startDir + 1, endDir >= 0 ? endDir : undefined);
		const dirRest	= endDir >= 0 ? dir.substring(endDir + 1) : '';

		const entries	= await fs.promises.readdir(dirDone, { withFileTypes: true }).then(entries =>
			entries.filter(i => i.isDirectory())
		);

		if (dirWild === '**') {
			return (await Promise.all(entries.map(async i => [
				...await getDirs(path.join(i.parentPath, i.name, '**', dirRest), glob),
				...await getDirs(path.join(i.parentPath, i.name, dirRest), glob)
			]))).flat();

		} else {
			const dirGlob	= globRe(dirWild);
			return (await Promise.all(entries.filter(i => dirGlob.test(i.name))
				.map(i => getDirs(path.join(dirDone, i.name, dirRest), glob))
			)).flat();
		}

	} else {
		try {
			const entries = await fs.promises.readdir(dir, { withFileTypes: true });
			return entries
				.filter(i => !i.isDirectory() && glob.test(i.name))
				.map(i => path.join(i.parentPath, i.name));

		} catch (error) {
			console.log(`Warning: Cannot read directory ${dir}: ${error}`);
			return [];
		}
	}
}

export async function expandFilePatterns(patterns: string[], cwd: string): Promise<string[]> {
	const files = (await Promise.all(patterns.map(async i => {
		const pattern = path.resolve(cwd, i);
		return isWild(i)
			? await getDirs(path.dirname(pattern), globRe(path.basename(pattern)))
			: pattern;
	}))).flat();
/*
	const files: string[] = [];

	for (const i of patterns) {
		const pattern = path.resolve(cwd, i);
		if (isWild(i)) {
			files.push(...await getDirs(path.dirname(pattern), globRe(path.basename(pattern))));
		} else {
			files.push(pattern);
		}
	}
*/
	return [...new Set(files)]; // Remove duplicates
}
