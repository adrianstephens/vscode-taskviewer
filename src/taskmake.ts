import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as child_process from 'child_process';
import {Glob, GlobFixer, fix, isWild, expandFilePatterns, fileFixer} from './glob';
import {taskId} from './extension';

type runnableTaskDefinition = {
	process:		string;
	args?: 			string[];
	options?:		vscode.ProcessExecutionOptions;
} | {
	commandLine:	string;
	options?:		vscode.ShellExecutionOptions;
} | {
	command:		string | vscode.ShellQuotedString;
	args?:			(string | vscode.ShellQuotedString)[];
	options?:		vscode.ShellExecutionOptions;
} | {
	callback:		(resolved: vscode.TaskDefinition) => Thenable<vscode.Pseudoterminal>;
};

export type TaskMakeDefinition = vscode.TaskDefinition
& (	{
	command:	string;
	args?:		string[];
} | {
	process:	string;
	args?:		string[];
} |	{
	task:		string;
} ) & {
	label:		string;
	inputs?:	string[];
	outputs?:	string[];
	ignoreErrors?:	boolean;
	options?:	{
		cwd?: string;
		env?: Record<string, string>;
	};
	dependsOn?:	string[];
}

export function isTaskMake(definition: vscode.TaskDefinition): definition is TaskMakeDefinition {
	return definition.type === 'taskmake';
}

function pick<T, K extends keyof T>(obj: T, ...keys: K[]): Pick<T, K> {
	return Object.fromEntries(keys.map(key => [key, obj[key]])) as Pick<T, K>;
}

function getCommandLine(definition: runnableTaskDefinition) {
	if ('commandLine' in definition)
		return definition.commandLine;

	if ('process' in definition)
		return `${definition.process} ${definition.args?.join(' ')}`;

	if ('command' in definition)
		return `${definition.command} ${definition.args?.join(' ')}`;

	return 'custom';
}

function copyExecutionOptions(task: vscode.Task, custom: boolean) {
	const	definition2	= {...task.definition, type: 'taskmake2'};
	const	execution2	= task.execution;

	if (execution2 instanceof vscode.ShellExecution) {
		Object.assign(definition2, pick(execution2, 'commandLine', 'command', 'args', 'options'));

	} else if (execution2 instanceof vscode.ProcessExecution) {
		Object.assign(definition2, pick(execution2, 'process', 'args', 'options'));

	} else if (custom) {
		Object.assign(definition2, {callback: (execution2 as any).callback});
	}

	return definition2;
}


async function runTask(task: vscode.Task): Promise<number> {
	const execution = await vscode.tasks.executeTask(task);
	return new Promise<number>(resolve => {
		const disposable = vscode.tasks.onDidEndTaskProcess(e => {
			if (e.execution === execution) {
				disposable.dispose();
				resolve(e.exitCode || 0);
			}
		});
	});
}

async function runTaskDirect(definition: runnableTaskDefinition, output: (message: string) => void): Promise<number> {
	return new Promise<number>(resolve => {

		if ('callback' in definition) {
			definition.callback(definition as any as vscode.TaskDefinition).then(pseudo => {
				pseudo.onDidWrite!(data => output(data));
				pseudo.onDidClose!(exitCode => resolve(exitCode ?? 0));
				pseudo.open(undefined);
			});
			return;
		}

		const cwd		= definition.options?.cwd || vscode.workspace.workspaceFolders?.[0].uri.fsPath;
		const env		= definition.options?.env;
		const shell		= 'commandLine' in definition || 'command' in definition;
		const command
			= 'command' in definition		? (typeof definition.command ==='string' ? definition.command : definition.command.value)
			: 'commandLine' in definition	? definition.commandLine
			: definition.process;

		let args
			= 'command' in definition		? definition.args?.map(arg => (typeof arg ==='string' ? arg : arg.value))
			: 'args' in definition			? definition.args
			: [];

		if (shell && args)
			args = args.map(i => i.includes(' ') ? `"${i}"` : i);

		const process = child_process.spawn(
			command,
			args,
			{
				cwd,
				env,
				shell,
				stdio: ['pipe', 'pipe', 'pipe']
			}
		);

		process.stdout.on('data', (data: Buffer) => 
			output(data.toString().replaceAll('\n', '\r\n'))
		);
		process.stderr.on('data', (data: Buffer) => output(data.toString()));
		process.on('close', (code: number) => resolve(code));
		process.on('error', (error: Error) => {
			output(`Command error: ${error.message}\r\n`);
			resolve(1);
		});
	});
}

