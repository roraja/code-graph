--
I want to be able to explore scenarios code graph in VS Code environment. So as I step into a scenario, I can see the code location in VS Code where I usually work. I'm imagining a VS Code extension which can live in the sidebar just like Copilot chat where I can browse through scenarios, and for a given scenario, I can walk through the scenario steps one by one, inspect variables and see the AI analysis of the function and reasoning. I still want this tool to remain independent. Create a very lightweight VS Code extension which internally will simply use this globally available code graph tool on the work space to populate its UI and have a simple UI to explore all the scenarios and for scenario step by step walk through the code. Create that extension and within VS Code Tasks have commands to install the extension or build the extension. Have the extension as a sub folder like code-graph-ext (think of better name maybe). Remember, the primary interface to the tool is still the CLI, the extension is just a UI plugin. web is still available.

Furthermore, The extension should allow exploring a function. So given a function, I can right click and say show scenarios which has this as well as I can ask it to explore scenario starting from this function. Log everything in dot VS Code slash code graph slash logs in a datewise file.
--

--
In the code graph web UI allow me to for a given function if I click open in VS Code, it should open that particular file and line number in a VS Code SSH remote instance. The SSH host name for the workspace can be configured in the code graph configuration. This way I can very easily navigate to the Vs Code file and line number from the web UI.
--
# Next
--
Refactor so that code-graph exposes JS as npm package which the vscode extension consumes. Maybe it can directly refer the JS API since its a mono-repo. Have a clear exports endpoint for the JS app, dont import from anyever.

--
I want to discover scenarios related to "GetUrlFromHDrop function in ui/base/clipboard/clipboard_util_win.cc:77" in /workspace/cr1/src.

Currently, I tried running in /workspace/cr1/src:

codegraph discover --hint "GetUrlFromHDrop function in ui/base/clipboard/clipboard_util_win.cc:77" 

but it fails for some reason. Can you check and fix all the issues until you are able to generate scenariios related to this function (using the CLI tool as if a user was using it). Find and fix the issues.
---

### Highlights and bookmarks
- LLM should add highlight at steps which is core


------

- In code walk, if there is branching, ask user to select a branch - like giving options list and letting user select
- Modify the codewalk generator skills and schema to have a tree kind of structure. Each cell can point to one or more next cells. In case there are multiple next cells, simply in the UI of Vscode, ask user to select which path to take. Have enough info for user to decide which path to explore using walks.
- This way, for walking complex functions with multiple if statements, I can explore all possible branches easily
- Implement this for test codewalk here to demonstrate branching - .vscode/code-graph/codewalks/resize-image-walk


---

- When saving code walk, for each codewalk folder, add file contents completely which can be restored when viewing codewalk 
--