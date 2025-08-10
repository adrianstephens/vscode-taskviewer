import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as child_process from 'child_process';
import {Glob, GlobFixer, fix, isWild, expandFilePatterns} from './glob';
import {taskId} from './extension';

type runnableTaskDefinition = vscode.TaskDefinition & ({
	process:		string;
	args?: 			string[];
	options?:		vscode.ProcessExecutionOptions;
} | {
	commandLine:	string | undefined;
	options?:		vscode.ShellExecutionOptions;
} | {
	command:		string | vscode.ShellQuotedString;
	args?:			(string | vscode.ShellQuotedString)[];
	options?:		vscode.ShellExecutionOptions;
});

export type DependantTaskDefinition = vscode.TaskDefinition
& (	{ command:	string; }
  |	{ task:		string; }
) & {
	label:		string;
	inputs?:	string[];
	outputs?:	string[];
	options?:	{
		cwd?: string;
		env?: Record<string, string>;
	};
	ignoreErrors?:	boolean;
}

export function isDependant(definition: vscode.TaskDefinition): definition is DependantTaskDefinition {
	return definition.type === 'dependant';
}

function getCommandLine(definition: runnableTaskDefinition) {
	if ('commandLine' in definition)
		return definition.commandLine;

	if ('process' in definition)
		return `${definition.process} ${definition.args?.join(' ')}`;

	return `${definition.command} ${definition.args?.join(' ')}`;
}

function pick<T, K extends keyof T>(obj: T, ...keys: K[]): Pick<T, K> {
	return Object.fromEntries(keys.map(key => [key, obj[key]])) as Pick<T, K>;
}

function setPresentationOptions(task: vscode.Task) {
	task.presentationOptions = {
		reveal: vscode.TaskRevealKind.Always,
		echo: true,
		focus: false,
		panel: vscode.TaskPanelKind.Shared,
		showReuseMessage: false,
		clear: false,
		group: 'dependant'
	} as vscode.TaskPresentationOptions;
	return task;
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
		const cwd = definition.options?.cwd || vscode.workspace.workspaceFolders?.[0].uri.fsPath;
		const env = definition.options?.env;
		const shell = !!(definition.commandLine || definition.command);

		const process = child_process.spawn(
			definition.commandLine ?? definition.command ?? definition.process,
			definition.args ?? [],
			{
				cwd,
				env,
				shell,
				stdio: ['pipe', 'pipe', 'pipe']
			}
		);

		process.stdout.on('data', (data: Buffer) => output(data.toString()));
		process.stderr.on('data', (data: Buffer) => output(data.toString()));
		process.on('close', (code: number) => resolve(code));
		process.on('error', (error: Error) => {
			output(`Command error: ${error.message}\r\n`);
			resolve(1);
		});
	});
}

interface Tasks	{
	all:		vscode.Task[],
	byOutput:	Record<string, vscode.Task>,
	byId:		Record<string, vscode.Task>,
	wild:		{glob: Glob, task: vscode.Task}[]
}

export class DependantTaskProvider implements vscode.TaskProvider {
	asyncTasks?:	Thenable<Tasks>;
	tasks?:			Tasks;
 
	timeout?:		NodeJS.Timeout;
	runningTasks	= new Set<string>();

	constructor(private context: vscode.ExtensionContext) {
	}

	public async provideTasks(): Promise<vscode.Task[]> {
		return [];
	}

	public resolveTask(task: vscode.Task): vscode.Task | undefined {
		const definition = task.definition;

		if (isDependant(definition)) {
			if (!definition.command && !definition.task) {
				console.error('Task definition must specify command or task:', definition);
				return undefined;
			}
			return this.fixDependantTask(task, definition, task.name);
		}

		return undefined;
	}

	
	private fixDependantTask(task: vscode.Task, definition: DependantTaskDefinition, label: string): vscode.Task {
		const preResolved = {} as any;
		if (!definition.options?.cwd)
			preResolved.options = {cwd: typeof task.scope === 'object' ? task.scope?.uri.fsPath : vscode.workspace.workspaceFolders?.[0].uri.fsPath};

		// Create the task
		const task2 = new vscode.Task(
			definition,
			task.scope!,
			label,
			'dependant',
			new vscode.CustomExecution(async resolved => new DependantCustomExecution({...(resolved as DependantTaskDefinition), ...preResolved, label}, this))
		);
		return setPresentationOptions(task2);
	}

	private makeDependentTask(task: vscode.Task, tasks: vscode.Task[], fixer: GlobFixer) {
		const definition	= task.definition as DependantTaskDefinition;

		if (definition.task) {
			const task2 = tasks.find(t => t.name === definition.task);
			if (task2) {
				const	definition2	= {...task2.definition, type: 'dependant2'};
				const	execution2	= task2.execution;

				if (execution2 instanceof vscode.ShellExecution) {
					Object.assign(definition2, pick(execution2, 'commandLine', 'command', 'args', 'options'));

				} else if (execution2 instanceof vscode.ProcessExecution) {
					Object.assign(definition2, pick(execution2, 'process', 'args', 'options'));
				}

				const newTask = new vscode.Task(
					fix(fixer, definition2),
					task2.scope!,
					task2.name,
					task2.source,
					execution2 instanceof vscode.CustomExecution ? execution2 : new vscode.CustomExecution(async resolved => new WrappedCustomExecution(resolved, task2.name)),
					task2.problemMatchers
				);
				return setPresentationOptions(newTask);
			}
		} else {
			const match 		= fixer.fix('${file}');
			const definition2	= {...definition,
				inputs:		definition.inputs?.map(i => fixer.fix(i)),
				outputs:	[match],
				command:	definition.command && fixer.fix(task.definition.command)
			};

			const newTask = this.fixDependantTask(task, definition2, `${task.name} (${match})`);
			//(newTask as any)._id = `${newTask.source}.${newTask.name}.${match}`;
			return newTask;
		}
	}
	