function setPresentationOptions(task: vscode.Task) {
	task.presentationOptions = {
		reveal: vscode.TaskRevealKind.Always,
		echo: true,
		focus: false,
		panel: vscode.TaskPanelKind.Shared,
		showReuseMessage: false,
		clear: false,
		group: 'taskmake'
	} as vscode.TaskPresentationOptions;
	return task;
}

async function checkIfTaskNeedsRun(inputs: string[], outputs: string[]): Promise<boolean> {
	if (!outputs.length)
		return true;

//	if (!inputs.length) {
//		mtimes(outputs).then(times => Math.min(...times)),
//	}



	async function mtimes(files: string[]) {
		return Promise.all(files.map(file => fs.promises.stat(file).then(stat => stat.mtime.getTime())));
	}

	// Check if all output files exist & get latest time
	try {
		const [minOutputTime, maxInputTime] = await Promise.all([
			mtimes(outputs).then(times => Math.min(...times)),
			mtimes(inputs).then(times => Math.max(...times))
		]);
		
		return maxInputTime > minOutputTime;

	} catch (_error) {
		return true;
	}
}

interface TaskRunner {
	run: (output: (message: string) => void) => Promise<number>;
}

class TaskRunnerNormal implements TaskRunner {
	constructor(public task: vscode.Task) {}
	async run(output: (message: string) => void) {
		output(`Running task: ${this.task.name}\r\n`);
		return runTask(this.task);
	}
}

class TaskRunnerDirect implements TaskRunner {
	direct: runnableTaskDefinition;
	name:	string;
	constructor(task: vscode.Task, fixer?: GlobFixer) {
		this.direct = copyExecutionOptions(task, true) as any as runnableTaskDefinition;
		if (fixer)
			this.direct = fix(fixer, this.direct);
		this.name	= task.name;
	}
	async run(output: (message: string) => void) {
		output(`Running task: ${this.name}\r\n`);
		return runTaskDirect(this.direct, output);
		/*
		this.provider.taskEmitter.fire({definition: this.definition, status: 'started'});
		const exitCode = await runTaskDirect(this.definition as runnableTaskDefinition, this.output);
		this.provider.taskEmitter.fire({definition: this.definition, status: 'finished', exitCode});
		return exitCode;
		*/
	}
}

class MakeTaskRunnerDirect implements TaskRunner {
	direct: 	runnableTaskDefinition;
	name:		string;
	needsRun:	Promise<boolean> = Promise.resolve(true);

	constructor(task: vscode.Task, public dependsOn: TaskRunner[], fixer?: GlobFixer) {
		const definition	= task.definition as TaskMakeDefinition;
		const cwd			= definition.options?.cwd ?? (typeof task.scope === 'object' ? task.scope?.uri.fsPath : vscode.workspace.workspaceFolders?.[0].uri.fsPath ?? '');
		
		if (definition.inputs) {
			const inputs	= fixer ? definition.inputs.map(i => fixer.fix(i))	: definition.inputs;
			const outputs	= fixer ? [path.resolve(cwd, fixer.fix('${file}'))]	: definition.outputs ?? [];
			this.needsRun	= expandFilePatterns(inputs, cwd).then(inputs => checkIfTaskNeedsRun(inputs, outputs));
		}

		this.direct		= {...definition, command: definition.command};
		if (fixer)
			this.direct	= fix(fixer, this.direct);
		this.name		= task.name;
	}

	async run(output: (message: string) => void) {
		const needsRun = await this.needsRun;
		if (!needsRun) {
			output(`'${this.name}' is up to date - skipping\r\n`);
			return 0;
		}

		output(`Running task: ${this.name}\r\n`);
		if (this.dependsOn.length) {
			output(`Task '${this.name}': Running dependencies...\r\n`);
			try {
				await Promise.all(this.dependsOn.map(async runner => {
					const exitCode = await runner.run(output);
					if (exitCode)
						throw exitCode;
				}));
			} catch (_exitCode) {
				output(`Dependencies failed for task '${this.name}'\r\n`);
				return 1;
			}
		}

		return runTaskDirect(this.direct, output);
	}
};

class WrappedCustomExecution implements vscode.Pseudoterminal {
	private writeEmitter = new vscode.EventEmitter<string>();
	private closeEmitter = new vscode.EventEmitter<number>();

