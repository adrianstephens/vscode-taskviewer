# Task Viewer

Provides quick access to your workspace tasks and/or launch scripts from the explorer or debug view.


## Features

- Tasks grouped by task group
- Task icons based on task name, with colors based on task type
- View all tasks, or only configured tasks (found in tasks.json)
- Launch scripts optionally shown in task view
- Separate Launch script view in debug pane, grouped by presentation group
- Task and Launch script execution on click from the explorer view
- Task and Launch script editing (opens in appropriate tasks.json or launch.json)
- Visual status updates for running, successful, or failed tasks (with exit codes)
- Stop button for running tasks or active debug sessions (<img src="https://raw.githubusercontent.com/microsoft/vscode-codicons/main/src/icons/stop-circle.svg" width="16" height="16" />)

### Icons

Theme icons are associated with strings found in task or launch script names, and can be customized using the setting `taskviewer.icons`. The default associations are:
- clean:			trash			(<img src="assets/icons/trash.png"/>)
- build: 			package 		(<img src="assets/icons/package.png"/>)
- rebuild: 			package 		(<img src="assets/icons/package.png"/>)
- test: 			beaker 			(<img src="assets/icons/beaker.png"/>)
- debug: 			bug 			(<img src="assets/icons/bug.png"/>)
- launch: 			rocket 			(<img src="assets/icons/rocket.png"/>)
- terminal: 		terminal 		(<img src="assets/icons/terminal.png"/>)
- watch: 			eye 			(<img src="assets/icons/eye.png"/>)
- deploy: 			cloud-upload	(<img src="assets/icons/cloud-upload.png"/>)
- start: 			play 			(<img src="assets/icons/play.png"/>)
- stop: 			debug-stop 	    (<img src="assets/icons/debug-stop.png"/>)
- publish: 			cloud 			(<img src="assets/icons/cloud.png"/>)
- default: 			gear 			(<img src="assets/icons/gear.png"/>)

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