	refresh() {
		clearTimeout(this.timeout);
		this.asyncTasks = undefined;
	}

	async getTasksAsync(refresh = false) {
		if (!this.asyncTasks || (refresh && !this.timeout)) {
			this.asyncTasks = vscode.tasks.fetchTasks().then(all => {
				this.timeout = setTimeout(()=> this.timeout = undefined, 5000);

				const byOutput: Record<string, vscode.Task> = {};
				const wild: {glob: Glob, task: vscode.Task}[] = [];
				const byId: Record<string, vscode.Task> = Object.fromEntries(all.map(task => [taskId(task), task]));

				for (const task of all) {
					if (isDependant(task.definition) && task.definition.outputs) {
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

	getDepends(inputs: string[]): vscode.Task[] {
		const tasks	= this.getTasks();
		const dependencies: vscode.Task[] = [];

		for (const input of inputs) {
			const normalized	= path.normalize(input);
			const task			= tasks.byOutput[normalized];
			
			if (task) {
				dependencies.push(task);

			} else {
				for (const {glob, task} of tasks.wild) {
					if (glob.test(normalized)) {
						const dep = this.makeDependentTask(task, tasks.all, glob.fixer(normalized));
						if (dep)
							dependencies.push(dep);
						break;
					}
				}
			}
		}

		return dependencies;
	}

	async checkIfTaskNeedsRun(inputs: string[], outputs: string[]): Promise<boolean> {
		if (!outputs || !inputs)
			return true;

		// Check if all output files exist & get latest time
		let oldestOutputTime = Number.MAX_SAFE_INTEGER;
		let newestInputTime = 0;

		for (const output of outputs) {
			if (!fs.existsSync(output))
				return true;

			const stats = fs.statSync(output);
			oldestOutputTime = Math.min(oldestOutputTime, stats.mtime.getTime());
		}


		for (const input of inputs) {
			if (!fs.existsSync(input))
				return true;

			const stats = fs.statSync(input);
			newestInputTime = Math.max(newestInputTime, stats.mtime.getTime());
		}

		return newestInputTime > oldestOutputTime;
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
	}
}

class DependantCustomExecution implements vscode.Pseudoterminal {
	private writeEmitter = new vscode.EventEmitter<string>();
	private closeEmitter = new vscode.EventEmitter<number>();

	get onDidWrite()	{ return this.writeEmitter.event; }
	get onDidClose()	{ return this.closeEmitter.event; }
	get output()		{ return (msg: string) => this.writeEmitter.fire(msg); }

	constructor(private definition: DependantTaskDefinition, private provider: DependantTaskProvider) {
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
			this.writeEmitter.fire(`ERROR: Circular dependency detected for task '${taskId}'\r\n`);
			this.closeEmitter.fire(1);
			return;
		}

		try {
			if (this.definition.inputs) {
				const cwd		= this.definition.options?.cwd || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';

				// 1. Check if task needs to run based on timestamps
				const inputs	= await expandFilePatterns(this.definition.inputs, cwd, this.output);
				const outputs	= (this.definition.outputs || []).map(file => path.resolve(cwd, file));

				const needsRun	= await this.provider.checkIfTaskNeedsRun(inputs, outputs);
				if (!needsRun) {
					this.output(`Task '${taskId}' is up to date - skipping\r\n`);
					this.closeEmitter.fire(0);
					return;
				}

				// 2. Run dependent tasks (both explicit and inferred from files)
				const dependencies = await this.provider.getDepends(this.definition.inputs);
				if (dependencies.length) {
					this.output(`Task '${taskId}': Running dependencies...\r\n`);
					try {
						await Promise.all(dependencies.map(async task => {
							this.output(`Running task: ${task.name}\r\n`);
							const exitCode = await runTask(task);
							if (exitCode)
								throw exitCode;
						}));
					} catch (exitCode) {
						this.output(`Dependencies failed for task '${taskId}'\r\n`);
						this.closeEmitter.fire(typeof exitCode === 'number' ? exitCode : 1);
						return;
					}
				}
			}

			// 3. Execute the main command
			this.output(`Task '${taskId}': Executing: ${this.definition.command ?? this.definition.task}\r\n`);
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
			const tasks	= this.provider.getTasks();
			const task	= tasks.all.find(t => t.name === this.definition.task);
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

class WrappedCustomExecution implements vscode.Pseudoterminal {
	private writeEmitter = new vscode.EventEmitter<string>();
	private closeEmitter = new vscode.EventEmitter<number>();

	get onDidWrite()	{ return this.writeEmitter.event; }
	get onDidClose()	{ return this.closeEmitter.event; }

	constructor(private resolved: vscode.TaskDefinition, public name: string) {//}, private execution: vscode.ShellExecution | vscode.ProcessExecution) {
	}

	open(_initialDimensions: vscode.TerminalDimensions | undefined): void {
		const runnable = this.resolved as runnableTaskDefinition;
		this.writeEmitter.fire(`Task '${this.name}': Executing: ${getCommandLine(runnable)}\r\n`);
		runTaskDirect(runnable, msg => this.writeEmitter.fire(msg)).then(exitCode => {
			this.writeEmitter.fire(`Command exited with code ${exitCode}\r\n`);
			this.closeEmitter.fire(exitCode);
		});
	}

	close(): void {
	}
}