	get onDidWrite()	{ return this.writeEmitter.event; }
	get onDidClose()	{ return this.closeEmitter.event; }

	constructor(private resolved: vscode.TaskDefinition, public name: string) {//}, private execution: vscode.ShellExecution | vscode.ProcessExecution) {
	}

	open(_initialDimensions: vscode.TerminalDimensions | undefined): void {
		const runnable = this.resolved as any as runnableTaskDefinition;
		this.writeEmitter.fire(`Task '${this.name}': Executing: ${getCommandLine(runnable)}\r\n`);
		runTaskDirect(runnable, msg => this.writeEmitter.fire(msg)).then(exitCode => {
			this.writeEmitter.fire(`Command exited with code ${exitCode}\r\n`);
			this.closeEmitter.fire(exitCode);
		});
	}

	close(): void {
	}
}

interface Tasks	{
	readonly all:		vscode.Task[],
	readonly byOutput:	Record<string, vscode.Task>,
	readonly byId:		Record<string, vscode.Task>,
	readonly wild:		{glob: Glob, task: vscode.Task}[]
}

interface TaskEvent {
	readonly definition:	vscode.TaskDefinition;
	readonly status:		string;
	readonly exitCode?:		number;
}

export class MakeTaskProvider implements vscode.TaskProvider {
	public taskEmitter = new vscode.EventEmitter<TaskEvent>();
	get onTask()	{ return this.taskEmitter.event; }

	asyncTasks?:	Thenable<Tasks>;
	tasks?:			Tasks;
	timeout?:		NodeJS.Timeout;
	runningTasks	= new Set<string>();
	dependentTasks	= new Set<string>();

	constructor(private context: vscode.ExtensionContext) {
	}

	public async provideTasks(): Promise<vscode.Task[]> {
		return [];
	}

	public resolveTask(task: vscode.Task): vscode.Task | undefined {
		const definition = task.definition;

		if (isTaskMake(definition)) {
			if (!definition.command && !definition.task) {
				console.error('Task definition must specify command or task:', definition);
				return undefined;
			}

			return this.fixDependantTask(task, definition, {label: task.name || definition.command || definition.task, dependsOn: undefined});
		}

		return undefined;
	}
	
	private fixDependantTask(task: vscode.Task, definition: TaskMakeDefinition, preResolved: any): vscode.Task {
		preResolved.taskDir = typeof task.scope === 'object' ? task.scope?.uri.fsPath : vscode.workspace.workspaceFolders?.[0].uri.fsPath;
		if (!definition.options?.cwd)
			preResolved.options = {cwd: preResolved.taskDir};

		// Create the task
		const task2 = new vscode.Task(
			definition,
			task.scope!,
			preResolved.label,
			'taskmake',
			new vscode.CustomExecution(async resolved => new TaskMakeCustomExecution({...(resolved as TaskMakeDefinition), ...preResolved}, this))
		);
		return setPresentationOptions(task2);
	}

	checkInputs(inputs: string[], cwd: string): boolean {
		const tasks	= this.getTasks();
		for (const input of inputs) {
			if (isWild(input))
				continue;

			const normalized	= path.normalize(input);
			const resolved		= path.resolve(cwd, normalized);
			if (fs.existsSync(resolved))
				continue;

			if (tasks.byOutput[normalized])
				continue;

			let found = false;
			for (const {glob, task} of tasks.wild) {
				found = glob.test(normalized) && this.checkInputs(task.definition.inputs ?? [], cwd);
				if (found)
					break;
			}
			if (!found)
				return false;
		}
		return true;
	}

