# Task Viewer

Provides quick access to your workspace tasks and/or launch scripts from the explorer or debug view.

![View](https://raw.githubusercontent.com/adrianstephens/vscode-taskviewer/main/assets/recording.gif)

## ☕ Support My Work  
If you enjoy this extension, consider [buying me a cup of tea](https://coff.ee/adrianstephens) to support future updates!  

## Features

- Tasks grouped by task group
- Full support for multi-root workspaces, and optional grouping by folder
- Task icons based on task name, with colors based on task type
- View all tasks, or only configured tasks (found in tasks.json)
- Launch scripts optionally shown in task view
- Separate Launch script view in debug pane, grouped by presentation group
- Task and Launch script execution on click from the explorer view
- Task and Launch script editing (opens in appropriate tasks.json or launch.json)
- Visual status updates for running, successful, or failed tasks
- Stop button for running tasks or active debug sessions (<img src="https://raw.githubusercontent.com/adrianstephens/vscode-taskviewer/main/assets/icons/error.png"/>)

### Icons

Theme icons are associated with strings found in task or launch script names, and can be customized using the setting `taskviewer.icons`. The default associations are:
- clean:			trash			(<img src="https://raw.githubusercontent.com/adrianstephens/vscode-taskviewer/main/assets/icons/trash.png"/>)
- build: 			package 		(<img src="https://raw.githubusercontent.com/adrianstephens/vscode-taskviewer/main/assets/icons/package.png"/>)
- rebuild: 			package 		(<img src="https://raw.githubusercontent.com/adrianstephens/vscode-taskviewer/main/assets/icons/package.png"/>)
- test: 			beaker 			(<img src="https://raw.githubusercontent.com/adrianstephens/vscode-taskviewer/main/assets/icons/beaker.png"/>)
- debug: 			bug 			(<img src="https://raw.githubusercontent.com/adrianstephens/vscode-taskviewer/main/assets/icons/bug.png"/>)
- launch: 			rocket 			(<img src="https://raw.githubusercontent.com/adrianstephens/vscode-taskviewer/main/assets/icons/rocket.png"/>)
- terminal: 		terminal 		(<img src="https://raw.githubusercontent.com/adrianstephens/vscode-taskviewer/main/assets/icons/terminal.png"/>)
- watch: 			eye 			(<img src="https://raw.githubusercontent.com/adrianstephens/vscode-taskviewer/main/assets/icons/eye.png"/>)
- deploy: 			cloud-upload	(<img src="https://raw.githubusercontent.com/adrianstephens/vscode-taskviewer/main/assets/icons/cloud-upload.png"/>)
- start: 			play 			(<img src="https://raw.githubusercontent.com/adrianstephens/vscode-taskviewer/main/assets/icons/play.png"/>)
- stop: 			debug-stop 	    (<img src="https://raw.githubusercontent.com/adrianstephens/vscode-taskviewer/main/assets/icons/debug-stop.png"/>)
- publish: 			cloud 			(<img src="https://raw.githubusercontent.com/adrianstephens/vscode-taskviewer/main/assets/icons/cloud.png"/>)
- default: 			gear 			(<img src="https://raw.githubusercontent.com/adrianstephens/vscode-taskviewer/main/assets/icons/gear.png"/>)

### Colors
Theme colors are associated with task or launch script types, and can be customized using the setting `taskviewer.colors`. The default associations are:
##### Tasks
- npm: 				<span style="color: red;">chart.red</span>
- shell: 			<span style="color: blue;">chart.blue</span>
- typescript: 	    <span style="color: purple;">chart.purple</span>
- gulp: 			<span style="color: orange;">chart.orange</span>
- grunt: 			<span style="color: yellow;">chart.yellow</span>
##### Launch scripts
- node: 			<span style="color: red">chart.red</span>
- extensionHost:    <span style="color: blue">chart.blue</span>
- chrome:			<span style="color: green">chart.green</span>
- msedge:			<span style="color: purple">chart.purple</span>
- compound:			<span style="color: blue">chart.blue</span>
- default: 			<span style="color: yellow">chart.yellow</span>

## Extension
This extension provides an extension mechanism of its own to allow customisation by task type, and to extend the list of items shown.

### API:
````typescript

interface TypeHandler {
	makeItem(id: string, task: vscode.Task|undefined, def: vscode.TaskDefinition, workspace?: vscode.WorkspaceFolder): CustomItem | void;
}

interface TaskProvider {
	provideItems(): Promise<CustomItem[]>;
}

interface CustomItem {
	title:		string;					// item title displayed in tree
	group?:		string;					// optional group for grouped placement in tree
	icon?:		vscode.ThemeIcon;		// optional icon displayed in tree
	tooltip?:	vscode.MarkdownString;
	run?():		void;					// called when user tries to run this item
	edit?():	void;					// called when user tries to edit this item
	children?(): Promise<CustomItem[]>;	// optional child nodes displayed in tree
}

//API
	registerType(type: string, handler: TypeHandler) {
		this.types[type] = handler;
	}
	registerProvider(handler: TaskProvider) {
		this.providers.push(handler);
	}

````


To use, first obtain the api from this extension, then use registerType to override the items displayed for a specific task type, and/or use registerProvider to create custom items.

### Example:


````typescript
import type {exports as taskviewerExports, CustomItem} from '<path to extensions>/isopodlabs.taskview-0.5.1/out/extension';

//in activate
	...

	const taskview =  vscode.extensions.getExtension('isopodlabs.taskviewer');
	if (taskview) {
		taskview.activate().then(() => {
			const api = taskview.exports as taskviewerExports;

			api.registerType('myTaskType', {
				makeItem(id, task, def, workspace) {
					return {
						title: 'My amazing task',
						...
					}
				}
			});

			api.registerProvider({
				async provideItems() {
					const items: CustomItem[] = [];
					//make some items
					return items;
				}
			});
			---
		})
	}

	...
````

Please ask on github for more details.