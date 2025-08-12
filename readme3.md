# TaskMake – Make-like Dependencies for VS Code Tasks

**TaskMake** is a VS Code extension that brings *make-like* functionality to your `tasks.json` — letting tasks declare **inputs** and **outputs**, and only run when they’re out of date.

It integrates directly with VS Code’s task system, so you don’t need Makefiles or external build tools if you don’t want them. Everything is expressed as VS Code tasks, but with automatic dependency checking and incremental builds.

---

## Features
- **Inputs & Outputs**: Specify which files a task depends on and what it produces.
- **Up-to-date checks**: Skips running tasks if outputs are newer than inputs.
- **Automatic dependencies**: If inputs are missing or stale, TaskMake searches for tasks that can produce them.
- **Glob matching**: Outputs can be declared as globs so one rule can produce many files.
- **Variable substitution**: Once a match is found, `${file…}` variables in the task definition are expanded based on the matched filename.
- **Nested builds**: Tasks can trigger other tasks until all dependencies are satisfied.

---

## How Matching Works
- **Outputs**: Use globs (e.g. `build/*.o`) to declare what files this task *can* produce. These globs are used for dependency resolution — `${file…}` variables inside `outputs` are *not* used for matching.
- **Inputs**: Can be explicit file paths or globs. If a glob is used, it’s expanded immediately to currently existing files — it won’t cause new files to be created.
- **Dependency search**: When an input is missing or out of date, TaskMake looks for a task whose `outputs` glob matches the filename.
- **Variable substitution**: Once a matching task is found, `${file…}` variables are expanded using the matched filename during task execution.

---

## Quick Start Example

```json
{
    "version": "2.0.0",
    "tasks": [
        {
            "label": "compile-cpp",
            "type": "dependant",
            "command": "g++",
            "args": ["-c", "${input}", "-o", "${output}"],
            "inputs": ["src/*.cpp"],
            "outputs": ["build/*.o"]
        },
        {
            "label": "link",
            "type": "dependant",
            "command": "g++",
            "args": ["-o", "program", "build/*.o"],
            "inputs": ["build/*.o"],
            "outputs": ["program"]
        }
    ]
}
```

---

### How it Works in This Example
1. You run `link`.
2. TaskMake sees that `link` depends on `build/*.o`.
3. It checks if those `.o` files are newer than `program`.
4. If any are missing or out-of-date, TaskMake looks for a task whose `outputs` match each missing or stale `.o`.
5. It finds `compile-cpp` because its `outputs` glob (`build/*.o`) matches.
6. It runs `compile-cpp` for each matching `.cpp` file in `src/`.
7. Once all `.o` files are up to date, `link` runs.

---

## Task Definition Parameters

Each TaskMake task uses `type: "dependant"` and can have one of three execution forms:

- **Command-based**  
  ```json
  { "command": "g++", "args": ["..."] }
  ```

- **Process-based** (runs a background process)  
  ```json
  { "process": "myTool", "args": ["..."] }
  ```

- **Task-based** (runs another VS Code task)  
  ```json
  { "task": "some-other-task-label" }
  ```

Common parameters:
- `label` — Task label (as in normal VS Code tasks).
- `inputs` — Files/globs to check timestamps against.
- `outputs` — Globs declaring what files the task can produce (used for matching).
- `ignoreErrors` — If true, continue the build even if this task fails.
- `options.cwd` — Working directory for the task.
- `options.env` — Environment variables for the task.
- `dependsOn` — Explicit extra tasks to run before this one.

---

## Why TaskMake Instead of Make?
- Fully integrated into VS Code’s Tasks UI.
- No need to maintain separate Makefiles.
- Cross-platform: works wherever VS Code runs.
- Still plays nicely with Make or other tools if you want to mix them.

---

## License
MIT — see LICENSE for details.