	getDepends(inputs: string[], dependsOn: string[], cwd: string): TaskRunner[] {
		const tasks	= this.getTasks();

		const getTaskByName = (name: string) => tasks.all.find(t => t.name === name);

		const fixTask = (task: vscode.Task, fixer: GlobFixer) => {
			const definition	= task.definition as TaskMakeDefinition;

			// ensure we can make all its inputs
			if (definition.inputs && !this.checkInputs(fix(fixer, definition.inputs), cwd))
				return;

			if (definition.task) {
				const task2 = getTaskByName(definition.task);
				if (task2) {
					const	definition2	= {...copyExecutionOptions(task2, false), type: 'taskmake2'};

					const newTask = new vscode.Task(
						fix(fixer, definition2),
						task2.scope!,
						fixer.fix(task2.name),
						task2.source,
						task2.execution instanceof vscode.CustomExecution
							? task2.execution
							: new vscode.CustomExecution(async resolved => new WrappedCustomExecution(resolved, task2.name)),
						task2.problemMatchers
					);
					return setPresentationOptions(newTask);
				}
			} else {
				const definition2 = fix(fixer, {...definition, outputs: ['${file}']});
				return this.fixDependantTask(task, definition2, {label: `${fixer.fix(task.name)} (${definition2.outputs[0]})`});
			}
		};

		const dependencies: TaskRunner[] = dependsOn
			.map(taskName => {
				if (this.dependentTasks.has(taskName)) {
					console.log(`Skipping ${taskName} - already run`);
					return undefined;
				}
				const task = getTaskByName(taskName);
				this.dependentTasks.add(taskName);
				return task;
			})
			.filter(Boolean)
			.map(task => new TaskRunnerNormal(task!));

		for (const input of inputs) {
			if (isWild(input))
				continue;

			const normalized	= path.normalize(input);
			const task			= tasks.byOutput[normalized];
			
			if (task) {
				const label = task.name;
				if (this.dependentTasks.has(label)) {
					console.log(`Skipping ${label} - already run`);
					continue;
				}
				this.dependentTasks.add(label);
				dependencies.push(new TaskRunnerNormal(task));

			} else {
				const resolved = path.resolve(cwd, normalized);
				let dep: vscode.Task | undefined;

				for (const {glob, task} of tasks.wild) {
					if (glob.test(normalized)) {
						dep = fixTask(task, fileFixer(resolved).add('${*}', glob.star(normalized)));
						if (dep)
							break;
					}
				}
				if (dep) {
					dependencies.push(new TaskRunnerNormal(dep));
				} else if (!fs.existsSync(resolved)) {
					console.log(`can't make ${resolved}`);
				}
			}
		}

		return dependencies;
	}
	
	getDependsDirect(inputs: string[], dependsOn: string[], cwd: string): TaskRunner[] {
		const tasks	= this.getTasks();

		const getTaskByName = (name: string) => tasks.all.find(t => t.name === name);

		const fixTask = (task: vscode.Task, fixer: GlobFixer) => {
			const definition	= task.definition as TaskMakeDefinition;

			if (definition.task) {
				const task2 = getTaskByName(definition.task);
				if (task2)
					return new TaskRunnerDirect(task, fixer);

			} else {
				return new MakeTaskRunnerDirect(task,
					this.getDependsDirect(fix(fixer, definition.inputs ?? []), definition.dependsOn ?? [], cwd),
					fixer
				);
			}
		};

		const dependencies: TaskRunner[] = dependsOn.map(taskName => getTaskByName(taskName))
			.filter(Boolean)
			.map(task => new TaskRunnerDirect(task!));


		for (const input of inputs) {
			if (isWild(input))
				continue;

			const normalized	= path.normalize(input);
			const task			= tasks.byOutput[normalized];
			
			if (task) {
				const definition = task.definition as TaskMakeDefinition;
				dependencies.push(new MakeTaskRunnerDirect(
					task,
					this.getDependsDirect(definition.inputs ?? [], definition.dependsOn ?? [], cwd)
				));

			} else {
				const resolved = path.resolve(cwd, normalized);
				let dep: TaskRunner | undefined;
				
				for (const {glob, task} of tasks.wild) {
					if (glob.test(normalized)) {
						dep = fixTask(task, fileFixer(resolved).add('${*}', glob.star(normalized)));
						if (dep)
							break;
					}
				}
				if (dep) {
					dependencies.push(dep);
				} else if (!fs.existsSync(resolved)) {
					console.log(`can't make ${resolved}`);
				}
			}
		}

		return dependencies;
	}

	refresh() {
		clearTimeout(this.timeout);
		this.asyncTasks = undefined;
	}

	async getTasksAsync(refresh = false) {
		if (!this.asyncTasks || (refresh && !this.timeout)) {
			this.asyncTasks = vscode.tasks.fetchTasks().then(all => {
				this.timeout = setTimeout(()=> this.timeout = undefined, 5000);

				const byOutput:	Record<string, vscode.Task> = {};
				const wild:		{glob: Glob, task: vscode.Task}[] = [];
				const byId:		Record<string, vscode.Task> = Object.fromEntries(all.map(task => [taskId(task), task]));

				for (const task of all) {
					if (isTaskMake(task.definition) && task.definition.outputs) {
						for (const output of task.definition.outputs) {
							const normalized = path.normalize(output);
							if (isWild(normalized))
								wild.push({glob: new Glob(normalized), task});
							else
								byOutput[normalized] = task;
						}
					}
				}
				return {all, byOutput, byId, wild};
			});
		}
		return this.tasks = await this.asyncTasks;
	}

	getTasks() {
		if (!this.tasks)
			throw new Error("no tasks");
		return this.tasks;
	}

	getTaskByName(name: string) {
		return this.getTasks().all.find(t => t.name === name);
	}

	getBuilder(input: string) {
		const tasks			= this.getTasks();
		const normalized	= path.normalize(input);
		const task			= tasks.byOutput[normalized];

		if (task)
			return task;

		for (const {glob, task} of tasks.wild) {
			if (glob.test(normalized))
				return task;
		}
	}

	anyRunning() {
		return this.runningTasks.size > 0;
	}
	isRunning(taskId: string) {
		if (this.runningTasks.has(taskId))
			return true;

		this.runningTasks.add(taskId);
		return false;
	}
	notRunning(taskId: string) {
		this.runningTasks.delete(taskId);
		if (this.runningTasks.size === 0)
			this.dependentTasks.clear();
	}
}

class TaskMakeCustomExecution implements vscode.Pseudoterminal {
	private writeEmitter = new vscode.EventEmitter<string>();
	private closeEmitter = new vscode.EventEmitter<number>();

	get onDidWrite()	{ return this.writeEmitter.event; }
	get onDidClose()	{ return this.closeEmitter.event; }
	get output()		{ return (msg: string) => this.writeEmitter.fire(msg); }

	constructor(private definition: TaskMakeDefinition, private provider: MakeTaskProvider) {
	}

	open(_initialDimensions: vscode.TerminalDimensions | undefined): void {
		this.execute();
	}

	close(): void {
		// Cleanup if needed
	}

	private async execute() {
		const taskId = this.definition.label;
		console.log(`starting ${taskId} ${this.provider.anyRunning()}`);

		await this.provider.getTasksAsync(!this.provider.anyRunning());
		
		// Prevent circular dependencies by tracking running tasks
		if (this.provider.isRunning(taskId)) {
			this.writeEmitter.fire(`Circular dependency detected for task '${taskId} (skipping)'\r\n`);
			this.closeEmitter.fire(0);
			return;
		}

		try {
			//const cwd		= this.definition.options?.cwd || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
			const taskDir	= this.definition.taskDir;

			// 1. Check if task needs to run based on timestamps

			const inputs	= await expandFilePatterns(this.definition.inputs ?? [], taskDir);
			const outputs	= (this.definition.outputs ?? []).map(file => path.resolve(taskDir, file));

			const needsRun	= await checkIfTaskNeedsRun(inputs, outputs);
			if (!needsRun) {
				this.output(`Task '${taskId}' is up to date - skipping\r\n`);
				this.closeEmitter.fire(0);
				return;
			}

			try {
				// 2. Run explicit and inferred dependent tasks
				const dependencies = this.provider.getDepends(this.definition.inputs ?? [], this.definition.dependsOn ?? [], taskDir);

				await Promise.all(dependencies.map(async task => {
					const exitCode = await task.run(this.output);
					if (exitCode)
						throw exitCode;
				}));

			} catch (exitCode) {
				this.output(`Dependencies failed for task '${taskId}'\r\n`);
				this.closeEmitter.fire(typeof exitCode === 'number' ? exitCode : 1);
				return;
			}

			// 3. Execute the main command

			this.output(`Task '${taskId}': Executing: ${this.definition.task ?? [this.definition.command, ...this.definition.args ?? []].join(' ')}\r\n`);
			const exitCode = await this.executeCommand();
			this.output(`Command exited with code ${exitCode}\r\n`);

			this.closeEmitter.fire(this.definition.ignoreErrors ? 0 : exitCode);

		} catch (error) {
			this.output(`Error: ${error}\r\n`);
			this.closeEmitter.fire(1);
		} finally {
			this.provider.notRunning(taskId);
			console.log(`stopped: ${taskId}`);
		}
	}

	private async executeCommand(): Promise<number> {
		if (this.definition.task) {
			const task	= this.provider.getTaskByName(this.definition.task);
			if (!task) {
				this.output(`Task '${this.definition.task}' not found\r\n`);
				return 1;
			}
			return runTask(task);

		} else {
			return runTaskDirect(this.definition as runnableTaskDefinition, this.output);

		}
	}

}
